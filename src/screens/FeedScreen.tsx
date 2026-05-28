import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '../storage/kv';
import { View, Text, StyleSheet, Pressable, Platform, Animated, Alert } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';

// FlashList is a drop-in for FlatList with 5-10× the scroll perf at this
// list's size; we lose the legacy `maxToRenderPerBatch` etc. knobs since
// FlashList runs its own recycling internally. Wrapped with
// createAnimatedComponent so it can receive Animated.event onScroll with
// useNativeDriver: true — same pattern as the old AnimatedFlatList.
const AnimatedFlashList = Animated.createAnimatedComponent(FlashList) as unknown as typeof FlashList;
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import type { FeedStackParamList } from '../navigation/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { ActionSheet } from '../components/ActionSheet';
import { Card } from '../components/Card';
import { ComposeFab } from '../components/ComposeFab';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { FeedPost, FeedItem } from '../components/FeedPost';
import { PostCard } from '../components/PostCard';
import { PeopleYouMayKnowRow } from '../components/PeopleYouMayKnowRow';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { fetchPublicFeed, prefetchFirstPageItems, deletePhotoFromFeedPost, removeFromPublicFeed, getFollowing, getUserPublicSummary, fetchPublicPosts, deletePost, searchUsersByName, createPost, type FeedPage } from '../services/cloudSync';
import { publishFeedVisibility } from '../services/feedVisibility';
import Toast from 'react-native-toast-message';
import type { ResharedRef } from '../types';
import { listFollowedHashtags } from '../services/hashtags';
import { fetchPostsByHashtag } from '../services/posts';
import type { Post } from '../types';
import type { DocumentSnapshot } from 'firebase/firestore';
import { getBlockedUids } from '../services/blockUser';
import { StoriesRow } from '../components/StoriesRow';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { FeedSkeleton } from '../components/FeedSkeleton';
import { FadeIn } from '../components/FadeIn';
import { useAuth } from '../services/authContext';
import { formatFirebaseError } from '../services/firebaseErrors';
import { captureException } from '../services/observability';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import { notifyError } from '../utils/notify';
import { useAppNavigation } from '../navigation/useAppNavigation';
import * as Haptics from 'expo-haptics';
import { useUnreadNotifCount } from '../hooks/useUnreadNotifCount';
import { DamPicker, type WaterPick } from '../components/DamPicker';
import { catchMatchesLeaderboardWater } from '../services/leaderboards';

type FeedScope = 'all' | 'following';
// AsyncStorage key for the last-selected water filter. Persisted so the
// user's "Язовир Искър" view survives an app restart — they almost always
// want the same dam they were last looking at.
const WATER_FILTER_KEY = '@ribolov/feedWaterFilter';

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    topBarTitle: {
      ...typography.h2,
      color: colors.text,
      flex: 1,
      letterSpacing: -0.5,
    },
    iconBtn: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentRow: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    segmentTab: {
      flex: 1,
      paddingVertical: 12,
      alignItems: 'center',
    },
    listContent: { paddingBottom: spacing.xxl },
    warnTitle: { ...typography.h3, color: colors.text },
    warnBody: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 22 },
    centerMsg: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  });
}

