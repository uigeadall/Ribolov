import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppColors, darkColors, lightColors, AccentTheme, accentPresets } from '../theme/palette';

const STORAGE_KEY = '@ribolov/theme-mode';
const ACCENT_KEY = '@ribolov/accent-theme';

type ThemeContextValue = {
  colors: AppColors;
  mode: 'light' | 'dark';
  setMode: (m: 'light' | 'dark') => void;
  toggleMode: () => void;
  accent: AccentTheme;
  setAccent: (a: AccentTheme) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<'light' | 'dark'>('light');
  const [accent, setAccentState] = useState<AccentTheme>('ocean');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'dark' || v === 'light') setModeState(v);
    });
    AsyncStorage.getItem(ACCENT_KEY).then((v) => {
      if (v && v in accentPresets) setAccentState(v as AccentTheme);
    });
  }, []);

  const setMode = useCallback((m: 'light' | 'dark') => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => undefined);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const setAccent = useCallback((a: AccentTheme) => {
    setAccentState(a);
    AsyncStorage.setItem(ACCENT_KEY, a).catch(() => undefined);
  }, []);

  const colors = useMemo(() => {
    const base = mode === 'dark' ? darkColors : lightColors;
    const preset = accentPresets[accent][mode === 'dark' ? 'dark' : 'light'];
    return { ...base, ...preset };
  }, [mode, accent]);

  const value = useMemo(
    () => ({
      colors,
      mode,
      setMode,
      toggleMode,
      accent,
      setAccent,
    }),
    [colors, mode, setMode, toggleMode, accent, setAccent]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme трябва да е в ThemeProvider');
  return ctx;
}
