/**
 * Locale context and provider.
 *
 * Wraps the app so every consumer of `useLocale()` re-renders when the user
 * switches language — no restart required.
 *
 * Usage:
 *   // In _layout.tsx (or another high-level provider):
 *   <LocaleProvider>…</LocaleProvider>
 *
 *   // In any component:
 *   const { t, locale, setLocale } = useLocale();
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

import i18n, {
  LOCALE_STORAGE_KEY,
  resolveLocale,
  SUPPORTED_LOCALES,
  SupportedLocale,
} from '@/src/i18n/i18n';

// expo-localization is a native Expo module — import lazily so the pure-node
// Jest environment can still load this file during tests.
let getLocales: (() => { languageTag: string }[]) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  getLocales = require('expo-localization').getLocales as () => { languageTag: string }[];
} catch {
  // Native module unavailable (e.g. plain Node test env) — fall back to 'en'.
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read the device's preferred locale (first tag returned by expo-localization). */
function deviceLocale(): SupportedLocale {
  if (getLocales) {
    const [first] = getLocales();
    if (first) {
      const resolved = resolveLocale(first.languageTag);
      if (resolved) return resolved;
    }
  }
  return 'en';
}

/** Load the persisted locale from AsyncStorage, falling back to the device locale. */
async function loadStoredLocale(): Promise<SupportedLocale> {
  try {
    const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored && (SUPPORTED_LOCALES as readonly string[]).includes(stored)) {
      return stored as SupportedLocale;
    }
  } catch {
    // storage unavailable — treat as no preference
  }
  return deviceLocale();
}

// ── Context ──────────────────────────────────────────────────────────────────

interface LocaleContextValue {
  /** Active locale code, e.g. 'en' | 'es'. */
  locale: SupportedLocale;
  /** Translate a dot-notation key, e.g. t('profile.sections.account'). */
  t: (key: string, options?: Record<string, unknown>) => string;
  /** Switch locale, persist to AsyncStorage, and trigger a re-render. */
  setLocale: (next: SupportedLocale) => Promise<void>;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'en',
  t: (key) => i18n.t(key),
  setLocale: async () => {},
});

// ── Provider ─────────────────────────────────────────────────────────────────

interface LocaleProviderProps {
  children: React.ReactNode;
  /** Override initial locale (useful in tests). */
  initialLocale?: SupportedLocale;
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(initialLocale ?? 'en');
  const [ready, setReady] = useState(initialLocale !== undefined);

  // On mount, resolve the locale from storage / device preference.
  useEffect(() => {
    if (initialLocale !== undefined) return; // already set

    loadStoredLocale().then((resolved) => {
      i18n.locale = resolved;
      setLocaleState(resolved);
      setReady(true);
    });
  }, [initialLocale]);

  const setLocale = useCallback(async (next: SupportedLocale) => {
    i18n.locale = next;
    setLocaleState(next);
    try {
      await AsyncStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Non-fatal: the in-memory locale still switches; it just won't survive a
      // restart if storage is unavailable.
    }
  }, []);

  // A stable t() that binds to the current locale state (triggers re-renders
  // whenever `locale` changes because the context value is recreated).
  const t = useCallback(
    (key: string, options?: Record<string, unknown>) => i18n.t(key, options),
    // Re-create when locale changes so consumers re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  if (!ready) {
    // Avoid rendering children before the locale is resolved to prevent a
    // flash of untranslated content. The caller's splash screen covers this gap.
    return null;
  }

  return (
    <LocaleContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Returns `{ locale, t, setLocale }` from the nearest LocaleProvider.
 *
 * Must be used inside a <LocaleProvider>.
 */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}
