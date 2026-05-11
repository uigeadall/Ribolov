import type { ViewStyle, TextStyle } from 'react-native';
import type { AppColors } from './palette';
import { radius, spacing } from './typography';

export function inputStyle(colors: AppColors): ViewStyle & TextStyle {
  return {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: 15,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
  };
}

export function chipStyle(colors: AppColors): ViewStyle {
  return {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  };
}

export function cardStyle(colors: AppColors): ViewStyle {
  return {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  };
}

export const commonShadow = {
  sm: {
    shadowColor: '#000' as const,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 } as const,
    elevation: 3,
  },
  md: {
    shadowColor: '#000' as const,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 } as const,
    elevation: 4,
  },
};
