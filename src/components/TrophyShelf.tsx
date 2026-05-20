import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../services/themeContext';
import type { AppColors } from '../theme/palette';
import { radius, spacing, typography } from '../theme/typography';

export type TrophyCatch = {
  id: string;
  speciesName: string;
  weightKg?: number;
  photoUri?: string;
  date?: string;
};

type Props = {
  catches: TrophyCatch[];
  onPressCatch: (id: string) => void;
};

const SW = Dimensions.get('window').width;
const CARD_W = Math.min(220, SW * 0.6);
const CARD_H = CARD_W * (4 / 3);

// Gold / silver / bronze podium colors for the three trophy positions.
// Picked to be high-contrast against the dark photo overlay below.
const PODIUM = ['#FFD700', '#C0C0C0', '#CD7F32'] as const;
const PODIUM_LABEL = ['#1', '#2', '#3'] as const;

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    section: { marginTop: spacing.lg },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.sm,
    },
    accent: { width: 4, height: 18, borderRadius: 2, backgroundColor: '#FFD700' },
    title: { ...typography.h3, color: colors.text },
    subtitle: {
      ...typography.caption,
      color: colors.textMuted,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
    },
    list: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm },
    card: {
      width: CARD_W,
      height: CARD_H,
      borderRadius: radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    cardImage: { ...StyleSheet.absoluteFillObject },
    cardOverlay: { ...StyleSheet.absoluteFillObject },
    cardNoPhoto: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySurface,
    },
    ribbon: {
      position: 'absolute',
      top: spacing.sm,
      left: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
    },
    ribbonText: { color: '#0F1B2D', fontWeight: '900', fontSize: 11, letterSpacing: 0.4 },
    cardFooter: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
    },
    weight: { color: '#fff', fontWeight: '900', fontSize: 24, letterSpacing: -0.5 },
    weightUnit: { color: 'rgba(255,255,255,0.78)', fontWeight: '700', fontSize: 13, marginLeft: 3 },
    species: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '700', marginTop: 2 },
  });
}

/** Horizontal scroll of up to 3 personal-best catches with podium ribbons.
    Renders nothing when the user has no catches. Tap a card → catch detail. */
export function TrophyShelf({ catches, onPressCatch }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Top 3 by weight. Filter out catches with no weight at all (can't rank them).
  const top = useMemo(() => {
    return [...catches]
      .filter((c) => typeof c.weightKg === 'number' && c.weightKg > 0)
      .sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0))
      .slice(0, 3);
  }, [catches]);

  if (top.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionRow}>
        <View style={styles.accent} />
        <Text style={styles.title}>Трофейна полица</Text>
      </View>
      <Text style={styles.subtitle}>Топ {top.length} най-големи улова</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list}>
        {top.map((c, idx) => (
          <Pressable key={c.id} onPress={() => onPressCatch(c.id)} style={styles.card}>
            {c.photoUri ? (
              <>
                <Image source={{ uri: c.photoUri }} style={styles.cardImage} contentFit="cover" cachePolicy="memory-disk" />
                <LinearGradient
                  colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.85)']}
                  locations={[0, 0.55, 1]}
                  style={styles.cardOverlay}
                />
              </>
            ) : (
              <View style={styles.cardNoPhoto}>
                <Ionicons name="fish-outline" size={48} color={colors.primary} />
              </View>
            )}

            {/* Podium ribbon */}
            <View style={[styles.ribbon, { backgroundColor: PODIUM[idx] }]}>
              <Ionicons name="trophy" size={11} color="#0F1B2D" />
              <Text style={styles.ribbonText}>{PODIUM_LABEL[idx]}</Text>
            </View>

            {/* Weight + species pinned to bottom */}
            <View style={styles.cardFooter}>
              {c.weightKg != null ? (
                <Text style={styles.weight}>
                  {c.weightKg.toFixed(1)}
                  <Text style={styles.weightUnit}>кг</Text>
                </Text>
              ) : null}
              <Text style={styles.species} numberOfLines={1}>{c.speciesName}</Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
