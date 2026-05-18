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
  background: '#EBF5FF',
  surfaceAlt: '#D6EEFF',
  card: '#FFFFFF',
  cardEdge: '#C2DDEF',
  text: '#0A3060',
  textMuted: '#6AABDC',
  border: '#BCD8EF',
  primary: '#1570B8',
  primaryLight: '#2A8FD4',
  primaryDark: '#0D559A',
  primarySurface: '#DFF0FF',
  accent: '#F5890A',
  white: '#FFFFFF',
  overlay: 'rgba(10, 40, 80, 0.45)',
  success: '#00A86A',
  warning: '#D98C1A',
  danger: '#C93030',
  glassBorder: 'rgba(255,255,255,0.65)',
  glassOverlay: 'rgba(255,255,255,0.88)',
};

export const darkColors: AppColors = {
  background: '#050C1A',
  surfaceAlt: '#0A1428',
  card: '#0E1E35',
  cardEdge: '#1A3050',
  text: '#E4F2FF',
  textMuted: '#6AABDC',
  border: '#1C3555',
  primary: '#4AA8E8',
  primaryLight: '#6EC0F0',
  primaryDark: '#2A8FD4',
  primarySurface: '#0A1E38',
  accent: '#F5890A',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.6)',
  success: '#00D98E',
  warning: '#F0A830',
  danger: '#FF6B6B',
  glassBorder: 'rgba(74,168,232,0.22)',
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
    light: { primary: '#1570B8', primaryLight: '#2A8FD4', primaryDark: '#0D559A', primarySurface: '#DFF0FF', accent: '#F5890A' },
    dark:  { primary: '#4AA8E8', primaryLight: '#6EC0F0', primaryDark: '#2A8FD4', primarySurface: '#0A1E38', accent: '#F5890A' },
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
