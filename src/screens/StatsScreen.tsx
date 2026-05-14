import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Pressable, RefreshControl, Modal, Animated } from 'react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Ionicons } from '@expo/vector-icons';
import { useAppNavigation } from '../navigation/useAppNavigation';

import { catchesStore } from '../storage/storage';
import type { Catch } from '../types';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const animRef = useRef<Animated.Value>(new Animated.Value(0));
  useEffect(() => {
    animRef.current.setValue(0);
    Animated.timing(animRef.current, { toValue: target, duration, useNativeDriver: false }).start();
    const listener = animRef.current.addListener(({ value: v }) => setValue(v));
    return () => animRef.current.removeListener(listener);
  }, [target, duration]);
  return value;
}

function AnimatedStatNum({ value, decimals = 0, suffix = '', color }: { value: number; decimals?: number; suffix?: string; color?: string }) {
  const { colors } = useTheme();
  const animated = useCountUp(value);
  return (
    <Text style={{ ...typography.h2, color: color ?? colors.primary, fontSize: 24 }}>
      {decimals > 0 ? animated.toFixed(decimals) : Math.round(animated)}{suffix}
    </Text>
  );
}

const SPECIES_PALETTE = ['#1A7A9C', '#2E9B5A', '#C49A00', '#7B4FA6', '#E85D04', '#0E4D64', '#D64545', '#0094B8'];
function speciesColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return SPECIES_PALETTE[Math.abs(h) % SPECIES_PALETTE.length];
}

const MONTH_LABELS = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];

