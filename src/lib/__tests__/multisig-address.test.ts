import type { AccountSigner } from '../account-signers';
import {
  canonicalSignerKey,
  deriveMultisigSalt,
  generateMultisigNonce,
  multisigMembershipHash,
  sortSignersCanonical,
} from '../multisig-address';

/**
 * A shared wallet's address is derived from its salt, and its salt is derived
 * from the signer set and threshold. Every participating device computes both
 * independently and must arrive at the same answer, or they each watch a
 * different account and the wallet silently fractures.
 *
 * These are the properties that guarantee that agreement.
 */

const ED: AccountSigner = { kind: 'ed25519', publicKeyHex: 'aa'.repeat(32) };
const WA: AccountSigner = { kind: 'webauthn', keyDataHex: 'bb'.repeat(65) + 'cc'.repeat(16) };
const DEL: AccountSigner = {
  kind: 'delegated',
  address: 'GBZMWXEXYIVXTYTJF55KTXZ3DJJJJD5GJ3XBQPQ6IUWU6N5US6KX6G6J',
};

describe('sortSignersCanonical', () => {
  it('is independent of the order signers were collected in', () => {
    const a = sortSignersCanonical([ED, WA, DEL]);
    const b = sortSignersCanonical([DEL, ED, WA]);
    const c = sortSignersCanonical([WA, DEL, ED]);

    expect(a.map(canonicalSignerKey)).toEqual(b.map(canonicalSignerKey));
    expect(b.map(canonicalSignerKey)).toEqual(c.map(canonicalSignerKey));
  });

  it('drops duplicates so a signer cannot be counted twice toward a threshold', () => {
    expect(sortSignersCanonical([ED, WA, ED])).toHaveLength(2);
  });

  it('gives each signer kind a distinct canonical key', () => {
    const keys = [ED, WA, DEL].map(canonicalSignerKey);
    expect(new Set(keys).size).toBe(3);
  });
});

describe('deriveMultisigSalt', () => {
  const base = { signers: [ED, WA], threshold: 2 };

  it('is deterministic for the same set and threshold', () => {
    expect(deriveMultisigSalt(base).toString('hex')).toBe(deriveMultisigSalt(base).toString('hex'));
  });

  it('produces 32 bytes, the width the factory expects', () => {
    expect(deriveMultisigSalt(base)).toHaveLength(32);
  });

  // The salt must depend on the set, not on the order members happened to pair
  // in — otherwise two devices in the same wallet derive different addresses.
  it('ignores signer ordering', () => {
    expect(deriveMultisigSalt({ signers: [ED, WA], threshold: 2 }).toString('hex')).toBe(
      deriveMultisigSalt({ signers: [WA, ED], threshold: 2 }).toString('hex'),
    );
  });

  it('changes when the threshold changes', () => {
    expect(deriveMultisigSalt({ signers: [ED, WA], threshold: 1 }).toString('hex')).not.toBe(
      deriveMultisigSalt({ signers: [ED, WA], threshold: 2 }).toString('hex'),
    );
  });

  it('changes when the signer set changes', () => {
    expect(deriveMultisigSalt({ signers: [ED, WA], threshold: 2 }).toString('hex')).not.toBe(
      deriveMultisigSalt({ signers: [ED, DEL], threshold: 2 }).toString('hex'),
    );
  });

  // The nonce is what lets the same people open a second, distinct wallet.
  it('changes with the deploy nonce', () => {
    expect(deriveMultisigSalt({ ...base, nonceHex: 'aa' }).toString('hex')).not.toBe(
      deriveMultisigSalt({ ...base, nonceHex: 'bb' }).toString('hex'),
    );
  });

  it('rejects a threshold outside the signer count', () => {
    expect(() => deriveMultisigSalt({ signers: [ED, WA], threshold: 0 })).toThrow();
    expect(() => deriveMultisigSalt({ signers: [ED, WA], threshold: 3 })).toThrow();
  });

  it('rejects an empty signer set', () => {
    expect(() => deriveMultisigSalt({ signers: [], threshold: 1 })).toThrow();
  });
});

describe('generateMultisigNonce', () => {
  it('returns 16 bytes of hex', () => {
    expect(generateMultisigNonce()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('does not repeat', () => {
    const nonces = new Set(Array.from({ length: 50 }, generateMultisigNonce));
    expect(nonces.size).toBe(50);
  });
});

describe('multisigMembershipHash', () => {
  it('is independent of member ordering and surrounding whitespace', () => {
    expect(multisigMembershipHash([' alice', 'bob '], 2)).toBe(
      multisigMembershipHash(['bob', 'alice'], 2),
    );
  });

  it('distinguishes different thresholds over the same members', () => {
    expect(multisigMembershipHash(['alice', 'bob'], 1)).not.toBe(
      multisigMembershipHash(['alice', 'bob'], 2),
    );
  });
});
