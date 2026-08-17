/**
 * Pins the recovery-policy operation encoding to XDR the chain has actually
 * accepted.
 *
 * The expected values here are not derived from the builders they test. They
 * are the operations submitted by scripts/recovery-testbed.ts in the
 * transactions listed below, each of which was accepted by a real
 * LatchSmartAccount's __check_auth on testnet. If a builder drifts, this fails
 * with a byte diff rather than with an opaque #3002 at submit time on someone's
 * phone.
 *
 * Testnet, 2026-08-17:
 *   add_context_rule          fc7fd1d26f3c841a8a1c65a240a66493dae7cdded159e9c751534caaf458cd1a
 *   add_policy                66845ff659c2c5b5a40bcf0ff621218cc07ffe151a3952d2940c528944d899d3
 *   add_context_rule (both)   da308e4a984cd4e4284e29f9f35b2b8925cff6edb16de8e10a4b97d9bf5e6da7
 *   execute(propose)          a0f78cda03e4625a26918606c51f5ff57540d27dfc936feefe631afbb46c56ae
 *   add_signer (finalize)     14d29723b3c1b837cbd865c8acd5fdebcbb152d2f901965da885038feda716d4
 */

import { Address, Contract, xdr } from '@stellar/stellar-sdk';

import {
  addContextRuleOp,
  addPolicyOp,
  addSignerOp,
  encodeRecoveryPolicyParams,
  encodeThresholdPolicyParams,
  recoveryAddSignerArgs,
  recoveryProposeOp,
  type RuntimeSigner,
} from '../account-admin';

const ACCOUNT = 'CAUSIP3BETIRVFUGN6DKE4ZDLWYVOUMQBZCVR4K2EXVSQDERLVP5FE4G';
const ED25519_VERIFIER = 'CAD6GFOCK2ISL7TA6QAZFY4QICS2AWSETXIKIACNSCPGXGOK7WOIME4U';
const THRESHOLD_POLICY = 'CAILIN6YJ5A73VPVHF35XAOESBNBLXOV7I7VZHYI2Q24EZTSQJ2UTFIL';
const RECOVERY_POLICY = 'CAOCYSLYOURJIQY2IC4AUI6FVYZEUH2G6MFHXRZHIMVVGDDD74F7AFQO';

const GUARDIAN_1 = 'cfb35505b9d827218235c928de91738d9b18866b1329df97dc38409887831269';
const GUARDIAN_2 = 'ced3b67172fb1458d59d17626c499439c8f2be58f43b2c57778a8e82229af7e1';

const b64 = (op: xdr.Operation) => op.toXDR().toString('base64');

/** `Signer::External(verifier, key_data)`, spelled out rather than reused. */
function externalSigner(keyDataHex: string): xdr.ScVal {
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(ED25519_VERIFIER).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(keyDataHex, 'hex')),
  ]);
}

