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
};

/** Fallback за ErrorBoundary извън ThemeProvider */
export const lightColorsLegacy = lightColors;
