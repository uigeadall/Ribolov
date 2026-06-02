import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { FeedPost, FeedItem } from '../components/FeedPost';
import { EmptyState } from '../components/EmptyState';
import { Skeleton } from '../components/Skeleton';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { subscribeSavedCatchIdsOrdered, unsaveCatchesBulk } from '../services/socialFeed';
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
    // Saved-IDs only render here; pause when the user navigates away.
    { pauseInBackground: true, pauseWhenUnfocused: true },
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

  // Multi-select mode — when active, the header swaps to "Готово" + a count,
  // each row taps to toggle selection (instead of opening the post), and a
  // floating action bar appears at the bottom with "Премахни запазените".
  // Exiting the mode (or finishing the bulk delete) clears the selection.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Drop selectedIds that no longer appear in the visible list. The
  // savedIds subscription can fire while the user is in select mode
  // (e.g., they unsaved one of the selected posts via its own bookmark
  // button, or a multi-device sync removed an item). Without this
  // filter, the bulk-delete action would send stale ids that no longer
  // exist in /savedCatches, and the per-row tap-to-toggle would
  // operate on the wrong row because the visible list shifted.
  useEffect(() => {
    const visible = new Set(itemList.map((i) => i.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [itemList]);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const onBulkUnsave = useCallback(() => {
    if (!user?.uid || selectedIds.size === 0 || bulkBusy) return;
    const ids = Array.from(selectedIds);
    Alert.alert(
      'Премахни запазените?',
      `Ще премахнем ${ids.length} ${ids.length === 1 ? 'запазена публикация' : 'запазени публикации'}.`,
      [
        { text: 'Отказ', style: 'cancel' },
        {
          text: 'Премахни',
          style: 'destructive',
          onPress: async () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setBulkBusy(true);
            try {
              await unsaveCatchesBulk(user.uid, ids);
              // The savedIds subscription will fire and the items list refetches —
              // we just exit select mode here.
              exitSelectMode();
              Toast.show({ type: 'success', text1: 'Премахнато', visibilityTime: 1500 });
            } catch {
              Toast.show({ type: 'error', text1: 'Грешка', text2: 'Неуспешно премахване.', visibilityTime: 2500 });
            } finally {
              setBulkBusy(false);
            }
          },
        },
      ],
    );
  }, [user?.uid, selectedIds, bulkBusy, exitSelectMode]);

  if (!configured || !user) {
    return (
      <Screen padded={false}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад">
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
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>
          {selectMode ? `Избрани: ${selectedIds.size}` : 'Запазени'}
        </Text>
        {selectMode ? (
          <Pressable onPress={exitSelectMode} hitSlop={8} accessibilityLabel="Изход от избор">
            <Text style={{ ...typography.bodyBold, color: colors.primary }}>Готово</Text>
          </Pressable>
        ) : itemList.length > 0 ? (
          <Pressable onPress={() => setSelectMode(true)} hitSlop={8} accessibilityLabel="Избор за изтриване">
            <Ionicons name="ellipsis-horizontal-circle-outline" size={24} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      {loading && itemList.length === 0 ? (
        <View style={{ padding: spacing.lg, gap: spacing.lg }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ gap: spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Skeleton width={40} height={40} borderRadius={20} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Skeleton height={13} width="55%" />
                  <Skeleton height={11} width="35%" />
                </View>
              </View>
              <Skeleton height={200} borderRadius={12} />
              <Skeleton height={12} width="80%" />
            </View>
          ))}
        </View>
      ) : error && itemList.length === 0 ? (
        <View style={{ padding: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.danger }}>{error}</Text>
        </View>
      ) : itemList.length === 0 ? (
        <EmptyState
          icon="bookmark-outline"
          emoji="🔖"
          title="Няма запазени"
          subtitle="В лентата натисни отметката на публикация, за да я запазиш тук."
          action={{
            label: 'Към лентата',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onPress: () => (navigation as any).navigate('FeedTab', { screen: 'FeedList' }),
          }}
        />
      ) : (
        <FlatList
          data={itemList}
          keyExtractor={(it) => it.id}
          removeClippedSubviews={Platform.OS === 'android'}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <FishingRefreshControl refreshing={refreshing} onRefresh={() => reload(true)} />
          }
          ItemSeparatorComponent={() => <View style={styles.gap} />}
          {...keyboardAwareScrollProps}
          renderItem={({ item }) => {
            const isSelected = selectedIds.has(item.id);
            // In select mode, the whole post becomes a tap target for toggling.
            // We wrap FeedPost in a Pressable with `pointerEvents="box-only"`
            // so the inner interactive elements (like/comment buttons) don't
            // intercept the tap. A checkmark overlay shows selection state.
            if (selectMode) {
              return (
                <Pressable
                  onPress={() => toggleSelected(item.id)}
                  style={{ opacity: isSelected ? 0.7 : 1 }}
                >
                  <View pointerEvents="none">
                    <FeedPost
                      item={item}
                      myUid={user.uid}
                      myDisplayName={user.displayName ?? 'Аз'}
                      socialEnabled
                      onPressAuthor={() => {}}
                      onPressCatch={() => {}}
                    />
                  </View>
                  {/* Selection circle — top-right corner. Filled when selected. */}
                  <View style={{
                    position: 'absolute',
                    top: 12,
                    right: 12,
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: isSelected ? colors.primary : 'rgba(0,0,0,0.45)',
                    borderWidth: 2,
                    borderColor: '#fff',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    {isSelected ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
                  </View>
                </Pressable>
              );
            }
            return (
              <FeedPost
                item={item}
                myUid={user.uid}
                myDisplayName={user.displayName ?? 'Аз'}
                socialEnabled
                onPressAuthor={(authorUid, name) =>
                  navigation.navigate('UserPublicProfile', { uid: authorUid, displayName: name })
                }
                onPressCatch={(catchItem) => navigation.navigate('CatchDetail', { id: catchItem.id })}
              />
            );
          }}
        />
      )}

      {/* Bulk action bar — floats above the tab bar when in select mode and
          at least one item is selected. Mirrors the iOS Photos app pattern. */}
      {selectMode && selectedIds.size > 0 ? (
        <View style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          backgroundColor: colors.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          paddingBottom: spacing.xl,
        }}>
          <Pressable
            onPress={onBulkUnsave}
            disabled={bulkBusy}
            style={{
              backgroundColor: colors.danger,
              borderRadius: 24,
              paddingVertical: 12,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: bulkBusy ? 0.6 : 1,
            }}
          >
            {bulkBusy ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="bookmark-outline" size={18} color="#fff" />
            )}
            <Text style={{ ...typography.bodyBold, color: '#fff' }}>
              Премахни {selectedIds.size}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}
