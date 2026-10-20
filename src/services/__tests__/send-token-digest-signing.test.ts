// signSmartAccountAuthEntryFromDigest / signPasskeyAuthEntryFromDigest sign a
// digest and context_rule_ids computed SERVER-SIDE (build-send / build-swap),
// unlike the legacy signSmartAccountAuthEntry / signPasskeyAuthEntry (still
// used by multisig-send.ts and backup-signer-tx.ts), which recompute both
// locally from a single repeated rule id. The regression this guards against:
// recomputing here would silently drop back to a wrong, fixed-length rule-id
// vector and sign a digest the chain never asked for (#3014 / on-chain auth
// failure) — see the doc comments on both functions in ../send-token.ts.
//
// send-token.ts pulls in a wide dependency graph (RPC transport, the passkey
// ceremony, the build/submit API clients) that only matters for the full
// send flow. None of it is touched by these two signing functions, so it is
// stubbed out here — see src/lib/__tests__/backup-signer-tx.test.ts for the
// same pattern.

import { Address, Keypair, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import {
  signPasskeyAuthEntryFromDigest,
  signSmartAccountAuthEntryFromDigest,
} from '@/src/services/send-token';

jest.mock('@/src/api/soroban-rpc', () => ({ loadRpcAccount: jest.fn() }));
jest.mock('@/src/api/smart-account', () => ({
  sorobanCall: jest.fn(),
  toBase64: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64'),
}));
jest.mock('@/src/api/transaction-relay', () => ({ submitBuiltTransaction: jest.fn() }));
jest.mock('@/src/api/transaction-build', () => ({ buildSend: jest.fn() }));
jest.mock('@/src/api/account-admin', () => ({ fetchDefaultContextRule: jest.fn() }));

const mockSignWithStoredPasskeyAtIndex = jest.fn();
jest.mock('@/src/lib/passkey-webauthn', () => ({
  // Identity pass-through: the test only needs to see exactly what this
  // module's own code does with the signature, not re-verify WebAuthn's own
  // encoding (covered elsewhere).
  encodeWebAuthnSigData: (sig: Uint8Array) => sig,
  getStoredKeyDataHex: jest.fn(),
  signWithStoredPasskeyAtIndex: (...args: unknown[]) => mockSignWithStoredPasskeyAtIndex(...args),
}));
jest.mock('@/src/constants/config', () => ({
  getNetworkId: () => 'testnet',
  PASSKEY_RP_ID: 'latch.test',
  STELLAR_AUTH_PREFIX: 'Stellar Smart Account Auth:\n',
  STELLAR_FACTORY_ADDRESS: 'CFACTORYTEST',
  STELLAR_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  STELLAR_RPC_URL: 'https://rpc.test',
}));
jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));

const STELLAR_AUTH_PREFIX = 'Stellar Smart Account Auth:\n';
const SIGNATURE_EXPIRATION_LEDGER = 9_999_999;

function randomContractAddress(): string {
  return StrKey.encodeContract(Keypair.random().rawPublicKey());
}

/** A SorobanAuthorizationEntry fixture with one context in its tree, matching
 * the shape in reference/latch-web-extension's delegatedAuthSubmit.test.ts. */
function buildEntry(): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(randomContractAddress()).toScAddress(),
        nonce: xdr.Int64.fromString('0'),
        signatureExpirationLedger: SIGNATURE_EXPIRATION_LEDGER,
        signature: xdr.ScVal.scvVec([]),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(randomContractAddress()).toScAddress(),
          functionName: Buffer.from('transfer'),
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

function signatureMapEntries(entry: xdr.SorobanAuthorizationEntry): xdr.ScMapEntry[] {
  return entry.credentials().address().signature().map() ?? [];
}

function findMapVal(entries: xdr.ScMapEntry[], key: string): xdr.ScVal {
  const found = entries.find((e) => scValToNative(e.key()) === key);
  if (!found) throw new Error(`no "${key}" entry in signature map`);
  return found.val();
}

