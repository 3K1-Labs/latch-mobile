/**
 * passkey-webauthn-platform-routing.test.ts
 *
 * passkey-webauthn.ts has no existing test coverage — it imports
 * expo-secure-store and react-native-quick-crypto, both native modules that
 * fail to load outright under plain Node (confirmed: `node -e
 * "require('expo-secure-store')"` throws). This suite mocks every native/heavy
 * dependency so the new kind='platform' routing added to
 * signWithStoredPasskeyAtIndex / getStoredPrivateKeyHex / redeployWithCurrentKey
 * (and the kind='local' write added to storePasskeyCredentialAtIndex) can run
 * and be checked directly, rather than left unverified.
 */

import * as crypto from 'crypto';

import * as SecureStore from 'expo-secure-store';
import { Passkey } from 'react-native-passkey';
import { b64uEncode } from '../base64url';
import {
  getStoredPrivateKeyHex,
  redeployWithCurrentKey,
  signWithStoredPasskeyAtIndex,
  storePasskeyCredentialAtIndex,
  storePlatformPasskeyCredentialAtIndex,
} from '../passkey-webauthn';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 'WHEN_PASSCODE_SET_THIS_DEVICE_ONLY',
  };
});

jest.mock('react-native-quick-crypto', () => ({
  __esModule: true,
  default: {
    createECDH: jest.fn(),
    randomBytes: jest.fn(),
  },
}));

jest.mock('react-native-passkey', () => ({
  Passkey: {
    create: jest.fn(),
    get: jest.fn(),
    isSupported: jest.fn(() => true),
  },
}));

jest.mock('@/src/store/wallet', () => {
  const keysForIndex = (listIndex: number) =>
    listIndex === 0
      ? {
          credentialId: 'latch_credential_id',
          keyDataHex: 'latch_key_data_hex',
          privateKey: 'latch_passkey_private_key',
          requiresBiometric: 'latch_passkey_requires_biometric',
          kind: 'latch_passkey_kind',
          rpId: 'latch_passkey_rp_id',
        }
      : {
          credentialId: `latch_credential_id_${listIndex}`,
          keyDataHex: `latch_key_data_hex_${listIndex}`,
          privateKey: `latch_passkey_private_key_${listIndex}`,
          requiresBiometric: `latch_passkey_requires_biometric_${listIndex}`,
          kind: `latch_passkey_kind_${listIndex}`,
          rpId: `latch_passkey_rp_id_${listIndex}`,
        };
  return {
    SECURE_KEYS: {
      CREDENTIAL_ID: 'latch_credential_id',
      KEY_DATA_HEX: 'latch_key_data_hex',
      PASSKEY_PRIVATE_KEY: 'latch_passkey_private_key',
      PASSKEY_REQUIRES_BIOMETRIC: 'latch_passkey_requires_biometric',
      PASSKEY_KIND: 'latch_passkey_kind',
      PASSKEY_RP_ID: 'latch_passkey_rp_id',
      SMART_ACCOUNT: 'latch_smart_account',
      DEPLOYED_KEY_DATA: 'latch_deployed_key_data',
    },
    getPasskeyStorageKeys: keysForIndex,
  };
});

