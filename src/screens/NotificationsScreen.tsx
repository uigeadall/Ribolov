import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, SectionList, Pressable, Alert, Platform } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen } from '../components/Screen';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
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

/** Per-type accent color used for the leading stripe on unread rows. Keeps
    scanning fast — you can spot like vs comment vs follow from across the
    screen without reading text. */
const TYPE_COLORS: Record<string, string> = {
  like: '#E53935',
  storyLike: '#E53935',
  comment: '#1E88E5',
  storyComment: '#1E88E5',
  mention: '#FB8C00',
  follow: '#2E9B5A',
  message: '#8E24AA',
};

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: spacing.md,
      alignItems: 'flex-start',
      opacity: 1,
      // Padding-left makes room for the 3px stripe on unread cards. We render
      // the stripe as an absolute-positioned bar inside the Card so it can
      // hug the corner radius cleanly.
    },
    rowUnread: { backgroundColor: colors.surfaceAlt },
    typeStripe: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 4,
      borderTopLeftRadius: radius.md,
      borderBottomLeftRadius: radius.md,
    },
    sectionHeader: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      backgroundColor: colors.background,
    },
    sectionHeaderText: {
      ...typography.bodyBold,
      color: colors.textMuted,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
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
    : item.type === 'message' ? colors.primary
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
            : item.type === 'mention'
              ? 'те спомена в публикация'
              : item.type === 'message'
                ? 'ти изпрати съобщение'
                : 'те последва';
  const icon =
    item.type === 'like' || item.type === 'storyLike'
      ? 'heart'
      : item.type === 'comment' || item.type === 'storyComment'
        ? 'chatbubble-ellipses-outline'
        : item.type === 'mention'
          ? 'at-outline'
          : item.type === 'message'
            ? 'mail-outline'
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
        {/* Type-colored leading stripe on unread rows — read rows lose it
            so the inbox visually quiets down as the user catches up. */}
        {!item.read ? (
          <View style={[styles.typeStripe, { backgroundColor: TYPE_COLORS[item.type] ?? colors.primary }]} />
        ) : null}
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
  groupIds?: string[];    // all notification ids in the group (including the representative)
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
      groupIds: follows.map((n) => n.id),
    };
    result.push(grouped);
    follows.forEach((n) => consumed.add(n.id));
  }

  // ── Like / storyLike grouping by catchId / storyId ────────────────────────
  // Build a map: key → list of like-type notifications with the same target
  const likeGroups = new Map<string, SocialNotification[]>();
  for (const n of sorted) {
    if (n.type !== 'like' && n.type !== 'storyLike') continue;
    const key = n.catchId || n.storyId || n.id; // catchId can be '' for non-catch notifs
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
      groupIds: group.map((n) => n.id),
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

/** Bucket a list of grouped notifications into time-based sections. We use 4
    coarse buckets so users with a quiet week still see something under
    "Тази седмица" instead of a single endless "По-стари". Ordered newest
    first within each bucket; bucket order matches that. */
function bucketByDay(items: GroupedNotification[]): { title: string; data: GroupedNotification[] }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);

  const buckets: Record<string, GroupedNotification[]> = {
    'Днес': [],
    'Вчера': [],
    'Тази седмица': [],
    'По-стари': [],
  };
  for (const n of items) {
    const ms = getCreatedAtMs(n.createdAt);
    if (!ms) { buckets['По-стари'].push(n); continue; }
    if (ms >= today.getTime()) buckets['Днес'].push(n);
    else if (ms >= yesterday.getTime()) buckets['Вчера'].push(n);
    else if (ms >= weekAgo.getTime()) buckets['Тази седмица'].push(n);
    else buckets['По-стари'].push(n);
  }
  return ['Днес', 'Вчера', 'Тази седмица', 'По-стари']
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ title: k, data: buckets[k] }));
}

// ─────────────────────────────────────────────────────────────────────────────

