/**
 * Spanish (es) translation strings.
 *
 * Scope note: this file covers the Profile screen and its bottom sheets as a
 * proof-of-concept. Full extraction of every hardcoded string across the app
 * is a separate, incremental effort (see issue #58).
 */
const es = {
  // ── Profile: section headers ─────────────────────────────────────────────
  profile: {
    sections: {
      account: 'Cuenta',
      security: 'Seguridad',
      preferences: 'Preferencias',
      support: 'Soporte',
    },

    // ── Account items ───────────────────────────────────────────────────────
    account: {
      myProfile: 'Mi Perfil',
      myAccounts: 'Mis Cuentas',
      multisigWallets: 'Carteras Multifirma',
      approveRequest: 'Aprobar Solicitud',
      addressBook: 'Libreta de Direcciones',
      recoveryPhrase: 'Frase de Recuperación',
    },

    // ── Security items ──────────────────────────────────────────────────────
    security: {
      walletBackup: 'Copia de Seguridad',
      signers: 'Firmantes',
      permissions: 'Permisos',
    },

    // ── Preferences items ───────────────────────────────────────────────────
    preferences: {
      network: 'Red',
      notifications: 'Notificaciones',
      language: 'Idioma',
    },

    // ── Support items ───────────────────────────────────────────────────────
    support: {
      helpSupport: 'Ayuda y Soporte',
      about: 'Acerca de Latch',
      privacyPolicy: 'Política de Privacidad',
    },

    // ── Network values ──────────────────────────────────────────────────────
    network: {
      testnet: 'Red de Pruebas',
      mainnet: 'Red Pública',
    },
  },

  // ── LanguageSheet ────────────────────────────────────────────────────────
  languageSheet: {
    title: 'Idioma',
    subtitle: 'Selecciona tu idioma preferido. Los cambios se aplican de inmediato.',
    languages: {
      en: 'Inglés',
      es: 'Español',
    },
  },
} as const;

export default es;
