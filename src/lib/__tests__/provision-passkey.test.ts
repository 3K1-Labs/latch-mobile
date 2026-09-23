/**
 * provision-passkey.test.ts
 *
 * The local-key fallback is disabled: a synced platform passkey is the only
 * supported way to back a wallet, so a failed or unavailable OS ceremony must
 * surface as a rejection carrying the reason — never a silent device-only key.
 */

import { Alert } from 'react-native';
import { Passkey } from 'react-native-passkey';

import {
  clearProvisionedPasskeyAtIndex,
  describePasskeyFailure,
  notifyIfDeviceOnly,
  notifyIfWeakBiometricGate,
  provisionPasskeyAtIndex,
} from '../provision-passkey';

jest.mock('react-native', () => ({ Alert: { alert: jest.fn() } }));

jest.mock('react-native-passkey', () => ({
  Passkey: { create: jest.fn(), get: jest.fn(), isSupported: jest.fn(() => true) },
}));

jest.mock('react-native-quick-crypto', () => ({
  __esModule: true,
  default: {
    randomBytes: (n: number) => Buffer.alloc(n, 7),
    createECDH: jest.fn(),
  },
}));

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

// provision-passkey.ts reads/bumps a monotonic counter (PASSKEY_SEQ) to number
// passkeys in the OS credential manager. expo-secure-store is a native module
// that throws under plain Node, and @/src/store/wallet pulls it in transitively,
// so both are mocked here — same reason platform-passkey / passkey-webauthn are.
const mockSecureStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock('@/src/store/wallet', () => ({
  SECURE_KEYS: {
    PASSKEY_SEQ: 'latch_passkey_seq',
    PASSKEY_LABEL: 'latch_passkey_label',
    PASSKEY_LABEL_SEQ: 'latch_passkey_label_seq',
  },
  getPasskeyStorageKeys: (listIndex: number) => ({
    credentialId: `latch_credential_id_${listIndex}`,
    keyDataHex: `latch_key_data_hex_${listIndex}`,
    privateKey: `latch_passkey_private_key_${listIndex}`,
    requiresBiometric: `latch_passkey_requires_biometric_${listIndex}`,
    kind: `latch_passkey_kind_${listIndex}`,
    rpId: `latch_passkey_rp_id_${listIndex}`,
    label: `latch_passkey_label_${listIndex}`,
    labelSeq: `latch_passkey_label_seq_${listIndex}`,
  }),
}));

// Class 3 by default; individual tests drop it to Class 2 to exercise the
// Android path where Keystore cannot bind a key to a weak biometric.
jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(() => Promise.resolve(3)),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const localAuth = require('expo-local-authentication');

jest.mock('@/src/constants/config', () => ({ PASSKEY_RP_ID: 'latch.finance' }));

const stored: Record<string, unknown> = {};
jest.mock('../passkey-webauthn', () => ({
  createPasskeyCredential: () => ({
    credentialId: 'aabb',
    publicKeyHex: '04' + '11'.repeat(64),
    privateKeyHex: '22'.repeat(32),
    keyDataHex: '04' + '11'.repeat(64) + 'aabb',
  }),
  storePasskeyCredentialAtIndex: jest.fn((credential, index, requireBiometric) => {
    stored.local = { credential, index, requireBiometric };
    return Promise.resolve();
  }),
  storePlatformPasskeyCredentialAtIndex: jest.fn((credential, index) => {
    stored.platform = { credential, index };
    return Promise.resolve();
  }),
}));

const platformCredential = {
  credentialId: 'ccdd',
  publicKeyHex: '04' + '33'.repeat(64),
  keyDataHex: '04' + '33'.repeat(64) + 'ccdd',
};

