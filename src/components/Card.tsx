import React, { useMemo } from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { useTheme } from '../services/themeContext';
import { radius, spacing } from '../theme/typography';
import { shadowCard } from '../theme/shadows';

export function Card({ children, style, ...rest }: ViewProps) {
  const { colors, mode } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          padding: spacing.lg,
          // Light mode: shadow only. Dark mode: subtle border + shadow.
          borderWidth: mode === 'dark' ? 1 : 0,
          borderColor: colors.cardEdge,
          ...shadowCard(mode),
        },
      }),
    [colors, mode]
  );
  return (
    <View style={[styles.wrap, style]} {...rest}>
      {children}
    </View>
  );
}
