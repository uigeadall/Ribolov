import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import AsyncStorage from '../storage/kv';
import { AppColors, darkColors, lightColors } from '../theme/palette';

const STORAGE_KEY = '@ribolov/theme-mode';
// Ключът на премахнатата accent-система (преди '@ribolov/accent-theme');
// чистим го еднократно при стартиране.
const LEGACY_ACCENT_KEY = '@ribolov/accent-theme';

type ThemeContextValue = {
  colors: AppColors;
  mode: 'light' | 'dark';
  setMode: (m: 'light' | 'dark') => void;
  toggleMode: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'dark' || v === 'light') setModeState(v);
    });
    AsyncStorage.removeItem(LEGACY_ACCENT_KEY).catch(() => undefined);
  }, []);

  const setMode = useCallback((m: 'light' | 'dark') => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => undefined);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const colors = useMemo(() => (mode === 'dark' ? darkColors : lightColors), [mode]);

  const value = useMemo(
    () => ({ colors, mode, setMode, toggleMode }),
    [colors, mode, setMode, toggleMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme трябва да е в ThemeProvider');
  return ctx;
}
