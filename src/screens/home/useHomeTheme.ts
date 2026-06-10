import { useTheme } from '../../services/themeContext';

/**
 * Home design-token hook — the single source of the home screen's
 * "dark-premium grouped cards" language (2026-06-10 redesign):
 *
 *  - flat `surface` cards with 1px `hairline` borders
 *  - NO shadows except photo tiles, NO gradients except photo overlays
 *  - uppercase `typography.overline` micro-labels in `mutedColor`
 *  - big numerals (Nunito_800ExtraBold, 32–48pt, tight letterSpacing)
 *  - a single accent (teal on the ocean preset); no per-section accents
 *
 * Sections derive every theme-dependent value here instead of receiving
 * theme props or hardcoding colours.
 */
export function useHomeTheme() {
  const { colors, mode } = useTheme();
  const hairline = mode === 'dark' ? 'rgba(148,191,224,0.16)' : colors.border;
  return {
    colors,
    mode,
    bg:         colors.background,
    surface:    colors.card,
    hairline,
    /** Soft chip/tint fill behind accent-coloured content. */
    accentSoft: colors.accent + '1A',
    /** Ink used ON accent-filled surfaces (teal needs dark ink in dark mode). */
    onAccent:   mode === 'dark' ? '#04201C' : '#FFFFFF',
    textColor:  colors.text,
    mutedColor: colors.textMuted,
    primary:    colors.primary,
    accent:     colors.accent,
  };
}
