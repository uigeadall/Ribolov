import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, TextInput } from 'react-native';

import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import { KNOTS, USE_CASE_LABELS, KnotUseCase } from '../data/knots';
import { keyboardAwareScrollProps } from '../utils/keyboardScrollProps';
import { StarRatingBar } from '../components/StarRatingBar';
import { useAppNavigation } from '../navigation/useAppNavigation';

const FILTERS: { id: 'all' | KnotUseCase; label: string }[] = [
  { id: 'all', label: 'Всички' },
  { id: 'hook', label: 'Кука' },
  { id: 'lure', label: 'Воблер' },
  { id: 'line-to-line', label: 'Корда↔Корда' },
  { id: 'loop', label: 'Примка' },
];

function strengthColor(strength: number): string {
  if (strength >= 90) return '#2C9F6F';
  if (strength >= 80) return '#D4A017';
  return '#C24D3F';
}

function createKnotsStyles(colors: AppColors) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.lg,
    },
    title: { ...typography.h2, color: colors.text },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.card,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    searchInput: { flex: 1, fontSize: 15, color: colors.text },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.card,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      marginRight: spacing.sm,
    },
    chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    chipText: { color: colors.textMuted, ...typography.bodyBold, fontSize: 13 },
    chipTextActive: { color: colors.white },
    row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    thumb: {
      width: 52,
      height: 52,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    name: { ...typography.h3, color: colors.text },
    alt: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
    desc: { ...typography.body, color: colors.text, marginTop: spacing.sm },
    metaRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
    meta: {},
    metaLabel: { ...typography.small, color: colors.textMuted },
    metaValue: { ...typography.bodyBold, color: colors.text, fontSize: 13 },
  });
}

export default function KnotsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createKnotsStyles(colors), [colors]);
  const navigation = useAppNavigation();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | KnotUseCase>('all');

  const filtered = useMemo(() => {
    return KNOTS.filter((k) => {
      if (filter !== 'all' && !k.useCases.includes(filter)) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          k.name.toLowerCase().includes(q) ||
          k.alternateName?.toLowerCase().includes(q) ||
          k.bestFor.some((s) => s.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [query, filter]);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={8}>
          <Ionicons name="chevron-back" size={28} color={colors.primary} />
        </Pressable>
        <Text style={styles.title}>Гид за възли</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={{ paddingHorizontal: spacing.lg }}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            placeholder="Търсене на възел..."
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <FlatList
          data={FILTERS}
          horizontal
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: spacing.md, marginHorizontal: -spacing.lg }}
          contentContainerStyle={{ paddingHorizontal: spacing.lg }}
          renderItem={({ item }) => (
            <Pressable style={[styles.chip, filter === item.id && styles.chipActive]} onPress={() => setFilter(item.id)}>
              <Text style={[styles.chipText, filter === item.id && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          )}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        {...keyboardAwareScrollProps}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('KnotDetail', { id: item.id })}
            style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
          >
            <Card style={{ marginBottom: spacing.md }}>
              <View style={styles.row}>
                <View style={styles.thumb}>
                  <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={24} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  {item.alternateName ? <Text style={styles.alt}>{item.alternateName}</Text> : null}
                  <Text style={styles.desc} numberOfLines={2}>
                    {item.description}
                  </Text>
                  <View style={styles.metaRow}>
                    <View style={styles.meta}>
                      <Text style={styles.metaLabel}>Сложност</Text>
                      <StarRatingBar rating={item.difficulty} color={colors.primary} emptyColor={colors.border} size={12} />
                    </View>
                    <View style={styles.meta}>
                      <Text style={styles.metaLabel}>Здравина</Text>
                      <Text style={[styles.metaValue, { color: strengthColor(item.strength) }]}>
                        {item.strength}%
                      </Text>
                    </View>
                  </View>
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
