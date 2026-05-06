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

const ALL_REGIONS = Array.from(new Set([...DAMS.map((d) => d.region), ...RIVERS.map((r) => r.region)])).sort((a, b) =>
  a.localeCompare(b, 'bg')
);

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
const POPULAR_SPECIES = [
  'Шаран',
  'Сом',
  'Щука',
  'Бяла риба',
  'Костур',
  'Балканска пъстърва',
  'Дъгова пъстърва',
  'Толстолоб',
  'Амур',
  'Каракуда',
];

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
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    closeBtn: { padding: 4 },
    title: { ...typography.h2, color: colors.text },
    tabRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    tabChip: {
      flex: 1,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      alignItems: 'center',
      backgroundColor: colors.background,
      borderWidth: 1,
      borderColor: colors.border,
    },
    tabChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    tabChipText: { ...typography.caption, fontWeight: '700', color: colors.text },
    tabChipTextActive: { color: colors.white },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      margin: spacing.lg,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: {
      flex: 1,
      paddingVertical: spacing.md,
      fontSize: 15,
      color: colors.text,
    },
    filterSection: { marginBottom: spacing.sm },
    filterLabel: {
      ...typography.caption,
      color: colors.textMuted,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.xs,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { ...typography.caption, color: colors.text, fontWeight: '600' },
    chipTextActive: { color: colors.white },
    resetBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    resetText: { ...typography.caption, color: colors.textMuted },
    resetBtn: { ...typography.caption, color: colors.primary, fontWeight: '600' },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
    },
    rowIcon: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: '#062D3D',
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowName: { ...typography.bodyBold, color: colors.text },
    rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    rowSpecies: { ...typography.small, color: colors.primary, marginTop: 4, fontWeight: '600' },
    rowRight: { alignItems: 'flex-end', gap: 4 },
    distText: { ...typography.caption, color: colors.text, fontWeight: '600' },
    empty: { alignItems: 'center', padding: spacing.xxl },
    emptyText: { ...typography.h3, color: colors.text, marginTop: spacing.md },
    emptyHint: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, textAlign: 'center' },
  });
}

export function DamPicker({ visible, userCoord, onClose, onSelect }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createDamPickerStyles(colors), [colors]);
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const [species, setSpecies] = useState<string | null>(null);
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
      if (region && it.region !== region) return false;
      if (species && !it.species.includes(species)) return false;
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
  }, [query, region, species, userCoord, listTab]);

  const distanceLabel = (row: WaterPick): string | null => {
    if (!userCoord) return null;
    const km = haversineKm(userCoord, { latitude: row.item.latitude, longitude: row.item.longitude });
    return km < 1 ? `${Math.round(km * 1000)} м` : `${km.toFixed(0)} км`;
  };

  const reset = () => {
    setQuery('');
    setRegion(null);
    setSpecies(null);
  };

  const hasFilters = !!query || !!region || !!species;

  const countLabel =
    listTab === 'dams' ? `Язовири: ${filtered.length}` : `Реки: ${filtered.length}`;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <Pressable onPress={onClose} hitSlop={8} style={styles.closeBtn}>
              <Ionicons name="close" size={26} color={colors.text} />
            </Pressable>
            <Text style={styles.title}>Водоеми</Text>
            <View style={{ width: 26 }} />
          </View>

          <View style={styles.tabRow}>
            <Pressable
              onPress={() => setListTab('dams')}
              style={[styles.tabChip, listTab === 'dams' && styles.tabChipActive]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons
                  name="water-outline"
                  size={16}
                  color={listTab === 'dams' ? colors.white : colors.text}
                />
                <Text style={[styles.tabChipText, listTab === 'dams' && styles.tabChipTextActive]}>Язовири</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => setListTab('rivers')}
              style={[styles.tabChip, listTab === 'rivers' && styles.tabChipActive]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons
                  name="trail-sign-outline"
                  size={16}
                  color={listTab === 'rivers' ? colors.white : colors.text}
                />
                <Text style={[styles.tabChipText, listTab === 'rivers' && styles.tabChipTextActive]}>Реки</Text>
              </View>
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

          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Регион</Text>
            <FlatList
              data={ALL_REGIONS}
              keyExtractor={(r) => r}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setRegion((r) => (r === item ? null : item))}
                  style={[styles.chip, region === item && styles.chipActive]}
                >
                  <Text style={[styles.chipText, region === item && styles.chipTextActive]}>{item}</Text>
                </Pressable>
              )}
            />
          </View>

          <View style={styles.filterSection}>
            <Text style={styles.filterLabel}>Риба</Text>
            <FlatList
              data={POPULAR_SPECIES}
              keyExtractor={(s) => s}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSpecies((s) => (s === item ? null : item))}
                  style={[styles.chip, species === item && styles.chipActive]}
                >
                  <Text style={[styles.chipText, species === item && styles.chipTextActive]}>{item}</Text>
                </Pressable>
              )}
            />
          </View>

          {hasFilters ? (
            <View style={styles.resetBar}>
              <Text style={styles.resetText}>{filtered.length} резултата</Text>
              <Pressable onPress={reset}>
                <Text style={styles.resetBtn}>Изчисти филтрите</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.resetBar}>
              <Text style={styles.resetText}>{countLabel}</Text>
              {userCoord ? <Text style={styles.resetText}>сортирани по разстояние</Text> : null}
            </View>
          )}

          <FlatList
            data={filtered}
            keyExtractor={(row) => `${row.kind}-${row.item.id}`}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={48} color={colors.textMuted} />
                <Text style={styles.emptyText}>Няма съвпадения</Text>
                <Text style={styles.emptyHint}>Опитай с друго име или премахни филтрите.</Text>
              </View>
            }
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
            renderItem={({ item }) => {
              const dist = distanceLabel(item);
              const it = item.item;
              const isDam = item.kind === 'dam';
              const metaDam = isDam ? (it as Dam) : null;
              const metaRiver = !isDam ? (it as River) : null;
              return (
                <Pressable
                  onPress={() => onSelect(item)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                >
                  <View style={[styles.rowIcon, !isDam && { backgroundColor: '#2E9B5A' }]}>
                    <Ionicons name={isDam ? 'water-outline' : 'trail-sign-outline'} size={18} color={colors.white} />
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
                    {dist ? <Text style={styles.distText}>{dist}</Text> : null}
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
