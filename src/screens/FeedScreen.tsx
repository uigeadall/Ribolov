import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, FlatList, Pressable, Platform, Animated, ActionSheetIOS, Alert } from 'react-native';
import { Image } from 'expo-image';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/Button';
import { FeedPost, FeedItem } from '../components/FeedPost';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { fetchPublicFeed, getFollowing, getUserPublicSummary, type FeedPage } from '../services/cloudSync';
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
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | undefined>();
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const loadingMoreRef = useRef(false);
  const flatListRef = useRef<FlatList<FeedItem>>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollTopAnim = useRef(new Animated.Value(0)).current;
  const scrollY = useRef(new Animated.Value(0)).current;

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
    try {
      const [page, followingRows, blockedUids] = await Promise.all([
        scope === 'all' ? fetchPublicFeed(20) : fetchPublicFeed(100),
        getFollowing(user.uid),
        getBlockedUids(user.uid),
      ]);
      const followingSet = new Set(followingRows.map((f) => f.uid));
      let next = page.items.filter((i) => !blockedUids.has(i.ownerUid));
      if (scope === 'following') {
        next = next.filter((i) => followingSet.has(i.ownerUid));
      }
      setItems(next);
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
      setError(formatFirebaseError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [configured, user, scope, prefetchBatch]);

  const loadMore = useCallback(async () => {
    if (!configured || !user || !hasMore || loadingMoreRef.current || !lastDoc) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const blockedUids = await getBlockedUids(user.uid);
      const page = await fetchPublicFeed(20, lastDoc);
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
  }, [configured, user, hasMore, lastDoc, prefetchBatch]);

  useEffect(() => {
    if (user && configured) load();
  }, [load, user, configured]);

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

  const displayedItems = useMemo(() => {
    const seen = new Set<string>();
    return items.filter((i) => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });
  }, [items]);

  const renderItem = useCallback(({ item }: { item: FeedItem }) => (
    <FeedPost
      item={item}
      onPressCatch={onPressCatch}
      myUid={user?.uid}
      myDisplayName={myDisplayName}
      myPhotoUrl={myPhotoUrl}
      resolvedAvatarUrl={avatarMap[item.ownerUid]}
      socialEnabled={socialEnabled}
      isVisible={visibleIds.has(item.id)}
      onPressAuthor={onPressAuthor}
    />
  ), [user?.uid, myDisplayName, myPhotoUrl, avatarMap, socialEnabled, visibleIds, onPressAuthor, onPressCatch]);

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
    ({ viewableItems }: { viewableItems: Array<{ item: FeedItem }> }) => {
      const ids = new Set(viewableItems.map((v) => v.item.id));
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

  /** Minimal Instagram-style top bar, shared across all states */
  const TopBar = () => (
    <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
      <Text style={styles.topBarTitle}>Лента</Text>
      {/* Notifications */}
      <Pressable
        onPress={() => navigation.navigate('Notifications')}
        hitSlop={8}
        style={styles.iconBtn}
        accessibilityLabel="Известия"
      >
        <View style={{ position: 'relative' }}>
          <Ionicons
            name={unreadNotifCount > 0 ? 'notifications' : 'notifications-outline'}
            size={24}
            color={colors.text}
          />
          {unreadNotifCount > 0 && (
            <View style={{
              position: 'absolute', top: -4, right: -6,
              backgroundColor: '#e53935', borderRadius: 8,
              minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center',
              paddingHorizontal: 3,
            }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700', lineHeight: 12 }}>
                {unreadNotifCount > 99 ? '99+' : unreadNotifCount}
              </Text>
            </View>
          )}
        </View>
      </Pressable>
      {/* Search */}
      <Pressable
        onPress={() => navigation.navigate('Search')}
        hitSlop={8}
        style={styles.iconBtn}
        accessibilityLabel="Търси"
      >
        <Ionicons name="search-outline" size={24} color={colors.text} />
      </Pressable>
      {/* Overflow */}
      <Pressable onPress={openOverflow} hitSlop={8} style={styles.iconBtn} accessibilityLabel="Още">
        <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
      </Pressable>
    </View>
  );

  /** ListHeaderComponent: stories row + scope tabs */
  const ListHeader = useMemo(() => (
    <>
      <StoriesRow />
      <View style={styles.segmentRow}>
        <Pressable
          onPress={() => { if (scope !== 'all') { setItems([]); setScope('all'); void Haptics.selectionAsync(); } }}
          style={[styles.segmentTab, { borderBottomWidth: 2, borderBottomColor: scope === 'all' ? colors.primary : 'transparent' }]}
        >
          <Ionicons name="grid-outline" size={22} color={scope === 'all' ? colors.primary : colors.textMuted} />
        </Pressable>
        <Pressable
          onPress={() => { if (scope !== 'following') { setItems([]); setScope('following'); void Haptics.selectionAsync(); } }}
          style={[styles.segmentTab, { borderBottomWidth: 2, borderBottomColor: scope === 'following' ? colors.primary : 'transparent' }]}
        >
          <Ionicons name="people-outline" size={22} color={scope === 'following' ? colors.primary : colors.textMuted} />
        </Pressable>
      </View>
    </>
  ), [scope, colors, styles]);

  if (!configured) {
    return (
      <Screen padded={false} safeAreaEdges={['left', 'right']}>
        <TopBar />
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Социалната част изисква Firebase</Text>
            <Text style={styles.warnBody}>
              Отвори файла src/services/firebaseConfig.ts и следвай инструкциите вътре, за да активираш облачната
              синхронизация и социалния feed.
            </Text>
          </Card>
        </View>
      </Screen>
    );
  }

  if (!user) {
    return (
      <Screen padded={false} safeAreaEdges={['left', 'right']}>
        <TopBar />
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Влез в акаунта си</Text>
            <Text style={styles.warnBody}>За да видиш улова на други риболовци, трябва да си влязъл.</Text>
            <Button title="Вход / Регистрация" onPress={() => navigation.navigate('Auth')} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false} safeAreaEdges={['left', 'right']}>
      <TopBar />

      {loading && items.length === 0 ? (
        <>
          {ListHeader}
          <FeedSkeleton />
        </>
      ) : error && items.length === 0 ? (
        <>
          {ListHeader}
          <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
            <Card>
              <Text style={styles.warnTitle}>Неуспешно зареждане</Text>
              <Text style={styles.warnBody}>{error}</Text>
              <Button title="Опитай отново" onPress={() => load()} style={{ marginTop: spacing.md }} />
            </Card>
          </View>
        </>
      ) : items.length === 0 ? (
        <>
          {ListHeader}
          <View style={{ flex: 1, justifyContent: 'center' }}>
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
        </>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={flatListRef}
            data={displayedItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={ListHeader}
            refreshControl={
              <FishingRefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
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
      )}
    </Screen>
  );
}
