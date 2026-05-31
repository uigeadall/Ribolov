import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { getSolunarDay, type MoonPhaseName } from '../services/solunar';

type Props = {
  latitude: number;
  longitude: number;
  /** Defaults to "now". Pass a specific Date to render a forecast for that
      day (e.g. tomorrow's prediction). */
  date?: Date;
  /** Compact mode for tight horizontal layouts (e.g. inside a weather card).
      Hides the period list and shows just the phase + rating row. */
  compact?: boolean;
  /** Custom title — defaults to "Лунен прогноз" on full, omitted on compact. */
  title?: string;
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

const RATING_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Слаб ден',
  2: 'Тих ден',
  3: 'Среден ден',
  4: 'Добър ден',
  5: 'Отличен ден',
};

/** HH:MM helper, local time. */
function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function SolunarCard({ latitude, longitude, date, compact, title }: Props) {
  const { colors } = useTheme();
  const solunar = useMemo(
    () => getSolunarDay(latitude, longitude, date),
    [latitude, longitude, date],
  );

  // Filter to upcoming periods (relative to "now") for the current-day view
  // so users see what's NEXT rather than a window they already missed. If
  // the caller passed an explicit date, surface all periods regardless.
  const upcomingPeriods = useMemo(() => {
    const explicitDate = !!date;
    if (explicitDate) return solunar.periods;
    const now = Date.now();
    const future = solunar.periods.filter((p) => Date.parse(p.endIso) > now);
    return future.length > 0 ? future : solunar.periods;
  }, [solunar.periods, date]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.md,
          gap: 6,
        },
        cardCompact: {
          padding: spacing.sm,
          gap: 4,
        },
        title: { ...typography.bodyBold, color: colors.text, fontSize: 13, marginBottom: 2 },
        headRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
        },
        moonEmoji: { fontSize: 26 },
        phaseName: { ...typography.bodyBold, color: colors.text, fontSize: 15, flex: 1 },
        starsRow: { flexDirection: 'row', gap: 1 },
        starText: { fontSize: 13 },
        ratingLabel: { ...typography.caption, color: colors.textMuted, marginTop: -2 },
        sectionLabel: {
          ...typography.caption,
          color: colors.textMuted,
          fontSize: 11,
          letterSpacing: 0.4,
          marginTop: 6,
        },
        periodRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingVertical: 3,
        },
        periodDot: { width: 8, height: 8, borderRadius: 4 },
        majorDot: { backgroundColor: colors.primary },
        minorDot: { backgroundColor: colors.textMuted, opacity: 0.55 },
        periodTime: { ...typography.body, color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] },
        periodKind: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
      }),
    [colors],
  );

  const stars = '★'.repeat(solunar.rating) + '☆'.repeat(5 - solunar.rating);

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      {title !== '' && !compact ? <Text style={styles.title}>{title ?? 'Лунен прогноз'}</Text> : null}
      <View style={styles.headRow}>
        <Text style={styles.moonEmoji}>{MOON_EMOJI[solunar.phaseName]}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.phaseName} numberOfLines={1}>{solunar.phaseLabel}</Text>
          <Text style={styles.ratingLabel}>{RATING_LABEL[solunar.rating]} · {Math.round(solunar.illumination * 100)}% осветеност</Text>
        </View>
        <Text style={[styles.starText, { color: colors.primary, fontWeight: '700' }]}>{stars}</Text>
      </View>

      {!compact && upcomingPeriods.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>ПО-ДОБРИ ЧАСОВЕ</Text>
          {upcomingPeriods.slice(0, 4).map((p, i) => (
            <View key={`${p.startIso}-${i}`} style={styles.periodRow}>
              <View style={[styles.periodDot, p.kind === 'major' ? styles.majorDot : styles.minorDot]} />
              <Text style={styles.periodTime}>{fmtTime(p.startIso)} — {fmtTime(p.endIso)}</Text>
              <Text style={styles.periodKind}>{p.kind === 'major' ? 'Голям прозорец' : 'Малък прозорец'}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}