describe('recovery policy operation encoding', () => {
  it('addContextRuleOp matches the guardian rule the chain accepted', () => {
    const accepted = new Contract(ACCOUNT).call(
      'add_context_rule',
      xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('CallContract'),
        new Address(ACCOUNT).toScVal(),
      ]),
      xdr.ScVal.scvString('recovery'),
      xdr.ScVal.scvVoid(),
      xdr.ScVal.scvVec([externalSigner(GUARDIAN_1), externalSigner(GUARDIAN_2)]),
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: new Address(THRESHOLD_POLICY).toScVal(),
          val: xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('threshold'),
              val: xdr.ScVal.scvU32(2),
            }),
          ]),
        }),
      ]),
    );

    const guardians: RuntimeSigner[] = [GUARDIAN_1, GUARDIAN_2].map((keyDataHex) => ({
      kind: 'external',
      verifierAddress: ED25519_VERIFIER,
      keyDataHex,
    }));

    const built = addContextRuleOp(
      ACCOUNT,
      { kind: 'callContract', address: ACCOUNT },
      'recovery',
      null,
      guardians,
      [{ address: THRESHOLD_POLICY, installParam: encodeThresholdPolicyParams(2) }],
    );

    expect(b64(built)).toBe(b64(accepted));
  });

  it('addPolicyOp + encodeRecoveryPolicyParams match the install the chain accepted', () => {
    const accepted = new Contract(ACCOUNT).call(
      'add_policy',
      xdr.ScVal.scvU32(1),
      new Address(RECOVERY_POLICY).toScVal(),
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('delay_ledgers'),
          val: xdr.ScVal.scvU32(720),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('quorum_policy'),
          val: new Address(THRESHOLD_POLICY).toScVal(),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('target_rule_id'),
          val: xdr.ScVal.scvU32(0),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('window_ledgers'),
          val: xdr.ScVal.scvU32(17280),
        }),
      ]),
    );

    const built = addPolicyOp(
      ACCOUNT,
      1,
      RECOVERY_POLICY,
      encodeRecoveryPolicyParams({
        delayLedgers: 720,
        windowLedgers: 17280,
        targetRuleId: 0,
        quorumPolicy: THRESHOLD_POLICY,
      }),
    );

    expect(b64(built)).toBe(b64(accepted));
  });

  /**
   * The shape setUpRecovery actually submits: one operation carrying the
   * guardian rule AND both its policies.
   *
   * This exists because a Soroban transaction may hold exactly one
   * InvokeHostFunction, so `add_context_rule` + `add_policy` cannot be made
   * atomic as two operations — and as two transactions there is a window where
   * the quorum has self-call rights with no recovery time-lock in front of them.
   *
   * The two policy addresses form a two-key map, which Soroban requires in
   * canonical order. THRESHOLD_POLICY (CAILIN…) sorts before RECOVERY_POLICY
   * (CAOCYS…), and the expected value below spells that order out literally, so
   * a builder that stopped sorting would fail here rather than at submit.
   */
  it('installs the quorum and recovery policies in one add_context_rule', () => {
    const recoveryParams = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('delay_ledgers'),
        val: xdr.ScVal.scvU32(720),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('quorum_policy'),
        val: new Address(THRESHOLD_POLICY).toScVal(),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('target_rule_id'),
        val: xdr.ScVal.scvU32(0),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('window_ledgers'),
        val: xdr.ScVal.scvU32(17280),
      }),
    ]);

    const accepted = new Contract(ACCOUNT).call(
      'add_context_rule',
      xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('CallContract'),
        new Address(ACCOUNT).toScVal(),
      ]),
      xdr.ScVal.scvString('recovery-atomic'),
      xdr.ScVal.scvVoid(),
      xdr.ScVal.scvVec([externalSigner(GUARDIAN_1), externalSigner(GUARDIAN_2)]),
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: new Address(THRESHOLD_POLICY).toScVal(),
          val: xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('threshold'),
              val: xdr.ScVal.scvU32(2),
            }),
          ]),
        }),
        new xdr.ScMapEntry({
          key: new Address(RECOVERY_POLICY).toScVal(),
          val: recoveryParams,
        }),
      ]),
    );

    const guardians: RuntimeSigner[] = [GUARDIAN_1, GUARDIAN_2].map((keyDataHex) => ({
      kind: 'external',
      verifierAddress: ED25519_VERIFIER,
      keyDataHex,
    }));

    // Deliberately passed in the WRONG order, so the builder's sort is what
    // makes this match rather than the caller happening to be tidy.
    const built = addContextRuleOp(
      ACCOUNT,
      { kind: 'callContract', address: ACCOUNT },
      'recovery-atomic',
      null,
      guardians,
      [
        {
          address: RECOVERY_POLICY,
          installParam: encodeRecoveryPolicyParams({
            delayLedgers: 720,
            windowLedgers: 17280,
            targetRuleId: 0,
            quorumPolicy: THRESHOLD_POLICY,
          }),
        },
        { address: THRESHOLD_POLICY, installParam: encodeThresholdPolicyParams(2) },
      ],
    );

    expect(b64(built)).toBe(b64(accepted));
  });

  /**
   * A passkey guardian is `External(webauthnVerifier, keyData)` — the same
   * shape a passkey account's own signer takes on the default rule. Its key is
   * a 65-byte uncompressed P-256 point with the credential id appended, well
   * under the contract's 256-byte MAX_EXTERNAL_KEY_SIZE.
   *
   * The verifier is what separates it from an ed25519 guardian: the account
   * matches the exact (verifier, key_data) tuple, so a passkey registered under
   * the ed25519 verifier could never authenticate.
   */
  it('encodes a passkey guardian under the WebAuthn verifier', () => {
    const WEBAUTHN_VERIFIER = 'CDBBGLSWWHWK52REY7GK5HWAQGAJJ4GP5O75LOM3F4INN6W4KT6DPBVY';
    const keyData = Buffer.concat([
      Buffer.from('04', 'hex'),
      Buffer.alloc(64, 0xab),
      Buffer.alloc(16, 0xcd),
    ]);
    expect(keyData.length).toBeLessThanOrEqual(256);

    const accepted = new Contract(ACCOUNT).call(
      'add_context_rule',
      xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('CallContract'),
        new Address(ACCOUNT).toScVal(),
      ]),
      xdr.ScVal.scvString('recovery-passkey'),
      xdr.ScVal.scvVoid(),
      xdr.ScVal.scvVec([
        xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol('External'),
          new Address(WEBAUTHN_VERIFIER).toScVal(),
          xdr.ScVal.scvBytes(keyData),
        ]),
      ]),
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: new Address(THRESHOLD_POLICY).toScVal(),
          val: xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('threshold'),
              val: xdr.ScVal.scvU32(1),
            }),
          ]),
        }),
      ]),
    );

    const built = addContextRuleOp(
      ACCOUNT,
      { kind: 'callContract', address: ACCOUNT },
      'recovery-passkey',
      null,
      [
        {
          kind: 'external',
          verifierAddress: WEBAUTHN_VERIFIER,
          keyDataHex: keyData.toString('hex'),
        },
      ],
      [{ address: THRESHOLD_POLICY, installParam: encodeThresholdPolicyParams(1) }],
    );

    expect(b64(built)).toBe(b64(accepted));
  });

  /**
   * A C-address guardian is stored as `Signer::Delegated(address)`, which the
   * contract authenticates with `address.require_auth_for_args`, letting a
   * smart-account guardian use its own signers and policies.
   *
   * The expected XDR here is the operation whose simulation the deployed
   * account accepted (see scripts/recovery-testbed.ts sim-delegated) — one auth
   * entry, the owner's, with no guardian signature needed to name it.
   */
  it('encodes a C-address guardian as a delegated signer', () => {
    const accepted = new Contract(ACCOUNT).call(
      'add_context_rule',
      xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('CallContract'),
        new Address(ACCOUNT).toScVal(),
      ]),
      xdr.ScVal.scvString('recovery-delegated'),
      xdr.ScVal.scvVoid(),
      xdr.ScVal.scvVec([
        xdr.ScVal.scvVec([
          xdr.ScVal.scvSymbol('Delegated'),
          new Address(RECOVERY_POLICY).toScVal(),
        ]),
      ]),
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: new Address(THRESHOLD_POLICY).toScVal(),
          val: xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('threshold'),
              val: xdr.ScVal.scvU32(1),
            }),
          ]),
        }),
      ]),
    );

    const built = addContextRuleOp(
      ACCOUNT,
      { kind: 'callContract', address: ACCOUNT },
      'recovery-delegated',
      null,
      [{ kind: 'delegated', address: RECOVERY_POLICY }],
      [{ address: THRESHOLD_POLICY, installParam: encodeThresholdPolicyParams(1) }],
    );

    expect(b64(built)).toBe(b64(accepted));
  });

  /**
   * The guardian's two calls.
   *
   * `propose` goes through the account's own `execute`: the policy admits only
   * an `execute` aimed at its own `propose`, and the guardian rule is scoped to
   * `CallContract(<account>)`, so a direct call on the policy would not match
   * the rule. `finalize` is a plain `add_signer` on the account.
   */
  describe('guardian actions', () => {
    const NEW_DEVICE = 'd08c965aa27c96a83f6ce6fc499467aa6523ab250aa9ad68c7f9c81e8f0eedb0';
    const GUARDIAN_RULE = 1;

    const newSigner: RuntimeSigner = {
      kind: 'external',
      verifierAddress: ED25519_VERIFIER,
      keyDataHex: NEW_DEVICE,
    };

    it('builds the propose call the chain accepted', () => {
      const accepted = new Contract(ACCOUNT).call(
        'execute',
        new Address(RECOVERY_POLICY).toScVal(),
        xdr.ScVal.scvSymbol('propose'),
        xdr.ScVal.scvVec([
          new Address(ACCOUNT).toScVal(),
          xdr.ScVal.scvU32(GUARDIAN_RULE),
          xdr.ScVal.scvSymbol('add_signer'),
          xdr.ScVal.scvVec([xdr.ScVal.scvU32(0), externalSigner(NEW_DEVICE)]),
        ]),
      );

      const built = recoveryProposeOp(
        ACCOUNT,
        RECOVERY_POLICY,
        GUARDIAN_RULE,
        'add_signer',
        recoveryAddSignerArgs(0, newSigner),
      );

      expect(b64(built)).toBe(b64(accepted));
    });

    it('builds the finalize call the chain accepted', () => {
      const accepted = new Contract(ACCOUNT).call(
        'add_signer',
        xdr.ScVal.scvU32(0),
        externalSigner(NEW_DEVICE),
      );

      expect(b64(addSignerOp(ACCOUNT, 0, newSigner))).toBe(b64(accepted));
    });

    /**
     * The policy compares the pending args to the presented args for exact
     * equality, so propose and finalize MUST encode the signer identically.
     * Sharing one builder is what guarantees that; this asserts it rather than
     * trusting the two call sites to stay in step.
     */
    it('encodes the same signer args at propose and at finalize', () => {
      const args = recoveryAddSignerArgs(0, newSigner);
      const proposeArgs = recoveryProposeOp(ACCOUNT, RECOVERY_POLICY, GUARDIAN_RULE, 'add_signer', args);
      const finalizeOp = addSignerOp(ACCOUNT, 0, newSigner);

      // Dig the pinned args back out of the propose envelope:
      //   execute(policy, "propose", [account, ruleId, fn_name, ARGS])
      //          args[0]   args[1]    args[2] ───────────────────┘
      const contractArgs = (op: xdr.Operation) =>
        (op as any).body().invokeHostFunctionOp().hostFunction().invokeContract().args();
      const asB64 = (vals: xdr.ScVal[]) => vals.map((v) => v.toXDR().toString('base64'));

      const pinned = contractArgs(proposeArgs)[2].vec()[3].vec();

      expect(asB64(pinned)).toEqual(asB64(contractArgs(finalizeOp)));
    });
  });

  /**
   * Soroban rejects a map whose keys are not in canonical order, and the
   * RecoveryAccountParams fields are not alphabetical in the Rust struct — so
   * the encoder has to sort them, and a reader "fixing" the order to match the
   * struct would break every install.
   */
  it('encodes RecoveryAccountParams keys in canonical order', () => {
    const params = encodeRecoveryPolicyParams({
      delayLedgers: 720,
      windowLedgers: 17280,
      targetRuleId: 0,
      quorumPolicy: THRESHOLD_POLICY,
    });

    const keys = (params.map() ?? []).map((entry) => entry.key().sym().toString());
    expect(keys).toEqual(['delay_ledgers', 'quorum_policy', 'target_rule_id', 'window_ledgers']);
    expect([...keys].sort()).toEqual(keys);
  });

  /** `quorum_policy` is an Option<Address>; None must encode as Void, not omitted. */
  it('encodes an absent quorum policy as Void rather than dropping the key', () => {
    const params = encodeRecoveryPolicyParams({
      delayLedgers: 720,
      windowLedgers: 17280,
      targetRuleId: 0,
      quorumPolicy: null,
    });

    const entry = (params.map() ?? []).find((e) => e.key().sym().toString() === 'quorum_policy');
    expect(entry).toBeDefined();
    expect(entry!.val().switch().name).toBe('scvVoid');
  });
});

