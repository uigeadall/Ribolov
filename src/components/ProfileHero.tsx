import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import type { AppColors } from '../theme/palette';

type Props = {
  name: string;
  city?: string;
  bio?: string;
  photoUrl?: string;
  /** Single-character fallback when there's no avatar image. */
  initials: string;
  /** Slot for left header content — typically a back button or menu trigger. */
  topLeft?: React.ReactNode;
  /** Slot for right header content — gear, ellipsis, or chat icon. */
  topRight?: React.ReactNode;
  /** Optional small label between the avatar and name, e.g. "@handle" or "Твоят профил". */
  badge?: string;
  /** Called when the avatar is tapped — typically used on the user's own profile to pick a photo. */
  onPickAvatar?: () => void;
};

/** Outdoorsy fishing palette — dawn / dusk over water. Light mode goes from
    deep lake-blue at the top to a warm sunrise gold near the avatar; dark
    mode keeps the colors muted so the cover doesn't burn out in night use. */
function heroGradient(mode: 'dark' | 'light'): [string, string, string] {
  if (mode === 'dark') {
    return ['#0A1A2B', '#0E2235', '#115B7D'];
  }
  return ['#0E2235', '#16729B', '#1B7FA8'];
}

// Cover band height (above the avatar). Together with AVATAR_OVERLAP it
// determines the total visual height of the hero before the identity block.
const COVER_HEIGHT = 200;
const AVATAR_SIZE = 108;
const AVATAR_OVERLAP = 54; // half the avatar — how far it dips into the page below

function createStyles(colors: AppColors, topPad: number) {
  return StyleSheet.create({
    container: { position: 'relative' },
    cover: {
      width: '100%',
      height: COVER_HEIGHT + topPad,
      // Rounded bottom corners give the cover a soft, water-edge feel without
      // requiring an SVG wave dependency.
      borderBottomLeftRadius: 28,
      borderBottomRightRadius: 28,
      // No overflow:hidden — would clip the overlapping avatar. The gradient
      // itself is the only content inside the cover, so it fills the rounded
      // shape without leaking out.
      paddingTop: topPad + 8,
      paddingHorizontal: spacing.md,
    },
    // Subtle horizon line — a thin translucent stripe that hints at a horizon.
    horizon: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: 'rgba(255,255,255,0.12)',
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      minHeight: 40,
    },
    topSlotPlaceholder: { width: 40, height: 40 },
    // Avatar absolute-positioned from the TOP of the hero container so it
    // overlaps the bottom edge of the cover regardless of what content
    // follows. Using `bottom:` would resolve against the container which
    // grows with the identity text — that was the previous bug.
    // Absolute child of the row-positioned container: center via left: 50% +
    // negative marginLeft (alignSelf doesn't apply on absolute children of a
    // non-flex parent in RN).
    avatarWrap: {
      position: 'absolute',
      top: COVER_HEIGHT + topPad - AVATAR_OVERLAP,
      left: '50%',
      marginLeft: -AVATAR_SIZE / 2,
      width: AVATAR_SIZE,
      height: AVATAR_SIZE,
      borderRadius: AVATAR_SIZE / 2,
      backgroundColor: colors.card,
      borderWidth: 4,
      borderColor: colors.card,
      shadowColor: '#000',
      shadowOpacity: 0.22,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 6 },
      elevation: 10,
      overflow: 'hidden',
    },
    avatarImg: { width: '100%', height: '100%' },
    avatarFallback: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    avatarLetter: { color: '#fff', fontSize: 42, fontWeight: '800' },
    cameraDot: {
      position: 'absolute',
      bottom: 4,
      right: 4,
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.card,
    },

    identity: {
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingTop: 64, // clear the overlapping avatar
    },
    badge: {
      ...typography.caption,
      color: colors.primary,
      fontWeight: '700',
      backgroundColor: colors.primarySurface,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.pill,
      overflow: 'hidden',
      marginBottom: spacing.xs,
    },
    name: {
      ...typography.h2,
      color: colors.text,
      fontSize: 24,
      letterSpacing: -0.4,
      textAlign: 'center',
    },
    cityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 4,
    },
    cityText: { ...typography.caption, color: colors.textMuted, fontSize: 13 },
    bio: {
      ...typography.body,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 21,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.sm,
    },
  });
}

export function ProfileHero({
  name,
  city,
  bio,
  photoUrl,
  initials,
  topLeft,
  topRight,
  badge,
  onPickAvatar,
}: Props) {
  const { colors, mode } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, insets.top), [colors, insets.top]);
  const gradient = useMemo(() => heroGradient(mode), [mode]);

  // The avatar is absolute-positioned via styles.avatarWrap. We render it as
  // either a Pressable or a View depending on whether tap-to-pick is enabled —
  // styles apply directly to the outer element so the absolute layout is
  // identical in both cases.
  const AvatarContainer: React.ElementType = onPickAvatar ? Pressable : View;
  const avatarProps = onPickAvatar
    ? { onPress: onPickAvatar, accessibilityRole: 'button' as const, accessibilityLabel: 'Промени снимка на профила' }
    : {};
  const avatarNode = (
    <AvatarContainer style={styles.avatarWrap} {...avatarProps}>
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={styles.avatarImg}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={200}
          recyclingKey={photoUrl}
        />
      ) : (
        <View style={styles.avatarFallback}>
          <Text style={styles.avatarLetter}>{initials}</Text>
        </View>
      )}
      {onPickAvatar ? (
        <View style={styles.cameraDot} pointerEvents="none">
          <Ionicons name="camera" size={14} color="#fff" />
        </View>
      ) : null}
    </AvatarContainer>
  );

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={gradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.cover}
      >
        <View style={styles.topBar}>
          {topLeft ?? <View style={styles.topSlotPlaceholder} />}
          {topRight ?? <View style={styles.topSlotPlaceholder} />}
        </View>
        <View style={[styles.horizon, { top: insets.top + 60 }]} pointerEvents="none" />
      </LinearGradient>

      {avatarNode}

      <View style={styles.identity}>
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {city ? (
          <View style={styles.cityRow}>
            <Ionicons name="location-outline" size={14} color={colors.textMuted} />
            <Text style={styles.cityText}>{city}</Text>
          </View>
        ) : null}
        {bio ? <Text style={styles.bio}>{bio}</Text> : null}
      </View>
    </View>
  );
}

/** Reusable header button style for both profile screens — translucent circle
    over the cover gradient. Use with an Ionicon inside. */
export function HeroButton({
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
        backgroundColor: 'rgba(255,255,255,0.18)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name={icon} size={20} color="#fff" />
      {badge && badge > 0 ? (
        <View
          style={{
            position: 'absolute',
            top: 2,
            right: 2,
            minWidth: 16,
            height: 16,
            paddingHorizontal: 4,
            borderRadius: 8,
            backgroundColor: '#C77F12',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
