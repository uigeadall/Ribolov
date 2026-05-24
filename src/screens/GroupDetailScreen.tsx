import React, { useCallback, useMemo, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { ActionSheet } from '../components/ActionSheet';
import { Button } from '../components/Button';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import {
  getGroup, getGroupPosts, isMember,
  joinGroup, leaveGroup, postToGroup, deleteGroupPost,
  getUpcomingEvents, setRsvp, getMyRsvp, deleteEvent,
  getPolls, castVote, getMyVote, deletePoll,
  type Group, type GroupPost,
  type GroupEvent, type RsvpStatus,
  type GroupPoll,
} from '../services/cloudSync';
import type { ProfileStackParamList } from '../navigation/types';
import { useAppNavigation } from '../navigation/useAppNavigation';
import { handleError } from '../utils/handleError';

type R = RouteProp<ProfileStackParamList, 'GroupDetail'>;
type Tab = 'posts' | 'events' | 'polls';

const RSVP_LABEL: Record<RsvpStatus, string> = {
  going: 'Идвам',
  maybe: 'Може би',
  not_going: 'Не',
};

function formatEventDate(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' });
    const time = d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
  } catch { return ''; }
}

function isUpcoming(iso: string): boolean {
  try { return new Date(iso).getTime() > Date.now() - 3 * 3600_000; }
  catch { return false; }
}

