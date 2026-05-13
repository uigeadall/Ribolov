import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../services/themeContext';
import { radius, spacing, typography } from '../theme/typography';
import { shadowButton } from '../theme/shadows';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
};

export function Button({ title, onPress, variant = 'primary', loading, disabled, style, compact }: Props) {
  const { colors, mode } = useTheme();
  const styles = useMemo(() => {
    const bg =
      variant === 'secondary'
        ? colors.card
        : variant === 'danger'
          ? colors.danger
          : variant === 'ghost'
            ? 'transparent'
            : 'transparent'; // primary: gradient handles bg
    const fg =
      variant === 'secondary'
        ? colors.primary
        : variant === 'ghost'
          ? colors.textMuted
          : variant === 'danger'
            ? colors.white
            : colors.white;
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
    variant === 'secondary' || variant === 'ghost' ? colors.primary : colors.white;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      android_ripple={{ color: variant === 'primary' ? 'rgba(255,255,255,0.2)' : `${colors.primary}22` }}
      style={[styles.btn, isDisabled && styles.disabled, style]}
    >
      {variant === 'primary' && (
        <LinearGradient
          colors={[colors.primaryLight, colors.primaryDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
      )}
      {loading ? (
        <ActivityIndicator color={indicatorColor} />
      ) : (
        <Text style={styles.text}>{title}</Text>
      )}
    </Pressable>
  );
}
