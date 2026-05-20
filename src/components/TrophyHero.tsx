import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { AppColors } from '../theme/palette';

type BestCatch = {
  photoUri?: string;
  speciesName?: string;
  weightKg?: number;
  date?: string;
};

type Props = {
  name: string;
  city?: string;
  bio?: string;
  avatarUrl?: string;
  initials: string;
  /** The personal-best catch (highest weightKg). Drives the cover photo + the
      "Personal best" badge. Falls back to a gradient cover if absent. */
  bestCatch?: BestCatch;
  topLeft?: React.ReactNode;
  topRight?: React.ReactNode;
  onPickAvatar?: () => void;
};

const HERO_HEIGHT = 360;

/** Fishing-themed dawn-water fallback used when the user has no catches yet. */
function fallbackGradient(mode: 'dark' | 'light'): [string, string, string] {
  return mode === 'dark'
    ? ['#06121F', '#102C44', '#8C4F1F']
    : ['#0A3A57', '#1F6F92', '#E8902E'];
}

function createStyles(colors: AppColors, topPad: number) {
  return StyleSheet.create({
    container: {
      width: '100%',
      height: HERO_HEIGHT + topPad,
      position: 'relative',
      backgroundColor: '#000',
    },
    photo: { ...StyleSheet.absoluteFillObject },
    fallbackGradient: { ...StyleSheet.absoluteFillObject },

    // Dark gradient overlay on top of the photo so identity text stays
    // readable regardless of what the actual photo content looks like.
    overlayGradient: { ...StyleSheet.absoluteFillObject },

    topBar: {
      position: 'absolute',
      top: topPad + 8,
      left: spacing.md,
      right: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      minHeight: 40,
    },
    topSlotPlaceholder: { width: 40, height: 40 },

    // Personal-record badge — pinned top-right under the topbar
    pbBadge: {
      position: 'absolute',
      top: topPad + 56,
      right: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(0,0,0,0.45)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
    },
    pbBadgeText: { color: '#FFD700', fontWeight: '800', fontSize: 10, letterSpacing: 0.5 },

    // Identity glass card — bottom-aligned, blur-backed
    identityWrap: {
      position: 'absolute',
      left: spacing.md,
      right: spacing.md,
      bottom: spacing.lg,
    },
    identityBlur: {
      borderRadius: radius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
    },
    identityInner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
      // Translucent fill on top of the blur so it works even where blur is unsupported
      backgroundColor: 'rgba(15,30,45,0.35)',
    },
    avatarWrap: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: colors.card,
      borderWidth: 2,
      borderColor: 'rgba(255,255,255,0.4)',
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarFallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    avatarLetter: { color: '#fff', fontSize: 28, fontWeight: '800' },
    cameraDot: {
      position: 'absolute',
      bottom: 2,
      right: 2,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.primary,
      borderWidth: 2,
      borderColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },

    identityText: { flex: 1 },
    name: { ...typography.h2, color: '#fff', fontSize: 20, letterSpacing: -0.3, fontWeight: '800' },
    cityRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    cityText: { ...typography.caption, color: 'rgba(255,255,255,0.78)', fontSize: 12 },
    bio: { ...typography.caption, color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 4, lineHeight: 17 },

    // PR strip below identity (only when bestCatch has weight)
    pbStrip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: spacing.sm,
      paddingTop: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: 'rgba(255,255,255,0.18)',
    },
    pbStripText: { color: 'rgba(255,255,255,0.92)', fontSize: 12, fontWeight: '600', flex: 1 },
  });
}

function formatPbDate(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('bg-BG', { month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

/** Hero card for the profile screens. When the user has a best catch with a
    photo, that photo fills the entire hero as a dramatic backdrop. Identity
    sits in a blur-glass card overlaying the bottom. Falls back to the
    dawn-water gradient when no photo is available so empty profiles still
    look intentional. */
export function TrophyHero({
  name,
  city,
  bio,
  avatarUrl,
  initials,
  bestCatch,
  topLeft,
  topRight,
  onPickAvatar,
}: Props) {
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, insets.top), [colors, insets.top]);
  const fallback = useMemo(() => fallbackGradient(mode), [mode]);

  const hasPhoto = !!bestCatch?.photoUri;
  const blurTint = mode === 'dark' ? 'dark' : 'default';

  const avatarNode = (
    <View style={styles.avatarWrap}>
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={styles.avatarImg}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={avatarUrl}
        />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarLetter}>{initials}</Text>
        </View>
      )}
      {onPickAvatar ? (
        <View style={styles.cameraDot} pointerEvents="none">
          <Ionicons name="camera" size={12} color="#fff" />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Backdrop — photo if available, gradient otherwise */}
      {hasPhoto ? (
        <Image
          source={{ uri: bestCatch!.photoUri }}
          style={styles.photo}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <LinearGradient
          colors={fallback}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.fallbackGradient}
        />
      )}

      {/* Dark gradient overlay for text legibility — stronger at top and bottom */}
      <LinearGradient
        colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.75)']}
        locations={[0, 0.45, 1]}
        style={styles.overlayGradient}
      />

      {/* Top bar — back / menu on the left, notifications / theme / etc on the right */}
      <View style={styles.topBar}>
        {topLeft ?? <View style={styles.topSlotPlaceholder} />}
        {topRight ?? <View style={styles.topSlotPlaceholder} />}
      </View>

      {/* Personal-record badge — only when we have a real catch to brag about */}
      {bestCatch?.weightKg != null && bestCatch.weightKg > 0 ? (
        <View style={styles.pbBadge}>
          <Ionicons name="trophy" size={11} color="#FFD700" />
          <Text style={styles.pbBadgeText}>ЛИЧЕН РЕКОРД</Text>
        </View>
      ) : null}

      {/* Identity glass card */}
      <View style={styles.identityWrap}>
        <BlurView intensity={30} tint={blurTint} style={styles.identityBlur}>
          <View style={styles.identityInner}>
            {onPickAvatar ? (
              <Pressable
                onPress={onPickAvatar}
                accessibilityRole="button"
                accessibilityLabel="Промени снимка на профила"
              >
                {avatarNode}
              </Pressable>
            ) : (
              avatarNode
            )}
            <View style={styles.identityText}>
              <Text style={styles.name} numberOfLines={1}>{name}</Text>
              {city ? (
                <View style={styles.cityRow}>
                  <Ionicons name="location-outline" size={11} color="rgba(255,255,255,0.78)" />
                  <Text style={styles.cityText} numberOfLines={1}>{city}</Text>
                </View>
              ) : null}
              {bio ? <Text style={styles.bio} numberOfLines={2}>{bio}</Text> : null}
            </View>
          </View>

          {/* PB strip — species + weight + date — only when we have something */}
          {bestCatch?.speciesName && bestCatch?.weightKg != null ? (
            <View style={[styles.identityInner, styles.pbStrip, { paddingTop: spacing.sm, paddingBottom: spacing.sm }]}>
              <Ionicons name="fish" size={14} color="#FFD700" />
              <Text style={styles.pbStripText} numberOfLines={1}>
                {bestCatch.speciesName} · {bestCatch.weightKg.toFixed(1)} кг
                {bestCatch.date ? ` · ${formatPbDate(bestCatch.date)}` : ''}
              </Text>
            </View>
          ) : null}
        </BlurView>
      </View>
    </View>
  );
}

/** Reusable header button — translucent dark circle that sits over the cover. */
export function TrophyHeroButton({
  icon,
  onPress,
  accessibilityLabel,
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  badge?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0,0,0,0.4)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={20} color="#fff" />
      {badge && badge > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            backgroundColor: '#E8902E',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
