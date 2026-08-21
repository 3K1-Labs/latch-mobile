/**
 * guardian-combo.ts — whether a set of guardians can be installed together.
 *
 * Split out of social-recovery.ts on purpose: this logic is pure (no chain
 * read, no signing, no storage) but social-recovery.ts's module graph pulls
 * in expo-secure-store, react-native-quick-crypto, AsyncStorage, and several
 * more Expo native modules several imports deep — none of which exist under
 * plain Node, so a test importing checkGuardianCombo from there would need an
 * ever-growing mock list just to load the module. `import type` for Guardian
 * is erased at compile time, so this file pulls in none of that.
 */

import type { Guardian } from '@/src/services/social-recovery';

/**
 * Why a set of guardians cannot be installed together as one recovery rule.
 *
 *   delegated-needs-sole  a delegated (smart account) guardian is present
 *                         alongside at least one other guardian.
 */
export type GuardianComboFailure = 'delegated-needs-sole';

export type GuardianComboCheck =
  | { ok: true }
  | { ok: false; reason: GuardianComboFailure };

/**
 * Whether this set of guardians can be installed together as one recovery
 * rule.
 *
 * The one restriction: a delegated (C-address / smart account) guardian must
 * be the rule's ONLY guardian. Authorising as a delegated guardian needs a
 * second, separate Soroban auth entry built and signed by the guardian's own
 * account (buildDelegatedGuardianEntry, social-recovery.ts) — a mechanism
 * that exists only for a lone guardian's direct submission (submitAsGuardian).
 * A quorum above 1 gathers every guardian's signature into ONE shared entry
 * instead (recovery-cosign.ts / aggregateAndSubmit), which has nowhere to
 * attach that second entry. Mixing a delegated guardian into any quorum would
 * silently produce a rule nobody can ever finish signing.
 */
export function checkGuardianCombo(guardians: Guardian[]): GuardianComboCheck {
  const hasDelegated = guardians.some((g) => g.kind === 'delegated');
  if (hasDelegated && guardians.length > 1) {
    return { ok: false, reason: 'delegated-needs-sole' };
  }
  return { ok: true };
}
