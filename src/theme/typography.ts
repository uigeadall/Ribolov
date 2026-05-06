import { TextStyle } from 'react-native';

export const typography: Record<string, TextStyle> = {
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.6, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.35, lineHeight: 28 },
  h3: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.15, lineHeight: 22 },
  body: { fontSize: 16, fontWeight: '400' as const, letterSpacing: 0.08, lineHeight: 24 },
  bodyBold: { fontSize: 16, fontWeight: '600' as const, letterSpacing: 0.08, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400' as const, letterSpacing: 0.15, lineHeight: 19 },
  small: { fontSize: 12, fontWeight: '400' as const, letterSpacing: 0.18, lineHeight: 17 },
  /** Етикети над секции */
  overline: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};
