import React, { useMemo } from 'react';
import { Pressable, View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  iconTint?: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
};

export function ListRow({ icon, iconTint, title, subtitle, onPress }: Props) {
  const { colors } = useTheme();
  const tint = iconTint ?? colors.primary;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.md,
          paddingVertical: spacing.md + 2,
          paddingHorizontal: spacing.sm,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          marginBottom: spacing.sm,
        },
        iconWrap: {
          width: 46,
          height: 46,
          borderRadius: radius.md,
          backgroundColor: colors.primarySurface,
          alignItems: 'center',
          justifyContent: 'center',
        },
        title: { ...typography.bodyBold, color: colors.text },
        sub: { ...typography.caption, color: colors.textMuted, marginTop: 3, lineHeight: 18 },
      }),
    [colors]
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      android_ripple={{ color: `${colors.primary}22` }}
      style={({ pressed }) => [styles.row, pressed && { opacity: Platform.OS === 'ios' ? 0.92 : 1 }]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={23} color={tint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
    </Pressable>
  );
}
