import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useState } from 'react';

import { AppColors, VestroColorsAmethyst, VestroColorsDark, VestroColorsLight } from '@/constants/theme';

export type ColorScheme = 'light' | 'dark' | 'amethyst';

const STORAGE_KEY = 'vestro-color-scheme';

export type ThemeContextValue = {
  scheme: ColorScheme;
  colors: AppColors;
  setScheme: (scheme: ColorScheme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const SCHEME_COLORS: Record<ColorScheme, AppColors> = {
  light: VestroColorsLight,
  dark: VestroColorsDark,
  amethyst: VestroColorsAmethyst,
};

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>('amethyst');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'amethyst') setSchemeState(saved);
    });
  }, []);

  function setScheme(next: ColorScheme) {
    setSchemeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }

  const colors = SCHEME_COLORS[scheme];

  return (
    <ThemeContext.Provider value={{ scheme, colors, setScheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useAppTheme must be used within an AppThemeProvider');
  return context;
}
