import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
};

export function EmptyState({ icon, title, subtitle }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
        iconWrap: {
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.primarySurface,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: spacing.md,
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
      }),
    [colors]
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={30} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}
