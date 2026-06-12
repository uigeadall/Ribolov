import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { useWeather } from '../hooks/useWeather';
import { BiteForecast, calcBiteWindows } from './BiteForecast';

/** Условия по рейтинг — пренесено от бившите home helpers. */
function fishingLabel(rating: number): string {
  if (rating >= 4) return 'Перфектно за риболов';
  if (rating >= 3) return 'Добри условия';
  return 'Умерени условия';
}

/**
 * Компактна лента с дневните условия над фийда — единственото, което
 * оцеля от стария Home. Разгъва се на място до пълната BiteForecast
 * графика. При грешка не рендерира нищо: фийдът никога не чака времето.
 */
export function FeedConditionsStrip() {
  const { colors } = useTheme();
  const { weather, weatherStatus } = useWeather();
  const [expanded, setExpanded] = useState(false);

  const peak = useMemo(() => {
    if (!weather) return null;
    const windows = calcBiteWindows(weather);
    return windows.reduce((b, w) => (w.rating > b.rating ? w : b), windows[0]);
  }, [weather]);

  if (weatherStatus === 'error' || (!weather && weatherStatus !== 'loading')) return null;

  if (!weather || !peak) {
    // Thin placeholder keeps the feed from jumping when conditions land.
    return <View style={[styles.placeholder, { backgroundColor: colors.surfaceAlt }]} />;
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardEdge }]}>
      <Pressable
        onPress={() => { void Haptics.selectionAsync(); setExpanded((v) => !v); }}
        accessibilityRole="button"
        accessibilityLabel="Условия за риболов"
        accessibilityState={{ expanded }}
        style={styles.row}
      >
        <Ionicons name="fish-outline" size={18} color={colors.primary} />
        <Text style={[typography.bodyBold, { color: colors.text }]}>
          {Math.round(weather.temperatureC)}°
        </Text>
        <Text style={[typography.caption, { color: colors.textMuted, flex: 1 }]} numberOfLines={1}>
          {fishingLabel(weather.fishingRating)} · {peak.label} {peak.range}
        </Text>
        <View style={[styles.ratingPill, { backgroundColor: colors.primarySurface }]}>
          <Text style={[typography.small, { color: colors.primary, fontFamily: 'Manrope_700Bold' }]}>
            {peak.rating}/5
          </Text>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={styles.expanded}>
          <BiteForecast weather={weather} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  ratingPill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  expanded: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    marginTop: -spacing.xs,
  },
  placeholder: {
    height: 44,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: radius.lg,
  },
});
