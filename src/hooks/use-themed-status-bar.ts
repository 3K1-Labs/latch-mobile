import { useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AppState, InteractionManager, Platform, StatusBar } from 'react-native';

import { useAppTheme } from '@/src/theme/ThemeContext';

// Covers the native stack's own 0.4s status-bar appearance animation.
const SETTLE_MS = 500;

// Routes drawn dark in both themes ('' is the splash at app/index.tsx).
const ALWAYS_DARK_ROUTES = new Set(['']);

/**
 * Keeps the iOS status bar matched to the active theme. Every screen's
 * <StatusBar> asks for the right style, but on iOS the native bar can drift
 * after a navigation (seen landing on the tabs), and RN never re-sends: it only
 * calls native when its merged JS value changes, which it hasn't. Re-asserting
 * after each route change, theme change and foreground closes that gap.
 */
export function useThemedStatusBar(): void {
  const route = useSegments().join('/');
  const { isDark } = useAppTheme();
  const barStyle = isDark || ALWAYS_DARK_ROUTES.has(route) ? 'light-content' : 'dark-content';

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const apply = () => StatusBar.setBarStyle(barStyle, false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const interaction = InteractionManager.runAfterInteractions(() => {
      apply();
      timer = setTimeout(apply, SETTLE_MS);
    });
    return () => {
      interaction.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [route, barStyle]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') StatusBar.setBarStyle(barStyle, false);
    });
    return () => sub.remove();
  }, [barStyle]);
}