/**
 * The nested entry a Delegated guardian needs. Shape confirmed on testnet:
 *   8def39af…  guardian is tx source, entry attached  → SUCCESS
 *   3f522230…  unrelated tx source, entry attached    → SUCCESS
 *   (omitted)  entry absent                           → "Unauthorized function call"
 */
describe('delegated guardian auth entry', () => {
  const GUARDIAN = 'GDH3GVIFXHMCOIMCGXESRXUROOGZWGEGNMJSTX4X3Q4EBGEHQMJGTDW3';

  const build = (digest: Buffer, validUntil: number, nonce: bigint) =>
    new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
        new xdr.SorobanAddressCredentials({
          address: new Address(GUARDIAN).toScAddress(),
          nonce: new xdr.Int64(nonce),
          signatureExpirationLedger: validUntil,
          signature: xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: new Address(ACCOUNT).toScAddress(),
            functionName: '__check_auth',
            args: [xdr.ScVal.scvBytes(digest)],
          }),
        ),
        subInvocations: [],
      }),
    });

  it('authorises __check_auth on the recovered account with the auth digest', () => {
    const digest = Buffer.alloc(32, 0x11);
    const entry = build(digest, 1000, 42n);

    const fn = entry.rootInvocation().function().contractFn();
    expect(Address.fromScAddress(fn.contractAddress()).toString()).toBe(ACCOUNT);
    expect(fn.functionName().toString()).toBe('__check_auth');
    expect(Buffer.from(fn.args()[0].bytes())).toEqual(digest);
    expect(entry.rootInvocation().subInvocations()).toHaveLength(0);
  });

  it('addresses the credentials to the guardian, not the account', () => {
    const entry = build(Buffer.alloc(32), 1000, 1n);
    const creds = entry.credentials().address();
    expect(Address.fromScAddress(creds.address()).toString()).toBe(GUARDIAN);
  });

  /** A different digest must produce a different entry, or it would be replayable. */
  it('binds the entry to its digest', () => {
    const a = build(Buffer.alloc(32, 0x01), 1000, 7n).toXDR().toString('base64');
    const b = build(Buffer.alloc(32, 0x02), 1000, 7n).toXDR().toString('base64');
    expect(a).not.toBe(b);
  });
});
