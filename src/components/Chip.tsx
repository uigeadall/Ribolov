import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
  /** 'navy' — за chips върху navy ленти (header band / тъмни секции). */
  variant?: 'default' | 'navy';
  compact?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Единственият pill chip на приложението (филтри, сегменти, тагове).
 * Избран = primarySurface + primary; върху navy = плътен onNavy / прозрачен.
 */
export function Chip({ label, selected, onPress, icon, variant = 'default', compact, disabled, style }: Props) {
  const { colors } = useTheme();

  const onNavy = variant === 'navy';
  const bg = onNavy
    ? selected ? colors.onNavy : 'transparent'
    : selected ? colors.primarySurface : colors.card;
  const fg = onNavy
    ? selected ? colors.navy : colors.onNavyMuted
    : selected ? colors.primary : colors.textMuted;
  const borderColor = onNavy
    ? selected ? colors.onNavy : colors.onNavyMuted + '55'
    : selected ? colors.primary : colors.border;

  const body = (
    <>
      {icon ? <Ionicons name={icon} size={compact ? 12 : 14} color={fg} /> : null}
      <Text
        style={{
          ...typography.small,
          fontSize: compact ? 12 : 13,
          fontFamily: selected ? 'Manrope_700Bold' : 'Manrope_600SemiBold',
          color: fg,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </>
  );

  const baseStyle: StyleProp<ViewStyle> = [
    styles.chip,
    {
      backgroundColor: bg,
      borderColor,
      paddingVertical: compact ? 5 : 7,
      paddingHorizontal: compact ? spacing.sm + 2 : spacing.md,
    },
    disabled && { opacity: 0.5 },
    style,
  ];

  if (!onPress) return <View style={baseStyle}>{body}</View>;

  return (
    <Pressable
      onPress={() => { void Haptics.selectionAsync(); onPress(); }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [...(baseStyle as ViewStyle[]), pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
});
