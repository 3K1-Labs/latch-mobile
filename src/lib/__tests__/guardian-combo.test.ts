import { checkGuardianCombo } from '../guardian-combo';
import type { Guardian } from '@/src/services/social-recovery';

/**
 * A delegated (smart account) guardian authorises with a second, separate
 * Soroban auth entry signed by its own account — a mechanism that only has a
 * home in the sole-guardian submit path. Mixing one into any quorum produces
 * a rule nobody can ever finish signing, so this is the one combination the
 * app must never let reach chain.
 */

const ED: Guardian = { address: 'GAAA', kind: 'ed25519', publicKeyHex: 'aa'.repeat(32) };
const WA: Guardian = { address: 'GBBB', kind: 'passkey', keyDataHex: '04' + 'bb'.repeat(80) };
const DEL: Guardian = { address: 'CCCC', kind: 'delegated' };

describe('checkGuardianCombo', () => {
  it('allows an empty set', () => {
    expect(checkGuardianCombo([])).toEqual({ ok: true });
  });

  it('allows a delegated guardian alone', () => {
    expect(checkGuardianCombo([DEL])).toEqual({ ok: true });
  });

  it('allows any number of non-delegated guardians together', () => {
    expect(checkGuardianCombo([ED, WA])).toEqual({ ok: true });
  });

  it('rejects a delegated guardian alongside another guardian', () => {
    expect(checkGuardianCombo([DEL, ED])).toEqual({
      ok: false,
      reason: 'delegated-needs-sole',
    });
  });

  it('rejects regardless of where the delegated guardian sits in the list', () => {
    expect(checkGuardianCombo([ED, DEL, WA])).toEqual({
      ok: false,
      reason: 'delegated-needs-sole',
    });
  });
});
