import React, { useRef } from 'react';
import { StyleSheet, View, ViewProps, Pressable, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../services/themeContext';
import { radius, spacing } from '../theme/typography';
import { shadowCard } from '../theme/shadows';

type GlassCardProps = ViewProps & { onPress?: () => void };

export function GlassCard({ children, style, onPress, ...rest }: GlassCardProps) {
  const { colors, mode } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const outer = [{ borderRadius: radius.lg, ...shadowCard(mode) }, style];

  const inner = (
    <View style={outer} {...rest}>
      <View style={{ borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.glassBorder }}>
        <LinearGradient
          colors={
            mode === 'dark'
              ? ['rgba(255,255,255,0.07)', 'rgba(255,255,255,0.02)']
              : ['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.55)']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={{ padding: spacing.lg }}>{children}</View>
      </View>
    </View>
  );

  if (!onPress) return inner;

  const onPressIn = () =>
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 5 }).start();

  return (
    <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
      <Animated.View style={{ transform: [{ scale }] }}>{inner}</Animated.View>
    </Pressable>
  );
}
