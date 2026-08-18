import { Keypair } from '@stellar/stellar-sdk';

import { deriveWalletAtIndex, generateStellarWallet, restoreStellarWallet } from '../seed-wallet';

/**
 * Derivation is the one thing in this codebase that must never change
 * silently. A regression here does not throw — it produces a different,
 * perfectly valid wallet, and the user's funds are simply somewhere else.
 *
 * These vectors are SEP-0005 Test Case 1, taken from the specification rather
 * than from this implementation's own output, so the tests check conformance
 * to the standard instead of agreement with themselves.
 *
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0005.md
 */
const SEP0005_TEST_1 = {
  mnemonic: 'illness spike retreat truth genius clock brain pass fit cave bargain toe',
  addresses: [
    'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
    'GBAW5XGWORWVFE2XTJYDTLDHXTY2Q2MO73HYCGB3XMFMQ562Q2W2GJQX',
    'GAY5PRAHJ2HIYBYCLZXTHID6SPVELOOYH2LBPH3LD4RUMXUW3DOYTLXW',
    'GAOD5NRAEORFE34G5D4EOSKIJB6V4Z2FGPBCJNQI6MNICVITE6CSYIAE',
  ],
};

describe('SEP-0005 derivation', () => {
  it.each(SEP0005_TEST_1.addresses.map((address, index) => [index, address]))(
    'derives the published address at m/44\'/148\'/%i\'',
    (index, expected) => {
      expect(deriveWalletAtIndex(SEP0005_TEST_1.mnemonic, index as number).gAddress).toBe(expected);
    },
  );

  it('derives account 0 by default when restoring', () => {
    expect(restoreStellarWallet(SEP0005_TEST_1.mnemonic).gAddress).toBe(
      SEP0005_TEST_1.addresses[0],
    );
  });

  it('is deterministic across calls', () => {
    const a = deriveWalletAtIndex(SEP0005_TEST_1.mnemonic, 0);
    const b = deriveWalletAtIndex(SEP0005_TEST_1.mnemonic, 0);
    expect(a.gAddress).toBe(b.gAddress);
    expect(a.publicKeyHex).toBe(b.publicKeyHex);
  });

  it('gives every account index a distinct key', () => {
    const addresses = [0, 1, 2, 3, 4].map(
      (i) => deriveWalletAtIndex(SEP0005_TEST_1.mnemonic, i).gAddress,
    );
    expect(new Set(addresses).size).toBe(addresses.length);
  });
});

describe('wallet shape', () => {
  it('reports publicKeyHex as the raw 32-byte key behind the G-address', () => {
    const wallet = deriveWalletAtIndex(SEP0005_TEST_1.mnemonic, 0);

    expect(wallet.publicKeyHex).toHaveLength(64);
    expect(wallet.publicKeyHex).toMatch(/^[0-9a-f]+$/);
    // The smart account is deployed against publicKeyHex while the rest of the
    // app addresses the same key as a G-address; they must describe one key.
    expect(Keypair.fromPublicKey(wallet.gAddress).rawPublicKey().toString('hex')).toBe(
      wallet.publicKeyHex,
    );
  });

  it('returns a keypair that can sign', () => {
    const wallet = deriveWalletAtIndex(SEP0005_TEST_1.mnemonic, 0);
    const message = Buffer.from('latch');

    expect(wallet.keypair.verify(message, wallet.keypair.sign(message))).toBe(true);
  });
});

describe('generateStellarWallet', () => {
  it('produces a 12-word mnemonic that round-trips to the same account', () => {
    const generated = generateStellarWallet();

    expect(generated.mnemonic.split(' ')).toHaveLength(12);
    expect(restoreStellarWallet(generated.mnemonic).gAddress).toBe(generated.gAddress);
  });

  it('does not repeat itself', () => {
    expect(generateStellarWallet().mnemonic).not.toBe(generateStellarWallet().mnemonic);
  });
});
