import React, { useMemo } from 'react';
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
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { marginBottom: spacing.md },
        hint: { ...typography.overline, color: colors.primary, marginBottom: spacing.xs },
        title: { ...typography.h3, fontSize: 18, color: colors.text },
        sub: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 22 },
      }),
    [colors]
  );

  return (
    <View style={styles.wrap}>
      {hint ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs }}>
          <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: colors.primary }} />
          <Text style={[styles.hint, { marginBottom: 0 }]} numberOfLines={2}>
            {hint}
          </Text>
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? (
        <Text style={styles.sub} numberOfLines={3}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}
