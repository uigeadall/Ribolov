import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';

import { catchesStore } from '../storage/storage';
import type { Catch } from '../types';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

const MONTH_LABELS = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];

export default function StatsScreen() {
  const { colors } = useTheme();
  const [catches, setCatches] = useState<Catch[]>([]);

  useEffect(() => { catchesStore.list().then(setCatches); }, []);

  const stats = useMemo(() => {
    if (catches.length === 0) return null;
    const totalWeight = catches.reduce((s, c) => s + (c.weightKg ?? 0), 0);
    const withWeight = catches.filter((c) => (c.weightKg ?? 0) > 0);
    const avgWeight = withWeight.length > 0 ? totalWeight / withWeight.length : 0;
    const released = catches.filter((c) => c.released).length;
    const speciesMap = new Map<string, number>();
    catches.forEach((c) => speciesMap.set(c.speciesName, (speciesMap.get(c.speciesName) ?? 0) + 1));
    const topSpecies = [...speciesMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    // Monthly catches for last 12 months
    const now = new Date();
    const monthly: { label: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yr = d.getFullYear();
      const mo = d.getMonth();
      const count = catches.filter((c) => {
        const cd = new Date(c.date);
        return cd.getFullYear() === yr && cd.getMonth() === mo;
      }).length;
      monthly.push({ label: MONTH_LABELS[mo], count });
    }

    const maxMonthly = Math.max(...monthly.map((m) => m.count), 1);
    const maxSpecies = topSpecies[0]?.[1] ?? 1;

    return { totalWeight, avgWeight, released, speciesMap, topSpecies, monthly, maxMonthly, maxSpecies, n: catches.length };
  }, [catches]);

  const styles = useMemo(() => StyleSheet.create({
    statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    statCell: {
      flex: 1,
      minWidth: '45%',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      alignItems: 'center',
    },
    statNum: { ...typography.h2, color: colors.primary, fontSize: 24 },
    statLbl: { ...typography.caption, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
    barRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 80 },
    barWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
    barLabel: { ...typography.caption, color: colors.textMuted, fontSize: 9, marginTop: 4, textAlign: 'center' },
    barCount: { ...typography.caption, color: colors.primary, fontSize: 9, fontWeight: '700', marginBottom: 2 },
    speciesRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
    speciesName: { ...typography.body, color: colors.text, width: 90 },
    speciesBar: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.border, overflow: 'hidden' },
    speciesFill: { height: '100%', borderRadius: 5, backgroundColor: colors.primary },
    speciesCount: { ...typography.caption, color: colors.textMuted, width: 28, textAlign: 'right' },
  }), [colors]);

  if (catches.length === 0) {
    return (
      <Screen scroll>
        <Text style={{ ...typography.h2, color: colors.text }}>Статистики</Text>
        <Card style={{ marginTop: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.textMuted }}>
            Добави улови в дневника, за да виждаш статистики.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={{ ...typography.h2, color: colors.text, marginBottom: spacing.lg }}>Статистики</Text>

        {/* Summary numbers */}
        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats!.n}</Text>
            <Text style={styles.statLbl}>Общо улова</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats!.totalWeight.toFixed(1)}</Text>
            <Text style={styles.statLbl}>кг общо</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats!.avgWeight > 0 ? stats!.avgWeight.toFixed(1) : '—'}</Text>
            <Text style={styles.statLbl}>кг средно</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats!.released}</Text>
            <Text style={styles.statLbl}>Пуснати</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats!.speciesMap.size}</Text>
            <Text style={styles.statLbl}>Различни вида</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>
              {stats!.n > 0 ? Math.round((stats!.released / stats!.n) * 100) : 0}%
            </Text>
            <Text style={styles.statLbl}>Пуснати %</Text>
          </View>
        </View>

        {/* Monthly bar chart */}
        <Text style={{ ...typography.h3, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }}>Улови по месеци (последните 12)</Text>
        <Card>
          <View style={styles.barRow}>
            {stats!.monthly.map((m, i) => {
              const pct = m.count / stats!.maxMonthly;
              const barH = Math.max(pct * 64, m.count > 0 ? 6 : 2);
              return (
                <View key={i} style={styles.barWrap}>
                  {m.count > 0 && (
                    <Text style={styles.barCount}>{m.count}</Text>
                  )}
                  <View
                    style={{
                      width: '80%',
                      height: barH,
                      borderRadius: 3,
                      backgroundColor: m.count > 0 ? colors.primary : colors.border,
                    }}
                  />
                  <Text style={styles.barLabel}>{m.label}</Text>
                </View>
              );
            })}
          </View>
        </Card>

        {/* Top species */}
        {stats!.topSpecies.length > 0 && (
          <>
            <Text style={{ ...typography.h3, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }}>Топ видове</Text>
            <Card>
              {stats!.topSpecies.map(([name, count]) => (
                <View key={name} style={styles.speciesRow}>
                  <Text style={styles.speciesName} numberOfLines={1}>{name}</Text>
                  <View style={styles.speciesBar}>
                    <View style={[styles.speciesFill, { width: `${(count / stats!.maxSpecies) * 100}%` }]} />
                  </View>
                  <Text style={styles.speciesCount}>{count}</Text>
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
