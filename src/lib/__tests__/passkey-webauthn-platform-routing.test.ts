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
        }
      : {
          credentialId: `latch_credential_id_${listIndex}`,
          keyDataHex: `latch_key_data_hex_${listIndex}`,
          privateKey: `latch_passkey_private_key_${listIndex}`,
          requiresBiometric: `latch_passkey_requires_biometric_${listIndex}`,
          kind: `latch_passkey_kind_${listIndex}`,
        };
  return {
    SECURE_KEYS: {
      CREDENTIAL_ID: 'latch_credential_id',
      KEY_DATA_HEX: 'latch_key_data_hex',
      PASSKEY_PRIVATE_KEY: 'latch_passkey_private_key',
      PASSKEY_REQUIRES_BIOMETRIC: 'latch_passkey_requires_biometric',
      PASSKEY_KIND: 'latch_passkey_kind',
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
    ];
    await Promise.all(keys.map((k) => SecureStore.deleteItemAsync(k)));
  });

  it('storePlatformPasskeyCredentialAtIndex stores credentialId/keyDataHex and marks kind=platform', async () => {
    await storePlatformPasskeyCredentialAtIndex(
      { credentialId: 'aabbcc', keyDataHex: '04' + '11'.repeat(64) + 'aabbcc' },
      0,
    );

    expect(await SecureStore.getItemAsync('latch_credential_id')).toBe('aabbcc');
    expect(await SecureStore.getItemAsync('latch_key_data_hex')).toBe('04' + '11'.repeat(64) + 'aabbcc');
    expect(await SecureStore.getItemAsync('latch_passkey_kind')).toBe('platform');
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
    await storePlatformPasskeyCredentialAtIndex({ credentialId: 'aabbcc', keyDataHex }, 0);

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

  it('getStoredPrivateKeyHex throws PASSKEY_IS_PLATFORM for a platform-kind credential', async () => {
    await storePlatformPasskeyCredentialAtIndex({ credentialId: 'aabbcc', keyDataHex: '04' + '00'.repeat(64) }, 0);

    await expect(getStoredPrivateKeyHex(0)).rejects.toThrow(/PASSKEY_IS_PLATFORM/);
  });

  it('redeployWithCurrentKey throws PASSKEY_IS_PLATFORM for a platform-kind credential', async () => {
    await storePlatformPasskeyCredentialAtIndex({ credentialId: 'aabbcc', keyDataHex: '04' + '00'.repeat(64) }, 0);

    await expect(redeployWithCurrentKey(0)).rejects.toThrow(/PASSKEY_IS_PLATFORM/);
  });
});
