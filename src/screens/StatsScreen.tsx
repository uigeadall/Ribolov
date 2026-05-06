import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { catchesStore } from '../storage/storage';
import type { Catch } from '../types';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

export default function StatsScreen() {
  const { colors } = useTheme();
  const [catches, setCatches] = useState<Catch[]>([]);

  useEffect(() => {
    catchesStore.list().then(setCatches);
  }, []);

  const stats = useMemo(() => {
    const totalWeight = catches.reduce((s, c) => s + (c.weightKg ?? 0), 0);
    const released = catches.filter((c) => c.released).length;
    const species = new Set(catches.map((c) => c.speciesId)).size;
    const maxW = catches.reduce((m, c) => Math.max(m, c.weightKg ?? 0), 0);
    return { totalWeight, released, species, maxW, n: catches.length };
  }, [catches]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        title: { ...typography.h2, color: colors.text },
        row: { ...typography.body, color: colors.text, marginTop: spacing.sm },
        muted: { ...typography.caption, color: colors.textMuted },
      }),
    [colors]
  );

  return (
    <Screen scroll>
      <Text style={styles.title}>Статистики</Text>
      <Text style={[styles.muted, { marginTop: spacing.xs }]}>От локалния дневник на устройството.</Text>

      <Card style={{ marginTop: spacing.lg }}>
        <Text style={styles.row}>Общо записи: {stats.n}</Text>
        <Text style={styles.row}>Различни видове: {stats.species}</Text>
        <Text style={styles.row}>Сума тегло (където има): {stats.totalWeight.toFixed(2)} кг</Text>
        <Text style={styles.row}>Най-тежък запис: {stats.maxW > 0 ? `${stats.maxW} кг` : '—'}</Text>
        <Text style={styles.row}>Пуснати риби: {stats.released}</Text>
      </Card>
    </Screen>
  );
}
