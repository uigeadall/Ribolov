import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl, ScrollView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useAuth } from '../services/authContext';
import {
  fetchListings, CATEGORY_LABELS, CONDITION_LABELS,
  type GearListing, type GearCategory,
} from '../services/marketplace';

const CATEGORIES: (GearCategory | 'all')[] = ['all', 'rods', 'reels', 'lures', 'tackle', 'clothing', 'other'];
const CAT_LABELS: Record<string, string> = { all: 'Всички', ...CATEGORY_LABELS };

export default function MarketplaceScreen() {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { user, configured } = useAuth();
  const insets = useSafeAreaInsets();
  const [listings, setListings] = useState<GearListing[]>([]);
  const [category, setCategory] = useState<GearCategory | 'all'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    title: { ...typography.h2, color: colors.text, flex: 1 },
    chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginRight: spacing.xs },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { ...typography.small, color: colors.text, fontWeight: '600' },
    chipTextActive: { color: colors.white },
    card: { flexDirection: 'row', gap: spacing.md },
    thumb: { width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
    listingTitle: { ...typography.bodyBold, color: colors.text },
    price: { ...typography.h3, color: colors.primary, marginTop: 2 },
    meta: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  }), [colors]);

  const load = useCallback(async () => {
    if (!configured) return;
    const list = await fetchListings(category === 'all' ? undefined : category);
    setListings(list);
    setRefreshing(false);
  }, [configured, category]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Марзет</Text>
        {user && configured ? (
          <Pressable onPress={() => navigation.navigate('PostListing')} hitSlop={8}>
            <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
          </Pressable>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.sm }}>
        {CATEGORIES.map((c) => (
          <Pressable key={c} style={[styles.chip, category === c && styles.chipActive]} onPress={() => setCategory(c)}>
            <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{CAT_LABELS[c]}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <FlatList
        data={listings}
        keyExtractor={(l) => l.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.sm, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <EmptyState icon="bag-outline" title="Няма обяви" subtitle="Първи публикувай оборудване за продажба с + горе." />
            {user && configured ? <Button title="Добави обява" onPress={() => navigation.navigate('PostListing')} style={{ marginTop: spacing.lg }} /> : null}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('ListingDetail', { listingId: item.id })}>
            <Card>
              <View style={styles.card}>
                {item.photoUrl ? (
                  <Image source={{ uri: item.photoUrl }} style={styles.thumb} contentFit="cover" />
                ) : (
                  <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
                    <Ionicons name="bag-outline" size={32} color={colors.primary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.listingTitle} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.price}>{item.priceBGN} лв.</Text>
                  <Text style={styles.meta}>{CONDITION_LABELS[item.condition]} · {item.locationName}</Text>
                  <Text style={styles.meta}>{item.sellerName}</Text>
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
