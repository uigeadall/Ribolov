/** Цветова система за светла / тъмна тема — "Navy & Chartreuse" */
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
  /**
   * Шартрьоз — единственият action цвят на марката. САМО за запълване
   * (бутони, табове, маркери) с `onAccent` мастило върху него — НИКОГА
   * като текст върху светъл фон (контраст ~2:1).
   */
  accent: string;
  /** Мастило върху accent (тъмно нави — ~8:1 върху шартрьоз). */
  onAccent: string;
  /** Нави лента — фон за header band и долната навигация. */
  navy: string;
  /** Текст/икони върху navy. */
  onNavy: string;
  /** Заглушен текст/икони върху navy (неактивни табове и др.). */
  onNavyMuted: string;
  /** Неактивни стълбчета в графики (до primary за активните). */
  chartDim: string;
  white: string;
  overlay: string;
  success: string;
  warning: string;
  danger: string;
};

export const lightColors: AppColors = {
  background: '#F5F7F9',
  surfaceAlt: '#EBEFF2',
  card: '#FFFFFF',
  cardEdge: '#DFE5EA',
  text: '#13294B',
  textMuted: '#5B6B7E',
  border: '#E3E8ED',
  // Teal-700 step — teal as TEXT needs this depth for AA (~4.6:1 on white)
  primary: '#0F766E',
  primaryLight: '#14B8B8',
  primaryDark: '#0B5C5C',
  primarySurface: '#DFF5F5',
  accent: '#14B8B8',
  onAccent: '#13294B',
  navy: '#13294B',
  onNavy: '#FFFFFF',
  onNavyMuted: '#7E93AB',
  chartDim: '#CBD5DE',
  white: '#FFFFFF',
  overlay: 'rgba(19, 41, 75, 0.45)',
  success: '#1E9E6A',
  warning: '#D98C1A',
  danger: '#F05D5E',
};

export const darkColors: AppColors = {
  background: '#0C1929',
  surfaceAlt: '#10202F',
  card: '#142639',
  cardEdge: '#273D58',
  text: '#E9EFF5',
  textMuted: '#93A7BB',
  border: '#1F3247',
  primary: '#3ECFCF',
  primaryLight: '#6BDCDC',
  primaryDark: '#22ABAB',
  primarySurface: '#0F2B33',
  accent: '#22C9C9',
  onAccent: '#0C1929',
  navy: '#0B1B30',
  onNavy: '#FFFFFF',
  onNavyMuted: '#7E93AB',
  chartDim: '#29415D',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.6)',
  success: '#34C98A',
  warning: '#E8A33A',
  danger: '#FF6B6B',
};

/** Fallback за ErrorBoundary извън ThemeProvider */
export const lightColorsLegacy = lightColors;
