import { useTheme } from '../../services/themeContext';

/** Derives the theme-dependent colour values the home screen sections share,
    so each extracted section computes them identically instead of receiving
    eight theme props. Mirrors the locals that used to live in HomeScreen. */
export function useHomeTheme() {
  const { colors, mode } = useTheme();
  const heroGrad: [string, string, string] = mode === 'dark'
    ? ['#0A1E38', '#050C1A', '#030810']
    : ['#4EAEE0', '#1E7CC4', '#0D559A'];
  return {
    colors,
    mode,
    heroGrad,
    waveColor:  mode === 'dark' ? '#080E1A' : '#F2F8FF',
    cardBg:     mode === 'dark' ? '#0E1E35' : '#FFFFFF',
    cardBorder: mode === 'dark' ? 'rgba(74,168,232,0.15)' : 'rgba(21,112,184,0.10)',
    textColor:  colors.text,
    mutedColor: colors.textMuted,
    primary:    colors.primary,
    accent:     colors.accent,
  };
}