jest.mock('../platform-passkey', () => ({
  isPlatformPasskeySupported: jest.fn(() => true),
  createPlatformPasskeyCredential: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const platformModule = require('../platform-passkey');

describe('provisionPasskeyAtIndex', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete stored.local;
    delete stored.platform;
    mockSecureStore.clear();
    (platformModule.isPlatformPasskeySupported as jest.Mock).mockReturnValue(true);
    (localAuth.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(localAuth.SecurityLevel.BIOMETRIC_STRONG);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('stores the OS credential and reports kind=platform', async () => {
    (platformModule.createPlatformPasskeyCredential as jest.Mock).mockResolvedValue(
      platformCredential,
    );

    const result = await provisionPasskeyAtIndex(0, { requireBiometric: true });

    expect(result).toEqual({
      ...platformCredential,
      kind: 'platform',
      passkeyName: 'Latch Wallet 1',
      seq: 1,
    });
    expect(stored.platform).toEqual({ credential: platformCredential, index: 0 });
    expect(stored.local).toBeUndefined();
  });

  it('numbers passkeys with a monotonic counter, not the list index', async () => {
    (platformModule.createPlatformPasskeyCredential as jest.Mock).mockResolvedValue(
      platformCredential,
    );

    await provisionPasskeyAtIndex(0, { requireBiometric: true });
    await provisionPasskeyAtIndex(0, { requireBiometric: true, accountLabel: 'Savings' });

    const [first, second] = (platformModule.createPlatformPasskeyCredential as jest.Mock).mock.calls;
    // Both fields carry the readable name — iOS shows user.name (not
    // displayName) in the iCloud Keychain entry.
    expect(first[0]).toMatchObject({ userName: 'Latch Wallet 1', userDisplayName: 'Latch Wallet 1' });
    // Second create at the same index still gets 2, and folds in the label.
    expect(second[0]).toMatchObject({
      userName: 'Savings (Latch 2)',
      userDisplayName: 'Savings (Latch 2)',
    });
  });

  it('does not advance the passkey counter when the ceremony fails', async () => {
    (platformModule.createPlatformPasskeyCredential as jest.Mock)
      .mockRejectedValueOnce({
        error: 'UserCancelled',
        message: 'The user cancelled the request.',
      })
      .mockResolvedValueOnce(platformCredential);

    await expect(provisionPasskeyAtIndex(0, { requireBiometric: true })).rejects.toThrow();
    // A dismissed sheet must not burn a number — the next real passkey is still
    // "Latch Wallet 1", and the counter only persists once a credential exists.
    expect(mockSecureStore.has('latch_passkey_seq')).toBe(false);

    const result = await provisionPasskeyAtIndex(0, { requireBiometric: true });
    expect(result.seq).toBe(1);
    expect(result.passkeyName).toBe('Latch Wallet 1');
    expect(mockSecureStore.get('latch_passkey_seq')).toBe('1');
  });

  it('still names the passkey when the seq counter cannot be read', async () => {
    (platformModule.createPlatformPasskeyCredential as jest.Mock).mockResolvedValue(
      platformCredential,
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-secure-store').getItemAsync as jest.Mock).mockRejectedValueOnce(
      new Error('keychain unavailable'),
    );

    await provisionPasskeyAtIndex(3, { requireBiometric: true });

    const [call] = (platformModule.createPlatformPasskeyCredential as jest.Mock).mock.calls;
    expect(call[0]).toMatchObject({ userName: 'Latch Wallet 1' });
  });

  it('rejects with the reason instead of falling back when the sheet is dismissed', async () => {
    (platformModule.createPlatformPasskeyCredential as jest.Mock).mockRejectedValue({
      error: 'UserCancelled',
      message: 'The user cancelled the request.',
    });

    await expect(provisionPasskeyAtIndex(2, { requireBiometric: false })).rejects.toThrow(
      'the system passkey sheet was dismissed',
    );
    expect(stored.local).toBeUndefined();
  });

  it('rejects without a device-only key when the OS cannot run the ceremony', async () => {
    (platformModule.isPlatformPasskeySupported as jest.Mock).mockReturnValue(false);

    await expect(provisionPasskeyAtIndex(0, { requireBiometric: true })).rejects.toThrow(
      /passkey provider/,
    );
    expect(platformModule.createPlatformPasskeyCredential).not.toHaveBeenCalled();
    expect(Passkey.create).not.toHaveBeenCalled();
    expect(stored.local).toBeUndefined();
  });
});

describe('clearProvisionedPasskeyAtIndex', () => {
  it('wipes every stored key for the slot so the next run reprovisions', async () => {
    const keys = [
      'latch_credential_id_0',
      'latch_key_data_hex_0',
      'latch_passkey_private_key_0',
      'latch_passkey_requires_biometric_0',
      'latch_passkey_kind_0',
      'latch_passkey_rp_id_0',
      'latch_passkey_label_0',
      'latch_passkey_label_seq_0',
    ];
    keys.forEach((k) => mockSecureStore.set(k, 'stale'));

    await clearProvisionedPasskeyAtIndex(0);

    keys.forEach((k) => expect(mockSecureStore.has(k)).toBe(false));
  });

  it('leaves another account slot untouched', async () => {
    mockSecureStore.set('latch_credential_id_0', 'stale');
    mockSecureStore.set('latch_credential_id_1', 'keep');

    await clearProvisionedPasskeyAtIndex(0);

    expect(mockSecureStore.has('latch_credential_id_0')).toBe(false);
    expect(mockSecureStore.get('latch_credential_id_1')).toBe('keep');
  });
});

describe('describePasskeyFailure', () => {
  it.each([
    [{ error: 'NoCreateOption' }, 'no passkey provider is set up on this device'],
    [{ error: 'BadConfiguration' }, 'this build is not registered with latch.finance'],
    [{ message: 'boom' }, 'boom'],
    [{}, 'the system passkey sheet did not complete'],
  ])('%p -> %s', (err, expected) => {
    expect(describePasskeyFailure(err, 'latch.finance')).toBe(expected);
  });
});

describe('notifyIfDeviceOnly', () => {
  beforeEach(() => jest.clearAllMocks());

  it('says nothing for a platform passkey', () => {
    notifyIfDeviceOnly({
      ...platformCredential,
      kind: 'platform',
      passkeyName: 'Latch Wallet 1',
      seq: 1,
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('tells the user a device-only key will not sign in elsewhere', () => {
    notifyIfDeviceOnly({
      credentialId: 'aabb',
      publicKeyHex: '04',
      keyDataHex: '04aabb',
      kind: 'local',
      deviceOnlyReason: 'the system passkey sheet was dismissed',
      passkeyName: 'Latch Wallet 1',
      seq: 1,
    });

    const [, body] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(body).toContain('the system passkey sheet was dismissed');
    expect(body).toContain('iCloud Keychain');
    expect(body).toContain('Google Password Manager');
  });
});

/**
 * With the local-key fallback disabled, a failed OS ceremony rejects no matter
 * what biometric the caller asked for — there is no device-only key left to
 * gate, and none of the expo-secure-store / Class 2 machinery is reached.
 */
describe('failed ceremony never yields a device-only key', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete stored.local;
    delete stored.platform;
    (platformModule.isPlatformPasskeySupported as jest.Mock).mockReturnValue(true);
    (platformModule.createPlatformPasskeyCredential as jest.Mock).mockRejectedValue({
      error: 'NoCreateOption',
    });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it.each([true, false])('rejects with requireBiometric=%s', async (requireBiometric) => {
    await expect(provisionPasskeyAtIndex(0, { requireBiometric })).rejects.toThrow(
      "Couldn't create a passkey",
    );
    expect(stored.local).toBeUndefined();
  });
});

describe('notifyIfWeakBiometricGate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('warns only when the gate fell back to the app level', () => {
    notifyIfWeakBiometricGate({
      credentialId: 'a',
      publicKeyHex: 'b',
      keyDataHex: 'ab',
      kind: 'local',
      biometricGate: 'app',
      passkeyName: 'Latch Wallet 1',
      seq: 1,
    });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for a Keystore-bound key', () => {
    notifyIfWeakBiometricGate({
      credentialId: 'a',
      publicKeyHex: 'b',
      keyDataHex: 'ab',
      kind: 'local',
      biometricGate: 'keystore',
      passkeyName: 'Latch Wallet 1',
      seq: 1,
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('describePasskeyFailure sentence folding', () => {
  it('lowercases and de-punctuates a native message so it reads mid-sentence', () => {
    const reason = describePasskeyFailure(
      { message: 'Face ID is not available. Please try again.' },
      'latch.finance',
    );
    expect(reason).toBe('face ID is not available. Please try again');
  });

  it('leaves the mapped codes alone', () => {
    expect(describePasskeyFailure({ error: 'UserCancelled' }, 'latch.finance')).toBe(
      'the system passkey sheet was dismissed',
    );
  });

  it.each([
    'RP ID cannot be validated',
    'The incoming request cannot be validated',
  ])('maps an Android Digital Asset Links failure (%s) to a specific reason', (message) => {
    const reason = describePasskeyFailure({ message }, 'latch.finance');
    expect(reason).toContain('could not be verified against');
    expect(reason).toContain('assetlinks.json');
  });

  it.each([
    // The literal string Android Credential Manager produces, seen in
    // production when a passkey deploy died between the challenge and the
    // assertion. It is not thrown by any JS dependency — it comes up from
    // native, so nothing mapped it before.
    'User canceled the selector',
    'User cancelled the selector',
    'androidx.credentials.exceptions.GetCredentialCancellationException',
  ])('maps the Android selector cancellation (%s) without guessing why', (message) => {
    const reason = describePasskeyFailure({ message }, 'michaelesenwa.me');
    // Both readings, because Credential Manager reports a dismissed sheet and
    // a sheet with nothing to show identically.
    expect(reason).toContain('dismissed');
    expect(reason).toContain('no passkey for michaelesenwa.me');
  });

  it('maps the iOS associated-domain failure the same way', () => {
    const reason = describePasskeyFailure(
      { message: 'The operation couldn’t be completed. Application is not associated with domain.' },
      'latch.finance',
    );
    expect(reason).toContain('could not be verified against');
  });
});
