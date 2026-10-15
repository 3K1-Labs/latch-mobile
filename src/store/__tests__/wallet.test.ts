// wallet.ts's store actions pull in a wide import graph (RPC, Sentry via
// smart-account-deploy.ts, native storage modules) that only matters for the
// real app. Stub it all out so these tests exercise the store's own
// reconciliation logic against a controlled chain response, not a real one.

import { Device, useWalletStore, WalletAccount } from '@/src/store/wallet';

(globalThis as any).__DEV__ = false;

const mockFetchDefaultContextRule = jest.fn();
jest.mock('@/src/api/account-admin', () => ({
  fetchDefaultContextRule: (...args: unknown[]) => mockFetchDefaultContextRule(...args),
  fetchContextRuleSigners: jest.fn(),
}));

jest.mock('@/src/constants/config', () => ({
  STELLAR_FACTORY_ADDRESS: 'CFACTORYTEST',
  STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  STELLAR_RPC_URL: 'https://rpc.test',
  getNetworkId: jest.fn(() => 'testnet'),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/src/lib/account-network', () => ({
  findDeployedNetwork: jest.fn(),
}));
jest.mock('@/src/lib/sac-transfer-cache', () => ({
  clearSacTransferCache: jest.fn(),
}));
jest.mock('@/src/lib/seed-wallet', () => ({
  deriveWalletAtIndex: jest.fn(),
  restoreStellarWallet: jest.fn(),
}));

function baseAccount(overrides: Partial<WalletAccount>): WalletAccount {
  return {
    index: -1,
    name: 'Test account',
    gAddress: '',
    publicKeyHex: '',
    smartAccountAddress: null,
    image: null,
    devices: [],
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('updateAccountDevicesAt', () => {
  it('only touches the account at the given array position', async () => {
    // Passkey/shared/deployed accounts all share index: -1 — updateAccountDevicesAt
    // exists specifically so writing one doesn't clobber the others (see
    // updateAccountDevices, which matches by `index` and does exactly that).
    const deviceA: Device = {
      signerKey: 'webauthn:aa',
      label: 'A',
      kind: 'webauthn',
      keyDataHex: 'aa',
      onChainSignerId: 1,
      isLocal: true,
      pairedAt: '2024-01-01T00:00:00.000Z',
    };
    const deviceB: Device = {
      signerKey: 'webauthn:bb',
      label: 'B',
      kind: 'webauthn',
      keyDataHex: 'bb',
      onChainSignerId: 2,
      isLocal: true,
      pairedAt: '2024-01-01T00:00:00.000Z',
    };
    useWalletStore.setState({
      accounts: [
        baseAccount({ name: 'Account A', devices: [deviceA] }),
        baseAccount({ name: 'Account B', devices: [deviceB] }),
      ],
    });

    const newDeviceA: Device = { ...deviceA, label: 'A renamed' };
    await useWalletStore.getState().updateAccountDevicesAt(0, [newDeviceA]);

    const { accounts } = useWalletStore.getState();
    expect(accounts[0].devices).toEqual([newDeviceA]);
    expect(accounts[1].devices).toEqual([deviceB]); // untouched
  });
});

describe('syncSignersFromChain', () => {
  it('keeps a pending-removal device that is already gone on-chain', async () => {
    const pubHex = 'aa'.repeat(32);
    const backupKeyHex = 'bb'.repeat(32);

    const localDevice: Device = {
      signerKey: `ed25519:${pubHex}`,
      label: 'This Device',
      kind: 'ed25519',
      keyDataHex: pubHex,
      onChainSignerId: null, // stale — chain now reports a real id, forcing a backfill + persist
      isLocal: true,
      pairedAt: '2024-01-01T00:00:00.000Z',
    };
    const pendingRemovalDevice: Device = {
      signerKey: `webauthn:${backupKeyHex}`,
      label: 'Backup signer',
      kind: 'webauthn',
      keyDataHex: backupKeyHex,
      onChainSignerId: 5,
      isLocal: false,
      isBackupSigner: true,
      pairedAt: '2024-01-01T00:00:00.000Z',
      pendingConfirm: { txHash: 'removetxhash', contextRuleId: 0, action: 'remove' },
    };

    useWalletStore.setState({
      accounts: [
        baseAccount({
          index: 0,
          gAddress: 'GTEST',
          publicKeyHex: pubHex,
          smartAccountAddress: 'CSMARTACCOUNTTEST',
          devices: [localDevice, pendingRemovalDevice],
        }),
      ],
    });

    // The backup signer is already removed on-chain — only the local
    // ed25519 signer remains in the Default rule.
    mockFetchDefaultContextRule.mockResolvedValue({
      ruleId: 0,
      signers: [{ kind: 'ed25519', signerKey: `ed25519:${pubHex}`, keyDataHex: pubHex, signerId: 1 }],
      policies: [],
    });

    const ok = await useWalletStore.getState().syncSignersFromChain(0);

    expect(ok).toBe(true);
    const devices = useWalletStore.getState().accounts[0].devices ?? [];
    expect(devices).toHaveLength(2);
    expect(devices.find((d) => d.signerKey === pendingRemovalDevice.signerKey)).toMatchObject({
      pendingConfirm: { action: 'remove' },
    });
    expect(devices.find((d) => d.signerKey === localDevice.signerKey)).toMatchObject({
      onChainSignerId: 1,
    });
  });
});
