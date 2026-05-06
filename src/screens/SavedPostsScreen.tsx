import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
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
import { formatFirebaseError } from '../services/firebaseErrors';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';

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
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, configured } = useAuth();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedIdsRef = useRef<string[]>([]);

  const loadIds = useCallback(async (ids: string[]) => {
    if (!ids.length) {
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setError(null);
    try {
      const rows = await fetchPublicCatchesByIds(ids);
      setItems(rows as FeedItem[]);
    } catch (e: unknown) {
      setError(formatFirebaseError(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!configured || !user?.uid) {
      setLoading(false);
      return () => {};
    }
    const unsub = subscribeSavedCatchIdsOrdered(user.uid, (ids) => {
      savedIdsRef.current = ids;
      void loadIds(ids);
    });
    return unsub;
  }, [configured, user?.uid, loadIds]);

  const onRefresh = () => {
    if (!user?.uid) return;
    setRefreshing(true);
    void loadIds(savedIdsRef.current);
  };

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

      {loading && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.centerMsg}>Зареждане…</Text>
        </View>
      ) : error && items.length === 0 ? (
        <View style={{ padding: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.danger }}>{error}</Text>
        </View>
      ) : items.length === 0 ? (
        <EmptyState
          icon="bookmark-outline"
          title="Няма запазени"
          subtitle="В лентата натисни отметката на публикация, за да я запазиш тук."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
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
            />
          )}
        />
      )}
    </Screen>
  );
}
