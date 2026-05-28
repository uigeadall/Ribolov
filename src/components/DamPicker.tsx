import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { DAMS, Dam } from '../data/dams';
import { RIVERS, River } from '../data/rivers';

export type WaterPick = { kind: 'dam'; item: Dam } | { kind: 'river'; item: River };

type Props = {
  visible: boolean;
  userCoord?: { latitude: number; longitude: number } | null;
  onClose: () => void;
  onSelect: (pick: WaterPick) => void;
};

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
) {
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function createDamPickerStyles(colors: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xxl + spacing.md,
      paddingBottom: spacing.md,
      backgroundColor: colors.card,
    },
    closeBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySurface,
    },
    title: { ...typography.h2, color: colors.text },
    // Segmented control housing — single rounded pill with two halves. Active
    // half gets the primary fill + white text; inactive stays transparent so
    // the segment looks like one cohesive control rather than two buttons.
    segmented: {
      flexDirection: 'row',
      marginHorizontal: spacing.lg,
      marginTop: spacing.sm,
      marginBottom: spacing.md,
      padding: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segmentedItem: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: radius.pill,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 6,
    },
    segmentedItemActive: { backgroundColor: colors.primary },
    segmentedText: { ...typography.caption, fontWeight: '700', color: colors.textMuted },
    segmentedTextActive: { color: colors.white },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      paddingVertical: spacing.md,
      fontSize: 15,
      color: colors.text,
    },
    countBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    countText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
    countTextStrong: { color: colors.text, fontWeight: '700' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      // Subtle elevation pulls the card off the background; light enough that
      // a list of 90+ rows doesn't look heavy. iOS only — Android picks it
      // up via the elevation prop but at a lower visual cost.
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 1,
    },
    rowIcon: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      backgroundColor: '#062D3D',
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowName: { ...typography.bodyBold, color: colors.text, fontSize: 15 },
    rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    rowSpecies: { ...typography.small, color: colors.primary, marginTop: 4, fontWeight: '600' },
    rowRight: { alignItems: 'flex-end', gap: 4 },
    distPill: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.primarySurface,
    },
    distText: { ...typography.small, color: colors.primary, fontWeight: '700' },
    empty: { alignItems: 'center', padding: spacing.xxl },
    emptyText: { ...typography.h3, color: colors.text, marginTop: spacing.md },
    emptyHint: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  });
}

export function DamPicker({ visible, userCoord, onClose, onSelect }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createDamPickerStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [listTab, setListTab] = useState<'dams' | 'rivers'>('dams');

  const filtered = useMemo((): WaterPick[] => {
    const q = normalize(query);
    const base: WaterPick[] =
      listTab === 'dams'
        ? DAMS.map((d) => ({ kind: 'dam', item: d }))
        : RIVERS.map((r) => ({ kind: 'river', item: r }));

    let list = base.filter((row) => {
      const it = row.item;
      if (q && !normalize(it.name).includes(q) && !normalize(it.region).includes(q)) return false;
      return true;
    });

    if (userCoord) {
      list = [...list].sort(
        (a, b) =>
          haversineKm(userCoord, { latitude: a.item.latitude, longitude: a.item.longitude }) -
          haversineKm(userCoord, { latitude: b.item.latitude, longitude: b.item.longitude })
      );
    } else {
      list = [...list].sort((a, b) => a.item.name.localeCompare(b.item.name, 'bg'));
    }
    return list;
  }, [query, userCoord, listTab]);

  const distanceLabel = (row: WaterPick): string | null => {
    if (!userCoord) return null;
    const km = haversineKm(userCoord, { latitude: row.item.latitude, longitude: row.item.longitude });
    return km < 1 ? `${Math.round(km * 1000)} м` : `${km.toFixed(0)} км`;
  };

  const switchTab = (next: 'dams' | 'rivers') => {
    if (next === listTab) return;
    void Haptics.selectionAsync();
    setListTab(next);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn} accessibilityLabel="Затвори">
              <Ionicons name="close" size={22} color={colors.primary} />
            </Pressable>
            <Text style={styles.title}>Водоеми</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* Segmented control — Язовири / Реки. Single pill housing with two
              halves so the control reads as one cohesive switcher rather than
              two separate buttons. */}
          <View style={styles.segmented}>
            <Pressable
              onPress={() => switchTab('dams')}
              style={[styles.segmentedItem, listTab === 'dams' && styles.segmentedItemActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: listTab === 'dams' }}
            >
              <Ionicons
                name="water-outline"
                size={16}
                color={listTab === 'dams' ? colors.white : colors.textMuted}
              />
              <Text style={[styles.segmentedText, listTab === 'dams' && styles.segmentedTextActive]}>
                Язовири
              </Text>
            </Pressable>
            <Pressable
              onPress={() => switchTab('rivers')}
              style={[styles.segmentedItem, listTab === 'rivers' && styles.segmentedItemActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: listTab === 'rivers' }}
            >
              <Ionicons
                name="trail-sign-outline"
                size={16}
                color={listTab === 'rivers' ? colors.white : colors.textMuted}
              />
              <Text style={[styles.segmentedText, listTab === 'rivers' && styles.segmentedTextActive]}>
                Реки
              </Text>
            </Pressable>
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Търси по име или регион…"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.countBar}>
            <Text style={styles.countText}>
              <Text style={styles.countTextStrong}>{filtered.length}</Text>
              {' '}
              {listTab === 'dams' ? 'язовира' : 'реки'}
            </Text>
            {userCoord ? (
              <Text style={styles.countText}>сортирани по разстояние</Text>
            ) : null}
          </View>

          <FlatList
            data={filtered}
            keyExtractor={(row) => `${row.kind}-${row.item.id}`}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={48} color={colors.textMuted} />
                <Text style={styles.emptyText}>Няма съвпадения</Text>
                <Text style={styles.emptyHint}>Опитай с друго име.</Text>
              </View>
            }
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl }}
            renderItem={({ item }) => {
              const dist = distanceLabel(item);
              const it = item.item;
              const isDam = item.kind === 'dam';
              const metaDam = isDam ? (it as Dam) : null;
              const metaRiver = !isDam ? (it as River) : null;
              return (
                <Pressable
                  onPress={() => {
                    void Haptics.selectionAsync();
                    onSelect(item);
                  }}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                >
                  <View style={[styles.rowIcon, !isDam && { backgroundColor: '#2E9B5A' }]}>
                    <Ionicons name={isDam ? 'water-outline' : 'trail-sign-outline'} size={20} color={colors.white} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowName}>{it.name}</Text>
                    <Text style={styles.rowMeta}>
                      {it.region}
                      {metaDam?.altitude ? ` · ${metaDam.altitude} м` : ''}
                      {metaDam?.area ? ` · ${metaDam.area}` : ''}
                      {metaRiver?.lengthKm ? ` · ${metaRiver.lengthKm}` : ''}
                    </Text>
                    <Text style={styles.rowSpecies} numberOfLines={1}>
                      {it.species.slice(0, 4).join(' · ')}
                      {it.species.length > 4 ? '…' : ''}
                    </Text>
                  </View>
                  <View style={styles.rowRight}>
                    {dist ? (
                      <View style={styles.distPill}>
                        <Text style={styles.distText}>{dist}</Text>
                      </View>
                    ) : null}
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </View>
                </Pressable>
              );
            }}
          />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
