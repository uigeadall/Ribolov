import React, { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ icon, title, subtitle, action }: Props) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.07, duration: 1100, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ])
    ).start();

    const ripple = (anim: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, { toValue: 1, duration: 1700, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ])
      );
    ripple(ring1, 0).start();
    ripple(ring2, 850).start();
  }, [pulse, ring1, ring2]);

  const ring1Scale = ring1.interpolate({ inputRange: [0, 1], outputRange: [1, 2.0] });
  const ring1Opacity = ring1.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.28, 0.1, 0] });
  const ring2Scale = ring2.interpolate({ inputRange: [0, 1], outputRange: [1, 2.0] });
  const ring2Opacity = ring2.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.28, 0.1, 0] });

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
    [colors]
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.ringWrap}>
        <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />
        <Animated.View style={[styles.ring, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
        <Animated.View style={{ transform: [{ scale: pulse }] }}>
          <View style={styles.iconWrap}>
            <Ionicons name={icon} size={30} color={colors.primary} />
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
