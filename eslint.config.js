// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'reference/*'],
  },
  {
    // eslint-config-expo 57 turns on the React Compiler rule set, which flags
    // 204 pre-existing sites in this codebase — reading refs during render,
    // setState inside effects, and similar. They are worth fixing, but each one
    // is a change to render behaviour and doing them inside an SDK upgrade
    // would make both impossible to review.
    //
    // Kept visible as warnings so the count goes down rather than up. Promote
    // these back to errors once the backlog is cleared.
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/purity': 'warn',
    },
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
