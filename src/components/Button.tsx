import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
  StyleProp,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { shadowButton } from '../theme/shadows';

type Props = {
  title: string;
  onPress: () => void;
  onLongPress?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
};

export function Button({ title, onPress, onLongPress, variant = 'primary', loading, disabled, style, compact }: Props) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => {
    const bg =
      variant === 'secondary'
        ? colors.card
        : variant === 'danger'
          ? colors.danger
          : variant === 'ghost'
            ? 'transparent'
            : colors.accent;
    const fg =
      variant === 'secondary'
        ? colors.primary
        : variant === 'ghost'
          ? colors.textMuted
          : variant === 'danger'
            ? colors.white
            : colors.onAccent;
    const border =
      variant === 'secondary' || variant === 'ghost' ? colors.border : 'transparent';
    return StyleSheet.create({
      btn: {
        backgroundColor: bg,
        paddingVertical: compact ? spacing.sm : spacing.md + 2,
        paddingHorizontal: compact ? spacing.md : spacing.xl,
        borderRadius: radius.lg,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: variant === 'secondary' ? 1.5 : 0,
        borderColor: border,
        minHeight: compact ? 44 : 52,
        overflow: 'hidden',
        ...(variant === 'primary' ? shadowButton(mode) : {}),
      },
      text: { ...typography.bodyBold, fontSize: compact ? 15 : 16, color: fg },
      disabled: { opacity: 0.52 },
    });
  }, [colors, variant, compact, mode]);

  const isDisabled = disabled || loading;
  const indicatorColor =
    variant === 'secondary' || variant === 'ghost'
      ? colors.primary
      : variant === 'danger'
        ? colors.white
        : colors.onAccent;

  // Light impact haptic on every button tap. Universal "felt the press"
  // confirmation that doesn't fight with system audio/visual cues. Variant
  // = 'danger' gets a slightly stronger Medium so the user feels the
  // "are you sure?" weight of a destructive action.
  const tapHaptic = () => {
    void Haptics.impactAsync(
      variant === 'danger'
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Light,
    );
  };

  return (
    <Pressable
      onPress={() => { tapHaptic(); onPress(); }}
      onLongPress={onLongPress}
      disabled={isDisabled}
      android_ripple={{ color: variant === 'primary' ? `${colors.onAccent}22` : `${colors.primary}22` }}
      style={[styles.btn, isDisabled && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={indicatorColor} />
      ) : (
        <Text style={styles.text}>{title}</Text>
      )}
    </Pressable>
  );
}