export default function GroupDetailScreen() {
  const navigation = useAppNavigation();
  const route = useRoute<R>();
  const { groupId, groupName } = route.params;
  const { colors, mode } = useTheme();
  const { user, configured } = useAuth();
  const insets = useSafeAreaInsets();

  const [tab, setTab] = useState<Tab>('posts');
  const [group, setGroup] = useState<Group | null>(null);
  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [polls, setPolls] = useState<GroupPoll[]>([]);
  const [myRsvps, setMyRsvps] = useState<Record<string, RsvpStatus | null>>({});
  const [myVotes, setMyVotes] = useState<Record<string, number | null>>({});
  const [joined, setJoined] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [postText, setPostText] = useState('');
  const [posting, setPosting] = useState(false);
  const [joining, setJoining] = useState(false);
  // Synchronous guard so a double-tap on the Join/Leave button can't fire
  // joinGroup/leaveGroup twice before React commits setJoining(true).
  const joiningRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin = group?.createdBy === user?.uid;

  const styles = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    metaText: { ...typography.caption, color: colors.textMuted },
    // Tabs
    tabsRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      gap: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    tabBtn: {
      flex: 1,
      paddingVertical: 10,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
      alignItems: 'center',
    },
    tabBtnActive: { borderBottomColor: colors.primary },
    tabBtnText: { fontSize: 13, fontFamily: 'Nunito_700Bold', color: colors.textMuted },
    tabBtnTextActive: { color: colors.text },
    // Posts
    postRow: { marginBottom: spacing.md },
    postAuthor: { ...typography.bodyBold, color: colors.text },
    postTime: { ...typography.small, color: colors.textMuted, marginTop: 1 },
    postText: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 22 },
    // Events
    eventCard: { marginBottom: spacing.md },
    eventDateBadge: {
      width: 56, alignItems: 'center', justifyContent: 'center',
      borderRadius: radius.md,
      backgroundColor: colors.primarySurface,
      paddingVertical: 6,
      marginRight: spacing.md,
    },
    eventDay: { fontSize: 22, fontFamily: 'Nunito_800ExtraBold', color: colors.primary, lineHeight: 24, letterSpacing: -0.5 },
    eventMonth: { fontSize: 10, fontFamily: 'Nunito_700Bold', color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 },
    eventTitle: { ...typography.bodyBold, color: colors.text, fontSize: 15 },
    eventMeta: { ...typography.small, color: colors.textMuted, marginTop: 2 },
    eventDesc: { ...typography.body, color: colors.text, marginTop: spacing.sm, lineHeight: 20 },
    rsvpRow: { flexDirection: 'row', gap: 6, marginTop: spacing.sm },
    rsvpBtn: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 4,
    },
    rsvpBtnActiveGoing: { backgroundColor: '#2E9B5A', borderColor: '#2E9B5A' },
    rsvpBtnActiveMaybe: { backgroundColor: '#F5A020', borderColor: '#F5A020' },
    rsvpBtnActiveNo: { backgroundColor: colors.danger, borderColor: colors.danger },
    rsvpBtnText: { fontSize: 11, fontFamily: 'Nunito_700Bold', color: colors.text },
    rsvpBtnTextActive: { color: '#fff' },
    rsvpCount: { fontSize: 11, fontFamily: 'Nunito_600SemiBold' },
    // Polls
    pollQuestion: { ...typography.bodyBold, color: colors.text, fontSize: 15, marginBottom: spacing.sm },
    pollOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 6,
      overflow: 'hidden',
      backgroundColor: colors.card,
    },
    pollOptionSelected: {
      borderColor: colors.primary,
      borderWidth: 2,
    },
    pollOptionBar: {
      position: 'absolute', left: 0, top: 0, bottom: 0,
      backgroundColor: colors.primarySurface,
      borderRadius: radius.md,
    },
    pollOptionText: { ...typography.body, color: colors.text, fontSize: 14, flex: 1, zIndex: 1 },
    pollOptionPct: { ...typography.bodyBold, color: colors.textMuted, fontSize: 13, zIndex: 1, marginLeft: 8 },
    pollFooter: { ...typography.small, color: colors.textMuted, marginTop: 6 },
    // FAB and composer
    fab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: Math.max(insets.bottom + 80, 100),
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35, shadowRadius: 12,
      elevation: 8,
    },
    composer: {
      flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm,
      paddingHorizontal: spacing.lg, paddingTop: spacing.sm,
      paddingBottom: Math.max(insets.bottom, spacing.md),
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
      backgroundColor: colors.card,
    },
    input: {
      flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
      paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      color: colors.text, maxHeight: 120, ...typography.body,
      backgroundColor: colors.surfaceAlt,
    },
    emptyWrap: {
      flex: 1,
      alignItems: 'center', justifyContent: 'center',
      paddingTop: spacing.xxl,
      paddingHorizontal: spacing.xl,
    },
    emptyText: { ...typography.body, color: colors.textMuted, marginTop: spacing.md, textAlign: 'center' },
  }), [colors, insets.bottom, mode]);

  const load = useCallback(async () => {
    if (!configured) return;
    const [g, p, am, evs, pls] = await Promise.all([
      getGroup(groupId),
      getGroupPosts(groupId),
      user ? isMember(groupId, user.uid) : Promise.resolve(false),
      getUpcomingEvents(groupId).catch(() => [] as GroupEvent[]),
      getPolls(groupId).catch(() => [] as GroupPoll[]),
    ]);
    setGroup(g);
    setPosts(p);
    setJoined(am);
    setMemberCount(g?.memberCount ?? 0);
    setEvents(evs);
    setPolls(pls);
    setRefreshing(false);

    // Hydrate my RSVP / vote state for the current items.
    if (user) {
      const rsvpEntries = await Promise.all(
        evs.map(async (e) => [e.id, await getMyRsvp(groupId, e.id, user.uid).catch(() => null)] as const),
      );
      setMyRsvps(Object.fromEntries(rsvpEntries));
      const voteEntries = await Promise.all(
        pls.map(async (p2) => [p2.id, await getMyVote(groupId, p2.id, user.uid).catch(() => null)] as const),
      );
      setMyVotes(Object.fromEntries(voteEntries));
    }
  }, [groupId, configured, user]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const handleJoin = async () => {
    if (!user || !configured || joiningRef.current) return;
    joiningRef.current = true;
    setJoining(true);
    try {
      if (joined) {
        await leaveGroup(groupId, user.uid);
        setJoined(false);
        setMemberCount((n) => Math.max(0, n - 1));
      } else {
        await joinGroup(groupId, { uid: user.uid, displayName: user.displayName ?? 'Рибар' });
        setJoined(true);
        setMemberCount((n) => n + 1);
      }
    } catch (e: unknown) {
      handleError(e);
    } finally {
      joiningRef.current = false;
      setJoining(false);
    }
  };

  const handlePost = async () => {
    if (!user || !postText.trim() || posting) return;
    setPosting(true);
    try {
      await postToGroup(groupId, postText, { uid: user.uid, displayName: user.displayName ?? 'Рибар' });
      setPostText('');
      Toast.show({ type: 'success', text1: 'Публикацията е изпратена', visibilityTime: 2000 });
      await load();
    } catch (e: unknown) {
      handleError(e);
    } finally {
      setPosting(false);
    }
  };

  const handleDeletePost = (post: GroupPost) => {
    Alert.alert('Изтриване', 'Да се изтрие публикацията?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий', style: 'destructive', onPress: async () => {
          try {
            await deleteGroupPost(groupId, post.id);
            setPosts((prev) => prev.filter((p) => p.id !== post.id));
          } catch (e) { handleError(e); }
        },
      },
    ]);
  };

  const handleDeleteEvent = (ev: GroupEvent) => {
    Alert.alert('Изтриване', `Да се изтрие „${ev.title}"?`, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий', style: 'destructive', onPress: async () => {
          try {
            await deleteEvent(groupId, ev.id);
            setEvents((prev) => prev.filter((e) => e.id !== ev.id));
          } catch (e) { handleError(e); }
        },
      },
    ]);
  };

  const handleDeletePoll = (poll: GroupPoll) => {
    Alert.alert('Изтриване', `Да се изтрие „${poll.question}"?`, [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий', style: 'destructive', onPress: async () => {
          try {
            await deletePoll(groupId, poll.id);
            setPolls((prev) => prev.filter((p) => p.id !== poll.id));
          } catch (e) { handleError(e); }
        },
      },
    ]);
  };

  const handleRsvp = async (ev: GroupEvent, status: RsvpStatus) => {
    if (!user) return;
    const previous = myRsvps[ev.id];
    if (previous === status) return;
    void Haptics.selectionAsync();
    // Optimistic update
    setMyRsvps((prev) => ({ ...prev, [ev.id]: status }));
    setEvents((prev) => prev.map((e) => {
      if (e.id !== ev.id) return e;
      const counts = { ...e.rsvpCounts };
      counts[status] += 1;
      if (previous) counts[previous] = Math.max(0, counts[previous] - 1);
      return { ...e, rsvpCounts: counts };
    }));
    try {
      await setRsvp(groupId, ev.id, { uid: user.uid, displayName: user.displayName ?? 'Рибар' }, status);
    } catch (e) {
      // Roll back
      setMyRsvps((prev) => ({ ...prev, [ev.id]: previous ?? null }));
      await load();
      handleError(e);
    }
  };

  const handleVote = async (poll: GroupPoll, optionIndex: number) => {
    if (!user) return;
    const previous = myVotes[poll.id];
    if (previous === optionIndex) return;
    void Haptics.selectionAsync();
    setMyVotes((prev) => ({ ...prev, [poll.id]: optionIndex }));
    setPolls((prev) => prev.map((p) => {
      if (p.id !== poll.id) return p;
      const counts = [...p.voteCounts];
      counts[optionIndex] = (counts[optionIndex] ?? 0) + 1;
      if (typeof previous === 'number' && previous >= 0 && previous < counts.length) {
        counts[previous] = Math.max(0, (counts[previous] ?? 0) - 1);
      }
      return { ...p, voteCounts: counts };
    }));
    try {
      await castVote(groupId, poll.id, user.uid, optionIndex);
    } catch (e) {
      setMyVotes((prev) => ({ ...prev, [poll.id]: previous ?? null }));
      await load();
      handleError(e);
    }
  };

  const openComposeMenu = () => {
    if (!joined) {
      Alert.alert('Само за членове', 'Присъедини се към клуба, за да публикуваш.');
      return;
    }
    ActionSheet.show({
      title: 'Създай',
      options: [
        {
          label: 'Събитие',
          icon: 'calendar-outline',
          onPress: () => navigation.navigate('CreateGroupEvent', { groupId, groupName }),
        },
        {
          label: 'Анкета',
          icon: 'bar-chart-outline',
          onPress: () => navigation.navigate('CreateGroupPoll', { groupId, groupName }),
        },
      ],
    });
  };

  const formatPostTime = (iso: string) => {
    try { return new Date(iso).toLocaleString('bg-BG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  };

  // Render functions per tab
  const renderPost = ({ item }: { item: GroupPost }) => (
    <Card style={styles.postRow}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.postAuthor}>{item.ownerName}</Text>
          {item.createdAt ? <Text style={styles.postTime}>{formatPostTime(item.createdAt)}</Text> : null}
        </View>
        {(user && (item.ownerUid === user.uid || isAdmin)) ? (
          <Pressable onPress={() => handleDeletePost(item)} hitSlop={8}>
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.postText}>{item.text}</Text>
    </Card>
  );

  const renderEvent = ({ item }: { item: GroupEvent }) => {
    const myStatus = myRsvps[item.id] ?? null;
    const d = new Date(item.dateIso);
    const day = isNaN(d.getTime()) ? '?' : String(d.getDate());
    const month = isNaN(d.getTime()) ? '' : d.toLocaleDateString('bg-BG', { month: 'short' }).replace('.', '');
    const upcoming = isUpcoming(item.dateIso);
    return (
      <Card style={[styles.eventCard, !upcoming && { opacity: 0.6 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={styles.eventDateBadge}>
            <Text style={styles.eventDay}>{day}</Text>
            <Text style={styles.eventMonth}>{month}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eventTitle}>{item.title}</Text>
            <Text style={styles.eventMeta}>{formatEventDate(item.dateIso)}</Text>
            {item.location?.name ? (
              <Text style={styles.eventMeta} numberOfLines={1}>📍 {item.location.name}</Text>
            ) : null}
          </View>
          {(user && (item.createdBy === user.uid || isAdmin)) ? (
            <Pressable onPress={() => handleDeleteEvent(item)} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
            </Pressable>
          ) : null}
        </View>

        {item.description ? <Text style={styles.eventDesc}>{item.description}</Text> : null}

        {joined && upcoming ? (
          <View style={styles.rsvpRow}>
            {(['going', 'maybe', 'not_going'] as RsvpStatus[]).map((s) => {
              const active = myStatus === s;
              const activeStyle = s === 'going' ? styles.rsvpBtnActiveGoing
                : s === 'maybe' ? styles.rsvpBtnActiveMaybe
                : styles.rsvpBtnActiveNo;
              return (
                <Pressable
                  key={s}
                  onPress={() => void handleRsvp(item, s)}
                  style={[styles.rsvpBtn, active && activeStyle]}
                  hitSlop={4}
                >
                  <Text style={[styles.rsvpBtnText, active && styles.rsvpBtnTextActive]}>
                    {RSVP_LABEL[s]}
                  </Text>
                  {item.rsvpCounts[s] > 0 ? (
                    <Text style={[styles.rsvpCount, active && { color: 'rgba(255,255,255,0.85)' }, !active && { color: colors.textMuted }]}>
                      {item.rsvpCounts[s]}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View style={[styles.rsvpRow, { paddingTop: 4 }]}>
            <Text style={{ ...typography.small, color: colors.textMuted }}>
              ✓ {item.rsvpCounts.going} идват
              {item.rsvpCounts.maybe > 0 ? ` · ${item.rsvpCounts.maybe} може би` : ''}
            </Text>
          </View>
        )}
      </Card>
    );
  };

  const renderPoll = ({ item }: { item: GroupPoll }) => {
    const myIdx = myVotes[item.id] ?? null;
    const totalVotes = item.voteCounts.reduce((s, c) => s + c, 0);
    return (
      <Card style={styles.postRow}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.pollQuestion}>{item.question}</Text>
          </View>
          {(user && (item.createdBy === user.uid || isAdmin)) ? (
            <Pressable onPress={() => handleDeletePoll(item)} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
            </Pressable>
          ) : null}
        </View>
        {item.options.map((opt, idx) => {
          const count = item.voteCounts[idx] ?? 0;
          const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const selected = myIdx === idx;
          return (
            <Pressable
              key={idx}
              style={[styles.pollOption, selected && styles.pollOptionSelected]}
              onPress={() => joined && handleVote(item, idx)}
              disabled={!joined}
            >
              {myIdx !== null ? (
                <View style={[styles.pollOptionBar, { width: `${pct}%` }]} />
              ) : null}
              <Text style={styles.pollOptionText} numberOfLines={2}>{opt}</Text>
              {myIdx !== null ? (
                <Text style={styles.pollOptionPct}>{pct}%</Text>
              ) : null}
            </Pressable>
          );
        })}
        <Text style={styles.pollFooter}>
          {totalVotes} {totalVotes === 1 ? 'глас' : 'гласа'}
          {item.createdByName ? ` · ${item.createdByName}` : ''}
          {!joined ? ' · Влез в клуба за да гласуваш' : ''}
        </Text>
      </Card>
    );
  };

  const emptyForTab = (
    <View style={styles.emptyWrap}>
      <Ionicons
        name={tab === 'events' ? 'calendar-outline' : tab === 'polls' ? 'bar-chart-outline' : 'chatbubble-outline'}
        size={40}
        color={colors.border}
      />
      <Text style={styles.emptyText}>
        {tab === 'events'
          ? (joined ? 'Няма предстоящи събития. Създай първото!' : 'Няма събития все още.')
          : tab === 'polls'
          ? (joined ? 'Няма анкети. Стартирай първата!' : 'Няма анкети все още.')
          : (joined || !user ? 'Няма публикации все още.' : 'Присъедини се, за да публикуваш.')}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen padded={false}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад">
            <Ionicons name="chevron-back" size={28} color={colors.primary} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{groupName}</Text>
          {user && configured ? (
            <Button
              title={joined ? 'Напусни' : 'Присъедини се'}
              variant={joined ? 'ghost' : 'primary'}
              compact
              onPress={handleJoin}
              loading={joining}
            />
          ) : null}
        </View>

        {group ? (
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={15} color={colors.textMuted} />
            <Text style={styles.metaText}>{memberCount} члена</Text>
            {group.description ? <>
              <Text style={styles.metaText}>·</Text>
              <Text style={styles.metaText} numberOfLines={1}>{group.description}</Text>
            </> : null}
          </View>
        ) : null}

        {/* Tabs */}
        <View style={styles.tabsRow}>
          {([
            { key: 'posts' as const, label: 'Публикации', count: posts.length },
            { key: 'events' as const, label: 'Събития', count: events.length },
            { key: 'polls' as const, label: 'Анкети', count: polls.length },
          ]).map((t) => (
            <Pressable
              key={t.key}
              style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
              onPress={() => { void Haptics.selectionAsync(); setTab(t.key); }}
            >
              <Text style={[styles.tabBtnText, tab === t.key && styles.tabBtnTextActive]}>
                {t.label}{t.count > 0 ? ` (${t.count})` : ''}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'posts' ? (
          <FlatList
            data={posts}
            keyExtractor={(p) => p.id}
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
            ListEmptyComponent={emptyForTab}
            renderItem={renderPost}
          />
        ) : tab === 'events' ? (
          <FlatList
            data={events}
            keyExtractor={(e) => e.id}
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
            ListEmptyComponent={emptyForTab}
            renderItem={renderEvent}
          />
        ) : (
          <FlatList
            data={polls}
            keyExtractor={(p) => p.id}
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
            ListEmptyComponent={emptyForTab}
            renderItem={renderPoll}
          />
        )}

        {/* Text post composer — only when Posts tab is active and user is a member */}
        {tab === 'posts' && joined && user ? (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Сподели нещо с клуба…"
              placeholderTextColor={colors.textMuted}
              value={postText}
              onChangeText={setPostText}
              multiline
              maxLength={2000}
            />
            <Pressable onPress={handlePost} disabled={posting || !postText.trim()} hitSlop={8}>
              {posting ? <ActivityIndicator size="small" color={colors.primary} /> : (
                <Ionicons name="send" size={24} color={postText.trim() ? colors.primary : colors.textMuted} />
              )}
            </Pressable>
          </View>
        ) : null}

        {/* FAB for creating Event / Poll — only when those tabs are active */}
        {(tab === 'events' || tab === 'polls') && joined && user ? (
          <Pressable onPress={openComposeMenu} style={styles.fab} accessibilityLabel={tab === 'events' ? 'Ново събитие' : 'Нова анкета'}>
            <Ionicons name="add" size={28} color="#fff" />
          </Pressable>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
