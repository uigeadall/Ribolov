import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '../storage/kv';
import { View, Text, StyleSheet, FlatList, Pressable, Platform, Animated, Alert } from 'react-native';

// FlatList wrapped with createAnimatedComponent — required so that the FlatList
// can receive an Animated.event onScroll with useNativeDriver: true (plain
// FlatList only supports JS-driven onScroll). The cast preserves FlatList's
// generic so callers keep proper typing on data / renderItem / etc.
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList) as unknown as typeof FlatList;
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import type { FeedStackParamList } from '../navigation/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { ActionSheet } from '../components/ActionSheet';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { FeedPost, FeedItem } from '../components/FeedPost';
import { PostCard } from '../components/PostCard';
import { PeopleYouMayKnowRow } from '../components/PeopleYouMayKnowRow';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { fetchPublicFeed, deletePhotoFromFeedPost, removeFromPublicFeed, getFollowing, getUserPublicSummary, fetchPublicPosts, deletePost, searchUsersByName, createPost, type FeedPage } from '../services/cloudSync';
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

type FeedScope = 'all' | 'following';

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
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const flatListRef = useRef<FlatList<any>>(null);
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
    setLoading(true);
    setError(null);
    const scopeAtRequest = scope;
    try {
      const [followingRows, blockedUids] = await Promise.all([
        getFollowing(user.uid),
        getBlockedUids(user.uid),
      ]);

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
    const dedupedCatches = items.filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });
    const merged: MixedFeedItem[] = [
      ...dedupedCatches.map((c) => ({ kind: 'catch' as const, data: c, date: c.date ?? '' })),
      ...posts.map((p) => ({ kind: 'post' as const, data: p, date: p.date ?? '' })),
    ];
    merged.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return merged;
  }, [items, posts]);

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
      return (
        <FeedPost
          item={c}
          onPressCatch={onPressCatch}
          myUid={user?.uid}
          myDisplayName={myDisplayName}
          myPhotoUrl={myPhotoUrl}
          resolvedAvatarUrl={avatarMap[c.ownerUid]}
          socialEnabled={socialEnabled}
          isVisible={visibleIds.has(c.id)}
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
      />
    );
  }, [user?.uid, user, myDisplayName, myPhotoUrl, avatarMap, socialEnabled, visibleIds, onPressAuthor, onPressCatch, onDeletePhoto, onRemovePost, onPressHashtag, onPressMention, onDeletePostItem, onReshareCatch, onResharePost]);

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
      setVisibleIds(ids);
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
          {/* Suggested anglers — most useful first-time content */}
          <PeopleYouMayKnowRow collapseWhenEmpty={false} />
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
        <AnimatedFlatList
          ref={flatListRef}
          data={displayedItems}
          keyExtractor={(item) => `${item.kind}-${item.data.id}`}
          contentContainerStyle={[styles.listContent, { paddingTop: headerHeight }]}
          refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ItemSeparatorComponent={ItemSeparator}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          onScroll={onScroll}
          scrollEventThrottle={16}
          removeClippedSubviews={Platform.OS === 'android'}
          maxToRenderPerBatch={8}
          windowSize={5}
          initialNumToRender={6}
          updateCellsBatchingPeriod={50}
          onScrollToIndexFailed={(info) => {
            // Row not yet measured — let RN estimate and retry once.
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.15 });
            }, 120);
          }}
          ListEmptyComponent={null}
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
        <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 32, borderTopRightRadius: 32, marginTop: -32 }}>
          <StoriesRow />
        </View>
      </Animated.View>

      {/* Full-screen content — each branch handles its own paddingTop */}
      <View style={{ flex: 1 }}>
        {waveContent}
      </View>

      {/* Compose FAB — opens an action sheet so the user can pick between
          a catch entry and a free-form post without losing this screen as
          their back destination. */}
      {user && configured ? (
        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            ActionSheet.show({
              title: 'Какво искаш да споделиш?',
              options: [
                {
                  label: 'Сподели улов',
                  icon: 'fish-outline',
                  onPress: () => (navigation as any).navigate('LogbookTab', { screen: 'AddCatch', params: {} }),
                },
                {
                  label: 'Напиши пост',
                  icon: 'create-outline',
                  onPress: () => navigation.navigate('CreatePost'),
                },
              ],
            });
          }}
          style={{
            position: 'absolute',
            right: spacing.lg,
            bottom: 100,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 6 },
            shadowOpacity: 0.35,
            shadowRadius: 12,
            elevation: 8,
          }}
          accessibilityRole="button"
          accessibilityLabel="Сподели"
        >
          <Ionicons name="add" size={30} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}
