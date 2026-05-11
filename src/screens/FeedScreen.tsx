import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ActivityIndicator, Platform } from 'react-native';
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
import { radius, spacing, typography } from '../theme/typography';
import { fetchPublicFeed, getFollowing, getUserPublicSummary, type FeedPage } from '../services/cloudSync';
import type { DocumentSnapshot } from 'firebase/firestore';
import { getBlockedUids } from '../services/blockUser';
import { StoriesRow } from '../components/StoriesRow';
import { FeedSkeleton } from '../components/FeedSkeleton';
import { useAuth } from '../services/authContext';
import { formatFirebaseError } from '../services/firebaseErrors';
import { captureException } from '../services/observability';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import { useAppNavigation } from '../navigation/useAppNavigation';
import * as Haptics from 'expo-haptics';

type FeedScope = 'all' | 'following';

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    hero: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
      backgroundColor: colors.surfaceAlt,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    heroTitleRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    heroTitleBlock: {
      flex: 1,
      minWidth: 0,
    },
    heroIconWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 2,
    },
    heroTitle: { ...typography.h1, color: colors.text },
    heroSubtitle: {
      ...typography.body,
      color: colors.textMuted,
      marginTop: spacing.xs,
      lineHeight: 22,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'flex-start',
      alignItems: 'center',
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    backBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentWrap: {
      marginHorizontal: spacing.lg,
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    segment: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      padding: 4,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentBtn: {
      flex: 1,
      paddingVertical: 11,
      alignItems: 'center',
      borderRadius: radius.pill,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
    },
    segmentBtnActive: { backgroundColor: colors.primary },
    segmentText: { ...typography.caption, fontWeight: '700', color: colors.textMuted },
    segmentTextActive: { color: colors.white },
    listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
    listGap: { height: spacing.lg },
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

  const heroTopStyle = useMemo(
    () => ({ paddingTop: insets.top + spacing.md }),
    [insets.top]
  );

  const [items, setItems] = useState<FeedItem[]>([]);
  const [myPhotoUrl, setMyPhotoUrl] = useState<string | undefined>();
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});
  const visibleIdsRef = useRef<Set<string>>(new Set());
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());

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
      // Batch-fetch avatars for posts that don't carry ownerPhotoUrl,
      // so FeedPost never needs its own Firestore read.
      const missingUids = [...new Set(
        next
          .filter((i) => !i.ownerPhotoUrl && i.ownerUid && i.ownerUid !== user.uid)
          .map((i) => i.ownerUid)
      )];
      if (missingUids.length > 0) {
        Promise.all(missingUids.map((uid) => getUserPublicSummary(uid).catch(() => null)))
          .then((summaries) => {
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
    if (!configured || !user || !hasMore || loadingMore || !lastDoc) return;
    setLoadingMore(true);
    try {
      const blockedUids = await getBlockedUids(user.uid);
      const page = await fetchPublicFeed(20, lastDoc);
      const next = page.items.filter((i) => !blockedUids.has(i.ownerUid));
      setItems((prev) => [...prev, ...next]);
      prefetchBatch(next);
      setLastDoc(page.lastDoc);
      setHasMore(page.hasMore);
    } catch {
      /* silent — user can pull to refresh */
    } finally {
      setLoadingMore(false);
    }
  }, [configured, user, hasMore, loadingMore, lastDoc, prefetchBatch]);

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

  const ItemSeparator = useCallback(() => <View style={styles.listGap} />, [styles.listGap]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 40 }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: FeedItem }> }) => {
      const ids = new Set(viewableItems.map((v) => v.item.id));
      visibleIdsRef.current = ids;
      setVisibleIds(ids);
    }
  ).current;

  const Header = () => (
    <View style={styles.header}>
      <Pressable onPress={() => navigation.goBack()} hitSlop={8} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={colors.primary} />
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pressable
        onPress={() => navigation.navigate('Classics')}
        hitSlop={8}
        style={styles.backBtn}
        accessibilityLabel="Седмични и месечни класации"
      >
        <Ionicons name="trophy-outline" size={22} color={colors.primary} />
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('SavedPosts')}
        hitSlop={8}
        style={styles.backBtn}
        accessibilityLabel="Запазени публикации"
      >
        <Ionicons name="bookmark-outline" size={22} color={colors.primary} />
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('Notifications')}
        hitSlop={8}
        style={styles.backBtn}
        accessibilityLabel="Известия"
      >
        <Ionicons name="notifications-outline" size={22} color={colors.primary} />
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('Search')}
        hitSlop={8}
        style={styles.backBtn}
        accessibilityLabel="Търси"
      >
        <Ionicons name="search-outline" size={22} color={colors.primary} />
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('Explore')}
        hitSlop={8}
        style={styles.backBtn}
        accessibilityLabel="Открий"
      >
        <Ionicons name="compass-outline" size={22} color={colors.primary} />
      </Pressable>
    </View>
  );

  if (!configured) {
    return (
      <Screen padded={false} safeAreaEdges={['left', 'right']}>
        <View style={[styles.hero, heroTopStyle]}>
          <Header />
          <View style={styles.heroTitleRow}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="newspaper-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroTitle}>Лента</Text>
            </View>
          </View>
        </View>
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
        <View style={[styles.hero, heroTopStyle]}>
          <Header />
          <View style={styles.heroTitleRow}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="newspaper-outline" size={22} color={colors.primary} />
            </View>
            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroTitle}>Лента</Text>
            </View>
          </View>
        </View>
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
      <View style={[styles.hero, heroTopStyle]}>
        <Header />
        <View style={styles.heroTitleRow}>
          <View style={styles.heroIconWrap}>
            <Ionicons name="fish-outline" size={22} color={colors.primary} />
          </View>
          <View style={styles.heroTitleBlock}>
            <Text style={styles.heroTitle}>Лента</Text>
            <Text style={styles.heroSubtitle}>Споделени улови от риболовната общност</Text>
          </View>
        </View>
      </View>

      <StoriesRow />

      <View style={styles.segmentWrap}>
        <View style={styles.segment}>
          <Pressable
            onPress={() => { if (scope !== 'all') { setItems([]); setScope('all'); void Haptics.selectionAsync(); } }}
            style={[styles.segmentBtn, scope === 'all' && styles.segmentBtnActive]}
          >
            <Ionicons
              name="globe-outline"
              size={16}
              color={scope === 'all' ? colors.white : colors.textMuted}
            />
            <Text style={[styles.segmentText, scope === 'all' && styles.segmentTextActive]}>Всички</Text>
          </Pressable>
          <Pressable
            onPress={() => { if (scope !== 'following') { setItems([]); setScope('following'); void Haptics.selectionAsync(); } }}
            style={[styles.segmentBtn, scope === 'following' && styles.segmentBtnActive]}
          >
            <Ionicons
              name="people-outline"
              size={16}
              color={scope === 'following' ? colors.white : colors.textMuted}
            />
            <Text style={[styles.segmentText, scope === 'following' && styles.segmentTextActive]}>Следвани</Text>
          </Pressable>
        </View>
      </View>

      {loading && items.length === 0 ? (
        <FeedSkeleton />
      ) : error && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <Card>
            <Text style={styles.warnTitle}>Неуспешно зареждане</Text>
            <Text style={styles.warnBody}>{error}</Text>
            <Button title="Опитай отново" onPress={() => load()} style={{ marginTop: spacing.md }} />
          </Card>
        </View>
      ) : items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <EmptyState
            icon="layers-outline"
            title={scope === 'following' ? 'Няма публикации от следваните' : 'Тук още е тихо'}
            subtitle={
              scope === 'following'
                ? 'Следвай риболовци от „Приятели“, за да виждаш само техните публични улове тук.'
                : 'Когато други споделят улов, ще го виждаш тук. Сподели и твоя — Дневник → улов → „Сподели публично".'
            }
          />
          {scope === 'following' ? (
            <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.md }}>
              <Button title="Към приятели" onPress={() => navigation.navigate('Friends')} />
            </View>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ItemSeparatorComponent={ItemSeparator}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          removeClippedSubviews={Platform.OS === 'android'}
          maxToRenderPerBatch={8}
          windowSize={5}
          initialNumToRender={6}
          updateCellsBatchingPeriod={50}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : hasMore ? (
              <View style={{ height: spacing.lg }} />
            ) : null
          }
          {...keyboardAwareScrollProps}
          renderItem={renderItem}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
        />
      )}
    </Screen>
  );
}
