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
  background: '#F4F6F8',
  surfaceAlt: '#EAEEF3',
  card: '#FFFFFF',
  cardEdge: '#DDE3EA',
  text: '#0E2235',
  textMuted: '#55677A',
  border: '#E2E8EF',
  // Lake-blue, darkened from #1B7FA8 so body-size text/links pass AA (~4.8:1)
  primary: '#16729B',
  primaryLight: '#1B7FA8',
  primaryDark: '#115B7D',
  primarySurface: '#E3F1F7',
  accent: '#A3C520',
  onAccent: '#0E2235',
  navy: '#0E2235',
  onNavy: '#FFFFFF',
  onNavyMuted: '#8FA3B5',
  chartDim: '#C9D3DD',
  white: '#FFFFFF',
  overlay: 'rgba(14, 34, 53, 0.45)',
  success: '#1E8E5A',
  warning: '#C77F12',
  danger: '#C93030',
};

export const darkColors: AppColors = {
  background: '#0B1624',
  surfaceAlt: '#0F1D30',
  card: '#13243A',
  cardEdge: '#24395A',
  text: '#E8EEF4',
  textMuted: '#94A8BC',
  border: '#1E3252',
  primary: '#4FA8CE',
  primaryLight: '#74BEDC',
  primaryDark: '#2E8DB8',
  primarySurface: '#11293A',
  // Brightened a step so it carries on dark surfaces
  accent: '#B5D32E',
  onAccent: '#0B1624',
  navy: '#0A1A2B',
  onNavy: '#FFFFFF',
  onNavyMuted: '#7E93A8',
  chartDim: '#28405C',
  white: '#FFFFFF',
  overlay: 'rgba(0, 0, 0, 0.6)',
  success: '#34C98A',
  warning: '#E8A33A',
  danger: '#FF6B6B',
};

/** Fallback за ErrorBoundary извън ThemeProvider */
export const lightColorsLegacy = lightColors;
