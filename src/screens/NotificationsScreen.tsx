import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, Alert, Platform } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeMyNotifications, markNotificationRead, markAllNotificationsRead, type SocialNotification } from '../services/socialFeed';
import { followUser, isFollowingUser } from '../services/social';
import { useFirestoreSubscription } from '../hooks/useFirestoreSubscription';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useAppNavigation } from '../navigation/useAppNavigation';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';

function formatNotifTime(createdAt: unknown): string {
  if (!createdAt) return '';
  let ms: number | null = null;
  if (typeof createdAt === 'object' && createdAt !== null && 'toMillis' in createdAt) {
    ms = (createdAt as { toMillis: () => number }).toMillis();
  } else if (typeof createdAt === 'number') {
    ms = createdAt;
  }
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'Сега';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} д`;
  return new Date(ms).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
}

function NotifSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={{ padding: spacing.lg, gap: spacing.md }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border }}>
          <Skeleton width={40} height={40} borderRadius={20} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={13} width="72%" />
            <Skeleton height={10} width="45%" />
          </View>
          <Skeleton width={8} height={8} borderRadius={4} />
        </View>
      ))}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    markAllText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
    row: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
      opacity: 1,
    },
    rowUnread: { backgroundColor: colors.surfaceAlt },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    avatarImg: { width: 40, height: 40 },
    avatarText: { ...typography.bodyBold, color: colors.primary },
    body: { flex: 1, minWidth: 0 },
    line: { ...typography.body, color: colors.text },
    preview: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
    meta: { ...typography.caption, color: colors.textMuted, marginTop: 6 },
    listContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
    sep: { height: spacing.md },
  });
}

type NotifRowProps = {
  item: GroupedNotification;
  myUid: string;
  onOpen: (n: SocialNotification) => void;
  onDismiss: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
};

function NotifRow({ item, myUid, onOpen, onDismiss, styles, colors }: NotifRowProps) {
  const avatarUrl = useAvatarUrl({
    ownerUid: item.actorUid,
    isMine: item.actorUid === myUid,
    resolvedAvatarUrl: undefined,
    ownerPhotoUrl: undefined,
  });
  const [followState, setFollowState] = useState<'idle' | 'busy' | 'done'>('idle');

  const dotColor =
    item.type === 'like' ? colors.primary
    : item.type === 'storyLike' ? colors.primary
    : item.type === 'comment' ? '#e53935'
    : item.type === 'storyComment' ? '#e53935'
    : '#2E9B5A';

  const isGrouped = (item.groupCount ?? 0) > 0;
  const groupCount = item.groupCount ?? 0;

  // Build the display line text for grouped vs individual notifications
  let displayLine: string;
  if (isGrouped && (item.type === 'like' || item.type === 'storyLike')) {
    const target = item.type === 'like' ? 'твой улов' : 'твоята история';
    displayLine = `${item.actorName} и ${groupCount} ${groupCount === 1 ? 'друг' : 'други'} реагираха на ${target}`;
  } else if (isGrouped && item.type === 'follow') {
    displayLine = `${groupCount + 1} риболовеца те последваха`;
  } else {
    displayLine = '';
  }

  const verb =
    item.type === 'like'
      ? `реагира ${item.reactionEmoji ?? '❤️'} на твой улов`
      : item.type === 'storyLike'
        ? `реагира ${item.reactionEmoji ?? '❤️'} на твоята история`
        : item.type === 'comment'
          ? 'коментира твой улов'
          : item.type === 'storyComment'
            ? 'коментира твоята история'
            : 'те последва';
  const icon =
    item.type === 'like' || item.type === 'storyLike'
      ? 'heart'
      : item.type === 'comment' || item.type === 'storyComment'
        ? 'chatbubble-ellipses-outline'
        : 'person-add-outline';
  const initials = item.actorName.slice(0, 1).toUpperCase();

  const onFollowBack = useCallback(async () => {
    if (followState !== 'idle') return;
    setFollowState('busy');
    try {
      const already = await isFollowingUser(myUid, item.actorUid);
      if (!already) await followUser(myUid, item.actorUid, item.actorName);
      setFollowState('done');
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      setFollowState('idle');
    }
  }, [followState, myUid, item.actorUid, item.actorName]);

  const renderRight = () => (
    <View style={{ backgroundColor: colors.danger, justifyContent: 'center', alignItems: 'center', width: 72, borderRadius: radius.md, marginLeft: spacing.sm }}>
      <Ionicons name="trash-outline" size={22} color="#fff" />
      <Text style={{ ...typography.small, color: '#fff', marginTop: 2, fontWeight: '700' }}>Скрий</Text>
    </View>
  );
  return (
    <Swipeable renderRightActions={renderRight} onSwipeableOpen={onDismiss} rightThreshold={60} overshootRight={false}>
    <Pressable onPress={() => onOpen(item)}>
      <Card style={[styles.row, !item.read && styles.rowUnread]}>
        <View style={styles.avatar}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>
        <View style={styles.body}>
          <Text style={styles.line}>
            {isGrouped
              ? displayLine
              : <><Text style={{ fontWeight: '700' }}>{item.actorName}</Text> {verb}.</>
            }
          </Text>
          {item.preview ? <Text style={styles.preview} numberOfLines={3}>{item.preview}</Text> : null}
          {item.catchId ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
              <Ionicons name={icon} size={11} color={colors.textMuted} />
              <Text style={styles.meta} numberOfLines={1}>
                Улов #{item.catchId.slice(0, 8)}…
              </Text>
            </View>
          ) : null}
          {item.createdAt ? (
            <Text style={[styles.meta, { marginTop: 4 }]}>{formatNotifTime(item.createdAt)}</Text>
          ) : null}
          {item.type === 'follow' && (
            <Pressable
              onPress={(e) => { e.stopPropagation(); void onFollowBack(); }}
              disabled={followState !== 'idle'}
              style={{
                marginTop: spacing.sm,
                alignSelf: 'flex-start',
                paddingHorizontal: spacing.md,
                paddingVertical: 5,
                borderRadius: 20,
                backgroundColor: followState === 'done' ? colors.primarySurface : colors.primary,
                borderWidth: 1,
                borderColor: followState === 'done' ? colors.border : colors.primary,
                opacity: followState === 'busy' ? 0.6 : 1,
              }}
              hitSlop={8}
            >
              <Text style={{ ...typography.small, fontWeight: '700', color: followState === 'done' ? colors.primary : colors.white }}>
                {followState === 'done' ? '✓ Последван' : 'Последвай'}
              </Text>
            </Pressable>
          )}
        </View>
        {!item.read ? (
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor, marginTop: 6 }} />
        ) : (
          <View style={{ width: 8 }} />
        )}
      </Card>
    </Pressable>
    </Swipeable>
  );
}

// ── Grouping ─────────────────────────────────────────────────────────────────

type GroupedNotification = SocialNotification & {
  groupCount?: number;   // how many were collapsed into this row
  groupActors?: string[]; // names of actors beyond the first
};

function getCreatedAtMs(createdAt: unknown): number {
  if (!createdAt) return 0;
  if (typeof createdAt === 'object' && createdAt !== null && 'toMillis' in createdAt) {
    return (createdAt as { toMillis: () => number }).toMillis();
  }
  if (typeof createdAt === 'number') return createdAt;
  return 0;
}

function groupNotifications(items: SocialNotification[]): GroupedNotification[] {
  const result: GroupedNotification[] = [];
  // Track which ids have been consumed into a group
  const consumed = new Set<string>();

  // Sort newest-first so we always keep the most-recent as the representative
  const sorted = [...items].sort(
    (a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt),
  );

  // ── Follow grouping: if 3+ follow notifications exist, collapse all into one ──
  const follows = sorted.filter((n) => n.type === 'follow');
  if (follows.length >= 3) {
    const [representative, ...rest] = follows;
    const grouped: GroupedNotification = {
      ...representative,
      groupCount: rest.length,
      groupActors: rest.map((n) => n.actorName),
    };
    result.push(grouped);
    follows.forEach((n) => consumed.add(n.id));
  }

  // ── Like / storyLike grouping by catchId / storyId ────────────────────────
  // Build a map: key → list of like-type notifications with the same target
  const likeGroups = new Map<string, SocialNotification[]>();
  for (const n of sorted) {
    if (n.type !== 'like' && n.type !== 'storyLike') continue;
    const key = n.catchId ?? n.storyId ?? n.id; // fall back to own id so it stays solo
    if (!likeGroups.has(key)) likeGroups.set(key, []);
    likeGroups.get(key)!.push(n);
  }

  for (const [, group] of likeGroups) {
    if (group.length < 2) continue; // single like — handled below as a plain row
    const [representative, ...rest] = group;
    const grouped: GroupedNotification = {
      ...representative,
      groupCount: rest.length,
      groupActors: rest.map((n) => n.actorName),
    };
    result.push(grouped);
    group.forEach((n) => consumed.add(n.id));
  }

  // ── Everything else (and solo likes / solo follows) ────────────────────────
  for (const n of sorted) {
    if (consumed.has(n.id)) continue;
    result.push({ ...n });
  }

  // Re-sort the final list by time (newest first)
  result.sort((a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt));

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, configured } = useAuth();
  const [notifTab, setNotifTab] = useState<'all' | 'likes' | 'comments'>('all');

  const { data, loading, setData } = useFirestoreSubscription<SocialNotification[]>(
    (cb) => {
      if (!configured || !user?.uid) { cb([]); return () => {}; }
      return subscribeMyNotifications(user.uid, cb);
    },
    [configured, user?.uid],
  );
  const items = data ?? [];
  const unreadCount = items.filter((n) => !n.read).length;

  const onOpen = useCallback(
    (n: SocialNotification) => {
      if (!user?.uid) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (!n.read) {
        setData((prev) => prev ? prev.map((item) => item.id === n.id ? { ...item, read: true } : item) : prev);
        markNotificationRead(user.uid, n.id).catch(() => {});
      }
      if (n.type === 'follow') {
        navigation.navigate('UserPublicProfile', { uid: n.actorUid, displayName: n.actorName });
      } else if (n.type === 'storyLike' || n.type === 'storyComment') {
        navigation.navigate('UserPublicProfile', { uid: n.actorUid, displayName: n.actorName });
      } else if (n.catchId) {
        // like / comment — go directly to the catch in the logbook tab
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigation.navigate as any)('LogbookTab', {
          screen: 'CatchDetail',
          params: { id: n.catchId },
        });
      } else {
        navigation.navigate('UserPublicProfile', { uid: user.uid, displayName: user.displayName ?? 'Моят профил' });
      }
    },
    [navigation, user?.uid, setData]
  );

  const onMarkAll = useCallback(() => {
    if (!user?.uid || unreadCount === 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setData((prev) => prev ? prev.map((n) => ({ ...n, read: true })) : prev);
    markAllNotificationsRead(user.uid).catch(() => {
      Toast.show({ type: 'error', text1: 'Грешка', text2: 'Неуспешно маркиране.', visibilityTime: 2500 });
    });
  }, [user?.uid, unreadCount, setData]);

  const onDismiss = useCallback((id: string) => {
    setData((prev) => prev ? prev.filter((n) => n.id !== id) : prev);
  }, [setData]);

  const tabDefs: { key: 'all' | 'likes' | 'comments'; label: string }[] = [
    { key: 'all', label: 'Всички' },
    { key: 'likes', label: 'Харесвания' },
    { key: 'comments', label: 'Коментари' },
  ];

  const filteredItems = useMemo(() => {
    if (notifTab === 'likes') return items.filter((n) => n.type === 'like' || n.type === 'storyLike');
    if (notifTab === 'comments') return items.filter((n) => n.type === 'comment' || n.type === 'storyComment');
    return items;
  }, [items, notifTab]);

  const TabBar = (
    <View style={{
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    }}>
      {tabDefs.map((tab) => {
        const active = notifTab === tab.key;
        return (
          <Pressable
            key={tab.key}
            style={{
              flex: 1,
              paddingVertical: 12,
              alignItems: 'center',
              borderBottomWidth: active ? 2 : 0,
              borderBottomColor: active ? colors.primary : 'transparent',
            }}
            onPress={() => {
              void Haptics.selectionAsync();
              setNotifTab(tab.key);
            }}
          >
            <Text style={{
              ...typography.body,
              color: active ? colors.primary : colors.textMuted,
              fontWeight: active ? '700' : '400',
            }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="chevron-back" size={28} color={colors.primary} />
          </Pressable>
          <Text style={styles.title}>Известия</Text>
        </View>
        {TabBar}
        <EmptyState icon="notifications-outline" title="Налични след вход" subtitle="Влез с Firebase акаунт, за да виждаш известия от лентата." />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Известия</Text>
        {unreadCount > 0 ? (
          <Pressable onPress={onMarkAll} style={styles.markAllBtn} hitSlop={8}>
            <Ionicons name="checkmark-done-outline" size={18} color={colors.primary} />
            <Text style={styles.markAllText}>Всички прочетени</Text>
          </Pressable>
        ) : null}
      </View>

      {TabBar}

      {loading ? (
        <NotifSkeleton />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon="notifications-off-outline"
          title="Няма известия"
          subtitle={notifTab === 'all'
            ? "Когато някой хареса или коментира твой улов, или те последва, ще се появи тук."
            : notifTab === 'likes'
              ? "Нямаш харесвания все още."
              : "Нямаш коментари все още."
          }
        />
      ) : (
        <FlatList
          data={groupNotifications(filteredItems)}
          keyExtractor={(n) => n.id}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => (
            <NotifRow
              item={item}
              myUid={user.uid}
              onOpen={onOpen}
              onDismiss={() => onDismiss(item.id)}
              styles={styles}
              colors={colors}
            />
          )}
        />
      )}
    </Screen>
  );
}
