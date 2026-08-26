/**
 * English (en) translation strings.
 *
 * Scope note: this file covers the Profile screen and its bottom sheets as a
 * proof-of-concept. Full extraction of every hardcoded string across the app
 * is a separate, incremental effort (see issue #58).
 */
const en = {
  // ── Profile: section headers ─────────────────────────────────────────────
  profile: {
    sections: {
      account: 'Account',
      security: 'Security',
      preferences: 'Preferences',
      support: 'Support',
    },

    // ── Account items ───────────────────────────────────────────────────────
    account: {
      myProfile: 'My Profile',
      myAccounts: 'My Accounts',
      multisigWallets: 'Multisig Wallets',
      approveRequest: 'Approve a Request',
      addressBook: 'Address Book',
      recoveryPhrase: 'Recovery Phrase',
    },

    // ── Security items ──────────────────────────────────────────────────────
    security: {
      walletBackup: 'Wallet Backup',
      signers: 'Signers',
      permissions: 'Permissions',
    },

    // ── Preferences items ───────────────────────────────────────────────────
    preferences: {
      network: 'Network',
      notifications: 'Notifications',
      language: 'Language',
    },

    // ── Support items ───────────────────────────────────────────────────────
    support: {
      helpSupport: 'Help & Support',
      about: 'About Latch',
      privacyPolicy: 'Privacy Policy',
    },

    // ── Network values ──────────────────────────────────────────────────────
    network: {
      testnet: 'Testnet',
      mainnet: 'Public Network',
    },
  },

  // ── LanguageSheet ────────────────────────────────────────────────────────
  languageSheet: {
    title: 'Language',
    subtitle: 'Select your preferred language. Changes take effect immediately.',
    languages: {
      en: 'English',
      es: 'Spanish',
    },
  },
} as const;

export default en;
