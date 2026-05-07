import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { WeatherSnapshot } from '../services/weather';
import { StarRatingBar } from './StarRatingBar';

type Window = { label: string; emoji: string; rating: number; tip: string };

function calcBiteWindows(w: WeatherSnapshot): Window[] {
  const hour = new Date().getHours();
  const base = w.fishingRating;

  // Dawn: 5-9h
  const dawnBonus = (hour >= 5 && hour <= 9 ? 0.8 : 0) + (w.moonPhase < 0.1 || Math.abs(w.moonPhase - 0.5) < 0.08 ? 0.5 : 0);
  // Midday: 10-16h — usually slower
  const midBonus = w.cloudCover > 60 ? 0.2 : -0.4;
  // Dusk: 17-21h — second best window
  const duskBonus = (hour >= 17 && hour <= 21 ? 0.6 : 0) + (w.moonPhase < 0.1 || Math.abs(w.moonPhase - 0.5) < 0.08 ? 0.4 : 0);
  // Night — moon-dependent
  const nightBonus = (w.moonPhase < 0.1 || Math.abs(w.moonPhase - 0.5) < 0.08) ? 0.5 : -0.5;

  const clamp = (v: number) => Math.max(1, Math.min(5, Math.round(v)));

  const pressureBonus = w.pressureHpa >= 1013 && w.pressureHpa <= 1022 ? 0.3 : w.pressureHpa < 1000 ? -0.5 : 0;

  return [
    {
      label: 'Сутринта',
      emoji: '🌅',
      rating: clamp(base + dawnBonus + pressureBonus),
      tip: dawnBonus > 0.5 ? 'Пик на хранене при изгрев' : 'Добра сутрешна активност',
    },
    {
      label: 'Денем',
      emoji: '☀️',
      rating: clamp(base + midBonus + pressureBonus),
      tip: w.cloudCover > 60 ? 'Облачността намалява UV — риба е по-активна' : 'Ярко слънце — риба е на дълбочина',
    },
    {
      label: 'Вечерта',
      emoji: '🌆',
      rating: clamp(base + duskBonus + pressureBonus),
      tip: duskBonus > 0.5 ? 'Отличен вечерен прозорец' : 'Умерена вечерна активност',
    },
    {
      label: 'Нощем',
      emoji: '🌙',
      rating: clamp(base + nightBonus + pressureBonus),
      tip: nightBonus > 0 ? `${w.moonPhaseName} — риба е активна нощем` : 'По-слаба нощна активност',
    },
  ];
}

type Props = { weather: WeatherSnapshot };

export function BiteForecast({ weather }: Props) {
  const { colors } = useTheme();
  const windows = useMemo(() => calcBiteWindows(weather), [weather]);

  const styles = useMemo(() => StyleSheet.create({
    container: {
      backgroundColor: colors.primarySurface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: spacing.sm,
    },
    title: { ...typography.bodyBold, color: colors.text, marginBottom: spacing.md },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    cell: {
      flex: 1,
      minWidth: '45%',
      backgroundColor: colors.card,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    cellLabel: { ...typography.small, color: colors.text, fontWeight: '600', marginTop: 2 },
    cellEmoji: { fontSize: 20 },
    cellTip: { ...typography.small, color: colors.textMuted, textAlign: 'center', marginTop: 4, lineHeight: 16 },
  }), [colors]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Прогноза за хапки</Text>
      <View style={styles.grid}>
        {windows.map((w) => (
          <View key={w.label} style={styles.cell}>
            <Text style={styles.cellEmoji}>{w.emoji}</Text>
            <Text style={styles.cellLabel}>{w.label}</Text>
            <View style={{ marginTop: 4 }}>
              <StarRatingBar rating={w.rating} color="#FFD700" emptyColor={colors.border} size={12} />
            </View>
            <Text style={styles.cellTip} numberOfLines={2}>{w.tip}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
