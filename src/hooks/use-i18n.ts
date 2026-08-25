import { useTranslation } from 'react-i18next';
import { getCurrentLanguage, SUPPORTED_LANGUAGES, type LanguageCode } from '../i18n/i18n';

/**
 * Convenience hook for i18n functionality.
 * Re-exports useTranslation with additional utilities.
 */
export function useI18n() {
  const { t, i18n } = useTranslation();

  return {
    /** Translate a key */
    t,
    /** Current language code (e.g., 'en', 'es') */
    language: getCurrentLanguage(),
    /** List of all supported languages */
    supportedLanguages: SUPPORTED_LANGUAGES,
    /** i18next instance (for advanced use) */
    i18n,
  };
}