export default function FeedScreen() {
  const navigation = useAppNavigation();
  const insets = useSafeAreaInsets();
  const { user, configured } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const unreadNotifCount = useUnreadNotifCount(user?.uid);

  // Optional deep-link target: when navigated here from a mention
  // notification we'll receive { focusPostId } and scroll to that post once
  // the list renders.
  const route = useRoute<RouteProp<FeedStackParamList, 'FeedList'>>();
  const focusPostId = route.params?.focusPostId;
  const focusHandledRef = useRef<string | null>(null);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | undefined>();
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});
  // visibleIdsRef is read by `prefetchBatch` and old code paths; we still
  // keep it for those, but the per-card visibility used by FeedPost /
  // PostCard now flows through the `publishFeedVisibility` pub-sub so the
  // renderItem closure doesn't churn on every viewability tick.
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const flatListRef = useRef<FlashListRef<any>>(null);
  // Persisted between load/loadMore so pagination passes same ownerUids filter
  const followingUidsRef = useRef<string[]>([]);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollTopAnim = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;
  const [headerHeight, setHeaderHeight] = useState(0);

  // diffClamp: goes up when scrolling down (max 300), down when scrolling up (min 0)
  const clampedScroll = useRef(Animated.diffClamp(scrollY, 0, 300)).current;
  const headerTranslate = useRef(Animated.multiply(clampedScroll, -1)).current;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // When the active user changes, reset session-scoped UI state so the
    // previous account's avatar and "new posts" baseline don't bleed into
    // the next account's session.
    setMyPhotoUrl(undefined);
    seenTopIdRef.current = null;
    newPostsCountRef.current = 0;
    setNewPostsCount(0);
    if (!user?.uid) return;
    AsyncStorage.getItem(`@ribolov/profilePhoto/${user.uid}`)
      .then((v) => { if (v) setMyPhotoUrl(v); })
      .catch(() => {});
  }, [user?.uid]);

  const [scope, setScope] = useState<FeedScope>('all');
  // Water-body filter (dam or river). When set, the feed shows only catches
  // matching that water — same matching rule as the Leaderboard scope
  // (`catchMatchesLeaderboardWater`): GPS within radius OR text match in
  // location name / notes. Posts are hidden while a water filter is active
  // since they don't carry a location signal worth filtering on.
  const [waterFilter, setWaterFilter] = useState<WaterPick | null>(null);
  const [waterPickerOpen, setWaterPickerOpen] = useState(false);

  // Restore last water filter on mount. Stored as { kind, id } — we resolve
  // back to the full Dam / River object from the local DAMS / RIVERS data
  // (which is bundled, so no network roundtrip).
  useEffect(() => {
    AsyncStorage.getItem(WATER_FILTER_KEY).then((raw) => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as { kind: 'dam' | 'river'; id: string };
        // Lazy import — DAMS / RIVERS are already pulled in by leaderboards.ts
        // via the catchMatchesLeaderboardWater path, but we need them here
        // to reconstruct the WaterPick object. Cheap require since the
        // module is already in the bundle.
        const { DAMS } = require('../data/dams');
        const { RIVERS } = require('../data/rivers');
        if (saved.kind === 'dam') {
          const d = DAMS.find((x: { id: string }) => x.id === saved.id);
          if (d) setWaterFilter({ kind: 'dam', item: d });
        } else {
          const r = RIVERS.find((x: { id: string }) => x.id === saved.id);
          if (r) setWaterFilter({ kind: 'river', item: r });
        }
      } catch {
        // Ignore malformed payload — fall back to no filter.
      }
    }).catch(() => {});
  }, []);

  // Persist filter on change. Null clears the saved value so a fresh launch
  // doesn't restore a filter the user explicitly cleared.
  useEffect(() => {
    if (waterFilter) {
      AsyncStorage.setItem(
        WATER_FILTER_KEY,
        JSON.stringify({ kind: waterFilter.kind, id: waterFilter.item.id }),
      ).catch(() => {});
    } else {
      AsyncStorage.removeItem(WATER_FILTER_KEY).catch(() => {});
    }
  }, [waterFilter]);

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // "X нови" pill state — counts items that appeared at the top of the feed
  // since the user last saw the top. seenTopIdRef tracks the most-recent
  // top item id the user has observed (updated on scroll-to-top + pill-tap).
  // itemsRef mirrors items so the onScroll listener can read fresh data
  // without forcing a listener re-create on every items change.
  const [newPostsCount, setNewPostsCount] = useState(0);
  const [stickyTabsVisible, setStickyTabsVisible] = useState(false);
  const seenTopIdRef = useRef<string | null>(null);
  const isAtTopRef = useRef(true);
  const itemsRef = useRef<FeedItem[]>([]);
  const newPostsCountRef = useRef(0);

  const prefetchBatch = useCallback((list: FeedItem[]) => {
    list.forEach((item) => {
      if (item.photoUri) Image.prefetch(item.photoUri).catch(() => {});
      if (item.ownerPhotoUrl) Image.prefetch(item.ownerPhotoUrl).catch(() => {});
    });
  }, []);

  const load = useCallback(async () => {
    if (!configured || !user) return;
    setError(null);
    const scopeAtRequest = scope;
    try {
      // Stale-while-revalidate: paint the last-cached page from AsyncStorage
      // *before* hitting the network. For the "all" (For You) tab we can paint
      // immediately because no follow-list lookup is needed. For Following,
      // the cache key depends on the follow list — so we fetch follows + the
      // cached page in parallel below, then paint with the right key.
      if (scope === 'all') {
        const cached = await prefetchFirstPageItems(20);
        if (cached.length > 0 && mountedRef.current && scopeAtRequest === scope) {
          setItems(cached);
          itemsRef.current = cached;
          setLoading(false);
        } else {
          setLoading(true);
        }
      } else {
        setLoading(true);
      }
      const [followingRows, blockedUids] = await Promise.all([
        getFollowing(user.uid),
        getBlockedUids(user.uid),
      ]);
      // Following-scope cache paint: the follow list is known now, so we can
      // look up a cache entry keyed by the sorted follow list. Same instant-
      // paint trick as For You. Skip when the user follows no one (the
      // fetchPublicFeed call below would short-circuit anyway).
      if (scope === 'following' && mountedRef.current && scopeAtRequest === scope) {
        const followingUids = followingRows
          .map((f) => f.uid)
          .filter((uid) => !blockedUids.has(uid));
        if (followingUids.length > 0) {
          const cached = await prefetchFirstPageItems(20, followingUids);
          if (cached.length > 0 && mountedRef.current && scopeAtRequest === scope) {
            setItems(cached);
            itemsRef.current = cached;
            setLoading(false);
          }
        }
      }

      let page: FeedPage;
      let postsPage: { items: Post[] };
      let hashtagPosts: Post[] = [];
      if (scope === 'following') {
        const uids = followingRows.map((f) => f.uid).filter((uid) => !blockedUids.has(uid));
        followingUidsRef.current = uids;
        // Fetch followed-hashtag posts in parallel so they mix into the
        // "Следваш" tab. Capped to 5 tags × 10 posts so the fan-out stays
        // bounded even for power users; dedupe happens after the merge.
        const tagsP = listFollowedHashtags(user.uid).catch(() => [] as string[]);
        if (uids.length > 0) {
          const [pageRes, postsRes, tags] = await Promise.all([
            fetchPublicFeed(20, null, uids),
            fetchPublicPosts(40, null, uids).catch(() => ({ items: [] as Post[], lastDoc: null, hasMore: false })),
            tagsP,
          ]);
          page = pageRes;
          postsPage = postsRes;
          if (tags.length > 0) {
            const tagLists = await Promise.all(
              tags.slice(0, 5).map((t) => fetchPostsByHashtag(t, 10).catch(() => [] as Post[])),
            );
            hashtagPosts = tagLists.flat();
          }
        } else {
          page = { items: [], lastDoc: null, hasMore: false };
          postsPage = { items: [] };
          const tags = await tagsP;
          if (tags.length > 0) {
            const tagLists = await Promise.all(
              tags.slice(0, 5).map((t) => fetchPostsByHashtag(t, 10).catch(() => [] as Post[])),
            );
            hashtagPosts = tagLists.flat();
          }
        }
      } else {
        followingUidsRef.current = [];
        [page, postsPage] = await Promise.all([
          fetchPublicFeed(20),
          fetchPublicPosts(40).catch(() => ({ items: [] as Post[], lastDoc: null, hasMore: false })),
        ]);
      }

      // Drop the result if the component unmounted or scope changed while we were waiting.
      if (!mountedRef.current || scopeAtRequest !== scope) return;

      let next = page.items.filter((i) => !blockedUids.has(i.ownerUid));
      // Merge followed-hashtag posts into the post stream, dedupe by id, and
      // exclude posts from blocked users / by the user themselves (those
      // already appear in their main feed).
      const mergedPostsById = new Map<string, Post>();
      for (const p of postsPage.items) mergedPostsById.set(p.id, p);
      for (const p of hashtagPosts) {
        if (!mergedPostsById.has(p.id)) mergedPostsById.set(p.id, p);
      }
      const nextPosts = Array.from(mergedPostsById.values())
        .filter((p) => !blockedUids.has(p.ownerUid))
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

      // "New posts" pill: surface the delta on every refresh whenever the
      // top-of-feed id has changed since the last time the user saw it. We
      // used to gate this on !isAtTopRef.current so the pill only appeared
      // mid-scroll, which meant a user at the top got fresh posts silently
      // appended without any "N нови публикации" hint. Now it shows for both
      // cases — if they're already at the top, they tap the pill (or just
      // scroll) and we'll clear it on next scroll-to-top.
      const newTopId = next[0]?.id ?? null;
      if (newTopId && seenTopIdRef.current && newTopId !== seenTopIdRef.current) {
        const seenIdx = next.findIndex((i) => i.id === seenTopIdRef.current);
        const delta = seenIdx > 0 ? seenIdx : next.length;
        newPostsCountRef.current = delta;
        setNewPostsCount(delta);
      } else if (!seenTopIdRef.current) {
        // First load — seed the tip without showing a pill.
        seenTopIdRef.current = newTopId;
        newPostsCountRef.current = 0;
        setNewPostsCount(0);
      }

      setItems(next);
      itemsRef.current = next;
      setPosts(nextPosts);
      prefetchBatch(next);
      setLastDoc(page.lastDoc);
      setHasMore(scope === 'all' ? page.hasMore : false);
      const missingUids = [...new Set(
        next
          .filter((i) => !i.ownerPhotoUrl && i.ownerUid && i.ownerUid !== user.uid)
          .map((i) => i.ownerUid)
      )];
      if (missingUids.length > 0) {
        Promise.all(missingUids.map((uid) => getUserPublicSummary(uid).catch(() => null)))
          .then((summaries) => {
            if (!mountedRef.current) return;
            const patch: Record<string, string> = {};
            summaries.forEach((s, idx) => {
              const url = s?.photoUrl?.trim();
              if (url) patch[missingUids[idx]] = url;
            });
            if (Object.keys(patch).length > 0) {
              setAvatarMap((prev) => ({ ...prev, ...patch }));
            }
          })
          .catch(() => {});
      }
    } catch (e: unknown) {
      captureException(e);
      if (mountedRef.current) setError(formatFirebaseError(e));
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [configured, user, scope, prefetchBatch]);

  const loadMore = useCallback(async () => {
    if (!configured || !user || !hasMore || loadingMoreRef.current || !lastDoc) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    // Capture scope at request time so a mid-flight scope switch can be detected on return.
    const scopeAtRequest = scope;
    try {
      const blockedUids = await getBlockedUids(user.uid);
      const ownerUids = followingUidsRef.current.length > 0 ? followingUidsRef.current : undefined;
      const page = await fetchPublicFeed(20, lastDoc, ownerUids);
      // If the user switched scope or unmounted while this was inflight, drop the result.
      if (!mountedRef.current || scopeAtRequest !== scope) return;
      const next = page.items.filter((i) => !blockedUids.has(i.ownerUid));
      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const deduped = next.filter((i) => !existingIds.has(i.id));
        return [...prev, ...deduped];
      });
      prefetchBatch(next);
      setLastDoc(page.lastDoc);
      setHasMore(page.hasMore);
    } catch {
      /* silent — user can pull to refresh */
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [configured, user, hasMore, lastDoc, prefetchBatch, scope]);

  const lastLoadRef = useRef<number>(0);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    if (user && configured) {
      load();
      lastLoadRef.current = Date.now();
    }
  }, [load, user, configured]);

  // Refresh feed when returning to this tab if data is >= 30s old.
  // This catches the case where a catch was just shared publicly from AddCatch
  // (cloud sync runs in the background after navigation, so the feed needs a refresh).
  useFocusEffect(
    useCallback(() => {
      if (!user || !configured) return;
      if (Date.now() - lastLoadRef.current >= 8_000) {
        loadRef.current();
        lastLoadRef.current = Date.now();
      }
    }, [user, configured])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  // Switching between "Всички" and "Следвани" must wipe ALL pagination state
  // so the next load doesn't mix scope-A's posts with scope-B's catches, or
  // page using scope-A's cursor while scope-B is active. The hero header
  // and the sticky compact tabs both call this — keeping the cleanup in one
  // place avoids drift between the two surfaces.
  const switchScope = useCallback((next: FeedScope) => {
    setScope((prev) => {
      if (prev === next) return prev;
      setItems([]);
      setPosts([]);
      setLastDoc(null);
      setHasMore(false);
      void Haptics.selectionAsync();
      return next;
    });
  }, []);

  const onPressAuthor = useCallback((authorUid: string, name: string) => {
    navigation.navigate('UserPublicProfile', { uid: authorUid, displayName: name });
  }, [navigation]);

  const onPressCatch = useCallback((catchItem: FeedItem) => {
    navigation.navigate('CatchDetail', { id: catchItem.id });
  }, [navigation]);

  // Tapping the embedded reshare card opens the ORIGINAL post or catch,
  // not the quoter's profile. Was a user-confusion bug: tap a quoted catch
  // → land on someone's profile instead of the catch detail.
  const onPressReshareTarget = useCallback((target: { kind: 'post' | 'catch'; id: string }) => {
    if (target.kind === 'catch') {
      navigation.navigate('CatchDetail', { id: target.id });
    } else {
      (navigation as any).navigate('PostDetail', { id: target.id });
    }
  }, [navigation]);

  const myDisplayName = user?.displayName ?? user?.email ?? 'Аз';
  const socialEnabled = !!user && !!configured;

  /**
   * Merged feed of catches and free-form posts, sorted by date (newest first).
   * Each entry is wrapped with a `kind` discriminator so the renderer can
   * pick the right component.
   */
  type MixedFeedItem =
    | { kind: 'catch'; data: FeedItem; date: string }
    | { kind: 'post'; data: Post; date: string };

  const displayedItems = useMemo<MixedFeedItem[]>(() => {
    const seen = new Set<string>();
    let dedupedCatches = items.filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });

    // Water-body filter: keep only catches that match the selected dam/river
    // via GPS-within-radius OR location-name/notes text match. Same rule as
    // the Leaderboard's water scope so behaviour is consistent across the
    // app — a catch that counts toward "Язовир Искър" on the leaderboard
    // also shows up in the "Язовир Искър" feed view.
    let filteredPosts = posts;
    if (waterFilter) {
      const waterScope = { type: 'water' as const, kind: waterFilter.kind, id: waterFilter.item.id };
      dedupedCatches = dedupedCatches.filter((c) => catchMatchesLeaderboardWater(c, waterScope));
      // Posts (text-only items) don't carry GPS and their text rarely
      // mentions a specific dam by name in a queryable way. Hiding them
      // when a water filter is active keeps the view focused on actual
      // catches from that water — which is what the user asked for.
      filteredPosts = [];
    }

    const merged: MixedFeedItem[] = [
      ...dedupedCatches.map((c) => ({ kind: 'catch' as const, data: c, date: c.date ?? '' })),
      ...filteredPosts.map((p) => ({ kind: 'post' as const, data: p, date: p.date ?? '' })),
    ];
    merged.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return merged;
  }, [items, posts, waterFilter]);

  // Mention-notification deep link: scroll to the focused post once it
  // appears in the merged list. focusHandledRef gates this to once per
  // distinct focusPostId so re-renders don't keep yanking the user.
  useEffect(() => {
    if (!focusPostId || focusHandledRef.current === focusPostId) return;
    const idx = displayedItems.findIndex(
      (it) => it.kind === 'post' && it.data.id === focusPostId,
    );
    if (idx < 0) return;
    focusHandledRef.current = focusPostId;
    // Defer to next frame so the FlatList has measured the row.
    setTimeout(() => {
      try {
        flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.15 });
      } catch { /* invalid index briefly during settle — onScrollToIndexFailed handles it */ }
    }, 120);
  }, [focusPostId, displayedItems]);

  const onPressHashtag = useCallback((tag: string) => {
    navigation.navigate('HashtagFeed', { tag });
  }, [navigation]);

  const onPressMention = useCallback(async (handle: string) => {
    try {
      const cleaned = handle.replace(/_/g, ' ');
      const results = await searchUsersByName(cleaned, { maxResults: 1, excludeUid: user?.uid });
      if (results[0]) {
        navigation.navigate('UserPublicProfile', { uid: results[0].uid, displayName: results[0].displayName });
      }
    } catch { /* ignore */ }
  }, [navigation, user?.uid]);

  // Helper: an instant repost — creates a Post doc with just the reshareOf
  // payload (no text, no photo). Goes through the feed immediately. The user
  // can still pick "Сподели с коментар" to land in the compose screen.
  const instantRepost = useCallback(async (target: ResharedRef) => {
    if (!user) return;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await createPost({
        ownerUid: user.uid,
        ownerName: user.displayName?.trim() || user.email?.trim() || 'Рибар',
        ownerPhotoUrl: myPhotoUrl,
        text: '',
        mentionUids: [],
        reshareOf: target,
      });
      Toast.show({ type: 'success', text1: 'Споделено в лентата', visibilityTime: 1500 });
    } catch (e) {
      notifyError('Грешка при споделяне', e instanceof Error ? e.message : 'Неуспешно споделяне.');
    }
  }, [user, myPhotoUrl]);

  // Show the user the two reshare modes — instant share or compose with a
  // comment. Themed bottom-sheet (ActionSheet) so the visual feel matches
  // the rest of the compose/share flow.
  const promptReshareMode = useCallback((target: ResharedRef) => {
    ActionSheet.show({
      title: 'Сподели',
      options: [
        {
          label: 'Сподели във лентата',
          icon: 'arrow-redo-outline',
          onPress: () => { void instantRepost(target); },
        },
        {
          label: 'Сподели с коментар',
          icon: 'chatbox-ellipses-outline',
          onPress: () => navigation.navigate('CreatePost', { reshare: target }),
        },
      ],
    });
  }, [navigation, instantRepost]);

  const onReshareCatch = useCallback((c: FeedItem) => {
    promptReshareMode({
      kind: 'catch',
      id: c.id,
      ownerUid: c.ownerUid,
      ownerName: c.ownerName ?? 'Рибар',
      ownerPhotoUrl: c.ownerPhotoUrl,
      text: c.notes ?? c.photoTitle ?? undefined,
      photoUri: c.photoUri,
      speciesName: c.speciesName,
      weightKg: c.weightKg,
      date: c.date,
    });
  }, [promptReshareMode]);

  const onResharePost = useCallback((p: Post) => {
    // If we're resharing a post that's itself a reshare, point at the original
    // so a chain of reshares doesn't accumulate nested cards.
    const target = p.reshareOf ?? {
      kind: 'post' as const,
      id: p.id,
      ownerUid: p.ownerUid,
      ownerName: p.ownerName,
      ownerPhotoUrl: p.ownerPhotoUrl,
      text: p.text,
      photoUri: p.photoUri,
      date: p.date,
    };
    promptReshareMode(target);
  }, [promptReshareMode]);

  const onDeletePostItem = useCallback(async (post: Post) => {
    Alert.alert('Изтрий публикацията', 'Сигурен ли си?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий', style: 'destructive', onPress: async () => {
          try {
            await deletePost(post.id);
            setPosts((prev) => prev.filter((p) => p.id !== post.id));
          } catch {
            notifyError('Неуспешно изтриване', 'Опитай отново.');
          }
        },
      },
    ]);
  }, []);

  const onDeletePhoto = useCallback(async (feedItem: FeedItem) => {
    if (!user) return;
    Alert.alert('Изтрий снимката', 'Сигурен ли си? Снимката ще бъде премахната от публикацията.', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий', style: 'destructive', onPress: async () => {
          try {
            await deletePhotoFromFeedPost(feedItem.id, user.uid);
            setItems((prev) => prev.map((i) => i.id === feedItem.id
              ? { ...i, photoUri: undefined, photoStoragePath: undefined, photoTitle: undefined, extraPhotoUris: undefined }
              : i
            ));
          } catch {
            notifyError('Снимката не можа да бъде изтрита', 'Опитай отново.');
          }
        },
      },
    ]);
  }, [user]);

  const onRemovePost = useCallback(async (feedItem: FeedItem) => {
    if (!user) return;
    Alert.alert('Премахни от лентата', 'Публикацията ще бъде скрита от лентата на всички. Уловът остава в дневника ти.', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Премахни', style: 'destructive', onPress: async () => {
          try {
            await removeFromPublicFeed(feedItem.id, user.uid);
            setItems((prev) => prev.filter((i) => i.id !== feedItem.id));
          } catch {
            notifyError('Публикацията не можа да бъде премахната', 'Опитай отново.');
          }
        },
      },
    ]);
  }, [user]);

  const renderItem = useCallback(({ item }: { item: MixedFeedItem }) => {
    if (item.kind === 'catch') {
      const c = item.data;
      // `isVisible` is no longer passed — FeedPost subscribes via
      // `useFeedItemVisibility(c.id)` so this closure stays stable across
      // viewability ticks. The cost saved: one renderItem call per visible
      // cell per tick = ~20 closure regenerations per scroll movement.
      return (
        <FeedPost
          item={c}
          onPressCatch={onPressCatch}
          myUid={user?.uid}
          myDisplayName={myDisplayName}
          myPhotoUrl={myPhotoUrl}
          resolvedAvatarUrl={avatarMap[c.ownerUid]}
          socialEnabled={socialEnabled}
          onPressAuthor={onPressAuthor}
          onDeletePhoto={onDeletePhoto}
          onRemovePost={onRemovePost}
          onReshare={user ? onReshareCatch : undefined}
          onPressHashtag={onPressHashtag}
          onPressMention={onPressMention}
        />
      );
    }
    const p = item.data;
    return (
      <PostCard
        post={p}
        myUid={user?.uid}
        myDisplayName={myDisplayName}
        myPhotoUrl={myPhotoUrl}
        resolvedAvatarUrl={avatarMap[p.ownerUid]}
        onPressAuthor={onPressAuthor}
        onPressHashtag={onPressHashtag}
        onPressMention={onPressMention}
        onDelete={onDeletePostItem}
        onReshare={user ? onResharePost : undefined}
        onPressReshareTarget={onPressReshareTarget}
      />
    );
  }, [user?.uid, user, myDisplayName, myPhotoUrl, avatarMap, socialEnabled, onPressAuthor, onPressCatch, onDeletePhoto, onRemovePost, onPressHashtag, onPressMention, onDeletePostItem, onReshareCatch, onResharePost]);

  // No separator — each post has its own bottom border
  const ItemSeparator = useCallback(() => null, []);

  // scrollY drives the collapsing header (Animated.diffClamp → translateY) on the
  // native side — no JS reads its value, so we can stay on useNativeDriver: true.
  // The threshold listener for the scroll-to-top button still fires in JS via the
  // `listener` callback; that's compatible with the native driver.
  const onScroll = useMemo(
    () => Animated.event(
      [{ nativeEvent: { contentOffset: { y: scrollY } } }],
      {
        useNativeDriver: true,
        listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
          const y = e.nativeEvent.contentOffset.y;
          const show = y > 400;
          setShowScrollTop((prev) => {
            if (prev !== show) {
              Animated.spring(scrollTopAnim, {
                toValue: show ? 1 : 0,
                useNativeDriver: true,
                speed: 18,
                bounciness: 8,
              }).start();
            }
            return show;
          });
          // Track "is at top" — within ~80px counts as "you can see the latest".
          // When the user returns to the top, the "X нови" pill clears itself
          // and the seen-tip is updated so future new items count from there.
          const atTop = y < 80;
          if (atTop !== isAtTopRef.current) {
            isAtTopRef.current = atTop;
            if (atTop && newPostsCountRef.current > 0) {
              newPostsCountRef.current = 0;
              setNewPostsCount(0);
              seenTopIdRef.current = itemsRef.current[0]?.id ?? null;
            }
          }
          // Toggle compact sticky tabs when the user scrolls past the main header.
          const shouldShowSticky = y > 200;
          setStickyTabsVisible((prev) => prev === shouldShowSticky ? prev : shouldShowSticky);
        },
      },
    ),
    [scrollY, scrollTopAnim],
  );

  const scrollToTop = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    void Haptics.selectionAsync();
  }, []);

  // Tap the "X нови" pill → scroll to top, mark all as seen, clear count.
  // The scroll-end will also clear the pill via the onScroll listener, but
  // we clear eagerly here so the pill disappears immediately on tap.
  const onPressNewPosts = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    seenTopIdRef.current = itemsRef.current[0]?.id ?? null;
    newPostsCountRef.current = 0;
    setNewPostsCount(0);
  }, []);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 40 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: { kind: string; data: { id: string } } }> }) => {
      const ids = new Set(viewableItems.map((v) => v.item.data.id));
      visibleIdsRef.current = ids;
      // Push to the pub-sub; FeedPost / PostCard subscribe individually. No
      // React state update here — that used to live in `visibleIds` and put
      // a fresh Set identity into renderItem's deps every tick, regenerating
      // the closure (and forcing FlashList to re-run renderItem for every
      // visible cell). Now the parent renders nothing on viewability change.
      publishFeedVisibility(ids);
    }
  ).current;

  const openOverflow = useCallback(() => {
    ActionSheet.show({
      options: [
        { label: 'Класации', icon: 'trophy-outline', onPress: () => navigation.navigate('Classics') },
        { label: 'Запазени', icon: 'bookmark-outline', onPress: () => navigation.navigate('SavedPosts') },
        { label: 'Открий', icon: 'compass-outline', onPress: () => navigation.navigate('Explore') },
      ],
    });
  }, [navigation]);

  const glassBtn = {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center' as const, justifyContent: 'center' as const,
  };

  const Hero = (
    <LinearGradient
      colors={['#0A2550', '#1570B8', '#1A8FE3']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ paddingTop: insets.top + 8, paddingBottom: 52, paddingHorizontal: spacing.lg }}
    >
      {/* Title + action buttons */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontSize: 28, fontWeight: '800', color: '#fff', flex: 1, letterSpacing: -0.5 }}>Лента</Text>
        <Pressable onPress={() => navigation.navigate('Notifications')} hitSlop={8} style={glassBtn} accessibilityLabel="Известия">
          <View style={{ position: 'relative' }}>
            <Ionicons name={unreadNotifCount > 0 ? 'notifications' : 'notifications-outline'} size={22} color="#fff" />
            {unreadNotifCount > 0 && (
              <View style={{ position: 'absolute', top: -4, right: -6, backgroundColor: '#e53935', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 12 }}>
                  {unreadNotifCount > 99 ? '99+' : unreadNotifCount}
                </Text>
              </View>
            )}
          </View>
        </Pressable>
        <Pressable onPress={() => navigation.navigate('Search')} hitSlop={8} style={glassBtn} accessibilityLabel="Търси">
          <Ionicons name="search-outline" size={22} color="#fff" />
        </Pressable>
        <Pressable onPress={openOverflow} hitSlop={8} style={glassBtn} accessibilityLabel="Още">
          <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
        </Pressable>
      </View>

      {/* Scope tabs */}
      <View style={{ flexDirection: 'row', marginTop: spacing.md, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
        <Pressable
          onPress={() => switchScope('all')}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, backgroundColor: scope === 'all' ? 'rgba(255,255,255,0.2)' : 'transparent', borderRadius: 12 }}
        >
          <Ionicons name="grid-outline" size={18} color="#fff" />
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Всички</Text>
        </Pressable>
        <Pressable
          onPress={() => switchScope('following')}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, backgroundColor: scope === 'following' ? 'rgba(255,255,255,0.2)' : 'transparent', borderRadius: 12 }}
        >
          <Ionicons name="people-outline" size={18} color="#fff" />
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Следвани</Text>
        </Pressable>
      </View>

      {/* Water-body filter chip — opens DamPicker. When active, shows the
          selected water name with a clear (×) button. The pill style mirrors
          the scope-tab background so the two controls feel like one cluster.
          Light haptic on open mirrors the "primary action" pattern used
          elsewhere; selection haptic fires inside the picker's onSelect. */}
      <Pressable
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setWaterPickerOpen(true);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginTop: spacing.sm,
          paddingVertical: 10,
          paddingHorizontal: 14,
          backgroundColor: waterFilter ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)',
          borderRadius: 14,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.18)',
        }}
        accessibilityRole="button"
        accessibilityLabel="Филтър по водоем"
      >
        <Ionicons
          name={waterFilter?.kind === 'river' ? 'git-branch-outline' : 'water-outline'}
          size={18}
          color="#fff"
        />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: '#fff' }} numberOfLines={1}>
          {waterFilter ? waterFilter.item.name : 'Филтър: всички водоеми'}
        </Text>
        {waterFilter ? (
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              setWaterFilter(null);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Изчисти филтър по водоем"
          >
            <Ionicons name="close-circle" size={20} color="rgba(255,255,255,0.85)" />
          </Pressable>
        ) : (
          <Ionicons name="chevron-down" size={16} color="rgba(255,255,255,0.75)" />
        )}
      </Pressable>
    </LinearGradient>
  );

  const waveContent = (() => {
    if (!configured) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg, paddingTop: headerHeight + spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Социалната част изисква Firebase</Text>
            <Text style={styles.warnBody}>
              Отвори файла src/services/firebaseConfig.ts и следвай инструкциите вътре, за да активираш облачната
              синхронизация и социалния feed.
            </Text>
          </Card>
        </View>
      );
    }
    if (!user) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg, paddingTop: headerHeight + spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Влез в акаунта си</Text>
            <Text style={styles.warnBody}>За да видиш улова на други риболовци, трябва да си влязъл.</Text>
            <Button title="Вход / Регистрация" onPress={() => navigation.navigate('Auth')} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      );
    }
    if (loading && items.length === 0) {
      return <View style={{ paddingTop: headerHeight }}><FeedSkeleton /></View>;
    }
    if (error && items.length === 0) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg, paddingTop: headerHeight + spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Неуспешно зареждане</Text>
            <Text style={styles.warnBody}>{error}</Text>
            <Button title="Опитай отново" onPress={() => load()} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      );
    }
    if (items.length === 0) {
      return (
        <View style={{ flex: 1, paddingTop: headerHeight }}>
          {/* Suggested anglers — most useful first-time content. Collapses
              when there's nobody to suggest either (e.g. brand-new account
              before the suggestion engine has scored candidates), so the
              empty-state CTA below isn't preceded by an empty row of nothing. */}
          <PeopleYouMayKnowRow collapseWhenEmpty={true} />
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg }}>
            <EmptyState
              icon={scope === 'following' ? 'people-outline' : 'layers-outline'}
              emoji={scope === 'following' ? '🐟' : '🎣'}
              title={scope === 'following' ? 'Няма публикации от следваните' : 'Тук още е тихо'}
              subtitle={
                scope === 'following'
                  ? 'Последвай риболовци, за да виждаш техните улови тук.'
                  : 'Сподели публично от Дневник → улов → „Сподели публично" — твоят пост ще се появи в лентата.'
              }
              action={{
                label: scope === 'following' ? 'Намери приятели' : 'Добави първи улов',
                onPress: () => {
                  if (scope === 'following') navigation.navigate('Friends');
                  else (navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params: {} });
                },
              }}
            />
          </View>
        </View>
      );
    }
    return (
      <FadeIn>
        <AnimatedFlashList
          ref={flatListRef}
          data={displayedItems}
          keyExtractor={(item) => `${item.kind}-${item.data.id}`}
          // Separate recycler pools for catch vs post cells. Without this hint
          // FlashList tries to reuse a catch cell for a post (and vice versa),
          // which means tearing down the wrong subtree and rebuilding from
          // scratch — wastes the recycler win. With it, scroll perf stays at
          // 60fps even on mixed-type feeds.
          getItemType={(item) => item.kind}
          // Pre-mount cells slightly outside the viewport so they're rendered
          // by the time they slide in. 500px ≈ one extra card on each side.
          drawDistance={500}
          contentContainerStyle={{ paddingTop: headerHeight }}
          refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={ItemSeparator}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          onScroll={onScroll}
          scrollEventThrottle={16}
          ListEmptyComponent={
            // Active water filter + 0 matches in the loaded pages. The
            // outer feedIsEmpty empty state (further down) handles
            // "feed truly empty"; this one specifically tells the user
            // why their view is blank when catches *do* exist but none
            // belong to the selected water.
            waterFilter && items.length > 0 && displayedItems.length === 0 ? (
              <View style={{ paddingTop: spacing.xxl, paddingHorizontal: spacing.lg }}>
                <EmptyState
                  icon="filter-outline"
                  title={`Няма улови от „${waterFilter.item.name}“`}
                  subtitle="Изпробвай друг водоем или премахни филтъра."
                  action={{
                    label: 'Премахни филтъра',
                    onPress: () => {
                      void Haptics.selectionAsync();
                      setWaterFilter(null);
                    },
                  }}
                />
              </View>
            ) : null
          }
          ListHeaderComponent={<PeopleYouMayKnowRow />}
          ListFooterComponent={
            loadingMore ? (
              <FeedSkeleton />
            ) : hasMore ? (
              <View style={{ height: spacing.lg }} />
            ) : !loadingMore && !hasMore && displayedItems.length > 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
                <Text style={{ fontSize: 36 }}>🎣</Text>
                <Text style={[typography.h3, { color: colors.text, marginTop: spacing.sm, textAlign: 'center' }]}>
                  Стигна до края на лентата
                </Text>
                <Text style={[typography.body, { color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' }]}>
                  Публикувай и ти — отвори Дневник и сподели улов.
                </Text>
                <Button
                  title="Запиши улов"
                  onPress={() => (navigation as any).navigate('LogbookTab', { screen: 'LogbookList' })}
                  style={{ marginTop: spacing.lg }}
                />
              </View>
            ) : null
          }
          {...keyboardAwareScrollProps}
          renderItem={renderItem}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
        />
        <Animated.View
          pointerEvents={showScrollTop ? 'auto' : 'none'}
          style={{
            position: 'absolute',
            bottom: spacing.xl,
            alignSelf: 'center',
            opacity: scrollTopAnim,
            transform: [{ scale: scrollTopAnim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
          }}
        >
          <Pressable
            onPress={scrollToTop}
            style={{
              backgroundColor: colors.primary,
              borderRadius: 20,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.25,
              shadowRadius: 4,
              elevation: 6,
            }}
          >
            <Ionicons name="arrow-up" size={16} color={colors.white} />
            <Text style={{ ...typography.small, color: colors.white, fontWeight: '700' }}>Нагоре</Text>
          </Pressable>
        </Animated.View>

        {/* Sticky compact tabs — fade in once the big header has scrolled away,
            so users can switch scope without scrolling back to top. The main
            header's tabs still work; this is a duplicate that lives over the
            content during deep scrolls. */}
        {configured && user && stickyTabsVisible ? (
          <Animated.View
            style={{
              position: 'absolute',
              top: insets.top,
              left: 0,
              right: 0,
              zIndex: 11,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.sm,
              backgroundColor: colors.background + 'F0',
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.border,
              opacity: scrollY.interpolate({
                inputRange: [180, 240],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            }}
          >
            <View style={{
              flexDirection: 'row',
              backgroundColor: colors.surfaceAlt,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: 'hidden',
              padding: 3,
            }}>
              <Pressable
                onPress={() => switchScope('all')}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 8,
                  borderRadius: 11,
                  backgroundColor: scope === 'all' ? colors.primary : 'transparent',
                }}
              >
                <Ionicons name="grid-outline" size={16} color={scope === 'all' ? '#fff' : colors.textMuted} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: scope === 'all' ? '#fff' : colors.textMuted }}>Всички</Text>
              </Pressable>
              <Pressable
                onPress={() => switchScope('following')}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 8,
                  borderRadius: 11,
                  backgroundColor: scope === 'following' ? colors.primary : 'transparent',
                }}
              >
                <Ionicons name="people-outline" size={16} color={scope === 'following' ? '#fff' : colors.textMuted} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: scope === 'following' ? '#fff' : colors.textMuted }}>Следвани</Text>
              </Pressable>
            </View>
          </Animated.View>
        ) : null}

        {/* "X нови" pill — appears under the header when new items arrive while
            the user is scrolled away. Tap to scroll to the top and clear. */}
        {newPostsCount > 0 ? (
          <View
            pointerEvents="box-none"
            style={{
              position: 'absolute',
              top: headerHeight + spacing.sm,
              left: 0,
              right: 0,
              alignItems: 'center',
              zIndex: 9,
            }}
          >
            <Pressable
              onPress={onPressNewPosts}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                backgroundColor: colors.primary,
                borderRadius: 20,
                paddingHorizontal: spacing.md,
                paddingVertical: 8,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.25,
                shadowRadius: 8,
                elevation: 8,
              }}
            >
              <Ionicons name="arrow-up" size={14} color="#fff" />
              <Text style={{ ...typography.small, color: '#fff', fontWeight: '800' }}>
                {newPostsCount} {newPostsCount === 1 ? 'нова публикация' : 'нови публикации'}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </FadeIn>
    );
  })();

  // Empty-feed signal: when there's nothing in the list, the empty-state CTA
  // ("Добави първи улов" / "Намери приятели") should be the only entry point
  // on screen. Without this, a brand-new user saw three competing CTAs at
  // once — the StoriesRow's "Сподели момент" bubble, the FAB, and the
  // empty-state's own button — and couldn't tell which path to take. We
  // gate the StoriesRow and the FAB on this so the empty state stands alone.
  const feedIsEmpty = items.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Collapsible header — slides up on scroll, re-appears on scroll back */}
      <Animated.View
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          transform: [{ translateY: headerTranslate }],
        }}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        {Hero}
        {!feedIsEmpty ? (
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 32, borderTopRightRadius: 32, marginTop: -32 }}>
            <StoriesRow />
          </View>
        ) : null}
      </Animated.View>

      {/* Full-screen content — each branch handles its own paddingTop */}
      <View style={{ flex: 1 }}>
        {waveContent}
      </View>

      {/* Compose FAB — shared component (also used on Home + Logbook) so the
          compose entrypoint feels identical across high-traffic surfaces.
          Hidden on the empty feed so the empty-state CTA owns the action. */}
      {!feedIsEmpty ? <ComposeFab /> : null}

      {/* Water-body picker. Same component used by MapScreen and
          LeaderboardScreen so the dam/river list + region grouping stays
          identical across surfaces — picking "Язовир Искър" here picks the
          same entity it would on the leaderboard. */}
      <DamPicker
        visible={waterPickerOpen}
        onClose={() => setWaterPickerOpen(false)}
        onSelect={(pick) => {
          void Haptics.selectionAsync();
          setWaterFilter(pick);
          setWaterPickerOpen(false);
        }}
      />
    </View>
  );
}
