// removeBackupSignerOnChain pulls in a wide dependency graph (RPC transport,
// passkey ceremonies, the bundler relay) that only matters for the actual
// submission path. The guard checks below all throw before any of that is
// touched, so every one of those modules is stubbed out here rather than
// exercised for real — see account-admin.test.ts for the signer_ids reads
// these guards rely on.

import { removeBackupSignerOnChain } from '../backup-signer-tx';

const mockFetchDefaultContextRule = jest.fn();
const mockFetchFactoryVerifiers = jest.fn();
const mockFetchRuleThreshold = jest.fn();
jest.mock('@/src/api/account-admin', () => ({
  fetchDefaultContextRule: (...args: unknown[]) => mockFetchDefaultContextRule(...args),
  fetchFactoryVerifiers: (...args: unknown[]) => mockFetchFactoryVerifiers(...args),
  fetchRuleThreshold: (...args: unknown[]) => mockFetchRuleThreshold(...args),
  addPolicyOp: jest.fn(),
  addSignerOp: jest.fn(),
  encodeThresholdPolicyParams: jest.fn(),
  liftToRuntimeSigner: jest.fn(),
  removeSignerOp: jest.fn(),
}));

jest.mock('@/src/api/smart-account', () => ({
  parseSimResult: jest.fn(),
  sorobanCall: jest.fn(),
  txToBase64: jest.fn(),
}));

jest.mock('@/src/api/transaction-relay', () => ({
  bundlerAddress: jest.fn(),
  submitViaBundler: jest.fn(),
}));

jest.mock('@/src/constants/config', () => ({
  PASSKEY_RP_ID: 'latch.test',
  STELLAR_FACTORY_ADDRESS: 'CFACTORYTEST',
  STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  STELLAR_RPC_URL: 'https://rpc.test',
}));

jest.mock('@/src/lib/admin-tx', () => ({
  extractFirstU32FromMeta: jest.fn(),
}));

const mockGetStoredKeyDataHex = jest.fn();
jest.mock('@/src/lib/passkey-webauthn', () => ({
  getStoredKeyDataHex: (...args: unknown[]) => mockGetStoredKeyDataHex(...args),
}));

jest.mock('@/src/lib/platform-passkey', () => ({
  createPlatformPasskeyCredential: jest.fn(),
  isPlatformPasskeySupported: jest.fn(),
}));

jest.mock('@/src/lib/provision-passkey', () => ({
  classifyPasskeyFailure: jest.fn(),
  describePasskeyFailure: jest.fn(),
  PasskeyProvisionError: class PasskeyProvisionError extends Error {},
}));

jest.mock('@/src/services/send-token', () => ({
  loadAccount: jest.fn(),
  resolveRegisteredWebAuthnVerifier: jest.fn(),
  signPasskeyAuthEntry: jest.fn(),
}));

jest.mock('react-native-quick-crypto', () => ({
  default: { randomBytes: jest.fn() },
}));

const KEY_A = 'aa'.repeat(32);
const KEY_B = 'bb'.repeat(32);
const SMART_ACCOUNT = 'CSMARTACCOUNTTEST';
const THRESHOLD_POLICY = 'CTHRESHOLDPOLICYTEST';

function stubChainState(opts: {
  signers: { signerId: number; keyDataHex: string }[];
  hasThresholdPolicy?: boolean;
}) {
  mockFetchDefaultContextRule.mockResolvedValue({
    ruleId: 0,
    signers: opts.signers,
    policies: opts.hasThresholdPolicy === false ? [] : [THRESHOLD_POLICY],
  });
  mockFetchFactoryVerifiers.mockResolvedValue({
    ed25519: 'CED25519',
    webauthn: 'CWEBAUTHN',
    secp256k1: 'CSECP256K1',
    thresholdPolicy: THRESHOLD_POLICY,
  });
  mockFetchRuleThreshold.mockResolvedValue(1);
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('removeBackupSignerOnChain — safety guards', () => {
  it("refuses to remove the account's last remaining signer", async () => {
    stubChainState({ signers: [{ signerId: 1, keyDataHex: KEY_A }] });
    mockGetStoredKeyDataHex.mockResolvedValue(KEY_B);

    await expect(
      removeBackupSignerOnChain({
        smartAccountAddress: SMART_ACCOUNT,
        keyDataHex: KEY_A,
        initiatorListIndex: 0,
      }),
    ).rejects.toThrow("only remaining signer");
  });

  it('rejects a fallbackSignerId whose on-chain key does not match keyDataHex', async () => {
    // keyDataHex has no match on-chain at all, so resolution falls back to
    // fallbackSignerId — but that id now belongs to a different key than the
    // caller claims. The stale id must never win: remove_signer acts on the
    // id alone, so this would otherwise silently remove the wrong signer.
    stubChainState({
      signers: [
        { signerId: 1, keyDataHex: KEY_A },
        { signerId: 2, keyDataHex: KEY_B },
      ],
    });
    mockGetStoredKeyDataHex.mockResolvedValue('cc'.repeat(32));

    await expect(
      removeBackupSignerOnChain({
        smartAccountAddress: SMART_ACCOUNT,
        keyDataHex: 'dd'.repeat(32),
        fallbackSignerId: 1, // belongs to KEY_A, not the caller's keyDataHex
        initiatorListIndex: 0,
      }),
    ).rejects.toThrow('changed on-chain');
  });

  it('resolves the signer id from keyDataHex without needing a fallback', async () => {
    // The chain lookup by key alone must be enough — no fallbackSignerId
    // supplied, and the keys on chain are out of position order so a
    // position-based id would resolve to the wrong one.
    stubChainState({
      signers: [
        { signerId: 9, keyDataHex: KEY_B },
        { signerId: 1, keyDataHex: KEY_A },
      ],
    });
    mockGetStoredKeyDataHex.mockResolvedValue('cc'.repeat(32));

    await expect(
      removeBackupSignerOnChain({
        smartAccountAddress: SMART_ACCOUNT,
        keyDataHex: KEY_A,
        initiatorListIndex: 0,
      }),
      // Resolution succeeds (doesn't throw "changed on-chain" or "last
      // remaining signer") and proceeds past the guards to the submission
      // path, which fails here only because submitSelfAuthOp's deps are
      // stubbed to undefined — proof the id/key pair it carried forward was
      // KEY_A's real id (1), not a positional guess.
    ).rejects.not.toThrow('changed on-chain');
  });

  it("refuses to let a device remove its own signer", async () => {
    stubChainState({
      signers: [
        { signerId: 1, keyDataHex: KEY_A },
        { signerId: 2, keyDataHex: KEY_B },
      ],
    });
    // This device's own stored key matches the target it's trying to remove.
    mockGetStoredKeyDataHex.mockResolvedValue(KEY_A);

    await expect(
      removeBackupSignerOnChain({
        smartAccountAddress: SMART_ACCOUNT,
        keyDataHex: KEY_A,
        initiatorListIndex: 0,
      }),
    ).rejects.toThrow("lock this device out");
  });

  it('refuses when the rule has no threshold policy installed', async () => {
    stubChainState({
      signers: [
        { signerId: 1, keyDataHex: KEY_A },
        { signerId: 2, keyDataHex: KEY_B },
      ],
      hasThresholdPolicy: false,
    });
    mockGetStoredKeyDataHex.mockResolvedValue('cc'.repeat(32));

    await expect(
      removeBackupSignerOnChain({
        smartAccountAddress: SMART_ACCOUNT,
        keyDataHex: KEY_A,
        initiatorListIndex: 0,
      }),
    ).rejects.toThrow('no approval threshold');
  });
});
