import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';
import type { Catch } from '../types';

type Props = {
  conditions: NonNullable<Catch['conditions']>;
};

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: spacing.md,
      padding: spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    accent: { width: 4, height: 18, borderRadius: 2, backgroundColor: colors.primary },
    title: { ...typography.bodyBold, color: colors.text },
    ratingPill: {
      marginLeft: 'auto',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: 'rgba(232,144,46,0.16)',
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
    },
    ratingText: { ...typography.caption, fontWeight: '800', color: '#E8902E', fontSize: 12 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
    cell: { flexBasis: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    iconCircle: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySurface,
    },
    cellLabel: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
    cellValue: { ...typography.bodyBold, color: colors.text, fontSize: 14 },
  });
}

/** Renders the catch's recorded fishing conditions in a clean grid card. Falls
    back gracefully when individual fields are missing (older catches won't have
    every condition). Pure presentation — no network calls. */
export function CatchConditionsCard({ conditions }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const cells: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [];
  if (conditions.temperatureC != null) {
    cells.push({ icon: 'thermometer-outline', label: 'Температура', value: `${conditions.temperatureC}°C` });
  }
  if (conditions.windKmh != null) {
    cells.push({ icon: 'flag-outline', label: 'Вятър', value: `${conditions.windKmh} км/ч` });
  }
  if (conditions.pressureHpa != null) {
    cells.push({ icon: 'speedometer-outline', label: 'Налягане', value: `${conditions.pressureHpa} hPa` });
  }
  if (conditions.moonPhaseName) {
    cells.push({ icon: 'moon-outline', label: 'Луна', value: conditions.moonPhaseName });
  }

  if (cells.length === 0 && conditions.fishingRating == null) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.accent} />
        <Text style={styles.title}>Условия при улова</Text>
        {conditions.fishingRating != null ? (
          <View style={styles.ratingPill}>
            <Ionicons name="star" size={11} color="#E8902E" />
            <Text style={styles.ratingText}>{'★'.repeat(conditions.fishingRating)}</Text>
          </View>
        ) : null}
      </View>
      {cells.length > 0 ? (
        <View style={styles.grid}>
          {cells.map((c) => (
            <View key={c.label} style={styles.cell}>
              <View style={styles.iconCircle}>
                <Ionicons name={c.icon} size={18} color={colors.primary} />
              </View>
              <View>
                <Text style={styles.cellLabel}>{c.label}</Text>
                <Text style={styles.cellValue}>{c.value}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
