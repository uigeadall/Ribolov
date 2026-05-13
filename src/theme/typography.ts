import { TextStyle } from 'react-native';

export const typography: Record<string, TextStyle> = {
  h1: { fontSize: 28, fontFamily: 'DMSans_700Bold', letterSpacing: -0.5, lineHeight: 34 },
  h2: { fontSize: 22, fontFamily: 'DMSans_700Bold', letterSpacing: -0.3, lineHeight: 28 },
  h3: { fontSize: 17, fontFamily: 'DMSans_600SemiBold', letterSpacing: -0.1, lineHeight: 22 },
  body: { fontSize: 15, fontFamily: 'DMSans_400Regular', letterSpacing: 0.05, lineHeight: 22 },
  bodyBold: { fontSize: 15, fontFamily: 'DMSans_600SemiBold', letterSpacing: 0.05, lineHeight: 22 },
  caption: { fontSize: 13, fontFamily: 'DMSans_400Regular', letterSpacing: 0.1, lineHeight: 18 },
  small: { fontSize: 12, fontFamily: 'DMSans_400Regular', letterSpacing: 0.12, lineHeight: 16 },
  /** Етикети над секции */
  overline: {
    fontSize: 11,
    fontFamily: 'DMSans_600SemiBold',
    letterSpacing: 1.1,
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
