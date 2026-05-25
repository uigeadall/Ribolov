import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { FadeIn } from '../components/FadeIn';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeMyNotifications, markNotificationRead, markAllNotificationsRead, clearReadNotifications, type SocialNotification } from '../services/socialFeed';
import { followUser, isFollowingUser } from '../services/social';
import { muteActor } from '../services/mutedActors';
import { ActionSheet } from '../components/ActionSheet';
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
  /** Left-swipe action — flag this row's notification(s) as read without
      archiving them. Lets users clear unread state on rows they want to
      keep visible (e.g. archive of memorable interactions). */
  onMarkRead: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
};

function NotifRow({ item, myUid, onOpen, onDismiss, onMarkRead, styles, colors }: NotifRowProps) {
  // Used by the grouped-row actor chips to open each contributor's profile.
  // Cheap to call again here — the parent NotificationsScreen also calls
  // useAppNavigation; both return references to the same singleton.
  const navigation = useAppNavigation();
  const avatarUrl = useAvatarUrl({
    ownerUid: item.actorUid,
    isMine: item.actorUid === myUid,
    resolvedAvatarUrl: undefined,
    ownerPhotoUrl: undefined,
  });
  // Four states:
  //   idle — not following yet; button reads "Последвай"
  //   busy — request in flight
  //   done — following (either set this session OR already following on mount)
  // 'done' on mount comes from the isFollowingUser probe below — that way a
  // mutual-follow notification shows the correct "✓ Последван" state from
  // the start instead of flashing "Последвай" until the user taps.
  const [followState, setFollowState] = useState<'idle' | 'busy' | 'done'>('idle');

  // Probe the live follow graph once per row mount so the button reflects
  // reality. Only runs for follow notifications (the only row type that
  // surfaces this button); cheap because getFollowing/isFollowingUser is
  // server-cached for the duration of the session. Best-effort — a network
  // miss leaves the button in the safe default 'idle' state.
  useEffect(() => {
    if (item.type !== 'follow' || !myUid) return;
    let cancelled = false;
    isFollowingUser(myUid, item.actorUid)
      .then((already) => {
        if (!cancelled && already) setFollowState('done');
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [item.type, item.actorUid, myUid]);

  const dotColor =
    item.type === 'like' ? colors.primary
    : item.type === 'storyLike' ? colors.primary
    : item.type === 'comment' ? '#e53935'
    : item.type === 'storyComment' ? '#e53935'
    : item.type === 'message' ? colors.primary
    : '#2E9B5A';

  const isGrouped = (item.groupCount ?? 0) > 0;
  const groupCount = item.groupCount ?? 0;

  // Build the display line text for grouped vs individual notifications.
  // Single source of truth — keep new grouped types here as they're added in
  // `groupNotifications`. The "и N други" suffix only renders when there's
  // more than one actor; the count itself never appears as "и 0 други".
  let displayLine: string;
  if (isGrouped && (item.type === 'like' || item.type === 'storyLike')) {
    const target = item.type === 'like' ? 'твой улов' : 'твоята история';
    displayLine = `${item.actorName} и ${groupCount} ${groupCount === 1 ? 'друг' : 'други'} реагираха на ${target}`;
  } else if (isGrouped && (item.type === 'comment' || item.type === 'storyComment')) {
    // Post-comments and catch-comments share the same wording — the deep-link
    // path on tap picks the right destination (FeedTab vs CatchDetail).
    const target = item.type === 'comment'
      ? (item.postId ? 'твоята публикация' : 'твой улов')
      : 'твоята история';
    displayLine = `${item.actorName} и ${groupCount} ${groupCount === 1 ? 'друг' : 'други'} коментираха ${target}`;
  } else if (isGrouped && item.type === 'mention') {
    // Mentions are grouped per-target — multiple people mentioning you in the
    // same post is rare but possible (e.g. quote-share chains).
    displayLine = `${item.actorName} и ${groupCount} ${groupCount === 1 ? 'друг' : 'други'} те споменаха`;
  } else {
    // Follow notifications are intentionally not grouped (see
    // groupNotifications below) so this branch never fires for them; each
    // follow is rendered as its own individual row with its own follow-back
    // button via the verb path.
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
  // Left-swipe action — only meaningful for unread rows. When the row is
  // already read, swipe-left is a no-op (the action panel still renders
  // for gesture consistency but the parent handler skips the write).
  const renderLeft = () => (
    <View style={{ backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', width: 72, borderRadius: radius.md, marginRight: spacing.sm }}>
      <Ionicons name="checkmark-done-outline" size={22} color="#fff" />
      <Text style={{ ...typography.small, color: '#fff', marginTop: 2, fontWeight: '700' }}>Прочети</Text>
    </View>
  );
  // Swipe direction is detected via the Swipeable callbacks. Both share a
  // single onSwipeableOpen so we have to look at the direction prop to
  // route — right reveal = onDismiss (archive, danger), left reveal =
  // onMarkRead (passive, primary color).
  // Long-press opens an action sheet — currently one action ("Mute this
  // person"), but the sheet shape lets future actions plug in (block,
  // report, etc.) without touching the swipe layout.
  const onLongPress = useCallback(() => {
    if (!item.actorUid || item.actorUid === myUid) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    ActionSheet.show({
      title: item.actorName,
      options: [
        {
          label: `Заглуши известията от ${item.actorName}`,
          icon: 'notifications-off-outline',
          destructive: true,
          onPress: async () => {
            try {
              await muteActor(myUid, item.actorUid, item.actorName);
              Toast.show({
                type: 'success',
                text1: 'Заглушено',
                text2: `Няма да получаваш push известия от ${item.actorName}.`,
                visibilityTime: 2800,
              });
            } catch {
              Toast.show({
                type: 'error',
                text1: 'Грешка',
                text2: 'Не успяхме да заглушим. Опитай отново.',
                visibilityTime: 2500,
              });
            }
          },
        },
      ],
    });
  }, [item.actorUid, item.actorName, myUid]);

  return (
    <Swipeable
      renderRightActions={renderRight}
      renderLeftActions={item.read ? undefined : renderLeft}
      onSwipeableOpen={(direction) => {
        if (direction === 'right') onDismiss();
        else if (direction === 'left') onMarkRead();
      }}
      rightThreshold={60}
      leftThreshold={60}
      overshootRight={false}
      overshootLeft={false}
    >
    <Pressable onPress={() => onOpen(item)} onLongPress={onLongPress} delayLongPress={400}>
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
          {/* Grouped notifications carry hidden actors — render a small
              horizontal stack of their initials underneath the line so
              users can see WHO reacted without leaving the screen, and
              tap any to open that user's profile. Previously the
              representative was the only actionable actor; the other N-1
              were buried in the count. Caps at 6 visible avatars; surplus
              shown as "+N" pill so the row doesn't grow unbounded on
              viral posts. */}
          {isGrouped && (item.groupActorUids?.length ?? 0) > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {/* The representative actor also belongs in the stack so
                  the count visually matches the displayLine ("X и N
                  others"). Build the full list once. */}
              {[
                { uid: item.actorUid, name: item.actorName },
                ...(item.groupActorUids ?? []).map((uid, i) => ({
                  uid,
                  name: item.groupActors?.[i] ?? 'Рибар',
                })),
              ].slice(0, 6).map((a) => (
                <Pressable
                  key={a.uid}
                  onPress={(e) => {
                    e.stopPropagation();
                    void Haptics.selectionAsync();
                    navigation.navigate('UserPublicProfile', { uid: a.uid, displayName: a.name });
                  }}
                  hitSlop={4}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                    paddingVertical: 3, paddingHorizontal: 8,
                    borderRadius: 12,
                    backgroundColor: colors.primarySurface,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.border,
                  }}
                  accessibilityLabel={`Виж профила на ${a.name}`}
                >
                  <View style={{
                    width: 18, height: 18, borderRadius: 9,
                    backgroundColor: colors.card,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ ...typography.caption, fontWeight: '700', color: colors.primary, fontSize: 10 }}>
                      {a.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <Text style={{ ...typography.caption, color: colors.text, fontSize: 11, maxWidth: 90 }} numberOfLines={1}>
                    {a.name}
                  </Text>
                </Pressable>
              ))}
              {(item.groupActorUids?.length ?? 0) + 1 > 6 ? (
                <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 12, backgroundColor: colors.surfaceAlt }}>
                  <Text style={{ ...typography.caption, color: colors.textMuted, fontSize: 11 }}>
                    +{(item.groupActorUids?.length ?? 0) + 1 - 6}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
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
  groupActorUids?: string[]; // uids of actors beyond the first — parallel to groupActors,
                              // used by the expand-on-tap actor list to deep-link to each
                              // individual user's profile when avatars are tapped.
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

  // Follow notifications are intentionally NOT grouped. The earlier version
  // collapsed 3+ follows into "N риболовеца те последваха" for inbox
  // compactness, but that hid every actor except the representative — the
  // "Follow back" button could only act on the first user, and the other
  // N-1 followers were unreachable from the notification. Since following
  // back is the WHOLE POINT of seeing this notification, the grouping cost
  // more than it saved. Each follow now gets its own row with its own
  // actionable Follow button.

  // ── Per-target grouping ────────────────────────────────────────────────────
  // Groups any reaction-style notif (likes + comments + mentions + their
  // story counterparts) on the same target. Key shape:
  //   "<type>:<target-id>"
  // The `type` prefix prevents a comment and a like on the same catch from
  // collapsing into one "5 people reacted/commented" mush — they get separate
  // rows that each say what action happened.
  const groupable = new Map<string, SocialNotification[]>();
  for (const n of sorted) {
    if (
      n.type !== 'like' &&
      n.type !== 'storyLike' &&
      n.type !== 'comment' &&
      n.type !== 'storyComment' &&
      n.type !== 'mention'
    ) continue;
    // postId takes precedence — post notifications carry postId AND catchId
    // (the latter is the legacy slot) and we always want to bucket by the
    // canonical target.
    const targetId = n.postId || n.catchId || n.storyId || n.id;
    const key = `${n.type}:${targetId}`;
    if (!groupable.has(key)) groupable.set(key, []);
    groupable.get(key)!.push(n);
  }

  for (const [, group] of groupable) {
    if (group.length < 2) continue; // single notif — handled below as a plain row
    // Multiple notifications can come from the same actor (e.g. two comments
    // on the same post). Dedupe actors so the "и N други" count reflects
    // distinct people, not raw event count.
    const seenActors = new Set<string>();
    const distinctActors: SocialNotification[] = [];
    for (const n of group) {
      if (seenActors.has(n.actorUid)) continue;
      seenActors.add(n.actorUid);
      distinctActors.push(n);
    }
    if (distinctActors.length < 2) continue;
    const [representative, ...rest] = distinctActors;
    const grouped: GroupedNotification = {
      ...representative,
      groupCount: rest.length,
      groupActors: rest.map((n) => n.actorName),
      // Parallel uids array — lets the rendered avatar row deep-link to
      // each contributor's profile. Names alone weren't enough since
      // the avatar URL fetcher (useAvatarUrl) is keyed by uid.
      groupActorUids: rest.map((n) => n.actorUid),
      // Always mark every underlying notif id read on tap — not just the
      // distinct-actor ones.
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
  const [notifTab, setNotifTab] = useState<'all' | 'likes' | 'comments' | 'follows'>('all');
  // Tactile pull-to-refresh — notifications stream via subscription, so we
  // flash a brief refreshing state for the FishingRefreshControl visual
  // and resolve. Matches FeedScreen + ChatsScreen.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    // Haptic is fired centrally by FishingRefreshControl now.
    setRefreshing(true);
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
      if (n.postId || (n.type === 'mention' && n.catchId)) {
        // Two paths land here: (1) likes/comments on a free-form post (n.postId
        // is set explicitly by notifyInteraction), and (2) legacy mentions that
        // packed the post id into the catchId slot. Both deep-link to the feed
        // with the post anchored at the top via focusPostId.
        const targetPostId = n.postId ?? n.catchId!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigation.navigate as any)('FeedTab', {
          screen: 'FeedList',
          params: { focusPostId: targetPostId },
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

  // "Clear read" — delete every notification the user has already read.
  // Confirms first since this is destructive (and unrecoverable). The button
  // is only shown when there are read notifications to delete; combined with
  // the unread state above, that means the header can show 0/1/2 actions.
  const onClearRead = useCallback(() => {
    if (!user?.uid) return;
    const readCount = (data ?? []).filter((n) => n.read).length;
    if (readCount === 0) return;
    Alert.alert(
      'Изтрий прочетените?',
      `Ще премахнем ${readCount} ${readCount === 1 ? 'прочетено известие' : 'прочетени известия'}.`,
      [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Изтрий',
          style: 'destructive',
          onPress: () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            // Optimistic drop from local state.
            let previous: SocialNotification[] = [];
            setData((prev) => {
              if (!prev) return prev;
              previous = prev;
              return prev.filter((n) => !n.read);
            });
            clearReadNotifications(user.uid).catch(() => {
              setData(() => previous);
              Toast.show({ type: 'error', text1: 'Грешка', text2: 'Неуспешно изтриване.', visibilityTime: 2500 });
            });
          },
        },
      ],
    );
  }, [user?.uid, data, setData]);

  const readCount = useMemo(() => (data ?? []).filter((n) => n.read).length, [data]);

  // Left-swipe handler — mark the row's notification(s) as read WITHOUT
  // removing them from the list. The optimistic update is identical to
  // the tap-to-open path (setData → markNotificationRead per id); only
  // the parent UX intent differs. Skips the writes entirely when the row
  // is already read (defensive — Swipeable's leftThreshold combined with
  // our renderLeft={undefined} on read rows already prevents this, but
  // a no-op guard here keeps a future regression from spamming Firestore).
  const onMarkRead = useCallback((ids: string[]) => {
    if (!user?.uid || ids.length === 0) return;
    void Haptics.selectionAsync();
    const idSet = new Set(ids);
    setData((prev) => {
      if (!prev) return prev;
      if (!prev.some((n) => idSet.has(n.id) && !n.read)) return prev;
      return prev.map((n) => idSet.has(n.id) ? { ...n, read: true } : n);
    });
    for (const id of ids) markNotificationRead(user.uid, id).catch(() => {});
  }, [user?.uid, setData]);

  const onDismiss = useCallback((ids: string[]) => {
    if (!user?.uid || ids.length === 0) return;
    const idSet = new Set(ids);
    setData((prev) => prev ? prev.filter((n) => !idSet.has(n.id)) : prev);
    // Mark them read in Firestore so they don't reappear on the next snapshot
    // and so the unread badge updates accordingly.
    ids.forEach((id) => { markNotificationRead(user.uid, id).catch(() => {}); });
  }, [setData, user?.uid]);

  const tabDefs: { key: 'all' | 'likes' | 'comments' | 'follows'; label: string }[] = [
    { key: 'all', label: 'Всички' },
    { key: 'likes', label: 'Харесвания' },
    { key: 'comments', label: 'Коментари' },
    { key: 'follows', label: 'Последвания' },
  ];

  const filteredItems = useMemo(() => {
    if (notifTab === 'likes') return items.filter((n) => n.type === 'like' || n.type === 'storyLike');
    if (notifTab === 'comments') return items.filter((n) => n.type === 'comment' || n.type === 'storyComment');
    if (notifTab === 'follows') return items.filter((n) => n.type === 'follow');
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {unreadCount > 0 ? (
            <Pressable onPress={onMarkAll} style={S.markAllBtn} hitSlop={8} accessibilityLabel="Маркирай всички като прочетени">
              <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
              <Text style={S.markAllText}>Прочетени</Text>
            </Pressable>
          ) : null}
          {readCount > 0 ? (
            <Pressable onPress={onClearRead} hitSlop={8} accessibilityLabel="Изтрий прочетените">
              <Ionicons name="trash-outline" size={18} color="#fff" />
            </Pressable>
          ) : null}
          {/* Settings shortcut — most users discover notification preferences
              from inside the inbox ("how do I stop getting these?"), not by
              digging through Profile → Settings. Always visible so the path
              to muting is one tap away regardless of inbox state. */}
          <Pressable
            onPress={() => navigation.navigate('NotificationPreferences')}
            hitSlop={8}
            accessibilityLabel="Настройки за известия"
          >
            <Ionicons name="settings-outline" size={18} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );

  if (!configured || !user) {
    return (
      <Screen padded={false} avoidKeyboard={false}>
        {HeroSection}
        <View style={S.wave}>
          {TabBar}
          <EmptyState
            icon="notifications-outline"
            title="Налични след вход"
            subtitle="Влез с акаунт, за да виждаш известия от лентата."
            action={{
              label: 'Влез',
              onPress: () => (navigation as any).navigate('ProfileTab'),
            }}
          />
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
          <FadeIn>
            <EmptyState
              icon="notifications-off-outline"
              title="Няма известия"
              subtitle={notifTab === 'all'
                ? "Когато някой хареса или коментира твой улов, или те последва, ще се появи тук."
                : notifTab === 'likes'
                  ? "Нямаш харесвания все още."
                  : notifTab === 'comments'
                    ? "Нямаш коментари все още."
                    : "Никой не те е последвал все още."
              }
            />
          </FadeIn>
        ) : (
          <FadeIn>
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
                onMarkRead={() => onMarkRead(item.groupIds ?? [item.id])}
                styles={styles}
                colors={colors}
              />
            )}
          />
          </FadeIn>
        )}
      </View>
    </Screen>
  );
}
