/**
 * passkey-webauthn-assertion.test.ts
 *
 * Pins the shape of the assertion signWithPasskey hands to latch-api. The
 * backend rejects an assertion whose clientDataJSON.origin is not in
 * WEBAUTHN_ALLOWED_ORIGINS, and origin is spelled here — a change to this
 * string is a deployment-coupled change, not a cosmetic one.
 *
 * Native modules are mocked as in passkey-webauthn-platform-routing.test.ts;
 * signWithPasskey itself is pure JS (@noble/curves) and runs under Node.
 */

import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { b64uEncode } from '../base64url';
import { signWithPasskey } from '../passkey-webauthn';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
}));

jest.mock('react-native-quick-crypto', () => ({
  __esModule: true,
  default: { createECDH: jest.fn(), randomBytes: jest.fn() },
}));

jest.mock('react-native-passkey', () => ({
  Passkey: { create: jest.fn(), get: jest.fn(), isSupported: jest.fn(() => true) },
}));

jest.mock('@/src/store/wallet', () => ({
  SECURE_KEYS: {},
  getPasskeyStorageKeys: () => ({}),
}));

const RP_ID = 'latch.finance';
const PRIVATE_KEY_HEX = '4f'.repeat(32);

describe('signWithPasskey assertion shape', () => {
  const authDigest = new Uint8Array(32).fill(7);

  it('spells origin as the https:// form of the RP ID', async () => {
    const { clientDataJSON } = await signWithPasskey(PRIVATE_KEY_HEX, authDigest, RP_ID);
    const clientData = JSON.parse(Buffer.from(clientDataJSON).toString('utf8'));

    expect(clientData).toEqual({
      type: 'webauthn.get',
      challenge: b64uEncode(authDigest),
      origin: `https://${RP_ID}`,
    });
  });

  it('keeps rpIdHash on the bare RP ID', async () => {
    const { authenticatorData } = await signWithPasskey(PRIVATE_KEY_HEX, authDigest, RP_ID);

    expect(Buffer.from(authenticatorData.slice(0, 32))).toEqual(
      Buffer.from(sha256(new TextEncoder().encode(RP_ID))),
    );
    expect(authenticatorData[32]).toBe(0x05); // UP | UV
  });

  it('signs the digest latch-api reconstructs: SHA256(authData || SHA256(clientDataJSON))', async () => {
    const { authenticatorData, clientDataJSON, signature } = await signWithPasskey(
      PRIVATE_KEY_HEX,
      authDigest,
      RP_ID,
    );

    const digest = sha256(
      new Uint8Array([...authenticatorData, ...sha256(clientDataJSON)]),
    );
    const publicKey = p256.getPublicKey(Buffer.from(PRIVATE_KEY_HEX, 'hex'), false);

    expect(p256.verify(signature, digest, publicKey, { prehash: false })).toBe(true);
  });
});