describe('platform passkey routing in passkey-webauthn.ts', () => {
  afterEach(async () => {
    jest.clearAllMocks();
    // Reset the in-memory SecureStore between tests.
    const keys = [
      'latch_credential_id',
      'latch_key_data_hex',
      'latch_passkey_private_key',
      'latch_passkey_requires_biometric',
      'latch_passkey_kind',
      'latch_passkey_rp_id',
    ];
    await Promise.all(keys.map((k) => SecureStore.deleteItemAsync(k)));
  });

  it('storePlatformPasskeyCredentialAtIndex stores credentialId/keyDataHex and marks kind=platform', async () => {
    await storePlatformPasskeyCredentialAtIndex(
      { credentialId: 'aabbcc', keyDataHex: '04' + '11'.repeat(64) + 'aabbcc' },
      0,
      'latch.finance',
    );

    expect(await SecureStore.getItemAsync('latch_credential_id')).toBe('aabbcc');
    expect(await SecureStore.getItemAsync('latch_key_data_hex')).toBe('04' + '11'.repeat(64) + 'aabbcc');
    expect(await SecureStore.getItemAsync('latch_passkey_kind')).toBe('platform');
    // The RP the credential belongs to is recorded, so a later RP change is
    // detectable rather than an unexplained ceremony failure.
    expect(await SecureStore.getItemAsync('latch_passkey_rp_id')).toBe('latch.finance');
    // No private key is ever written for a platform passkey.
    expect(await SecureStore.getItemAsync('latch_passkey_private_key')).toBeNull();
  });

  it('storePasskeyCredentialAtIndex (local path) explicitly marks kind=local', async () => {
    await storePasskeyCredentialAtIndex(
      {
        credentialId: 'ddeeff',
        keyDataHex: '04' + '22'.repeat(64) + 'ddeeff',
        privateKeyHex: '33'.repeat(32),
        publicKeyHex: '04' + '22'.repeat(64),
      },
      0,
      false,
    );

    expect(await SecureStore.getItemAsync('latch_passkey_kind')).toBe('local');
  });

  it('signWithStoredPasskeyAtIndex routes to signWithPlatformPasskey when kind=platform', async () => {
    const keyDataHex = '04' + '44'.repeat(64) + 'aabbcc';
    await storePlatformPasskeyCredentialAtIndex({ credentialId: 'aabbcc', keyDataHex }, 0, 'latch.finance');

    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const payload = Buffer.from('auth digest bytes stand-in');
    const derSignature = crypto.sign('sha256', payload, privateKey);

    (Passkey.get as jest.Mock).mockResolvedValue({
      id: 'aabbcc',
      response: {
        authenticatorData: b64uEncode(new Uint8Array([1, 2, 3])),
        clientDataJSON: b64uEncode(new Uint8Array([4, 5, 6])),
        signature: b64uEncode(derSignature),
      },
    });

    const authDigest = new Uint8Array(32).fill(7);
    const { sig, keyDataHex: returnedKeyDataHex } = await signWithStoredPasskeyAtIndex(
      0,
      authDigest,
      'latch.finance',
    );

    expect(returnedKeyDataHex).toBe(keyDataHex);
    expect(sig.signature.length).toBe(64);
    // allowCredentials was restricted to this device's stored credential id.
    expect((Passkey.get as jest.Mock).mock.calls[0][0].allowCredentials).toEqual([
      { type: 'public-key', id: b64uEncode(Buffer.from('aabbcc', 'hex')) },
    ]);
  });

  it('signWithStoredPasskeyAtIndex refuses a platform credential minted under a different RP', async () => {
    // The exact drift that took passkey deploys down: the credential was created
    // under latch.finance, EXPO_PUBLIC_PASSKEY_RP_ID later moved to another
    // domain, and Credential Manager could no longer find it. The OS reports
    // only "no match", so the failure has to be caught here to be explainable.
    await storePlatformPasskeyCredentialAtIndex(
      { credentialId: 'aabbcc', keyDataHex: '04' + '55'.repeat(64) + 'aabbcc' },
      0,
      'latch.finance',
    );

    await expect(
      signWithStoredPasskeyAtIndex(0, new Uint8Array(32).fill(7), 'michaelesenwa.me'),
    ).rejects.toThrow(/created for "latch\.finance".*now configured for "michaelesenwa\.me"/s);

    // The doomed ceremony must not be raised at all — a passkey sheet the user
    // cannot satisfy is worse than an error that says what to do.
    expect(Passkey.get as jest.Mock).not.toHaveBeenCalled();
  });

  it('signWithStoredPasskeyAtIndex stamps the RP on a credential stored before it was recorded', async () => {
    const keyDataHex = '04' + '66'.repeat(64) + 'aabbcc';
    await storePlatformPasskeyCredentialAtIndex({ credentialId: 'aabbcc', keyDataHex }, 0, 'latch.finance');
    // Simulate a credential provisioned by an older build: kind is set, RP is not.
    await SecureStore.deleteItemAsync('latch_passkey_rp_id');

    const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const derSignature = crypto.sign('sha256', Buffer.from('payload'), privateKey);
    (Passkey.get as jest.Mock).mockResolvedValue({
      id: 'aabbcc',
      response: {
        authenticatorData: b64uEncode(new Uint8Array([1, 2, 3])),
        clientDataJSON: b64uEncode(new Uint8Array([4, 5, 6])),
        signature: b64uEncode(derSignature),
      },
    });

    await signWithStoredPasskeyAtIndex(0, new Uint8Array(32).fill(7), 'michaelesenwa.me');

    // The ceremony succeeded, which proves which RP this credential answers to.
    expect(await SecureStore.getItemAsync('latch_passkey_rp_id')).toBe('michaelesenwa.me');
  });

  it('getStoredPrivateKeyHex throws PASSKEY_IS_PLATFORM for a platform-kind credential', async () => {
    await storePlatformPasskeyCredentialAtIndex(
      { credentialId: 'aabbcc', keyDataHex: '04' + '00'.repeat(64) },
      0,
      'latch.finance',
    );

    await expect(getStoredPrivateKeyHex(0)).rejects.toThrow(/PASSKEY_IS_PLATFORM/);
  });

  it('redeployWithCurrentKey throws PASSKEY_IS_PLATFORM for a platform-kind credential', async () => {
    await storePlatformPasskeyCredentialAtIndex(
      { credentialId: 'aabbcc', keyDataHex: '04' + '00'.repeat(64) },
      0,
      'latch.finance',
    );

    await expect(redeployWithCurrentKey(0)).rejects.toThrow(/PASSKEY_IS_PLATFORM/);
  });

  it('storePasskeyCredentialAtIndex writes the private key before the public pointers', async () => {
    await storePasskeyCredentialAtIndex(
      {
        credentialId: 'ddeeff',
        keyDataHex: '04' + '22'.repeat(64) + 'ddeeff',
        privateKeyHex: '33'.repeat(32),
        publicKeyHex: '04' + '22'.repeat(64),
      },
      0,
      false,
    );

    // An interruption partway through this sequence must never leave public
    // pointers (credentialId/keyDataHex/kind) set without the private key
    // they promise — see signWithStoredPasskeyAtIndex's self-heal test below
    // for what happens if that invariant is ever violated some other way.
    const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls.map(([key]) => key);
    const privateKeyCallIndex = calls.indexOf('latch_passkey_private_key');
    const kindCallIndex = calls.indexOf('latch_passkey_kind');
    expect(privateKeyCallIndex).toBeGreaterThanOrEqual(0);
    expect(kindCallIndex).toBeGreaterThan(privateKeyCallIndex);
  });

  it('signWithStoredPasskeyAtIndex self-heals a corrupted local credential (public pointers with no private key)', async () => {
    // Simulate the exact corruption an interrupted storePasskeyCredential
    // write used to be able to produce: public pointers + kind='local'
    // present, but no private key ever written.
    await SecureStore.setItemAsync('latch_credential_id', 'ddeeff');
    await SecureStore.setItemAsync('latch_key_data_hex', '04' + '22'.repeat(64) + 'ddeeff');
    await SecureStore.setItemAsync('latch_passkey_requires_biometric', 'false');
    await SecureStore.setItemAsync('latch_passkey_kind', 'local');

    const authDigest = new Uint8Array(32).fill(1);
    await expect(signWithStoredPasskeyAtIndex(0, authDigest, 'latch.finance')).rejects.toThrow(
      /PASSKEY_CREDENTIAL_MISSING/,
    );

    // The corrupted pointers are cleared so the next attempt sees "nothing
    // here" and creates a fresh credential, instead of hitting this same
    // dead end forever.
    expect(await SecureStore.getItemAsync('latch_credential_id')).toBeNull();
    expect(await SecureStore.getItemAsync('latch_key_data_hex')).toBeNull();
    expect(await SecureStore.getItemAsync('latch_passkey_kind')).toBeNull();
  });
});