export default function NotificationsScreen() {
  const navigation = useAppNavigation();
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, configured } = useAuth();

  const heroColors: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#2B87CE', '#1570B8', '#0D559A'];
  const waveColor = mode === 'dark' ? '#0E1628' : '#FFFFFF';

  const S = useMemo(() => StyleSheet.create({
    hero: { paddingBottom: 28 + 16 },
    heroInner: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 8,
      gap: 8,
    },
    heroTitle: {
      flex: 1,
      fontSize: 22,
      fontWeight: '700',
      color: '#fff',
      textAlign: 'center',
    },
    backBtn: {
      width: 40, height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255,255,255,0.15)',
      alignItems: 'center', justifyContent: 'center',
    },
    markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    markAllText: { fontSize: 13, color: '#fff', fontWeight: '700' },
    wave: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      marginTop: -28,
      flex: 1,
      backgroundColor: waveColor,
      overflow: 'hidden',
    },
  }), [waveColor]);
  const [notifTab, setNotifTab] = useState<'all' | 'likes' | 'comments'>('all');
  // Tactile pull-to-refresh — notifications stream via subscription, so we
  // flash a brief refreshing state for the FishingRefreshControl visual
  // and resolve. Matches FeedScreen + ChatsScreen.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  const { data, loading, setData } = useFirestoreSubscription<SocialNotification[]>(
    (cb) => {
      if (!configured || !user?.uid) { cb([]); return () => {}; }
      return subscribeMyNotifications(user.uid, cb);
    },
    [configured, user?.uid],
    { pauseInBackground: true },
  );
  const items = data ?? [];
  const unreadCount = items.filter((n) => !n.read).length;

  const onOpen = useCallback(
    (n: SocialNotification) => {
      if (!user?.uid) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (!n.read) {
        // If this row represents a group (e.g. 5 collapsed follow notifications),
        // mark every notification in the group as read — not just the
        // representative. Otherwise the next snapshot regroups the still-unread
        // members and the row keeps showing as unread.
        const groupIds = (n as SocialNotification & { groupIds?: string[] }).groupIds;
        const idsToMark = groupIds && groupIds.length > 0 ? groupIds : [n.id];
        const idSet = new Set(idsToMark);
        setData((prev) => prev ? prev.map((item) => idSet.has(item.id) ? { ...item, read: true } : item) : prev);
        for (const id of idsToMark) markNotificationRead(user.uid, id).catch(() => {});
      }
      if (n.type === 'mention' && n.catchId) {
        // The mention pipeline reuses `catchId` to carry the post id. Land
        // the user in the feed with the post anchored at the top — the
        // FeedScreen reads `focusPostId` and scrolls there on first paint.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigation.navigate as any)('FeedTab', {
          screen: 'FeedList',
          params: { focusPostId: n.catchId },
        });
      } else if (n.type === 'follow' || n.type === 'mention') {
        // Mention without a post id (legacy/edge) falls back to the actor's
        // profile so the notification isn't a dead end.
        navigation.navigate('UserPublicProfile', { uid: n.actorUid, displayName: n.actorName });
      } else if (n.type === 'storyLike' || n.type === 'storyComment') {
        navigation.navigate('UserPublicProfile', { uid: n.actorUid, displayName: n.actorName });
      } else if (n.type === 'message' && n.convId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigation.navigate as any)('ProfileTab', {
          screen: 'ChatDetail',
          params: { convId: n.convId, otherUid: n.actorUid, otherName: n.actorName },
        });
      } else if (n.catchId) {
        // Comments → land in the catch detail AND focus the reply composer
        // with @actorName pre-filled. Likes/etc. just land on the catch.
        // (storyComment is handled above, so only `comment` reaches here.)
        const wantsFocus = n.type === 'comment';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigation.navigate as any)('LogbookTab', {
          screen: 'CatchDetail',
          params: {
            id: n.catchId,
            ...(wantsFocus ? { focusComment: { authorName: n.actorName } } : {}),
          },
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
    // Capture previous state so we can roll back if the write fails.
    let previousUnreadIds: string[] = [];
    setData((prev) => {
      if (!prev) return prev;
      previousUnreadIds = prev.filter((n) => !n.read).map((n) => n.id);
      return prev.map((n) => ({ ...n, read: true }));
    });
    markAllNotificationsRead(user.uid).catch(() => {
      // Roll back optimistic update — restore the unread state.
      setData((prev) => {
        if (!prev) return prev;
        const ids = new Set(previousUnreadIds);
        return prev.map((n) => ids.has(n.id) ? { ...n, read: false } : n);
      });
      Toast.show({ type: 'error', text1: 'Грешка', text2: 'Неуспешно маркиране.', visibilityTime: 2500 });
    });
  }, [user?.uid, unreadCount, setData]);

  const onDismiss = useCallback((ids: string[]) => {
    if (!user?.uid || ids.length === 0) return;
    const idSet = new Set(ids);
    setData((prev) => prev ? prev.filter((n) => !idSet.has(n.id)) : prev);
    // Mark them read in Firestore so they don't reappear on the next snapshot
    // and so the unread badge updates accordingly.
    ids.forEach((id) => { markNotificationRead(user.uid, id).catch(() => {}); });
  }, [setData, user?.uid]);

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

  const groupedItems = useMemo(() => groupNotifications(filteredItems), [filteredItems]);
  const sections = useMemo(() => bucketByDay(groupedItems), [groupedItems]);

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

  const HeroSection = (
    <View style={S.hero}>
      <LinearGradient colors={heroColors} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      <View style={S.heroInner}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={S.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={S.heroTitle}>Известия</Text>
        {unreadCount > 0 ? (
          <Pressable onPress={onMarkAll} style={S.markAllBtn} hitSlop={8}>
            <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
            <Text style={S.markAllText}>Прочетени</Text>
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>
    </View>
  );

  if (!configured || !user) {
    return (
      <Screen padded={false} avoidKeyboard={false}>
        {HeroSection}
        <View style={S.wave}>
          {TabBar}
          <EmptyState icon="notifications-outline" title="Налични след вход" subtitle="Влез с Firebase акаунт, за да виждаш известия от лентата." />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} avoidKeyboard={false}>
      {HeroSection}
      <View style={S.wave}>
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
          <SectionList
            sections={sections}
            keyExtractor={(n) => n.id}
            removeClippedSubviews={Platform.OS === 'android'}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            stickySectionHeadersEnabled
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            renderSectionHeader={({ section }) => (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{section.title}</Text>
              </View>
            )}
            renderItem={({ item }) => (
              <NotifRow
                item={item}
                myUid={user.uid}
                onOpen={onOpen}
                onDismiss={() => onDismiss(item.groupIds ?? [item.id])}
                styles={styles}
                colors={colors}
              />
            )}
          />
        )}
      </View>
    </Screen>
  );
}
