/**
 * Unit tests for src/i18n/i18n.ts
 *
 * Runs in the `node` Jest project (pure JS, no native modules).
 *
 * What is tested:
 *   - i18n.t() returns the correct English strings on default locale.
 *   - Switching to Spanish returns the correct Spanish strings.
 *   - enableFallback: missing keys fall through to English rather than
 *     throwing or returning the raw key path.
 *   - resolveLocale() maps BCP-47 tags to supported locale codes.
 *   - SUPPORTED_LOCALES contains 'en' and 'es'.
 *   - LOCALE_STORAGE_KEY is a stable string constant.
 */

// Re-import from the shared instance so each test mutates the same object
// (matching runtime behaviour where one I18n instance is shared app-wide).
import i18n, {
  LOCALE_STORAGE_KEY,
  resolveLocale,
  SUPPORTED_LOCALES,
} from '../i18n';

beforeEach(() => {
  // Reset to English before each test to avoid ordering dependencies.
  i18n.locale = 'en';
});

// ── SUPPORTED_LOCALES ────────────────────────────────────────────────────────

describe('SUPPORTED_LOCALES', () => {
  it('contains en and es', () => {
    expect(SUPPORTED_LOCALES).toContain('en');
    expect(SUPPORTED_LOCALES).toContain('es');
  });

  it('has exactly 2 entries (the two PoC languages)', () => {
    expect(SUPPORTED_LOCALES).toHaveLength(2);
  });
});

// ── LOCALE_STORAGE_KEY ───────────────────────────────────────────────────────

describe('LOCALE_STORAGE_KEY', () => {
  it('is a non-empty string', () => {
    expect(typeof LOCALE_STORAGE_KEY).toBe('string');
    expect(LOCALE_STORAGE_KEY.length).toBeGreaterThan(0);
  });

  it('is stable (never accidentally renamed)', () => {
    expect(LOCALE_STORAGE_KEY).toBe('latch_locale');
  });
});

// ── resolveLocale ────────────────────────────────────────────────────────────

describe('resolveLocale', () => {
  it('returns "en" for "en"', () => {
    expect(resolveLocale('en')).toBe('en');
  });

  it('returns "en" for "en-US" (strips region tag)', () => {
    expect(resolveLocale('en-US')).toBe('en');
  });

  it('returns "en" for "en-GB"', () => {
    expect(resolveLocale('en-GB')).toBe('en');
  });

  it('returns "es" for "es"', () => {
    expect(resolveLocale('es')).toBe('es');
  });

  it('returns "es" for "es-MX"', () => {
    expect(resolveLocale('es-MX')).toBe('es');
  });

  it('returns "es" for "es-419"', () => {
    expect(resolveLocale('es-419')).toBe('es');
  });

  it('returns null for an unsupported language ("fr")', () => {
    expect(resolveLocale('fr')).toBeNull();
  });

  it('returns null for an unsupported language ("zh-Hant")', () => {
    expect(resolveLocale('zh-Hant')).toBeNull();
  });

  it('is case-insensitive for the base tag', () => {
    expect(resolveLocale('EN')).toBe('en');
    expect(resolveLocale('ES')).toBe('es');
  });
});

// ── English translations ─────────────────────────────────────────────────────

describe('English translations (default)', () => {
  it('translates profile section headers', () => {
    expect(i18n.t('profile.sections.account')).toBe('Account');
    expect(i18n.t('profile.sections.security')).toBe('Security');
    expect(i18n.t('profile.sections.preferences')).toBe('Preferences');
    expect(i18n.t('profile.sections.support')).toBe('Support');
  });

  it('translates account setting labels', () => {
    expect(i18n.t('profile.account.myProfile')).toBe('My Profile');
    expect(i18n.t('profile.account.myAccounts')).toBe('My Accounts');
    expect(i18n.t('profile.account.addressBook')).toBe('Address Book');
    expect(i18n.t('profile.account.recoveryPhrase')).toBe('Recovery Phrase');
  });

  it('translates security setting labels', () => {
    expect(i18n.t('profile.security.walletBackup')).toBe('Wallet Backup');
    expect(i18n.t('profile.security.signers')).toBe('Signers');
    expect(i18n.t('profile.security.permissions')).toBe('Permissions');
  });

  it('translates preferences labels', () => {
    expect(i18n.t('profile.preferences.network')).toBe('Network');
    expect(i18n.t('profile.preferences.notifications')).toBe('Notifications');
    expect(i18n.t('profile.preferences.language')).toBe('Language');
  });

  it('translates support labels', () => {
    expect(i18n.t('profile.support.helpSupport')).toBe('Help & Support');
    expect(i18n.t('profile.support.about')).toBe('About Latch');
    expect(i18n.t('profile.support.privacyPolicy')).toBe('Privacy Policy');
  });

  it('translates language sheet strings', () => {
    expect(i18n.t('languageSheet.title')).toBe('Language');
    expect(i18n.t('languageSheet.languages.en')).toBe('English');
    expect(i18n.t('languageSheet.languages.es')).toBe('Spanish');
  });
});

// ── Spanish translations ──────────────────────────────────────────────────────

describe('Spanish translations', () => {
  beforeEach(() => {
    i18n.locale = 'es';
  });

  it('translates profile section headers', () => {
    expect(i18n.t('profile.sections.account')).toBe('Cuenta');
    expect(i18n.t('profile.sections.security')).toBe('Seguridad');
    expect(i18n.t('profile.sections.preferences')).toBe('Preferencias');
    expect(i18n.t('profile.sections.support')).toBe('Soporte');
  });

  it('translates account setting labels', () => {
    expect(i18n.t('profile.account.myProfile')).toBe('Mi Perfil');
    expect(i18n.t('profile.account.recoveryPhrase')).toBe('Frase de Recuperación');
  });

  it('translates language sheet strings', () => {
    expect(i18n.t('languageSheet.title')).toBe('Idioma');
    expect(i18n.t('languageSheet.languages.en')).toBe('Inglés');
    expect(i18n.t('languageSheet.languages.es')).toBe('Español');
  });
});

// ── Fallback behaviour ───────────────────────────────────────────────────────

describe('fallback behaviour', () => {
  it('falls back to English for a key that exists in en but not in a hypothetical locale', () => {
    // Temporarily switch to a locale that has no translations registered.
    // i18n-js's enableFallback should return the English string.
    i18n.locale = 'fr'; // not a supported locale — no translations
    const result = i18n.t('profile.sections.account');
    // Should fall back to English, not crash or return a missing-key marker.
    expect(result).toBe('Account');
    i18n.locale = 'en'; // restore
  });

  it('does not throw for an unknown key — returns a missing indicator string', () => {
    expect(() => i18n.t('this.key.does.not.exist')).not.toThrow();
  });
});
