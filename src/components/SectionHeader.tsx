import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../services/themeContext';
import { spacing, typography } from '../theme/typography';

type Props = {
  title: string;
  /** Кратък контекст над заглавието */
  hint?: string;
  /** По-светъл подзаглавен ред под заглавието */
  subtitle?: string;
};

export function SectionHeader({ title, hint, subtitle }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      {hint ? (
        <Text style={[styles.hint, { color: colors.primary }]} numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.sub, { color: colors.textMuted }]} numberOfLines={3}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  hint: { ...typography.overline, marginBottom: spacing.xs },
  title: { ...typography.h3, fontSize: 18 },
  sub: { ...typography.body, marginTop: spacing.xs, lineHeight: 22 },
});
