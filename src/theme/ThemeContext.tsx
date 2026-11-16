import * as eva from '@eva-design/eva';
import { ThemeProvider as RestyleThemeProvider } from '@shopify/restyle';
import { ApplicationProvider } from '@ui-kitten/components';
import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { useAppearanceStore, type AppearancePreference } from '@/src/store/appearance';
import { darkTheme, lightTheme } from './theme';

type ColorMode = 'light' | 'dark';

interface ThemeContextValue {
  /** The mode actually on screen, after resolving 'system'. */
  colorMode: ColorMode;
  isDark: boolean;
  preference: AppearancePreference;
  setPreference: (preference: AppearancePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  colorMode: 'dark',
  isDark: true,
  preference: 'system',
  setPreference: () => {},
});

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useAppearanceStore((s) => s.preference);
  const setPreference = useAppearanceStore((s) => s.setPreference);
  const system = useColorScheme();

  // An unknown system scheme falls back to dark, the app's original look.
  const colorMode: ColorMode =
    preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;
  const isDark = colorMode === 'dark';

  const value = useMemo(
    () => ({ colorMode, isDark, preference, setPreference }),
    [colorMode, isDark, preference, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ApplicationProvider {...eva} theme={isDark ? eva.dark : eva.light}>
        <RestyleThemeProvider theme={isDark ? darkTheme : lightTheme}>{children}</RestyleThemeProvider>
      </ApplicationProvider>
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
