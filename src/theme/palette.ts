/** Цветова система за светла / тъмна тема */
export type AppColors = {
  background: string;
  surfaceAlt: string;
  card: string;
  /** Контур около карти и панели (леко по-силен от border). */
  cardEdge: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  primaryLight: string;
  /** По-тъмен за сенки и акценти (напр. бутони). */
  primaryDark: string;
  /** Фон за филтри и chips около primary. */
  primarySurface: string;
  accent: string;
  white: string;
  overlay: string;
  success: string;
  warning: string;
  danger: string;
  /** Border colour for glassmorphism cards */
  glassBorder: string;
  /** Top-left highlight start for glass card gradient */
  glassOverlay: string;
};

export const lightColors: AppColors = {
  background: '#EEF5F7',
  surfaceAlt: '#E2EEF3',
  card: '#FFFFFF',
  cardEdge: '#C2DAE4',
  text: '#0A2028',
  textMuted: '#4F6E7A',
  border: '#C8DDE6',
  primary: '#006E8A',
  primaryLight: '#0094B8',
  primaryDark: '#004F64',
  primarySurface: '#D4EBF3',
  accent: '#00A86A',
  white: '#FFFFFF',
  overlay: 'rgba(10, 32, 40, 0.45)',
  success: '#00A86A',
  warning: '#D98C1A',
  danger: '#C93030',
  glassBorder: 'rgba(255,255,255,0.52)',
  glassOverlay: 'rgba(255,255,255,0.72)',
};

export const darkColors: AppColors = {
  background: '#050F12',
  surfaceAlt: '#0A1C22',
  card: '#0E2129',
  cardEdge: '#163040',
  text: '#E4F2F7',
  textMuted: '#6E9BAA',
  border: '#1C3A48',
  primary: '#00C4E8',
  primaryLight: '#33D4F0',
  primaryDark: '#0098B8',
  primarySurface: '#082030',
  accent: '#00D98E',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.6)',
  success: '#00D98E',
  warning: '#F0A830',
  danger: '#FF6B6B',
  glassBorder: 'rgba(0,196,232,0.16)',
  glassOverlay: 'rgba(255,255,255,0.055)',
};

/** Fallback за ErrorBoundary извън ThemeProvider */
export const lightColorsLegacy = lightColors;

export type AccentTheme = 'ocean' | 'forest' | 'sunset' | 'nordic' | 'midnight';

export const accentPresets: Record<AccentTheme, {
  label: string;
  emoji: string;
  light: Pick<AppColors, 'primary' | 'primaryLight' | 'primaryDark' | 'primarySurface' | 'accent'>;
  dark: Pick<AppColors, 'primary' | 'primaryLight' | 'primaryDark' | 'primarySurface' | 'accent'>;
}> = {
  ocean: {
    label: 'Океан',
    emoji: '🌊',
    light: { primary: '#006E8A', primaryLight: '#0094B8', primaryDark: '#004F64', primarySurface: '#D4EBF3', accent: '#00A86A' },
    dark:  { primary: '#00C4E8', primaryLight: '#33D4F0', primaryDark: '#0098B8', primarySurface: '#082030', accent: '#00D98E' },
  },
  forest: {
    label: 'Гора',
    emoji: '🌲',
    light: { primary: '#2D6A4F', primaryLight: '#40916C', primaryDark: '#1B4332', primarySurface: '#D8F3DC', accent: '#52B788' },
    dark:  { primary: '#52B788', primaryLight: '#74C69D', primaryDark: '#40916C', primarySurface: '#081C0E', accent: '#95D5B2' },
  },
  sunset: {
    label: 'Залез',
    emoji: '🌅',
    light: { primary: '#C05621', primaryLight: '#DD6B20', primaryDark: '#9C4221', primarySurface: '#FEEBC8', accent: '#D69E2E' },
    dark:  { primary: '#F6AD55', primaryLight: '#FBD38D', primaryDark: '#ED8936', primarySurface: '#2D1A08', accent: '#ECC94B' },
  },
  nordic: {
    label: 'Нордик',
    emoji: '❄️',
    light: { primary: '#2B6CB0', primaryLight: '#3182CE', primaryDark: '#2C5282', primarySurface: '#EBF8FF', accent: '#805AD5' },
    dark:  { primary: '#63B3ED', primaryLight: '#90CDF4', primaryDark: '#4299E1', primarySurface: '#0A1A2B', accent: '#B794F4' },
  },
  midnight: {
    label: 'Полунощ',
    emoji: '🌙',
    light: { primary: '#553C9A', primaryLight: '#6B46C1', primaryDark: '#44337A', primarySurface: '#FAF5FF', accent: '#D53F8C' },
    dark:  { primary: '#B794F4', primaryLight: '#D6BCFA', primaryDark: '#9F7AEA', primarySurface: '#1A0B2E', accent: '#F687B3' },
  },
};
