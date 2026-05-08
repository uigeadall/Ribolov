import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';

import { catchesStore } from '../storage/storage';
import type { Catch } from '../types';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

const DAY_LABELS = ['Нед', 'Пон', 'Вт', 'Ср', 'Чет', 'Пет', 'Съб'];
const MONTH_LABELS = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];

function InsightRow({ icon, label, value, sub }: { icon: string; label: string; value: string; sub?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }}>
      <View style={{
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: colors.primarySurface,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Ionicons name={icon as any} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ ...typography.caption, color: colors.textMuted }}>{label}</Text>
        <Text style={{ ...typography.bodyBold, color: colors.text, marginTop: 1 }}>{value}</Text>
        {sub ? <Text style={{ ...typography.caption, color: colors.textMuted, marginTop: 1 }}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export default function InsightsScreen() {
  const { colors } = useTheme();
  const [catches, setCatches] = useState<Catch[]>([]);

  useEffect(() => { catchesStore.list().then(setCatches); }, []);

  const insights = useMemo(() => {
    if (catches.length < 3) return null;

    // Best day of week
    const byDay = Array(7).fill(0) as number[];
    catches.forEach((c) => { byDay[new Date(c.date).getDay()]++; });
    const bestDayIdx = byDay.indexOf(Math.max(...byDay));

    // Best month
    const byMonth = Array(12).fill(0) as number[];
    catches.forEach((c) => { byMonth[new Date(c.date).getMonth()]++; });
    const bestMonthIdx = byMonth.indexOf(Math.max(...byMonth));

    // Favourite species
    const specMap = new Map<string, number>();
    catches.forEach((c) => specMap.set(c.speciesName, (specMap.get(c.speciesName) ?? 0) + 1));
    const favSpecies = [...specMap.entries()].sort((a, b) => b[1] - a[1])[0];

    // Average weight
    const withWeight = catches.filter((c) => (c.weightKg ?? 0) > 0);
    const avgW = withWeight.length > 0
      ? withWeight.reduce((s, c) => s + (c.weightKg ?? 0), 0) / withWeight.length
      : null;

    // Weight trend — compare last 10 vs previous 10 catches with weight
    let trend: 'up' | 'down' | 'stable' = 'stable';
    if (withWeight.length >= 6) {
      const sorted = [...withWeight].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const half = Math.floor(sorted.length / 2);
      const recentAvg = sorted.slice(half).reduce((s, c) => s + (c.weightKg ?? 0), 0) / (sorted.length - half);
      const oldAvg = sorted.slice(0, half).reduce((s, c) => s + (c.weightKg ?? 0), 0) / half;
      if (recentAvg > oldAvg * 1.05) trend = 'up';
      else if (recentAvg < oldAvg * 0.95) trend = 'down';
    }

    // Release rate
    const releaseRate = Math.round((catches.filter((c) => c.released).length / catches.length) * 100);

    // Unique waters
    const waters = new Set(catches.map((c) => c.location?.name).filter(Boolean));

    // Best location (most catches)
    const locMap = new Map<string, number>();
    catches.forEach((c) => {
      if (c.location?.name) locMap.set(c.location.name, (locMap.get(c.location.name) ?? 0) + 1);
    });
    const bestLoc = [...locMap.entries()].sort((a, b) => b[1] - a[1])[0];

    // Catches this year vs last year
    const thisYear = new Date().getFullYear();
    const thisYearN = catches.filter((c) => new Date(c.date).getFullYear() === thisYear).length;
    const lastYearN = catches.filter((c) => new Date(c.date).getFullYear() === thisYear - 1).length;

    return {
      bestDay: DAY_LABELS[bestDayIdx],
      bestDayCount: byDay[bestDayIdx],
      bestMonth: MONTH_LABELS[bestMonthIdx],
      bestMonthCount: byMonth[bestMonthIdx],
      favSpecies,
      avgW,
      trend,
      releaseRate,
      waters: waters.size,
      bestLoc,
      thisYearN,
      lastYearN,
    };
  }, [catches]);

  const styles = useMemo(() => StyleSheet.create({
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 2 },
  }), [colors]);

  if (catches.length === 0) {
    return (
      <Screen scroll>
        <Text style={{ ...typography.h2, color: colors.text }}>Инсайти</Text>
        <Card style={{ marginTop: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.textMuted }}>
            Добави поне 3 улова в дневника, за да виждаш анализ на твоя риболов.
          </Text>
        </Card>
      </Screen>
    );
  }

  if (!insights) {
    return (
      <Screen scroll>
        <Text style={{ ...typography.h2, color: colors.text }}>Инсайти</Text>
        <Card style={{ marginTop: spacing.lg }}>
          <Text style={{ ...typography.body, color: colors.textMuted }}>
            Нужни са поне 3 улова за анализ.
          </Text>
        </Card>
      </Screen>
    );
  }

  const trendIcon = insights.trend === 'up' ? 'trending-up' : insights.trend === 'down' ? 'trending-down' : 'remove-outline';
  const trendText = insights.trend === 'up'
    ? 'Средното тегло расте — формата ти е нагоре!'
    : insights.trend === 'down'
    ? 'Средното тегло намалява напоследък.'
    : 'Средното тегло е стабилно.';

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}>
        <Text style={{ ...typography.h2, color: colors.text, marginBottom: spacing.lg }}>Инсайти</Text>

        Твоят риболовен профил
        <Card style={{ marginTop: spacing.sm }}>
          <InsightRow
            icon="calendar"
            label="Най-добър ден за риболов"
            value={insights.bestDay}
            sub={`${insights.bestDayCount} улова в този ден`}
          />
          <View style={styles.divider} />
          <InsightRow
            icon="sunny-outline"
            label="Най-добър месец"
            value={insights.bestMonth}
            sub={`${insights.bestMonthCount} улова`}
          />
          <View style={styles.divider} />
          <InsightRow
            icon="fish-outline"
            label="Любим вид"
            value={insights.favSpecies?.[0] ?? '—'}
            sub={`${insights.favSpecies?.[1] ?? 0} улова`}
          />
          <View style={styles.divider} />
          <InsightRow
            icon="location-outline"
            label="Любима локация"
            value={insights.bestLoc?.[0] ?? '—'}
            sub={insights.bestLoc ? `${insights.bestLoc[1]} улова там` : undefined}
          />
          <View style={styles.divider} />
          <InsightRow
            icon="map-outline"
            label="Уникални водоеми"
            value={`${insights.waters}`}
            sub="различни места за риболов"
          />
        </Card>

        <Text style={{ ...typography.h3, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }}>Тегло и тенденции</Text>
        <Card style={{ marginTop: spacing.sm }}>
          {insights.avgW != null && (
            <>
              <InsightRow
                icon="scale-outline"
                label="Средно тегло на улов"
                value={`${insights.avgW.toFixed(2)} кг`}
              />
              <View style={styles.divider} />
            </>
          )}
          <InsightRow
            icon={trendIcon}
            label="Тенденция"
            value={trendText}
          />
          <View style={styles.divider} />
          <InsightRow
            icon="leaf-outline"
            label="Процент пуснати риби"
            value={`${insights.releaseRate}%`}
            sub={insights.releaseRate >= 50 ? 'Отличен рибовъд!' : 'Пускай когато можеш.'}
          />
        </Card>

        <Text style={{ ...typography.h3, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm }}>Тази година</Text>
        <Card style={{ marginTop: spacing.sm }}>
          <InsightRow
            icon="trophy-outline"
            label={`Улова ${new Date().getFullYear()} г.`}
            value={`${insights.thisYearN} улова`}
            sub={insights.lastYearN > 0
              ? insights.thisYearN >= insights.lastYearN
                ? `+${insights.thisYearN - insights.lastYearN} спрямо миналата година`
                : `${insights.thisYearN - insights.lastYearN} спрямо миналата година`
              : undefined
            }
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}
