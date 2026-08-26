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
