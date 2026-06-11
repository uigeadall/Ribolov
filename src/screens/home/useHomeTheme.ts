import { useTheme } from '../../services/themeContext';

/**
 * Home design-token hook — the single source of the home screen's
 * "dark-premium grouped cards" language (2026-06-10 redesign):
 *
 *  - flat `surface` cards with 1px `hairline` borders
 *  - NO shadows except photo tiles, NO gradients except photo overlays
 *  - uppercase `typography.overline` micro-labels in `mutedColor`
 *  - big numerals (Manrope_800ExtraBold, 32–48pt, tight letterSpacing)
 *  - a single accent (teal on the ocean preset); no per-section accents
 *
 * Sections derive every theme-dependent value here instead of receiving
 * theme props or hardcoding colours.
 */
export function useHomeTheme() {
  const { colors, mode } = useTheme();
  return {
    colors,
    mode,
    bg:         colors.background,
    surface:    colors.card,
    hairline:   colors.cardEdge,
    /** Soft chip/tint fill behind accent-coloured content. */
    accentSoft: colors.accent + '1A',
    /** Ink used ON accent-filled surfaces (chartreuse always takes navy ink). */
    onAccent:   colors.onAccent,
    textColor:  colors.text,
    mutedColor: colors.textMuted,
    primary:    colors.primary,
    accent:     colors.accent,
  };
}
