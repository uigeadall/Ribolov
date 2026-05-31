import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { getSolunarDay, type MoonPhaseName } from '../services/solunar';

type Props = {
  latitude: number;
  longitude: number;
  /** Optional callback when a day is tapped — host screen can pre-fill a
      trip planner with that date. */
  onPressDay?: (date: Date, rating: number) => void;
};

const MOON_EMOJI: Record<MoonPhaseName, string> = {
  new: '🌑',
  waxingCrescent: '🌒',
  firstQuarter: '🌓',
  waxingGibbous: '🌔',
  full: '🌕',
  waningGibbous: '🌖',
  lastQuarter: '🌗',
  waningCrescent: '🌘',
};

const DAY_LABELS_BG = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * 7-day solunar forecast strip. Renders today + the next 6 days as a
 * horizontal row of compact tiles — moon emoji, weekday label, star
 * rating. Designed to be embedded in screens that have map / location
 * context (MapScreen, TripPlannerScreen) so users can see at a glance
 * which day is best for fishing.
 *
 * Highlights today's tile with the primary color so users orient
 * immediately. Tapping any tile fires onPressDay so the host screen
 * can pre-fill a trip-planner form with the chosen date.
 */
export function Solunar7DayStrip({ latitude, longitude, onPressDay }: Props) {
  const { colors, mode } = useTheme();
  const days = useMemo(() => {
    const out: Array<{ date: Date; rating: number; phase: MoonPhaseName }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const s = getSolunarDay(latitude, longitude, d);
      out.push({ date: d, rating: s.rating, phase: s.phaseName });
    }
    return out;
  }, [latitude, longitude]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          paddingHorizontal: spacing.md,
        },
        scroll: { paddingVertical: spacing.xs, gap: 8 },
        dayCard: {
          width: 52,
          alignItems: 'center',
          paddingVertical: 8,
          paddingHorizontal: 4,
          borderRadius: radius.md,
          borderWidth: 1.5,
          borderColor: colors.border,
          backgroundColor: mode === 'dark' ? 'rgba(18,28,36,0.96)' : 'rgba(255,255,255,0.96)',
        },
        dayCardToday: {
          borderColor: colors.primary,
          backgroundColor: colors.primary + '14',
        },
        dayLabel: { ...typography.caption, color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 },
        dayLabelToday: { color: colors.primary },
        dayDate: { ...typography.small, color: colors.text, fontSize: 11, fontWeight: '600' },
        moon: { fontSize: 18, marginVertical: 2 },
        rating: { fontSize: 11, fontWeight: '700' },
      }),
    [colors, mode],
  );

  return (
    <View style={styles.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
      >
        {days.map(({ date, rating, phase }, idx) => {
          const isToday = idx === 0;
          // Star color scales with rating — strong primary at 5, fading
          // through muted as the rating drops. Helps users spot good days.
          const starColor =
            rating >= 4 ? colors.primary
              : rating === 3 ? colors.text
                : colors.textMuted;
          return (
            <Pressable
              key={date.toISOString().slice(0, 10)}
              onPress={() => {
                void Haptics.selectionAsync();
                onPressDay?.(date, rating);
              }}
              style={[styles.dayCard, isToday && styles.dayCardToday]}
              accessibilityRole="button"
              accessibilityLabel={`${DAY_LABELS_BG[date.getDay()]} ${date.getDate()}, рейтинг ${rating} от 5`}
            >
              <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                {isToday ? 'Днес' : DAY_LABELS_BG[date.getDay()]}
              </Text>
              <Text style={styles.dayDate}>{date.getDate()}</Text>
              <Text style={styles.moon}>{MOON_EMOJI[phase]}</Text>
              <Text style={[styles.rating, { color: starColor }]}>{'★'.repeat(rating)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
