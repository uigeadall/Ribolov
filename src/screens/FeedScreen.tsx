import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '../storage/kv';
import { View, Text, StyleSheet, Pressable, Platform, Animated, Alert, ScrollView } from 'react-native';
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
import { rankFeedItems, type RankingSignals } from '../services/feedRanking';
import { loadFeedSignals, recordDwell, type PersistedFeedSignals } from '../services/feedSignals';
import { catchesStore, spotsStore } from '../storage/storage';
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

type FeedScope = 'forYou' | 'all' | 'following';
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

  // diffClamp: goes up when scrolling down (clamped at the MEASURED header
  // height), back to 0 when scrolling up. The clamp ceiling has to match the
  // real header height — was hardcoded to 300, so on taller headers (Hero +
  // StoriesRow + safe-area insets, easily 400-500px) only the first 300px
  // slid up and the remainder stayed visibly stuck on screen at "fully
  // collapsed." Recreate the Animated chain when headerHeight changes; the
  // first-layout pass (headerHeight=0) yields a no-op chain that keeps the
  // header anchored, which is the right behavior pre-measurement.
  //
  // useMemo instead of useRef: useRef captured the initial diffClamp(.,0,0)
  // forever, so even after measurement the chain stayed degenerate. useMemo
  // rebuilds when headerHeight changes. diffClamp's internal accumulator
  // resets on rebuild — acceptable here because the rebuild fires at first
  // layout (before any scroll input) so the user never sees a discontinuity.
  const headerTranslate = useMemo(
    () => Animated.multiply(Animated.diffClamp(scrollY, 0, headerHeight || 1), -1),
    [scrollY, headerHeight],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // When the active user changes, reset ALL session-scoped state so the
    // previous account's items/scope/filter/error don't bleed into the next
    // account's first render. The auth-context account-switch wipe only
    // touches AsyncStorage — in-memory React state is this screen's job.
    // Previously this effect only cleared avatar + "new posts" baseline,
    // which left items/posts/scope visible for the new user momentarily
    // before the next load() overwrote them. Race-prone and confusing.
    setMyPhotoUrl(undefined);
    seenTopIdRef.current = null;
    newPostsCountRef.current = 0;
    setNewPostsCount(0);
    setItems([]);
    setPosts([]);
    setLastDoc(null);
    setHasMore(false);
    setError(null);
    followingUidsRef.current = [];
    if (!user?.uid) return;
    let cancelled = false;
    AsyncStorage.getItem(`@ribolov/profilePhoto/${user.uid}`)
      .then((v) => { if (v && !cancelled) setMyPhotoUrl(v); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Default to 'forYou' so new users land on personalised content immediately.
  // The ranker tolerates an empty signals set — if we haven't loaded
  // favorites/top-species yet, every catch's score is the bare recency value
  // and the list reads as plain chronological until the signal effect lands.
  const [scope, setScope] = useState<FeedScope>('forYou');

  // For You ranking signals. Loaded once on mount and refreshed when the
  // user opens For You — cheap (all local AsyncStorage reads + one
  // getFollowing). The default zero-signals state is a valid RankingSignals
  // input that just produces chronological order; the effect below
  // populates it after the initial render so first-paint isn't blocked on
  // a signals fetch.
  const [rankingSignals, setRankingSignals] = useState<RankingSignals>({
    followedUids: new Set(),
    favoriteSpotCoords: [],
    topSpeciesIds: new Set(),
    myUid: null,
  });

  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    void (async () => {
      try {
        const [followingRows, spots, catches, persisted] = await Promise.all([
          getFollowing(user.uid).catch(() => [] as Array<{ uid: string }>),
          spotsStore.list().catch(() => []),
          catchesStore.list().catch(() => []),
          loadFeedSignals(),
        ]);
        if (cancelled) return;
        // Top-5 most-caught species — proxy for "what the user actually
        // fishes for." Beats a separate target-species preferences screen
        // because it's zero-effort (auto-derived from logging behaviour).
        const speciesCount = new Map<string, number>();
        for (const c of catches) {
          speciesCount.set(c.speciesId, (speciesCount.get(c.speciesId) ?? 0) + 1);
        }
        const topSpeciesIds = new Set(
          [...speciesCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([id]) => id),
        );
        const favoriteSpotCoords = spots
          .filter((s) => s.isFavorite)
          .map((s) => ({ latitude: s.latitude, longitude: s.longitude }));
        setRankingSignals({
          followedUids: new Set(followingRows.map((f) => f.uid)),
          favoriteSpotCoords,
          topSpeciesIds,
          myUid: user.uid,
          hiddenAuthorUids: new Set(persisted.hiddenAuthorUids),
          notInterestedCatchIds: new Set(persisted.notInterestedCatchIds),
          dwellByAuthorUid: persisted.dwellByAuthorUid,
        });
      } catch {
        /* signals stay zeroed → chronological ranking */
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  // Expose a refresh helper so the menu actions ("Не ме интересува" /
  // "Скрий автора") can re-load signals after a mutation. Avoids
  // depending on a global event bus — the FeedPost callbacks fire this
  // explicitly after the AsyncStorage write completes.
  const refreshFeedSignals = useCallback(async () => {
    const persisted = await loadFeedSignals();
    setRankingSignals((prev) => ({
      ...prev,
      hiddenAuthorUids: new Set(persisted.hiddenAuthorUids),
      notInterestedCatchIds: new Set(persisted.notInterestedCatchIds),
      dwellByAuthorUid: persisted.dwellByAuthorUid,
    }));
  }, []);

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
  const seenTopIdRef = useRef<string | null>(null);
  const isAtTopRef = useRef(true);
  const itemsRef = useRef<FeedItem[]>([]);
  const newPostsCountRef = useRef(0);

  const prefetchBatch = useCallback((list: FeedItem[]) => {
    list.forEach((item) => {
      if (item.photoUri) Image.prefetch(item.photoUri).catch(() => {});
      if (item.ownerPhotoUrl) Image.prefetch(item.ownerPhotoUrl).catch(() => {});
      // Video posters too — they're tiny (typically <120 KB) but render
      // as the inline-player background while the video buffers, so
      // having them warm in cache means the post never shows a black
      // box during fast scrolling.
      if (item.videoThumbnailUri) Image.prefetch(item.videoThumbnailUri).catch(() => {});
      // Extra photos — load only the FIRST extra. Grid posts (2-4 photos)
      // show all of them on-screen, but on entry the user only sees the
      // first tile of pages 2-N; the rest comes in as they swipe.
      // For 1+ extras we just warm the lead so the grid paints without
      // a blank-tile flash.
      if (item.extraPhotoUris && item.extraPhotoUris[0]) {
        Image.prefetch(item.extraPhotoUris[0]).catch(() => {});
      }
    });
  }, []);

  // Lookahead media prefetch on visibility change. The viewability handler
  // pushes IDs to the visibility pub-sub for play/pause + dwell tracking;
  // this picks up the FRESH visible-set, finds the next 3 items beyond the
  // bottom-most visible card, and prefetches their media. Triggered on every
  // viewability tick (~100ms during a scroll), so it stays close to the
  // user's scroll velocity without us having to listen to onScroll directly.
  const lastLookaheadKeyRef = useRef<string>('');
  const lookaheadPrefetch = useCallback(
    (visibleIds: Set<string>, currentList: ReturnType<typeof Array.from<FeedItem>>) => {
      if (visibleIds.size === 0 || currentList.length === 0) return;
      const indices: number[] = [];
      currentList.forEach((it, i) => { if (visibleIds.has(it.id)) indices.push(i); });
      if (indices.length === 0) return;
      const lastVisible = indices[indices.length - 1];
      const upcoming = currentList.slice(lastVisible + 1, lastVisible + 4);
      // Dedupe re-fires: cheap key on the upcoming ids so re-running the
      // handler doesn't issue redundant Image.prefetch calls every viewport
      // tick during a stationary pause.
      const key = upcoming.map((u) => u.id).join('|');
      if (key === lastLookaheadKeyRef.current) return;
      lastLookaheadKeyRef.current = key;
      prefetchBatch(upcoming);
    },
    [prefetchBatch],
  );

  const load = useCallback(async () => {
    if (!configured || !user) return;
    setError(null);
    const scopeAtRequest = scope;
    try {
      // Stale-while-revalidate: paint the last-cached page from AsyncStorage
      // *before* hitting the network. For the "all" (For You) tab we can paint
      // immediately because no follow-list lookup is needed. For Following,
      // the cache key depends on the follow list — so we fetch follows + the
      // cached page in parallel below, then paint with the right key. The
      // "forYou" scope shares the same underlying candidate set as "all"
      // (it just re-orders client-side); reuse the same instant-paint cache.
      if (scope === 'all' || scope === 'forYou') {
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
      setHasMore(scope === 'all' || scope === 'forYou' ? page.hasMore : false);
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

  // Switching between "Всички" and "Следвани" must wipe ALL state that
  // belongs to the outgoing scope so the next load doesn't mix scope-A's
  // posts with scope-B's catches, or page using scope-A's cursor while
  // scope-B is active. switchScope is the single entry point for scope
  // changes from the hero header — keeping the cleanup in one helper
  // avoids drift if more callers are added later.
  //
  // Beyond the obvious pagination wipe: we also clear `error` (so a stuck
  // failure banner doesn't survive a scope flip), `followingUidsRef` (so a
  // mid-flight loadMore in the previous scope can't be filtered against
  // the wrong follow list), and the "X нови" pill state (so a freshness
  // signal from the previous scope's top-of-feed doesn't carry over).
  const switchScope = useCallback((next: FeedScope) => {
    setScope((prev) => {
      if (prev === next) return prev;
      setItems([]);
      setPosts([]);
      setLastDoc(null);
      setHasMore(false);
      setError(null);
      followingUidsRef.current = [];
      seenTopIdRef.current = null;
      newPostsCountRef.current = 0;
      setNewPostsCount(0);
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
    | { kind: 'post'; data: Post; date: string }
    // Suggested-users carousel — non-content slot injected every Nth item
    // in the For You feed. Carries a stable id so FlashList's recycler
    // doesn't mistake successive slots for different rows; the actual
    // content is rendered by PeopleYouMayKnowRow.
    | { kind: 'suggested'; data: { id: string }; date: string };

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

    // "За теб" ranking: re-order the deduped catches via the For You scorer
    // (recency × follow × spot × species × engagement) before merging in
    // posts. Posts stay chronological at the tail — they're harder to score
    // (no GPS, no species) and treating them as a strict timeline keeps
    // the personalised section feeling like "catches I'd like" rather than
    // mixing in unrelated text posts.
    if (scope === 'forYou') {
      const ranked = rankFeedItems(dedupedCatches, rankingSignals);
      const merged: MixedFeedItem[] = [];
      // Inject "Suggested users" every 8th catch — close enough to Twitter's
      // ~10-item cadence to feel intentional, sparse enough not to break the
      // reading flow. Position-derived id keeps the slot stable across
      // re-renders so FlashList's recycler doesn't drop the carousel state.
      ranked.forEach((c, i) => {
        merged.push({ kind: 'catch' as const, data: c, date: c.date ?? '' });
        if ((i + 1) % 8 === 0) {
          merged.push({
            kind: 'suggested' as const,
            data: { id: `suggested-${i}` },
            date: c.date ?? '',
          });
        }
      });
      // Posts still appear, but ordered by date and after the ranked catches.
      filteredPosts
        .slice()
        .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
        .forEach((p) => {
          merged.push({ kind: 'post' as const, data: p, date: p.date ?? '' });
        });
      return merged;
    }

    const merged: MixedFeedItem[] = [
      ...dedupedCatches.map((c) => ({ kind: 'catch' as const, data: c, date: c.date ?? '' })),
      ...filteredPosts.map((p) => ({ kind: 'post' as const, data: p, date: p.date ?? '' })),
    ];
    merged.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return merged;
  }, [items, posts, waterFilter, scope, rankingSignals]);

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
  //
  // Optimistic insert: drop the repost at the top of the local `posts` array
  // as soon as the Firestore write resolves with the doc id. Without this,
  // the user sees a success toast but their repost doesn't appear until the
  // next pull-to-refresh or the focus-effect re-load (8s freshness window).
  // On failure we never inserted, so there's nothing to roll back.
  const instantRepost = useCallback(async (target: ResharedRef) => {
    if (!user) return;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const ownerName = user.displayName?.trim() || user.email?.trim() || 'Рибар';
      const id = await createPost({
        ownerUid: user.uid,
        ownerName,
        ownerPhotoUrl: myPhotoUrl,
        text: '',
        mentionUids: [],
        reshareOf: target,
      });
      const optimisticPost: Post = {
        id,
        ownerUid: user.uid,
        ownerName,
        ownerPhotoUrl: myPhotoUrl,
        text: '',
        hashtags: [],
        mentionUids: [],
        date: new Date().toISOString(),
        reshareOf: target,
      };
      setPosts((prev) => {
        // Dedupe — if a snapshot/refresh already inserted this id, leave it.
        if (prev.some((p) => p.id === id)) return prev;
        return [optimisticPost, ...prev];
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

  // ── Negative-feedback handlers wired into the FeedPost ⋯ menu.
  //   - markNotInterested persists the catchId; the ranker then drops it
  //     from For You. We also yank it from the visible items right away so
  //     the user sees their action take effect.
  //   - hideAuthor persists the uid; the ranker drops all of that author's
  //     items from For You. Confirmation Alert prevents fat-finger hides.
  const handleNotInterested = useCallback(async (item: FeedItem) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const { markNotInterested } = await import('../services/feedSignals');
    await markNotInterested(item.id);
    await refreshFeedSignals();
    setItems((prev) => prev.filter((x) => x.id !== item.id));
    Toast.show({ type: 'success', text1: 'Няма да го виждаш повече', visibilityTime: 1800 });
  }, [refreshFeedSignals]);
  const handleHideAuthor = useCallback((authorUid: string, displayName: string) => {
    Alert.alert(
      `Скрий ${displayName}?`,
      'Няма да виждаш повече публикации от този потребител в "За теб".',
      [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Скрий',
          style: 'destructive',
          onPress: async () => {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            const { hideAuthor } = await import('../services/feedSignals');
            await hideAuthor(authorUid);
            await refreshFeedSignals();
            setItems((prev) => prev.filter((x) => x.ownerUid !== authorUid));
            Toast.show({ type: 'success', text1: 'Авторът е скрит', visibilityTime: 1800 });
          },
        },
      ],
    );
  }, [refreshFeedSignals]);

  const renderItem = useCallback(({ item }: { item: MixedFeedItem }) => {
    if (item.kind === 'suggested') {
      // Wrap the row in a hairline-bordered container so it visually
      // separates from the surrounding posts. collapseWhenEmpty=true means
      // a brand-new account with no candidates gets a null row, not a
      // confusing "Suggested users" header with no carousel beneath.
      return (
        <View style={{
          backgroundColor: colors.card,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          paddingVertical: spacing.sm,
        }}>
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xs }}>
            <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>
              Може да харесаш
            </Text>
          </View>
          <PeopleYouMayKnowRow collapseWhenEmpty={true} />
        </View>
      );
    }
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
          onMarkNotInterested={scope === 'forYou' ? handleNotInterested : undefined}
          onHideAuthor={handleHideAuthor}
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
  }, [user?.uid, user, myDisplayName, myPhotoUrl, avatarMap, socialEnabled, onPressAuthor, onPressCatch, onDeletePhoto, onRemovePost, onPressHashtag, onPressMention, onDeletePostItem, onReshareCatch, onResharePost, onPressReshareTarget, scope, handleNotInterested, handleHideAuthor]);

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
  // useRef wraps `lookaheadPrefetch` so the FlashList prop stays stable
  // across renders (changing onViewableItemsChanged after mount triggers
  // a hard re-init that wipes scroll position). The handler reads the
  // freshest `lookaheadPrefetch` via the ref instead.
  const lookaheadRef = useRef(lookaheadPrefetch);
  useEffect(() => { lookaheadRef.current = lookaheadPrefetch; }, [lookaheadPrefetch]);
  const itemsForLookaheadRef = useRef<FeedItem[]>([]);
  useEffect(() => { itemsForLookaheadRef.current = items; }, [items]);

  // ── Dwell tracking ──────────────────────────────────────────────
  // dwellEntryRef[id] = wall-clock ms when the id first entered the viewport
  // in the current dwell session. When the id exits (no longer in
  // viewableItems), we look up its owner uid, compute seconds, and queue
  // into pendingDwellRef. A single timer flushes pendingDwellRef to
  // AsyncStorage every 15s + on unmount, so we write at most ~4× per minute
  // of active scrolling, not 10× per second.
  const dwellEntryRef = useRef<Map<string, number>>(new Map());
  const pendingDwellRef = useRef<Record<string, number>>({});
  const dwellByIdToUidRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    for (const it of items) dwellByIdToUidRef.current.set(it.id, it.ownerUid);
  }, [items]);
  useEffect(() => {
    const flushDwell = async () => {
      const pending = pendingDwellRef.current;
      pendingDwellRef.current = {};
      if (Object.keys(pending).length === 0) return;
      await recordDwell(pending).catch(() => {});
    };
    const interval = setInterval(() => { void flushDwell(); }, 15_000);
    return () => {
      clearInterval(interval);
      // Flush on unmount so a brief session still trains the model.
      void flushDwell();
    };
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: { kind: string; data: { id: string } } }> }) => {
      const now = Date.now();
      const ids = new Set(viewableItems.map((v) => v.item.data.id));

      // EXIT: anything in the previous visible set but not in the new set
      // closes its dwell session. Accumulate seconds-by-owner into pending.
      for (const [id, enteredAt] of dwellEntryRef.current.entries()) {
        if (!ids.has(id)) {
          const ownerUid = dwellByIdToUidRef.current.get(id);
          if (ownerUid) {
            const secs = (now - enteredAt) / 1000;
            pendingDwellRef.current[ownerUid] = (pendingDwellRef.current[ownerUid] ?? 0) + secs;
          }
          dwellEntryRef.current.delete(id);
        }
      }
      // ENTER: anything newly visible starts a dwell session.
      for (const id of ids) {
        if (!dwellEntryRef.current.has(id)) dwellEntryRef.current.set(id, now);
      }

      visibleIdsRef.current = ids;
      publishFeedVisibility(ids);
      lookaheadRef.current(ids, itemsForLookaheadRef.current);
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

  // X-style flat icon button — no glassmorphism, no border, just a press
  // target. Color comes from the theme so it works in dark mode too.
  const flatIconBtn = {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  };

  // Trending hashtags — derived from already-loaded posts so it costs zero
  // Firestore reads. We count tag occurrences across the last 200 posts
  // (a generous batch — posts.length is rarely that big), sort by count,
  // pull the top 5. Only shown when we have at least 3 tags total;
  // otherwise the strip would look sparse.
  const trendingHashtags = useMemo<Array<{ tag: string; count: number }>>(() => {
    const counts = new Map<string, number>();
    for (const p of posts.slice(0, 200)) {
      for (const tag of p.hashtags ?? []) {
        if (!tag) continue;
        const lc = tag.toLowerCase();
        counts.set(lc, (counts.get(lc) ?? 0) + 1);
      }
    }
    if (counts.size < 3) return [];
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [posts]);

  /** Flat X-style top bar — no gradient, no border-radius pills, no
      glassmorphism. A thin hairline separates the top bar from the tab row,
      and another hairline separates the tab row from the feed. The active
      scope tab gets a short bold underline (X's signature visual). The
      water filter is no longer a fat pill — it's a small chip that only
      appears when active, with a close button. */
  const Hero = (
    <View style={{ backgroundColor: colors.card }}>
      {/* Status-bar safe area + title row */}
      <View style={{
        paddingTop: insets.top + 4,
        paddingHorizontal: 16,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
      }}>
        <Text style={{
          fontSize: 20, fontWeight: '800', color: colors.text,
          flex: 1, letterSpacing: -0.3,
        }}>
          Начало
        </Text>
        <Pressable
          onPress={() => navigation.navigate('Notifications')}
          hitSlop={8}
          style={flatIconBtn}
          android_ripple={{ color: colors.primary + '33', borderless: true, radius: 18 }}
          accessibilityLabel="Известия"
        >
          <View style={{ position: 'relative' }}>
            <Ionicons
              name={unreadNotifCount > 0 ? 'notifications' : 'notifications-outline'}
              size={20}
              color={colors.text}
            />
            {unreadNotifCount > 0 && (
              <View style={{
                position: 'absolute', top: -3, right: -5,
                backgroundColor: '#e53935', borderRadius: 8,
                minWidth: 14, height: 14,
                alignItems: 'center', justifyContent: 'center',
                paddingHorizontal: 3,
              }}>
                <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700', lineHeight: 11 }}>
                  {unreadNotifCount > 99 ? '99+' : unreadNotifCount}
                </Text>
              </View>
            )}
          </View>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('Search')}
          hitSlop={8}
          style={flatIconBtn}
          android_ripple={{ color: colors.primary + '33', borderless: true, radius: 18 }}
          accessibilityLabel="Търси"
        >
          <Ionicons name="search-outline" size={20} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => {
            // Open a richer overflow menu — adds the water-body filter to the
            // existing trophy/saved/explore options since the filter no
            // longer has its own pill in the header.
            ActionSheet.show({
              options: [
                {
                  label: waterFilter ? `Филтър: ${waterFilter.item.name}` : 'Филтрирай по водоем',
                  icon: 'water-outline',
                  onPress: () => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setWaterPickerOpen(true);
                  },
                },
                { label: 'Класации', icon: 'trophy-outline', onPress: () => navigation.navigate('Classics') },
                { label: 'Запазени', icon: 'bookmark-outline', onPress: () => navigation.navigate('SavedPosts') },
                { label: 'Открий', icon: 'compass-outline', onPress: () => navigation.navigate('Explore') },
              ],
            });
          }}
          hitSlop={8}
          style={flatIconBtn}
          android_ripple={{ color: colors.primary + '33', borderless: true, radius: 18 }}
          accessibilityLabel="Още"
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={colors.text} />
        </Pressable>
      </View>

      {/* X-style scope tabs — text labels, no icons, with a short bold
          underline beneath the active tab. The container has a hairline
          bottom border so the tab row visually separates from the feed. */}
      <View style={{
        flexDirection: 'row',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}>
        {(['forYou', 'all', 'following'] as const).map((s) => {
          const active = scope === s;
          const label = s === 'forYou' ? 'За теб' : s === 'all' ? 'Всички' : 'Следвани';
          return (
            <Pressable
              key={s}
              onPress={() => switchScope(s)}
              style={{ flex: 1, alignItems: 'center', paddingTop: 14, paddingBottom: 10 }}
              android_ripple={{ color: colors.primary + '22' }}
            >
              <Text style={{
                fontSize: 15,
                fontWeight: active ? '700' : '500',
                color: active ? colors.text : colors.textMuted,
              }}>
                {label}
              </Text>
              {/* Underline indicator — short, ~50px, centred under the label. */}
              <View style={{
                marginTop: 10,
                height: 3,
                width: 48,
                borderRadius: 2,
                backgroundColor: active ? colors.primary : 'transparent',
              }} />
            </Pressable>
          );
        })}
      </View>

      {/* Trending hashtags strip — horizontal scroll of pill chips, rendered
          ONLY when we have at least 3 distinct tags across the loaded posts.
          Tapping a chip opens HashtagFeed, which is the existing screen for
          per-tag browsing. Pure client-side aggregation — no extra Firestore
          reads. Hidden on the Following tab where the feed is already a
          narrow signal; trending is most useful on Всички / За теб. */}
      {trendingHashtags.length > 0 && scope !== 'following' ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6 }}
        >
          {trendingHashtags.map(({ tag }) => (
            <Pressable
              key={tag}
              onPress={() => navigation.navigate('HashtagFeed', { tag })}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.background,
              }}
              accessibilityRole="button"
              accessibilityLabel={`Отвори #${tag}`}
            >
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: '700' }}>
                #{tag}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Water-body filter chip — only shown when a filter is active, with
          a close button to clear it. Replaces the always-visible fat pill
          that took up real estate. Tapping the chip body re-opens the
          picker so the user can switch waters without re-clearing. */}
      {waterFilter ? (
        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setWaterPickerOpen(true);
          }}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            alignSelf: 'flex-start',
            marginHorizontal: 16,
            marginTop: 8,
            paddingVertical: 5,
            paddingHorizontal: 10,
            borderRadius: 999,
            backgroundColor: colors.primarySurface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Ionicons
            name={waterFilter.kind === 'river' ? 'git-branch-outline' : 'water-outline'}
            size={13}
            color={colors.primary}
          />
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.primary }} numberOfLines={1}>
            {waterFilter.item.name}
          </Text>
          <Pressable
            onPress={() => {
              void Haptics.selectionAsync();
              setWaterFilter(null);
            }}
            hitSlop={8}
          >
            <Ionicons name="close-circle" size={15} color={colors.primary} />
          </Pressable>
        </Pressable>
      ) : null}
    </View>
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
        {/* Stories row sits flush under the top bar — no rounded overlap
            sleight (the gradient hero needed that to feel like a curve into
            the body; with the flat X-style top bar a hairline divider does
            the same job for free, and the rounded mask was clipping the
            first story's avatar). */}
        {!feedIsEmpty ? <StoriesRow /> : null}
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
