import React, { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

type Props = {
  /** Ionicon glyph for the default icon variant. Ignored when `emoji` is set. */
  icon: keyof typeof Ionicons.glyphMap;
  /** Brand emoji that replaces the Ionicon. Use for fishing-native contexts —
      e.g. 🎣 for "no catches", 🐟 for "no species", 🏆 for "no tournaments".
      Renders larger than the Ionicon since emoji glyphs are visually denser. */
  emoji?: string;
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ icon, emoji, title, subtitle, action }: Props) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  // Gentle vertical float — the icon drifts up ~4px and back, looking
  // like it's hovering. Decoupled from the pulse so the two phase-shift
  // and produce a slightly more organic motion.
  const float = useRef(new Animated.Value(0)).current;
  // Subtle tilt — only used when an emoji is rendered. Animations on the
  // Ionicon path stay rotation-free because most ionicons read as static
  // symbols and a tilt looks wrong.
  const tilt = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Capture every loop so we can stop them on unmount. Without this, an
    // EmptyState that shows/hides as data loads (e.g. swipe-to-refresh on
    // an empty list) accumulates orphaned loops that keep running off-screen
    // and burn CPU/battery.
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.07, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ]),
    );
    pulseLoop.start();

    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ]),
    );
    floatLoop.start();

    // tiltLoop only runs when emoji mode is active. We allow null so the
    // cleanup function can no-op cleanly without a branch.
    let tiltLoop: Animated.CompositeAnimation | null = null;
    if (emoji) {
      tiltLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(tilt, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(tilt, { toValue: -1, duration: 1400, useNativeDriver: true }),
        ]),
      );
      tiltLoop.start();
    }

    const ripple = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 1700, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const ring1Loop = ripple(ring1, 0);
    const ring2Loop = ripple(ring2, 850);
    ring1Loop.start();
    ring2Loop.start();

    return () => {
      pulseLoop.stop();
      floatLoop.stop();
      tiltLoop?.stop();
      ring1Loop.stop();
      ring2Loop.stop();
    };
  }, [pulse, ring1, ring2, float, tilt, emoji]);

  const ring1Scale = ring1.interpolate({ inputRange: [0, 1], outputRange: [1, 2.0] });
  const ring1Opacity = ring1.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.28, 0.1, 0] });
  const ring2Scale = ring2.interpolate({ inputRange: [0, 1], outputRange: [1, 2.0] });
  const ring2Opacity = ring2.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.28, 0.1, 0] });
  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  const tiltDeg = tilt.interpolate({ inputRange: [-1, 1], outputRange: ['-6deg', '6deg'] });

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
        ringWrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
        ring: {
          position: 'absolute',
          width: 64,
          height: 64,
          borderRadius: 32,
          borderWidth: 2,
          borderColor: colors.primary,
        },
        iconWrap: {
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.primarySurface,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.cardEdge,
        },
        emojiText: {
          fontSize: 34,
          // No lineHeight — emoji glyphs already include vertical padding.
        },
        title: { ...typography.h3, color: colors.text, textAlign: 'center' },
        subtitle: {
          ...typography.body,
          color: colors.textMuted,
          textAlign: 'center',
          marginTop: spacing.sm,
          lineHeight: 22,
        },
        actionBtn: {
          backgroundColor: colors.primary,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.xl,
          paddingVertical: 12,
          marginTop: spacing.lg,
        },
        actionBtnText: {
          ...typography.bodyBold,
          color: colors.white,
          textAlign: 'center',
        },
      }),
    [colors],
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.ringWrap}>
        <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />
        <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
        <Animated.View style={{ transform: [{ scale: pulse }, { translateY: floatY }] }}>
          <View style={styles.iconWrap}>
            {emoji ? (
              <Animated.Text style={[styles.emojiText, { transform: [{ rotate: tiltDeg }] }]}>
                {emoji}
              </Animated.Text>
            ) : (
              <Ionicons name={icon} size={30} color={colors.primary} />
            )}
          </View>
        </Animated.View>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {action ? (
        <Pressable style={styles.actionBtn} onPress={action.onPress}>
          <Text style={styles.actionBtnText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
