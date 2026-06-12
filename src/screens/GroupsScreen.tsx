import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Pressable,
  TextInput, Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { FishingRefreshControl } from '../components/FishingRefreshControl';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import { fetchGroups, fetchMyGroups, type Group, CATEGORY_LABELS } from '../services/groups';
import { useAsync } from '../hooks/useAsync';
import { useAppNavigation } from '../navigation/useAppNavigation';

type Tab = 'discover' | 'mine';

export default function GroupsScreen() {
  const navigation = useAppNavigation();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('discover');
  const [search, setSearch] = useState('');

  const styles = useMemo(() => StyleSheet.create({
    header: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.md,
      paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    tabs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    tab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
    tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabText: { ...typography.small, color: colors.text, fontWeight: '600' },
    tabTextActive: { color: colors.white },
    searchWrap: {
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      backgroundColor: colors.surfaceAlt, borderRadius: radius.lg,
      borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: spacing.md, marginHorizontal: spacing.lg, marginBottom: spacing.sm,
    },
    searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? spacing.sm + 2 : spacing.sm, fontSize: 15, color: colors.text },
    groupRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    groupIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primarySurface, alignItems: 'center', justifyContent: 'center' },
    groupName: { ...typography.bodyBold, color: colors.text },
    groupMeta: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  }), [colors]);

  const { data, loading, refreshing, reload } = useAsync(async () => {
    if (!configured) return { groups: [] as Group[], myGroups: [] as Group[] };
    const [all, mine] = await Promise.all([
      fetchGroups(),
      user ? fetchMyGroups(user.uid) : Promise.resolve([] as Group[]),
    ]);
    return { groups: all, myGroups: mine };
  }, [configured, user]);

  const groups = data?.groups ?? [];
  const myGroups = data?.myGroups ?? [];

  // Skip the initial focus — useAsync auto-runs on mount. Subsequent focuses
  // do a silent reload so existing data stays visible (no skeleton flicker).
  const initialFocusRef = useRef(true);
  useFocusEffect(useCallback(() => {
    if (initialFocusRef.current) { initialFocusRef.current = false; return; }
    reload(true);
  }, [reload]));

  const displayed = (tab === 'mine' ? myGroups : groups).filter((g) =>
    !search.trim() || g.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Клубове</Text>
        {user && configured ? (
          <Pressable onPress={() => navigation.navigate('CreateGroup')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Създай клуб">
            <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.tabs}>
        {(['discover', 'mine'] as Tab[]).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => { void Haptics.selectionAsync(); setTab(t); }}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'discover' ? 'Откривай' : 'Моите'}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={colors.textMuted} />
        <TextInput
          placeholder="Търси клуб…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          style={styles.searchInput}
          clearButtonMode="while-editing"
        />
      </View>

      <FlashList
        data={displayed}
        keyExtractor={(g) => g.id}
        refreshControl={<FishingRefreshControl refreshing={refreshing} onRefresh={() => reload(true)} />}
        // FlashList's contentContainerStyle ignores `gap`; use a separator to
        // preserve the inter-card spacing the FlatList got from `gap: spacing.sm`.
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}
        ListEmptyComponent={
          !loading ? (
            <View style={{ marginTop: spacing.xxl }}>
              <EmptyState
                icon="people-outline"
                title="Няма клубове"
                subtitle={tab === 'mine' ? 'Присъедини се към клуб или създай нов.' : 'Все още няма клубове. Бъди първи!'}
                action={tab === 'mine' && user
                  ? { label: 'Създай клуб', onPress: () => navigation.navigate('CreateGroup') }
                  : undefined}
              />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('GroupDetail', { groupId: item.id, groupName: item.name })}>
            <Card>
              <View style={styles.groupRow}>
                <View style={styles.groupIcon}>
                  <Ionicons name="people-outline" size={22} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.groupMeta}>
                    {CATEGORY_LABELS[item.category]} · {item.memberCount} {item.memberCount === 1 ? 'член' : 'члена'}
                  </Text>
                  {item.description ? <Text style={styles.groupMeta} numberOfLines={1}>{item.description}</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
