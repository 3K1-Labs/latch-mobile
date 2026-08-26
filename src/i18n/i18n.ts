/**
 * i18n initializer.
 *
 * Creates a single shared I18n instance pre-loaded with the supported
 * locales. The default locale is English; callers should set `i18n.locale`
 * before using `i18n.t()`.
 *
 * This module is intentionally free of native-module imports (no
 * expo-localization) so it can run in any environment — the React hook
 * layer (use-locale.ts) is responsible for reading the device locale and
 * the persisted preference and applying them here.
 */
import { I18n } from 'i18n-js';

import en from './en';
import es from './es';

/** Locale codes supported by the app. */
export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** AsyncStorage key used to persist the user's language choice. */
export const LOCALE_STORAGE_KEY = 'latch_locale';

/**
 * Map from two-letter BCP 47 tag (or longer tag like "es-MX") to a
 * supported locale code. Returns null when there is no match.
 */
export function resolveLocale(tag: string): SupportedLocale | null {
  const base = tag.split('-')[0].toLowerCase();
  if ((SUPPORTED_LOCALES as readonly string[]).includes(base)) {
    return base as SupportedLocale;
  }
  return null;
}

/** The single shared I18n instance for the whole app. */
const i18n = new I18n({ en, es });

// Fall back to English for any key that is missing in the active locale.
i18n.enableFallback = true;
i18n.defaultLocale = 'en';
i18n.locale = 'en';

export default i18n;
