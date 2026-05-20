import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';
import type { AppColors } from '../theme/palette';

type Props = {
  name: string;
  city?: string;
  bio?: string;
  /** Big cover band photo (e.g. best-catch). Falls back to a gradient. */
  coverUrl?: string;
  avatarUrl?: string;
  initials: string;
  /** Optional dot-separated metadata items shown under the name (e.g.
      "12 последователи · 3 следва"). Each item appears with a center dot
      between them. Pass undefined entries and they're skipped. */
  metaItems?: Array<string | undefined>;
  /** Top-left slot — usually back button. */
  topLeft?: React.ReactNode;
  /** Top-right slot — usually overflow menu. */
  topRight?: React.ReactNode;
  /** Action button row that sits under the name. Parent fully controls what
      goes here so the same hero serves both own-profile (Edit / Settings) and
      public profile (Follow / Message / Block). */
  actions?: React.ReactNode;
  /** Tap-to-pick avatar — own profile only. Renders a small camera dot. */
  onPickAvatar?: () => void;
};

const COVER_HEIGHT = 200;
const AVATAR_SIZE = 120;
const AVATAR_OVERLAP = 44; // how far the avatar dips into the panel below the cover
const RING_WIDTH = 4;

function fallbackGradient(mode: 'dark' | 'light'): [string, string, string] {
  return mode === 'dark'
    ? ['#06121F', '#102C44', '#8C4F1F']
    : ['#0A3A57', '#1F6F92', '#E8902E'];
}

function createStyles(colors: AppColors, topPad: number) {
  return StyleSheet.create({
    container: { backgroundColor: colors.background },
    cover: {
      width: '100%',
      height: COVER_HEIGHT + topPad,
      backgroundColor: '#000',
    },
    coverImage: { ...StyleSheet.absoluteFillObject },
    // Soft dark gradient at the top so back/overflow icons stay readable
    // against bright photos.
    topShade: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: topPad + 64,
    },
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

    // The identity panel — sits BELOW the cover, normal background. The avatar
    // overlaps the boundary so part of it is over the cover and part over the
    // panel — Facebook's signature placement.
    identityPanel: {
      backgroundColor: colors.background,
      paddingTop: AVATAR_OVERLAP + spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
    },

    // Avatar — absolute, overlapping the cover-panel boundary on the left.
    avatarWrap: {
      position: 'absolute',
      left: spacing.lg,
      // negative top pulls the avatar up so half overlaps the cover.
      // The avatar's own height is AVATAR_SIZE; we want AVATAR_OVERLAP of it
      // to be over the cover, so position it (AVATAR_SIZE - AVATAR_OVERLAP)
      // above the panel's top edge.
      top: -(AVATAR_SIZE - AVATAR_OVERLAP),
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: colors.background,
      borderWidth: RING_WIDTH,
      borderColor: colors.background,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.16,
      shadowRadius: 8,
      elevation: 6,
    },
    avatarInner: {
      width: '100%',
      height: '100%',
      borderRadius: (AVATAR_SIZE - RING_WIDTH * 2) / 2,
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarFallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    avatarLetter: { color: '#fff', fontSize: 44, fontWeight: '800' },
    cameraDot: {
      position: 'absolute',
      bottom: 4,
      right: 4,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 3,
      borderColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Identity text block — left-aligned, sits to the right of where the
    // avatar would be at small sizes, OR below on phones. We render it below
    // the avatar (Facebook's mobile layout) so it never gets crowded.
    name: {
      ...typography.h2,
      color: colors.text,
      fontSize: 22,
      fontWeight: '800',
      letterSpacing: -0.3,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      marginTop: 2,
    },
    metaText: { ...typography.caption, color: colors.textMuted, fontSize: 13 },
    metaDot: {
      width: 3,
      height: 3,
      borderRadius: 1.5,
      backgroundColor: colors.textMuted,
      marginHorizontal: 6,
      opacity: 0.6,
    },
    bio: {
      ...typography.body,
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
      marginTop: spacing.sm,
    },

    // Action buttons row — owned by parent, but the spacing is consistent.
    actionsWrap: { marginTop: spacing.md },
  });
}

/** Facebook-style profile hero. Wide cover at the top, avatar overlapping
    the bottom-left edge, identity text left-aligned below the avatar, then
    an action button row. Parent controls the buttons so the same hero
    serves both the user's own profile and the public profile view. */
export function FacebookProfileHero({
  name,
  city,
  bio,
  coverUrl,
  avatarUrl,
  initials,
  metaItems,
  topLeft,
  topRight,
  actions,
  onPickAvatar,
}: Props) {
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, insets.top), [colors, insets.top]);
  const fallback = useMemo(() => fallbackGradient(mode), [mode]);

  const visibleMeta = (metaItems ?? []).filter((m): m is string => !!m && m.trim().length > 0);

  const avatarNode = (
    <View style={styles.avatarWrap}>
      <View style={styles.avatarInner}>
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
      </View>
      {onPickAvatar ? (
        <View style={styles.cameraDot} pointerEvents="none">
          <Ionicons name="camera" size={16} color={colors.text} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* ── Cover ── */}
      <View style={styles.cover}>
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={styles.coverImage}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        ) : (
          <LinearGradient
            colors={fallback}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={styles.coverImage}
          />
        )}
        {/* Top fade so icon buttons stay readable on any photo */}
        <LinearGradient
          colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']}
          style={styles.topShade}
        />
        <View style={styles.topBar}>
          {topLeft ?? <View style={styles.topSlotPlaceholder} />}
          {topRight ?? <View style={styles.topSlotPlaceholder} />}
        </View>
      </View>

      {/* ── Identity panel — sits below the cover, holds the avatar overlap ── */}
      <View style={styles.identityPanel}>
        {/* Avatar is absolute-positioned within this panel so it can dip
            into the cover above. */}
        {onPickAvatar ? (
          <Pressable
            onPress={onPickAvatar}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Промени снимка на профила"
            style={styles.avatarWrap}
          >
            {/* Re-render inner content here so the hit area is the whole circle */}
            <View style={styles.avatarInner}>
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
            </View>
            <View style={styles.cameraDot} pointerEvents="none">
              <Ionicons name="camera" size={16} color={colors.text} />
            </View>
          </Pressable>
        ) : (
          avatarNode
        )}

        <Text style={styles.name} numberOfLines={1}>{name}</Text>

        {visibleMeta.length > 0 ? (
          <View style={styles.metaRow}>
            {visibleMeta.map((item, i) => (
              <React.Fragment key={i}>
                {i > 0 ? <View style={styles.metaDot} /> : null}
                <Text style={styles.metaText}>{item}</Text>
              </React.Fragment>
            ))}
          </View>
        ) : city ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={13} color={colors.textMuted} />
            <Text style={[styles.metaText, { marginLeft: 4 }]}>{city}</Text>
          </View>
        ) : null}

        {bio ? <Text style={styles.bio} numberOfLines={4}>{bio}</Text> : null}

        {actions ? <View style={styles.actionsWrap}>{actions}</View> : null}
      </View>
    </View>
  );
}

/** Reusable header button — translucent dark circle that sits over the cover. */
export function FacebookHeroButton({
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