export default function StatsScreen() {
  const { colors, mode } = useTheme();
  const navigation = useAppNavigation();
  const [catches, setCatches] = useState<Catch[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDay, setSelectedDay] = useState<{ dateKey: string; catches: Catch[] } | null>(null);

  const loadCatches = useCallback(() => {
    setLoadError(false);
    setLoading(true);
    catchesStore.list().then((list) => { setCatches(list); setLoading(false); }).catch(() => { setLoadError(true); setLoading(false); });
  }, []);

  useEffect(() => { loadCatches(); }, [loadCatches]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setLoadError(false);
    try { setCatches(await catchesStore.list()); } catch { setLoadError(true); }
    setRefreshing(false);
  }, []);

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

    const pbBySpecies = new Map<string, { name: string; bestKg: number; bestCm: number }>();
    catches.forEach((c) => {
      const prev = pbBySpecies.get(c.speciesId);
      if (!prev) {
        pbBySpecies.set(c.speciesId, { name: c.speciesName, bestKg: c.weightKg ?? 0, bestCm: c.lengthCm ?? 0 });
      } else {
        if ((c.weightKg ?? 0) > prev.bestKg) prev.bestKg = c.weightKg!;
        if ((c.lengthCm ?? 0) > prev.bestCm) prev.bestCm = c.lengthCm!;
      }
    });
    const pbList = [...pbBySpecies.values()]
      .filter((p) => p.bestKg > 0 || p.bestCm > 0)
      .sort((a, b) => b.bestKg - a.bestKg);

    return { totalWeight, avgWeight, released, speciesMap, topSpecies, monthly, maxMonthly, maxSpecies, n: catches.length, calCells, currentStreak, longestStreak, activeDaysThisYear, pbList };
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

  if (loadError) {
    return (
      <Screen scroll>
        <Text style={{ ...typography.h2, color: colors.text }}>Статистики</Text>
        <Card style={{ marginTop: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.textMuted, marginBottom: spacing.md }}>
            Грешка при зареждане на данните.
          </Text>
          <TouchableOpacity onPress={loadCatches}>
            <Text style={{ ...typography.body, color: colors.primary, fontWeight: '600' }}>Опитай отново</Text>
          </TouchableOpacity>
        </Card>
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen scroll>
        <Text style={{ ...typography.h2, color: colors.text, marginBottom: spacing.lg }}>Статистики</Text>
        <View style={{ gap: spacing.md }}>
          {[120, 80, 100, 70].map((h, i) => (
            <View key={i} style={{ height: h, borderRadius: radius.md, backgroundColor: colors.border, opacity: 0.5 }} />
          ))}
        </View>
      </Screen>
    );
  }

  if (catches.length === 0) {
    return (
      <Screen scroll>
        <Text style={{ ...typography.h2, color: colors.text }}>Статистики</Text>
        <Card style={{ marginTop: spacing.lg, alignItems: 'center', paddingVertical: spacing.xl }}>
          <Ionicons name="bar-chart-outline" size={48} color={colors.textMuted} style={{ marginBottom: spacing.md }} />
          <Text style={{ ...typography.bodyBold, color: colors.text, marginBottom: spacing.sm }}>
            Все още няма статистики
          </Text>
          <Text style={{ ...typography.body, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.lg }}>
            Добави первия си улов в дневника, за да видиш графики и анализи.
          </Text>
          <TouchableOpacity
            onPress={() => navigation.navigate('AddCatch', {})}
            style={{ backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 20 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', ...typography.body }}>Добави улов</Text>
          </TouchableOpacity>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Text style={{ ...typography.h2, color: colors.text, marginBottom: spacing.md }}>Статистики</Text>

        {/* Hero card */}
        <View style={{
          backgroundColor: mode === 'dark' ? colors.primarySurface : colors.primary,
          borderWidth: mode === 'dark' ? 1 : 0,
          borderColor: colors.primary,
          borderRadius: radius.xl,
          padding: spacing.xl,
          marginBottom: spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.lg,
        }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...typography.overline, color: mode === 'dark' ? colors.textMuted : 'rgba(255,255,255,0.7)', marginBottom: 4 }}>Общо улова</Text>
            <AnimatedStatNum value={stats!.n} color={mode === 'dark' ? colors.primary : '#fff'} />
            <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm }}>
              <View>
                <Text style={{ ...typography.small, color: mode === 'dark' ? colors.textMuted : 'rgba(255,255,255,0.65)' }}>Общо тегло</Text>
                <Text style={{ ...typography.bodyBold, color: mode === 'dark' ? colors.text : '#fff' }}>{stats!.totalWeight.toFixed(1)} кг</Text>
              </View>
              <View>
                <Text style={{ ...typography.small, color: mode === 'dark' ? colors.textMuted : 'rgba(255,255,255,0.65)' }}>Вида</Text>
                <Text style={{ ...typography.bodyBold, color: mode === 'dark' ? colors.text : '#fff' }}>{stats!.speciesMap.size}</Text>
              </View>
              <View>
                <Text style={{ ...typography.small, color: mode === 'dark' ? colors.textMuted : 'rgba(255,255,255,0.65)' }}>Сезон</Text>
                <Text style={{ ...typography.bodyBold, color: mode === 'dark' ? colors.text : '#fff' }}>{stats!.activeDaysThisYear} дни</Text>
              </View>
            </View>
          </View>
          <Text style={{ fontSize: 52, opacity: mode === 'dark' ? 0.6 : 0.9 }}>🎣</Text>
        </View>

        {/* Summary numbers */}
        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <AnimatedStatNum value={stats!.currentStreak} />
            <Text style={styles.statLbl}>Дни серия</Text>
          </View>
          <View style={styles.statCell}>
            <AnimatedStatNum value={stats!.totalWeight} decimals={1} />
            <Text style={styles.statLbl}>кг общо</Text>
          </View>
          <View style={styles.statCell}>
            {stats!.avgWeight > 0
              ? <AnimatedStatNum value={stats!.avgWeight} decimals={1} />
              : <Text style={styles.statNum}>—</Text>}
            <Text style={styles.statLbl}>кг средно</Text>
          </View>
          <View style={styles.statCell}>
            <AnimatedStatNum value={stats!.released} />
            <Text style={styles.statLbl}>Пуснати</Text>
          </View>
          <View style={styles.statCell}>
            <AnimatedStatNum value={stats!.speciesMap.size} />
            <Text style={styles.statLbl}>Различни вида</Text>
          </View>
          <View style={styles.statCell}>
            <AnimatedStatNum value={stats!.n > 0 ? Math.round((stats!.released / stats!.n) * 100) : 0} suffix="%" />
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
              {stats!.topSpecies.map(([name, count]) => {
                const sc = speciesColor(name);
                return (
                  <View key={name} style={styles.speciesRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, width: 96 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sc }} />
                      <Text style={[styles.speciesName, { width: undefined, flex: 1 }]} numberOfLines={1}>{name}</Text>
                    </View>
                    <View style={styles.speciesBar}>
                      <View style={[styles.speciesFill, { width: `${(count / stats!.maxSpecies) * 100}%`, backgroundColor: sc }]} />
                    </View>
                    <Text style={styles.speciesCount}>{count}</Text>
                  </View>
                );
              })}
            </Card>
          </>
        )}
        {/* Personal bests per species */}
        {stats!.pbList.length > 0 && (
          <>
            <Text style={{ ...typography.h3, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }}>Лични рекорди по вид</Text>
            <Card>
              {stats!.pbList.map((pb) => (
                <View key={pb.name} style={[styles.speciesRow, { alignItems: 'center' }]}>
                  <Text style={[styles.speciesName, { width: 100 }]} numberOfLines={1}>{pb.name}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    {pb.bestKg > 0 ? (
                      <Text style={{ ...typography.caption, color: colors.primary, fontWeight: '700' }}>
                        🏆 {pb.bestKg} кг
                      </Text>
                    ) : null}
                    {pb.bestCm > 0 ? (
                      <Text style={{ ...typography.caption, color: colors.textMuted }}>
                        📏 {pb.bestCm} см
                      </Text>
                    ) : null}
                  </View>
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
                      : cell.count === 0 ? colors.surfaceAlt
                      : cell.count === 1 ? colors.primary + '55'
                      : cell.count <= 3 ? colors.primary + '99'
                      : cell.count <= 6 ? colors.primary + 'CC'
                      : colors.primary;
                    return (
                      <Pressable
                        key={dow}
                        onPress={() => {
                          if (cell.isFuture || cell.count === 0) return;
                          const dayCatches = catches.filter((c) => {
                            const d = new Date(c.date);
                            return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === cell.dateKey;
                          });
                          setSelectedDay({ dateKey: cell.dateKey, catches: dayCatches });
                        }}
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
            <Text style={{ ...typography.caption, color: colors.textMuted }}>Без</Text>
            <View style={[styles.calCell, { backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border }]} />
            <View style={[styles.calCell, { backgroundColor: colors.primary + '55' }]} />
            <View style={[styles.calCell, { backgroundColor: colors.primary + '99' }]} />
            <View style={[styles.calCell, { backgroundColor: colors.primary + 'CC' }]} />
            <View style={[styles.calCell, { backgroundColor: colors.primary }]} />
            <Text style={{ ...typography.caption, color: colors.textMuted }}>Много</Text>
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

      {/* Calendar day detail modal */}
      <Modal
        visible={!!selectedDay}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedDay(null)}
      >
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setSelectedDay(null)}>
          <Pressable style={{ backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, maxHeight: '60%' }}>
            <Text style={{ ...typography.h3, color: colors.text, marginBottom: spacing.sm }}>
              {selectedDay ? new Date(selectedDay.dateKey).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
            </Text>
            <Text style={{ ...typography.caption, color: colors.textMuted, marginBottom: spacing.md }}>
              {selectedDay?.catches.length ?? 0} улова
            </Text>
            <ScrollView>
              {selectedDay?.catches.map((c) => (
                <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Ionicons name="fish-outline" size={18} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ ...typography.bodyBold, color: colors.text }}>{c.speciesName}</Text>
                    {c.weightKg != null ? <Text style={{ ...typography.caption, color: colors.textMuted }}>{c.weightKg} кг{c.lengthCm != null ? ` · ${c.lengthCm} см` : ''}</Text> : null}
                    {c.location?.name ? <Text style={{ ...typography.caption, color: colors.textMuted }}>{c.location.name}</Text> : null}
                  </View>
                  {c.released ? <Text style={{ ...typography.caption, color: colors.accent, fontWeight: '700' }}>Пуснат</Text> : null}
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setSelectedDay(null)} style={{ marginTop: spacing.lg, alignItems: 'center' }}>
              <Text style={{ ...typography.body, color: colors.primary, fontWeight: '700' }}>Затвори</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  );
}
