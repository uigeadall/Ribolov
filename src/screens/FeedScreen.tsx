import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, FlatList, Pressable, Platform, Animated, ActionSheetIOS, Alert } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';

import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { FeedPost, FeedItem } from '../components/FeedPost';
import { PostCard } from '../components/PostCard';
import { PeopleYouMayKnowRow } from '../components/PeopleYouMayKnowRow';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { fetchPublicFeed, deletePhotoFromFeedPost, removeFromPublicFeed, getFollowing, getUserPublicSummary, fetchPublicPosts, deletePost, searchUsersByName, type FeedPage } from '../services/cloudSync';
import type { Post } from '../types';
import type { DocumentSnapshot } from 'firebase/firestore';
import { getBlockedUids } from '../services/blockUser';
import { StoriesRow } from '../components/StoriesRow';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { FeedSkeleton } from '../components/FeedSkeleton';
import { useAuth } from '../services/authContext';
import { formatFirebaseError } from '../services/firebaseErrors';
import { captureException } from '../services/observability';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
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
      if (scope === 'following') {
        const uids = followingRows.map((f) => f.uid).filter((uid) => !blockedUids.has(uid));
        followingUidsRef.current = uids;
        if (uids.length > 0) {
          [page, postsPage] = await Promise.all([
            fetchPublicFeed(20, null, uids),
            fetchPublicPosts(40, null, uids).catch(() => ({ items: [] as Post[], lastDoc: null, hasMore: false })),
          ]);
        } else {
          page = { items: [], lastDoc: null, hasMore: false };
          postsPage = { items: [] };
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
      const nextPosts = postsPage.items.filter((p) => !blockedUids.has(p.ownerUid));
      setItems(next);
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

  const onReshareCatch = useCallback((c: FeedItem) => {
    navigation.navigate('CreatePost', {
      reshare: {
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
      },
    });
  }, [navigation]);

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
    navigation.navigate('CreatePost', { reshare: target });
  }, [navigation]);

  const onDeletePostItem = useCallback(async (post: Post) => {
    Alert.alert('Изтрий публикацията', 'Сигурен ли си?', [
      { text: 'Отказ', style: 'cancel' },
      {
        text: 'Изтрий', style: 'destructive', onPress: async () => {
          try {
            await deletePost(post.id);
            setPosts((prev) => prev.filter((p) => p.id !== post.id));
          } catch {
            Alert.alert('Грешка', 'Неуспешно изтриване. Опитай отново.');
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
            Alert.alert('Грешка', 'Снимката не можа да бъде изтрита. Опитай отново.');
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
            Alert.alert('Грешка', 'Публикацията не можа да бъде премахната. Опитай отново.');
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
        />
      );
    }
    const p = item.data;
    return (
      <PostCard
        post={p}
        myUid={user?.uid}
        myDisplayName={myDisplayName}
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

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    {
      useNativeDriver: false,
      listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => {
        const show = e.nativeEvent.contentOffset.y > 400;
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
      },
    }
  );

  const scrollToTop = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    void Haptics.selectionAsync();
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
    const options = ['Класации', 'Запазени', 'Открий', 'Отказ'];
    const actions = [
      () => navigation.navigate('Classics'),
      () => navigation.navigate('SavedPosts'),
      () => navigation.navigate('Explore'),
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: 3 },
        (idx) => { if (idx < 3) actions[idx](); }
      );
    } else {
      Alert.alert('Меню', undefined, [
        { text: 'Класации', onPress: actions[0] },
        { text: 'Запазени', onPress: actions[1] },
        { text: 'Открий', onPress: actions[2] },
        { text: 'Отказ', style: 'cancel' },
      ]);
    }
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
          onPress={() => { if (scope !== 'all') { setItems([]); setScope('all'); void Haptics.selectionAsync(); } }}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, backgroundColor: scope === 'all' ? 'rgba(255,255,255,0.2)' : 'transparent', borderRadius: 12 }}
        >
          <Ionicons name="grid-outline" size={18} color="#fff" />
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>Всички</Text>
        </Pressable>
        <Pressable
          onPress={() => { if (scope !== 'following') { setItems([]); setScope('following'); void Haptics.selectionAsync(); } }}
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
        <View style={{ flex: 1, justifyContent: 'center', paddingTop: headerHeight }}>
          <EmptyState
            icon="layers-outline"
            title={scope === 'following' ? 'Няма публикации от следваните' : 'Тук още е тихо'}
            subtitle={
              scope === 'following'
                ? 'Следвай риболовци от „Приятели", за да виждаш само техните публични улови тук.'
                : 'Когато други споделят улов, ще го виждаш тук. Сподели и твоя — Дневник → улов → „Сподели публично".'
            }
          />
          {scope === 'following' ? (
            <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.md }}>
              <Button title="Към приятели" onPress={() => navigation.navigate('Friends')} />
            </View>
          ) : null}
        </View>
      );
    }
    return (
      <View style={{ flex: 1 }}>
        <FlatList
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
      </View>
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

      {/* Create-post FAB — floats above tab bar */}
      {user && configured ? (
        <Pressable
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            navigation.navigate('CreatePost');
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
          accessibilityLabel="Нова публикация"
        >
          <Ionicons name="create" size={26} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}
