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
  background: '#F2F7FA',
  surfaceAlt: '#E8F1F5',
  card: '#FFFFFF',
  cardEdge: '#D0E2EB',
  text: '#0E2A33',
  textMuted: '#5B7580',
  border: '#D5E3EA',
  primary: '#0E4D64',
  primaryLight: '#1A7A9C',
  primaryDark: '#093545',
  primarySurface: '#DCECF2',
  accent: '#2E9B5A',
  white: '#FFFFFF',
  overlay: 'rgba(14, 42, 51, 0.45)',
  success: '#2E9B5A',
  warning: '#E8A83A',
  danger: '#D64545',
};

export const darkColors: AppColors = {
  background: '#0D1518',
  surfaceAlt: '#152428',
  card: '#1A2E34',
  cardEdge: '#243942',
  text: '#E8F4F8',
  textMuted: '#8FA8B3',
  border: '#2A4049',
  primary: '#4BA3C3',
  primaryLight: '#7BBFD6',
  primaryDark: '#2D6F87',
  primarySurface: '#1E3A44',
  accent: '#5FD39A',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.55)',
  success: '#5FD39A',
  warning: '#E8C547',
  danger: '#FF8A8A',
};

/** Fallback за ErrorBoundary извън ThemeProvider */
export const lightColorsLegacy = lightColors;