describe('signSmartAccountAuthEntryFromDigest', () => {
  it('embeds the given context_rule_ids verbatim, not recomputed from the tree', () => {
    const entry = buildEntry();
    const keypair = Keypair.random();
    const verifierAddress = Keypair.random().publicKey();
    const authDigestHex = 'ab'.repeat(32);
    // Asymmetric on purpose: this fixture's tree has exactly ONE auth context
    // (no subInvocations), so a correct implementation that recomputed this
    // from the tree (buildContextRuleIds(entry, ruleId)) would always produce
    // a single-element vector — never this one.
    const contextRuleIds = [0, 1, 1];

    signSmartAccountAuthEntryFromDigest(
      entry,
      keypair,
      authDigestHex,
      contextRuleIds,
      verifierAddress,
    );

    const entries = signatureMapEntries(entry);
    expect(scValToNative(findMapVal(entries, 'context_rule_ids'))).toEqual(contextRuleIds);
  });

  it('signs STELLAR_AUTH_PREFIX + authDigestHex exactly, not a locally recomputed digest', () => {
    const entry = buildEntry();
    const keypair = Keypair.random();
    const verifierAddress = Keypair.random().publicKey();
    const authDigestHex = 'cd'.repeat(32);

    signSmartAccountAuthEntryFromDigest(entry, keypair, authDigestHex, [0], verifierAddress);

    const entries = signatureMapEntries(entry);
    const signers = findMapVal(entries, 'signers').map() ?? [];
    expect(signers).toHaveLength(1);
    const [signerEntry] = signers;
    const signerKeyScVal = signerEntry.key();
    const sigScVal = signerEntry.val();

    const signerKeyNative = scValToNative(signerKeyScVal) as [string, string, Buffer];
    expect(signerKeyNative[0]).toBe('External');
    expect(signerKeyNative[1]).toBe(verifierAddress);
    expect(Buffer.from(signerKeyNative[2]).toString('hex')).toBe(
      Buffer.from(keypair.rawPublicKey()).toString('hex'),
    );

    const sigBytes = Buffer.from(scValToNative(sigScVal) as Uint8Array);
    // Ed25519 signing is deterministic (RFC 8032): re-signing the expected
    // message with the same key reproduces the exact same bytes iff that is
    // what was actually signed.
    const expectedMessage = Buffer.from(STELLAR_AUTH_PREFIX + authDigestHex.toLowerCase(), 'utf8');
    expect(sigBytes.toString('hex')).toBe(keypair.sign(expectedMessage).toString('hex'));
  });

  it('does not touch signatureExpirationLedger — the digest already commits to it', () => {
    const entry = buildEntry();
    signSmartAccountAuthEntryFromDigest(
      entry,
      Keypair.random(),
      'ef'.repeat(32),
      [0],
      Keypair.random().publicKey(),
    );
    expect(entry.credentials().address().signatureExpirationLedger()).toBe(
      SIGNATURE_EXPIRATION_LEDGER,
    );
  });
});

describe('signPasskeyAuthEntryFromDigest', () => {
  const fakeSig = Buffer.from('fake-webauthn-signature');
  const fakeKeyDataHex = 'aa'.repeat(65);

  beforeEach(() => {
    mockSignWithStoredPasskeyAtIndex.mockReset();
    mockSignWithStoredPasskeyAtIndex.mockResolvedValue({ sig: fakeSig, keyDataHex: fakeKeyDataHex });
  });

  it('passes authDigestHex straight through as the challenge, not a re-hashed value', async () => {
    const entry = buildEntry();
    const authDigestHex = '12'.repeat(32);

    await signPasskeyAuthEntryFromDigest(entry, 0, authDigestHex, [0], Keypair.random().publicKey());

    const [, challenge] = mockSignWithStoredPasskeyAtIndex.mock.calls[0];
    expect(Buffer.from(challenge as Uint8Array).toString('hex')).toBe(authDigestHex);
  });

  it('embeds the given context_rule_ids verbatim, not recomputed from the tree', async () => {
    const entry = buildEntry();
    const contextRuleIds = [0, 2, 2];

    await signPasskeyAuthEntryFromDigest(
      entry,
      0,
      '34'.repeat(32),
      contextRuleIds,
      Keypair.random().publicKey(),
    );

    const entries = signatureMapEntries(entry);
    expect(scValToNative(findMapVal(entries, 'context_rule_ids'))).toEqual(contextRuleIds);
  });

  it('does not touch signatureExpirationLedger', async () => {
    const entry = buildEntry();
    await signPasskeyAuthEntryFromDigest(entry, 0, '56'.repeat(32), [0], Keypair.random().publicKey());
    expect(entry.credentials().address().signatureExpirationLedger()).toBe(
      SIGNATURE_EXPIRATION_LEDGER,
    );
  });
});
