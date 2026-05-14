import React, { useMemo, useRef } from 'react';
import { StyleSheet, View, ViewProps, Pressable, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../services/themeContext';
import { radius, spacing } from '../theme/typography';
import { shadowCard } from '../theme/shadows';

type CardProps = ViewProps & {
  onPress?: () => void;
};

export function Card({ children, style, onPress, ...rest }: CardProps) {
  const { colors, mode } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          padding: spacing.lg,
          borderWidth: mode === 'dark' ? 1 : 0,
          borderColor: colors.cardEdge,
          overflow: 'hidden',
          ...shadowCard(mode),
        },
      }),
    [colors, mode]
  );

  const sheen = (
    <LinearGradient
      colors={
        mode === 'dark'
          ? ['rgba(255,255,255,0.04)', 'transparent']
          : ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.38)']
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFillObject}
      pointerEvents="none"
    />
  );

  if (onPress) {
    const onPressIn = () =>
      Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 60, bounciness: 0 }).start();
    const onPressOut = () =>
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 5 }).start();

    return (
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
        <Animated.View style={[styles.wrap, style, { transform: [{ scale }] }]} {...rest}>
          {sheen}
          {children}
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <View style={[styles.wrap, style]} {...rest}>
      {sheen}
      {children}
    </View>
  );
}
