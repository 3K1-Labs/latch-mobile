// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'reference/*'],
  },
  {
    // The two modules that handle raw key material log through
    // src/lib/logger.ts instead of console, so "never log a key, a digest, or
    // even a length" is enforced rather than remembered. Console output lands
    // in the device log, readable over adb or Xcode.
    //
    // Deliberately narrow. The rest of the codebase still uses console
    // directly; widening this is a mechanical change worth doing separately
    // from a security fix, so a reviewer can see what actually changed here.
    files: ['src/lib/passkey-webauthn.ts', 'src/services/send-token.ts'],
    rules: {
      'no-console': 'error',
    },
  },
]);
