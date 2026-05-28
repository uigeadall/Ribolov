import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, TextInput, ScrollView, Alert } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Toast from 'react-native-toast-message';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { Screen } from '../components/Screen';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { FadeIn } from '../components/FadeIn';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { getImageVariant, ImageSize } from '../utils/imageVariants';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import {
  subscribeMyConversations,
  subscribeTyping,
  subscribeMutedConversations,
  muteConversation,
  unmuteConversation,
  markConversationRead,
  markConversationUnread,
  ensureDirectConversation,
  fetchOlderConversations,
} from '../services/messaging';
import { subscribeUserPresence, getUserPublicSummary } from '../services/userProfile';
import { getBlockedUids } from '../services/blockUser';
import { getFollowing } from '../services/social';
import { ConversationPreview } from '../types';
import { useFirestoreSubscription } from '../hooks/useFirestoreSubscription';
import { useAvatarUrl } from '../hooks/useAvatarUrl';
import { useAppNavigation } from '../navigation/useAppNavigation';

function formatTime(ms: number): string {
  if (!ms) return '';
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return 'сега';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} мин`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ч`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} дн`;
  return new Date(ms).toLocaleDateString('bg-BG', { day: 'numeric', month: 'short' });
}

function ChatSkeleton({ colors }: { colors: AppColors }) {
  return (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.lg }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Skeleton width={54} height={54} borderRadius={27} />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={14} width="50%" />
            <Skeleton height={11} width="75%" />
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            <Skeleton height={10} width={36} />
            <Skeleton height={18} width={18} borderRadius={9} />
          </View>
        </View>
      ))}
    </View>
  );
}

type ChatRowProps = {
  item: ConversationPreview;
  myUid: string;
  muted: boolean;
  styles: ReturnType<typeof createChatsStyles>;
  colors: AppColors;
  onPress: (item: ConversationPreview) => void;
  onToggleMute: (item: ConversationPreview, muted: boolean) => void;
  onToggleUnread: (item: ConversationPreview) => void;
  swipeRef: (ref: Swipeable | null) => void;
};

/** One conversation row. Subscribes to presence + typing for its own conv so the
    online dot and "пише…" indicator are live. Capped by the list's 50-item cap
    upstream, so at most 100 listeners — well within Firestore's per-client budget. */
function ChatRow({ item, myUid, muted, styles, colors, onPress, onToggleMute, onToggleUnread, swipeRef }: ChatRowProps) {
  const avatarUrl = useAvatarUrl({
    ownerUid: item.otherUid,
    isMine: item.otherUid === myUid,
    resolvedAvatarUrl: undefined,
    ownerPhotoUrl: undefined,
  });
  const initials = item.otherName.slice(0, 1).toUpperCase();

  const [presence, setPresence] = useState<{ online: boolean }>({ online: false });
  const [otherTyping, setOtherTyping] = useState(false);

  useEffect(() => {
    if (!item.otherUid) return;
    const unsub = subscribeUserPresence(item.otherUid, (p) => setPresence({ online: p.online }));
    return unsub;
  }, [item.otherUid]);

  useEffect(() => {
    if (!item.convId || !myUid) return;
    const unsub = subscribeTyping(item.convId, myUid, (uid) => setOtherTyping(!!uid));
    return unsub;
  }, [item.convId, myUid]);

  const mineLast = item.lastSenderUid === myUid;
  const unread = item.unreadCount > 0;

  const previewNode = otherTyping ? (
    <Text style={styles.previewTyping} numberOfLines={1}>пише…</Text>
  ) : (
    <Text
      style={unread ? styles.previewUnread : styles.preview}
      numberOfLines={1}
    >
      {mineLast && item.lastMessage ? <Text style={styles.previewPrefix}>Ти: </Text> : null}
      {item.lastMessage || 'Без съобщения'}
    </Text>
  );

  // Right action: mute / unmute. Color flips so the action explains itself.
  const renderRightActions = () => (
    <Pressable
      onPress={() => onToggleMute(item, !muted)}
      style={[styles.swipeAction, { backgroundColor: muted ? colors.primary : '#8E8E93' }]}
      accessibilityRole="button"
      accessibilityLabel={muted ? 'Включи известията' : 'Заглуши'}
    >
      <Ionicons name={muted ? 'notifications' : 'notifications-off'} size={20} color="#fff" />
      <Text style={styles.swipeActionLabel}>{muted ? 'Включи' : 'Заглуши'}</Text>
    </Pressable>
  );

  // Left action: mark unread/read. Same colors.primary, icon flips.
  const renderLeftActions = () => (
    <Pressable
      onPress={() => onToggleUnread(item)}
      style={[styles.swipeAction, { backgroundColor: colors.primary }]}
      accessibilityRole="button"
      accessibilityLabel={unread ? 'Отбележи като прочетено' : 'Отбележи като непрочетено'}
    >
      <Ionicons name={unread ? 'checkmark-done' : 'ellipse'} size={20} color="#fff" />
      <Text style={styles.swipeActionLabel}>{unread ? 'Прочетено' : 'Непрочетено'}</Text>
    </Pressable>
  );

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      overshootRight={false}
      overshootLeft={false}
      rightThreshold={60}
      leftThreshold={60}
      friction={2}
    >
      <Pressable
        onPress={() => onPress(item)}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceAlt }]}
      >
        <View style={styles.avatarWrap}>
          {avatarUrl ? (
            <Image source={{ uri: getImageVariant(avatarUrl, ImageSize.avatar) ?? avatarUrl }} style={styles.avatarImg} contentFit="cover" cachePolicy="memory-disk" />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}
          {presence.online ? <View style={styles.onlineDot} /> : null}
        </View>

        <View style={styles.body}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={styles.name} numberOfLines={1}>{item.otherName}</Text>
            {muted ? <Ionicons name="notifications-off" size={13} color={colors.textMuted} /> : null}
          </View>
          {previewNode}
        </View>

        <View style={styles.right}>
          {item.lastMessageAt ? (
            <Text style={unread ? styles.timeUnread : styles.time}>{formatTime(item.lastMessageAt)}</Text>
          ) : null}
          {unread && !muted ? (
            <View style={styles.unreadPill}>
              <Text style={styles.unreadPillText}>
                {item.unreadCount > 99 ? '99+' : item.unreadCount}
              </Text>
            </View>
          ) : unread && muted ? (
            // Muted conversations get a subtle dot instead of a colored pill —
            // we still want the user to know there's something new without
            // shouting about it.
            <View style={styles.mutedUnreadDot} />
          ) : (
            <View style={styles.unreadSpacer} />
          )}
        </View>
      </Pressable>
    </Swipeable>
  );
}

// ─── Recently-active rail ────────────────────────────────────────────────────

type ActiveContact = {
  uid: string;
  displayName: string;
  photoUrl?: string;
  online: boolean;
};

/** Horizontal rail of follows who are currently online. Tap → open or start a
    chat with them. Avatars are 64px (slightly larger than the row avatars) so
    the rail reads as a feature, not just a header. */
function ActiveContactsRail({
  myUid,
  myName,
  colors,
  onOpen,
}: {
  myUid: string;
  myName: string;
  colors: AppColors;
  onOpen: (uid: string, displayName: string) => void;
}) {
  const [contacts, setContacts] = useState<ActiveContact[]>([]);

  // Build the candidate set from getFollowing (cached), then subscribe to each
  // one's presence. We surface only people who are currently online. Cap at
  // 30 to keep the listener count bounded; getFollowing caches for 10 min so
  // this isn't a per-render Firestore hit.
  useEffect(() => {
    if (!myUid) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    (async () => {
      const follows = await getFollowing(myUid).catch(() => []);
      if (cancelled) return;
      const candidates = follows.slice(0, 30);
      const baseState: ActiveContact[] = candidates.map((f) => ({
        uid: f.uid, displayName: f.displayName, online: false,
      }));
      setContacts(baseState);
      // Hydrate displayName/photo for any candidate missing a name.
      candidates.forEach((f) => {
        if (!f.displayName) {
          getUserPublicSummary(f.uid).then((sum) => {
            if (cancelled || !sum) return;
            setContacts((prev) => prev.map((c) => c.uid === f.uid
              ? { ...c, displayName: sum.displayName || c.displayName, photoUrl: sum.photoUrl }
              : c));
          }).catch(() => {});
        } else {
          getUserPublicSummary(f.uid).then((sum) => {
            if (cancelled || !sum?.photoUrl) return;
            setContacts((prev) => prev.map((c) => c.uid === f.uid ? { ...c, photoUrl: sum.photoUrl } : c));
          }).catch(() => {});
        }
      });
      // Presence per candidate. Listeners go away in cleanup.
      candidates.forEach((f) => {
        const unsub = subscribeUserPresence(f.uid, (p) => {
          if (cancelled) return;
          setContacts((prev) => prev.map((c) => c.uid === f.uid ? { ...c, online: p.online } : c));
        });
        unsubs.push(unsub);
      });
    })();
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [myUid]);

  const onlineContacts = useMemo(() => contacts.filter((c) => c.online), [contacts]);
  if (onlineContacts.length === 0) return null;

  const onTap = async (c: ActiveContact) => {
    try {
      void Haptics.selectionAsync();
      const convId = await ensureDirectConversation(myUid, myName, c.uid, c.displayName);
      onOpen(c.uid, c.displayName);
      // ensureDirectConversation also caches the convId for the chat detail
      // flow; we navigate via the same onOpen so the screen-level wiring
      // (route params) lives in one place.
      void convId;
    } catch {
      // Best-effort — if conversation creation fails we still navigate; the
      // chat screen will retry on mount.
      onOpen(c.uid, c.displayName);
    }
  };

  return (
    <View style={{ paddingTop: spacing.sm }}>
      <Text style={{
        ...typography.bodyBold,
        color: colors.textMuted,
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        paddingHorizontal: spacing.lg,
        marginBottom: spacing.xs,
      }}>
        Активни сега
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}
      >
        {onlineContacts.map((c) => {
          const initial = (c.displayName || '?').slice(0, 1).toUpperCase();
          return (
            <Pressable
              key={c.uid}
              onPress={() => onTap(c)}
              style={{ alignItems: 'center', width: 68 }}
              accessibilityRole="button"
              accessibilityLabel={`Чат с ${c.displayName}`}
            >
              <View style={{
                width: 60, height: 60, borderRadius: 30,
                backgroundColor: colors.primarySurface,
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderColor: '#2ECC71',
                overflow: 'hidden',
              }}>
                {c.photoUrl ? (
                  <Image source={{ uri: getImageVariant(c.photoUrl, ImageSize.avatar) ?? c.photoUrl }} style={{ width: 56, height: 56, borderRadius: 28 }} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 22 }}>{initial}</Text>
                )}
              </View>
              <Text
                style={{ ...typography.caption, color: colors.text, fontSize: 11, marginTop: 4, textAlign: 'center' }}
                numberOfLines={1}
              >
                {c.displayName.split(' ')[0] || c.displayName}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function createChatsStyles(colors: AppColors, mode: 'dark' | 'light') {
  return StyleSheet.create({
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.sm,
    },
    searchInput: { flex: 1, color: colors.text, ...typography.body, paddingVertical: 2 },

    // Tab bar — All / Unread. Underline-style active tab, matches NotificationsScreen.
    tabBar: {
      flexDirection: 'row',
      paddingHorizontal: spacing.lg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: spacing.md,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive: { borderBottomColor: colors.primary },
    tabLabel: { ...typography.bodyBold, color: colors.textMuted, fontSize: 14 },
    tabLabelActive: { color: colors.primary },
    tabCountPill: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.primary,
      paddingHorizontal: 5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabCountPillText: { color: '#fff', fontSize: 10, fontWeight: '800' },

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: 12,
      gap: spacing.md,
      backgroundColor: colors.background,
    },
    avatarWrap: {
      width: 54,
      height: 54,
      borderRadius: 27,
      overflow: 'visible',
    },
    avatarImg: { width: 54, height: 54, borderRadius: 27 },
    avatarFallback: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.primarySurface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    avatarText: { color: colors.primary, fontWeight: '700', fontSize: 22 },
    onlineDot: {
      position: 'absolute',
      bottom: 1,
      right: 1,
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: '#2ECC71',
      borderWidth: 2.5,
      borderColor: mode === 'dark' ? colors.background : '#FFFFFF',
    },

    body: { flex: 1, justifyContent: 'center', gap: 3 },
    name: { ...typography.h3, color: colors.text, fontSize: 16 },
    preview: { ...typography.body, color: colors.textMuted, fontSize: 14 },
    previewUnread: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
    previewPrefix: { color: colors.textMuted, fontWeight: '600' },
    previewTyping: { ...typography.body, color: colors.primary, fontStyle: 'italic', fontSize: 14 },

    right: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, minWidth: 44 },
    time: { ...typography.small, color: colors.textMuted, fontSize: 12 },
    timeUnread: { ...typography.small, color: colors.primary, fontWeight: '700', fontSize: 12 },
    unreadPill: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 7,
    },
    unreadPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
    mutedUnreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.textMuted,
      marginRight: 7,
    },
    unreadSpacer: { width: 22, height: 22 },

    // Swipe-action panels — match the height of the row so the colored slab
    // fully spans the swipe gesture.
    swipeAction: {
      width: 86,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
    },
    swipeActionLabel: { ...typography.small, color: '#fff', fontSize: 10, fontWeight: '700' },

    warn: { ...typography.body, color: colors.textMuted },

    sep: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: spacing.lg + 54 + spacing.md,
    },

    fab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.xl + spacing.md,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
  });
}

type InboxTab = 'all' | 'unread';

export default function ChatsScreen() {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => createChatsStyles(colors, mode), [colors, mode]);
  const navigation = useAppNavigation();
  const { user, configured } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<InboxTab>('all');
  // Inbox is a live Firestore subscription, so refresh is purely tactile —
  // we flash a brief refreshing state so the FishingRefreshControl animation
  // plays through and then resolves. Matches the FeedScreen look.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    // Haptic is fired centrally by FishingRefreshControl now.
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }, []);

  // Track open Swipeable rows so we can close the previously-open one when
  // the user starts swiping a different row (iMessage behavior). Keyed by
  // convId.
  const [swipeRefs] = useState(() => new Map<string, Swipeable | null>());

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
    wave: {
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      marginTop: -28,
      flex: 1,
      backgroundColor: waveColor,
      overflow: 'hidden',
    },
  }), [waveColor]);

  const { data, loading } = useFirestoreSubscription<ConversationPreview[]>(
    (cb) => {
      if (!user?.uid) { cb([]); return () => {}; }
      return subscribeMyConversations(user.uid, cb);
    },
    [user?.uid],
    { pauseInBackground: true },
  );
  // Older conversations beyond the 50-doc live tail. Append-only, fetched in
  // chunks when the user scrolls past the tail.
  const [olderConvs, setOlderConvs] = useState<ConversationPreview[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // null = haven't tried, true = more available, false = caught up.
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean | null>(null);
  // Reset pagination state when the user changes.
  useEffect(() => {
    setOlderConvs([]);
    setHasMoreOlder(null);
  }, [user?.uid]);

  // Merge live + paginated by id (live wins on overlap), then sort by recency.
  const allItems: ConversationPreview[] = useMemo(() => {
    const live = data ?? [];
    if (olderConvs.length === 0) return live;
    const byId = new Map<string, ConversationPreview>();
    for (const c of olderConvs) byId.set(c.convId, c);
    for (const c of live) byId.set(c.convId, c);
    return Array.from(byId.values()).sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  }, [data, olderConvs]);

  const loadOlder = useCallback(async () => {
    if (!user?.uid || loadingOlder || hasMoreOlder === false) return;
    const oldest = allItems[allItems.length - 1];
    const beforeMs = oldest?.lastMessageAt ?? 0;
    if (!beforeMs) return;
    setLoadingOlder(true);
    try {
      const batch = await fetchOlderConversations(user.uid, beforeMs, 30);
      if (batch.length === 0) {
        setHasMoreOlder(false);
      } else {
        setOlderConvs((prev) => {
          const seen = new Set(prev.map((c) => c.convId));
          const dedup = batch.filter((c) => !seen.has(c.convId));
          return [...prev, ...dedup];
        });
        setHasMoreOlder(batch.length === 30);
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [user?.uid, loadingOlder, hasMoreOlder, allItems]);

  const [blockedUids, setBlockedUids] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.uid) { setBlockedUids(new Set()); return; }
    let cancelled = false;
    getBlockedUids(user.uid).then((set) => { if (!cancelled) setBlockedUids(set); }).catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Subscribe to mute set — kept tiny (one doc per muted conv).
  const [mutedSet, setMutedSet] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.uid) { setMutedSet(new Set()); return; }
    return subscribeMutedConversations(user.uid, setMutedSet);
  }, [user?.uid]);

  // Filter pipeline: blocked-out → search query → tab.
  const items = useMemo(() => {
    const visible = blockedUids.size > 0
      ? allItems.filter((c) => !blockedUids.has(c.otherUid))
      : allItems;
    const q = searchQuery.trim().toLowerCase();
    const searched = q
      ? visible.filter((c) =>
          c.otherName.toLowerCase().includes(q) || (c.lastMessage ?? '').toLowerCase().includes(q))
      : visible;
    if (tab === 'unread') {
      return searched.filter((c) => c.unreadCount > 0 && !mutedSet.has(c.convId));
    }
    return searched;
  }, [allItems, searchQuery, blockedUids, mutedSet, tab]);

  // Unread count for the tab badge (excludes muted conversations — those
  // shouldn't pressure the user to read them).
  const unreadConvCount = useMemo(
    () => allItems.filter((c) => c.unreadCount > 0 && !mutedSet.has(c.convId) && !blockedUids.has(c.otherUid)).length,
    [allItems, mutedSet, blockedUids],
  );

  const onPressConv = (item: ConversationPreview) => {
    navigation.navigate('ChatDetail', {
      convId: item.convId,
      otherUid: item.otherUid,
      otherName: item.otherName,
    });
  };

  const onCompose = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).navigate('Friends');
  };

  const onToggleMute = useCallback(async (item: ConversationPreview, nextMuted: boolean) => {
    if (!user) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Optimistic — the snapshot will fix it if the write fails.
    setMutedSet((prev) => {
      const next = new Set(prev);
      if (nextMuted) next.add(item.convId); else next.delete(item.convId);
      return next;
    });
    swipeRefs.get(item.convId)?.close();
    try {
      if (nextMuted) await muteConversation(user.uid, item.convId);
      else await unmuteConversation(user.uid, item.convId);
    } catch {
      Toast.show({ type: 'error', text1: 'Не успяхме да обновим състоянието', visibilityTime: 2400 });
    }
  }, [user, swipeRefs]);

  const onToggleUnread = useCallback(async (item: ConversationPreview) => {
    if (!user) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    swipeRefs.get(item.convId)?.close();
    try {
      if (item.unreadCount > 0) {
        await markConversationRead(item.convId, user.uid);
      } else {
        await markConversationUnread(item.convId, user.uid);
      }
    } catch {
      Toast.show({ type: 'error', text1: 'Не успяхме да обновим състоянието', visibilityTime: 2400 });
    }
  }, [user, swipeRefs]);

  const HeroSection = (
    <View style={S.hero}>
      <LinearGradient colors={heroColors} style={StyleSheet.absoluteFillObject} pointerEvents="none" />
      <View style={S.heroInner}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={S.backBtn} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={S.heroTitle}>Съобщения</Text>
        <View style={{ width: 40 }} />
      </View>
    </View>
  );

  if (!configured || !user) {
    return (
      <Screen padded={false} avoidKeyboard={false}>
        {HeroSection}
        <View style={[S.wave, { flex: 1 }]}>
          <View style={{ padding: spacing.lg, flex: 1 }}>
            <Text style={styles.warn}>Влез в профила си и активирай Firebase, за да ползваш чата.</Text>
          </View>
        </View>
      </Screen>
    );
  }

  const myName = user.displayName ?? user.email ?? 'Аз';

  // ListHeader bundles the rail + search + tabs so they scroll with the list
  // (tabs are deliberately scrollable because the rail takes vertical space —
  // pinning them is more visual noise than it's worth).
  const ListHeader = (
    <View>
      <ActiveContactsRail
        myUid={user.uid}
        myName={myName}
        colors={colors}
        onOpen={(uid, name) => {
          navigation.navigate('ChatDetail', {
            convId: [user.uid, uid].sort().join('_'),
            otherUid: uid,
            otherName: name,
          });
        }}
      />

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Търси разговори…"
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <View style={styles.tabBar}>
        <Pressable
          onPress={() => { void Haptics.selectionAsync(); setTab('all'); }}
          style={[styles.tab, tab === 'all' && styles.tabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'all' }}
        >
          <Text style={[styles.tabLabel, tab === 'all' && styles.tabLabelActive]}>Всички</Text>
        </Pressable>
        <Pressable
          onPress={() => { void Haptics.selectionAsync(); setTab('unread'); }}
          style={[styles.tab, tab === 'unread' && styles.tabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'unread' }}
        >
          <Text style={[styles.tabLabel, tab === 'unread' && styles.tabLabelActive]}>Непрочетени</Text>
          {unreadConvCount > 0 ? (
            <View style={styles.tabCountPill}>
              <Text style={styles.tabCountPillText}>{unreadConvCount > 99 ? '99+' : unreadConvCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );

  return (
    <Screen padded={false} avoidKeyboard={false}>
      {HeroSection}
      <View style={[S.wave, { flex: 1 }]}>
        {loading ? (
          <ChatSkeleton colors={colors} />
        ) : (
          <FadeIn>
          <FlashList
            data={items}
            keyExtractor={(item) => item.convId}
            // Search bar lives in ListHeader. Dismiss on drag so users can
            // get to lower rows without the keyboard covering them, matching
            // SearchScreen / ChatDetail input behavior.
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={items.length === 0 ? { flexGrow: 1, paddingBottom: 100 } : { paddingBottom: 100 }}
            ListHeaderComponent={ListHeader}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            ListFooterComponent={
              loadingOlder ? (
                <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
                  <Skeleton width={120} height={12} />
                </View>
              ) : null
            }
            refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            ListEmptyComponent={
              <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.xl }}>
                <EmptyState
                  icon={tab === 'unread' ? 'checkmark-done-outline' : 'chatbubbles-outline'}
                  title={tab === 'unread' ? 'Няма непрочетени' : 'Все още няма разговори'}
                  subtitle={tab === 'unread'
                    ? 'Всичко е изчистено. Хубаво е, когато inbox-ът е празен.'
                    : 'Открий приятели и започни първия си разговор.'}
                  action={tab === 'unread' ? undefined : { label: 'Към приятели', onPress: onCompose }}
                />
              </View>
            }
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            renderItem={({ item }) => (
              <ChatRow
                item={item}
                myUid={user.uid}
                muted={mutedSet.has(item.convId)}
                styles={styles}
                colors={colors}
                onPress={onPressConv}
                onToggleMute={onToggleMute}
                onToggleUnread={onToggleUnread}
                swipeRef={(r) => { swipeRefs.set(item.convId, r); }}
              />
            )}
          />
          </FadeIn>
        )}

        <Pressable
          onPress={onCompose}
          style={styles.fab}
          accessibilityRole="button"
          accessibilityLabel="Нов разговор"
        >
          <Ionicons name="create-outline" size={26} color="#fff" />
        </Pressable>
      </View>
    </Screen>
  );
}
