import { Address, StrKey, xdr } from '@stellar/stellar-sdk';

import { fetchContextRuleSigners, fetchDefaultContextRule } from './account-admin';

// account-admin.ts imports sorobanCall/txToBase64 from ./smart-account, which
// transitively pulls in smart-account-deploy.ts -> @sentry/react-native (ESM
// that this project's "node" jest project can't load). Stub the whole module
// so the test never walks that chain — sorobanCall becomes a plain response
// queue instead of a real RPC transport.
const mockSorobanCall = jest.fn();
jest.mock('./smart-account', () => ({
  sorobanCall: (...args: unknown[]) => mockSorobanCall(...args),
  txToBase64: () => 'dummy-tx-base64',
  ledgerKeyToBase64: () => 'dummy-key-base64',
}));

const RPC_CFG = {
  rpcUrl: 'https://rpc.test',
  networkPassphrase: 'Test SDF Network ; September 2015',
  factoryAddress: contractAddress(99),
};

function contractAddress(seed: number): string {
  return StrKey.encodeContract(Buffer.alloc(32, seed));
}

function mapEntry(key: string, val: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
}

function externalSignerScVal(verifierAddress: string, keyDataHex: string): xdr.ScVal {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(verifierAddress).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(keyDataHex, 'hex')),
  ]);
}

function scalarResult(val: xdr.ScVal): object {
  return { results: [{ xdr: val.toXDR('base64') }], latestLedger: 0 };
}

function contextRuleResult(opts: { id: number; signers: xdr.ScVal[]; signerIds: number[] }): object {
  const rule = xdr.ScVal.scvMap([
    mapEntry('id', xdr.ScVal.scvU32(opts.id)),
    mapEntry('context_type', xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Default')])),
    mapEntry('signers', xdr.ScVal.scvVec(opts.signers)),
    mapEntry('signer_ids', xdr.ScVal.scvVec(opts.signerIds.map((i) => xdr.ScVal.scvU32(i)))),
    mapEntry('policies', xdr.ScVal.scvVec([])),
  ]);
  return scalarResult(rule);
}

// fetchFactoryVerifiers issues its 4 get_verifier/get_threshold_policy calls
// via Promise.all, but each is a single non-overlapping await inside
// simulateRead — so they still reach the mock in the order the array
// literal lists them. A FIFO queue of responses is enough to stand in for
// the RPC transport.
function queueResponses(...responses: object[]) {
  for (const r of responses) mockSorobanCall.mockResolvedValueOnce(r);
}

afterEach(() => {
  mockSorobanCall.mockReset();
});

const ED25519_VERIFIER = contractAddress(1);
const WEBAUTHN_VERIFIER = contractAddress(2);
const SECP256K1_VERIFIER = contractAddress(3);
const THRESHOLD_POLICY = contractAddress(4);

function verifierResponses(): object[] {
  return [
    scalarResult(new Address(ED25519_VERIFIER).toScVal()),
    scalarResult(new Address(WEBAUTHN_VERIFIER).toScVal()),
    scalarResult(new Address(SECP256K1_VERIFIER).toScVal()),
    scalarResult(new Address(THRESHOLD_POLICY).toScVal()),
  ];
}

describe('fetchContextRuleSigners', () => {
  it('reads each signer id from signer_ids, not its position in the Vec', async () => {
    // A prior removal leaves a gap: the two surviving signers sit at Vec
    // positions 0 and 1, but their stable ids (7 and 3) are neither 0/1 nor
    // in position order. Using the position as the id (the bug this test
    // guards against) would silently target the wrong signer on removal.
    const keyA = 'aa'.repeat(32);
    const keyB = 'bb'.repeat(32);
    queueResponses(
      ...verifierResponses(),
      contextRuleResult({
        id: 0,
        signers: [
          externalSignerScVal(WEBAUTHN_VERIFIER, keyA),
          externalSignerScVal(WEBAUTHN_VERIFIER, keyB),
        ],
        signerIds: [7, 3],
      }),
    );

    const signers = await fetchContextRuleSigners(RPC_CFG, contractAddress(5), 0);

    expect(signers).toHaveLength(2);
    expect(signers[0]).toMatchObject({ keyDataHex: keyA, signerId: 7 });
    expect(signers[1]).toMatchObject({ keyDataHex: keyB, signerId: 3 });
  });
});

describe('fetchDefaultContextRule', () => {
  it('attaches signer_ids to the Default rule it discovers', async () => {
    const keyA = 'cc'.repeat(32);
    queueResponses(
      ...verifierResponses(),
      scalarResult(xdr.ScVal.scvU32(1)), // get_context_rules_count
      contextRuleResult({
        id: 0,
        signers: [externalSignerScVal(WEBAUTHN_VERIFIER, keyA)],
        signerIds: [42],
      }),
    );

    const rule = await fetchDefaultContextRule(RPC_CFG, contractAddress(6));

    expect(rule.ruleId).toBe(0);
    expect(rule.signers).toEqual([
      expect.objectContaining({ keyDataHex: keyA, signerId: 42 }),
    ]);
  });
});
