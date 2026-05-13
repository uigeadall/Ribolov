import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { FeedPost, FeedItem } from '../components/FeedPost';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeSavedCatchIdsOrdered } from '../services/socialFeed';
import { fetchPublicCatchesByIds } from '../services/cloudSync';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import { useFirestoreSubscription } from '../hooks/useFirestoreSubscription';
import { useAsync } from '../hooks/useAsync';
import { useAppNavigation } from '../navigation/useAppNavigation';

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
    listContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl },
    gap: { height: spacing.lg },
    centerMsg: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  });
}

export default function SavedPostsScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, configured } = useAuth();

  const { data: savedIds, loading: idsLoading } = useFirestoreSubscription<string[]>(
    (cb) => {
      if (!configured || !user?.uid) { cb([]); return () => {}; }
      return subscribeSavedCatchIdsOrdered(user.uid, cb);
    },
    [configured, user?.uid],
  );

  const { data: items, loading: postsLoading, refreshing, error, reload } = useAsync<FeedItem[]>(
    async () => {
      if (!savedIds?.length) return [];
      return fetchPublicCatchesByIds(savedIds) as Promise<FeedItem[]>;
    },
    [savedIds],
  );

  const loading = idsLoading || postsLoading;
  const itemList: FeedItem[] = items ?? [];

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
            <Ionicons name="chevron-back" size={28} color={colors.primary} />
          </Pressable>
          <Text style={styles.title}>Запазени</Text>
        </View>
        <EmptyState icon="bookmark-outline" title="Влез в акаунта" subtitle="Запазени публикации са налични след вход и Firebase." />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Запазени</Text>
      </View>

      {loading && itemList.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerMsg}>Зареждане…</Text>
        </View>
      ) : error && itemList.length === 0 ? (
        <View style={{ padding: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.danger }}>{error}</Text>
        </View>
      ) : itemList.length === 0 ? (
        <EmptyState
          icon="bookmark-outline"
          title="Няма запазени"
          subtitle="В лентата натисни отметката на публикация, за да я запазиш тук."
        />
      ) : (
        <FlatList
          data={itemList}
          keyExtractor={(it) => it.id}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => reload(true)} tintColor={colors.primary} />
          }
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          {...keyboardAwareScrollProps}
          renderItem={({ item }) => (
            <FeedPost
              item={item}
              myUid={user.uid}
              myDisplayName={user.displayName ?? user.email ?? 'Аз'}
              socialEnabled
              onPressAuthor={(authorUid, name) =>
                navigation.navigate('UserPublicProfile', { uid: authorUid, displayName: name })
              }
              onPressCatch={(catchItem) => navigation.navigate('CatchDetail', { id: catchItem.id })}
            />
          )}
        />
      )}
    </Screen>
  );
}
