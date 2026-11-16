import { useAppTheme } from '@/src/theme/ThemeContext';

/** Status bar content colour for the active theme: light icons on dark, dark on light. */
export function useStatusBarStyle(): 'light' | 'dark' {
  const { isDark } = useAppTheme();
  return isDark ? 'light' : 'dark';
}
