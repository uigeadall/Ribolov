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
import { AppColors, darkColors, lightColors } from '../theme/palette';

const STORAGE_KEY = '@ribolov/theme-mode';

type ThemeContextValue = {
  colors: AppColors;
  mode: 'light' | 'dark';
  setMode: (m: 'light' | 'dark') => void;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v === 'dark' || v === 'light') setModeState(v);
    });
  }, []);

  const setMode = useCallback((m: 'light' | 'dark') => {
    setModeState(m);
    AsyncStorage.setItem(STORAGE_KEY, m).catch(() => undefined);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const value = useMemo(
    () => ({
      colors: mode === 'dark' ? darkColors : lightColors,
      mode,
      setMode,
      toggleMode,
    }),
    [mode, setMode, toggleMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme трябва да е в ThemeProvider');
  return ctx;
}
