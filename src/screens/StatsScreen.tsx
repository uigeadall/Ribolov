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

    // Catch dates set for calendar — key format: YYYY-MM-DD
    const catchDayCount = new Map<string, number>();
    catches.forEach((c) => {
      const d = new Date(c.date);
      if (isNaN(d.getTime())) return;
      const key = d.toISOString().slice(0, 10);
      catchDayCount.set(key, (catchDayCount.get(key) ?? 0) + 1);
    });

    // Calendar: 16 weeks back from today, aligned to Monday
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekday = today.getDay(); // 0=Sun ... 6=Sat
    const daysToMon = (weekday + 6) % 7; // days since last Monday
    const calStart = new Date(today.getTime() - (daysToMon + 15 * 7) * 86_400_000);
    const totalDays = 16 * 7;
    const calCells: { dateKey: string; count: number; isToday: boolean; isFuture: boolean }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(calStart.getTime() + i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      calCells.push({ dateKey: key, count: catchDayCount.get(key) ?? 0, isToday: key === today.toISOString().slice(0, 10), isFuture: d > today });
    }

    // Longest streak from full catch history
    const allKeys = [...catchDayCount.keys()].sort();
    let longestStreak = 0;
    let tempStreak = 0;
    let prevDate = '';
    allKeys.forEach((k) => {
      if (prevDate) {
        const diff = new Date(k).getTime() - new Date(prevDate).getTime();
        tempStreak = diff === 86_400_000 ? tempStreak + 1 : 1;
      } else {
        tempStreak = 1;
      }
      longestStreak = Math.max(longestStreak, tempStreak);
      prevDate = k;
    });

    // Current streak: consecutive days back from today (up to 1000 as safety cap)
    let currentStreak = 0;
    for (let i = 0; i < 1000; i++) {
      const key = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      if (catchDayCount.has(key)) { currentStreak++; }
      else break;
    }

    const activeDaysThisYear = [...catchDayCount.keys()].filter((k) => k.startsWith(String(today.getFullYear()))).length;

    return { totalWeight, avgWeight, released, speciesMap, topSpecies, monthly, maxMonthly, maxSpecies, n: catches.length, calCells, currentStreak, longestStreak, activeDaysThisYear };
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
    calCell: { width: 13, height: 13, borderRadius: 3, margin: 1 },
    calDayLabel: { ...typography.caption, fontSize: 8, color: colors.textMuted, width: 13, textAlign: 'center', marginRight: 2 },
    streakRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    streakBox: {
      flex: 1,
      backgroundColor: colors.primarySurface,
      borderRadius: radius.md,
      padding: spacing.md,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    streakNum: { ...typography.h2, fontSize: 28, color: colors.primary },
    streakLbl: { ...typography.caption, color: colors.textMuted, marginTop: 2, textAlign: 'center' },
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
        {/* Fishing calendar */}
        <Text style={{ ...typography.h3, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }}>Риболовен календар (16 седмици)</Text>
        <Card>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: 'row' }}>
              {/* Day-of-week labels column */}
              <View style={{ justifyContent: 'space-around', paddingTop: 2, marginRight: 2 }}>
                {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'].map((d) => (
                  <Text key={d} style={styles.calDayLabel}>{d}</Text>
                ))}
              </View>
              {/* 16 columns, 7 rows each */}
              {Array.from({ length: 16 }, (_, wk) => (
                <View key={wk}>
                  {Array.from({ length: 7 }, (_, dow) => {
                    const cell = stats!.calCells[wk * 7 + dow];
                    if (!cell) return <View key={dow} style={styles.calCell} />;
                    const bg = cell.isFuture ? 'transparent'
                      : cell.count === 0 ? colors.border
                      : cell.count === 1 ? colors.primary + '66'
                      : cell.count <= 3 ? colors.primary + 'AA'
                      : colors.primary;
                    return (
                      <View
                        key={dow}
                        style={[
                          styles.calCell,
                          { backgroundColor: bg },
                          cell.isToday ? { borderWidth: 1.5, borderColor: colors.primary } : null,
                        ]}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}>
            <Text style={{ ...typography.caption, color: colors.textMuted }}>Без улов</Text>
            <View style={[styles.calCell, { backgroundColor: colors.border }]} />
            <View style={[styles.calCell, { backgroundColor: colors.primary + '66' }]} />
            <View style={[styles.calCell, { backgroundColor: colors.primary + 'AA' }]} />
            <View style={[styles.calCell, { backgroundColor: colors.primary }]} />
            <Text style={{ ...typography.caption, color: colors.textMuted }}>Много улови</Text>
          </View>
        </Card>

        {/* Streaks */}
        <View style={styles.streakRow}>
          <View style={styles.streakBox}>
            <Text style={styles.streakNum}>{stats!.currentStreak}</Text>
            <Text style={styles.streakLbl}>дни серия</Text>
          </View>
          <View style={styles.streakBox}>
            <Text style={styles.streakNum}>{stats!.longestStreak}</Text>
            <Text style={styles.streakLbl}>най-дълга серия</Text>
          </View>
          <View style={styles.streakBox}>
            <Text style={styles.streakNum}>{stats!.activeDaysThisYear}</Text>
            <Text style={styles.streakLbl}>активни дни тази година</Text>
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
