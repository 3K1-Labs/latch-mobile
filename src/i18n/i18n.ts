import * as Localization from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './locales/en.json';
import es from './locales/es.json';

const LANGUAGE_KEY = 'latch_selected_language';

/**
 * Available languages in the app.
 * Add new languages here as they're implemented.
 */
export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]['code'];

const resources = {
  en: { translation: en },
  es: { translation: es },
};

/**
 * Get the persisted language choice, or fall back to device locale.
 */
async function getInitialLanguage(): Promise<LanguageCode> {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (saved && SUPPORTED_LANGUAGES.some((l) => l.code === saved)) {
      return saved as LanguageCode;
    }
  } catch {
    // Ignore storage errors
  }

  // Fallback to device locale
  const deviceLocale = Localization.getLocales()[0]?.languageCode || 'en';
  const match = SUPPORTED_LANGUAGES.find((l) => l.code === deviceLocale);
  return (match?.code || 'en') as LanguageCode;
}

/**
 * Initialize i18next with persisted language or device locale.
 * Must be called before the app renders.
 */
export async function initI18n(): Promise<void> {
  const language = await getInitialLanguage();

  await i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    compatibilityJSON: 'v3', // React Native compatibility
    interpolation: {
      escapeValue: false, // React already escapes
    },
    react: {
      useSuspense: false, // Avoid suspense in React Native
    },
  });
}

/**
 * Change the app language and persist the choice.
 */
export async function changeLanguage(languageCode: LanguageCode): Promise<void> {
  await i18n.changeLanguage(languageCode);
  await AsyncStorage.setItem(LANGUAGE_KEY, languageCode);
}

/**
 * Get the current language code.
 */
export function getCurrentLanguage(): LanguageCode {
  return (i18n.language || 'en') as LanguageCode;
}

export default i18n;
