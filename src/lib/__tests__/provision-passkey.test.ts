/**
 * provision-passkey.test.ts
 *
 * The fallback from a platform passkey to a device-only key is the difference
 * between a wallet that can be signed into on a second device and one that
 * cannot, so what it returns — and whether the user is told — is worth pinning.
 */

import { Alert } from 'react-native';
import { Passkey } from 'react-native-passkey';

import {
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
    (platformModule.isPlatformPasskeySupported as jest.Mock).mockReturnValue(true);
    (localAuth.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(localAuth.SecurityLevel.BIOMETRIC_STRONG);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('stores the OS credential and reports kind=platform', async () => {
    (platformModule.createPlatformPasskeyCredential as jest.Mock).mockResolvedValue(
      platformCredential,
    );

    const result = await provisionPasskeyAtIndex(0, { requireBiometric: true });

    expect(result).toEqual({ ...platformCredential, kind: 'platform' });
    expect(stored.platform).toEqual({ credential: platformCredential, index: 0 });
    expect(stored.local).toBeUndefined();
  });

  it('falls back to a device-only key and names the reason when the sheet is dismissed', async () => {
    (platformModule.createPlatformPasskeyCredential as jest.Mock).mockRejectedValue({
      error: 'UserCancelled',
      message: 'The user cancelled the request.',
    });

    const result = await provisionPasskeyAtIndex(2, { requireBiometric: false });

    expect(result.kind).toBe('local');
    expect(result.deviceOnlyReason).toBe('the system passkey sheet was dismissed');
    expect(result.keyDataHex).toBe(result.publicKeyHex + result.credentialId);
    expect(stored.local).toMatchObject({ index: 2, requireBiometric: false });
  });

  it('does not run the ceremony when the OS cannot', async () => {
    (platformModule.isPlatformPasskeySupported as jest.Mock).mockReturnValue(false);

    const result = await provisionPasskeyAtIndex(0, { requireBiometric: true });

    expect(platformModule.createPlatformPasskeyCredential).not.toHaveBeenCalled();
    expect(result.kind).toBe('local');
    expect(Passkey.create).not.toHaveBeenCalled();
  });
});

describe('describePasskeyFailure', () => {
  it.each([
    [{ error: 'NoCreateOption' }, 'no passkey provider is set up on this device'],
    [{ error: 'BadConfiguration' }, 'this build is not registered with latch.finance'],
    [{ message: 'boom' }, 'boom'],
    [{}, 'the system passkey sheet did not complete'],
  ])('%p -> %s', (err, expected) => {
    expect(describePasskeyFailure(err)).toBe(expected);
  });
});

describe('notifyIfDeviceOnly', () => {
  beforeEach(() => jest.clearAllMocks());

  it('says nothing for a platform passkey', () => {
    notifyIfDeviceOnly({ ...platformCredential, kind: 'platform' });
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('tells the user a device-only key will not sign in elsewhere', () => {
    notifyIfDeviceOnly({
      credentialId: 'aabb',
      publicKeyHex: '04',
      keyDataHex: '04aabb',
      kind: 'local',
      deviceOnlyReason: 'the system passkey sheet was dismissed',
    });

    const [, body] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(body).toContain('the system passkey sheet was dismissed');
    expect(body).toContain('iCloud Keychain');
    expect(body).toContain('Google Password Manager');
  });
});

/**
 * Class 2 (weak) biometrics — the Android-only case that made setup dead-end.
 *
 * expo-secure-store gates requireAuthentication on BIOMETRIC_STRONG, so asking
 * for it on a device whose only biometric is Class 2 throws ERROR_NO_HARDWARE
 * instead of degrading. The fallback that was supposed to rescue a failed
 * platform ceremony was itself the thing that threw, and the caller reported a
 * bare "Setup Failed" with the cause discarded.
 */
describe('biometric gate selection', () => {
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

  it('binds the key to the Keystore when a Class 3 biometric is enrolled', async () => {
    (localAuth.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(
      localAuth.SecurityLevel.BIOMETRIC_STRONG,
    );

    const result = await provisionPasskeyAtIndex(0, { requireBiometric: true });

    expect(result.biometricGate).toBe('keystore');
    expect(stored.local).toMatchObject({ requireBiometric: true });
  });

  it('stores without the Keystore gate on a Class 2-only device instead of throwing', async () => {
    (localAuth.getEnrolledLevelAsync as jest.Mock).mockResolvedValue(
      localAuth.SecurityLevel.BIOMETRIC_WEAK,
    );

    const result = await provisionPasskeyAtIndex(0, { requireBiometric: true });

    expect(result.biometricGate).toBe('app');
    // The regression: requireBiometric must NOT reach expo-secure-store here,
    // or it throws ERROR_NO_HARDWARE and provisioning dead-ends.
    expect(stored.local).toMatchObject({ requireBiometric: false });
  });

  it('reports gate=none when the caller never asked for a biometric', async () => {
    const result = await provisionPasskeyAtIndex(0, { requireBiometric: false });

    expect(result.biometricGate).toBe('none');
    expect(stored.local).toMatchObject({ requireBiometric: false });
  });

  it('survives a capability probe that throws, without gating on Keystore', async () => {
    (localAuth.getEnrolledLevelAsync as jest.Mock).mockRejectedValue(new Error('probe blew up'));

    const result = await provisionPasskeyAtIndex(0, { requireBiometric: true });

    expect(result.biometricGate).toBe('app');
    expect(stored.local).toMatchObject({ requireBiometric: false });
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
    });
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('describePasskeyFailure sentence folding', () => {
  it('lowercases and de-punctuates a native message so it reads mid-sentence', () => {
    const reason = describePasskeyFailure({
      message: 'Face ID is not available. Please try again.',
    });
    expect(reason).toBe('face ID is not available. Please try again');
  });

  it('leaves the mapped codes alone', () => {
    expect(describePasskeyFailure({ error: 'UserCancelled' })).toBe(
      'the system passkey sheet was dismissed',
    );
  });

  it.each([
    'RP ID cannot be validated',
    'The incoming request cannot be validated',
  ])('maps an Android Digital Asset Links failure (%s) to a specific reason', (message) => {
    const reason = describePasskeyFailure({ message });
    expect(reason).toContain('could not be verified against');
    expect(reason).toContain('assetlinks.json');
  });

  it('maps the iOS associated-domain failure the same way', () => {
    const reason = describePasskeyFailure({
      message: 'The operation couldn’t be completed. Application is not associated with domain.',
    });
    expect(reason).toContain('could not be verified against');
  });
});
