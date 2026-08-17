/**
 * admin-tx.ts — orchestration for post-deploy admin transactions on a
 * LatchSmartAccount.
 *
 * Today this module covers ONE flow: completing a device pairing by
 * adding the new device's signer on-chain. When pairing the 2nd device
 * the same transaction also installs the admin (M-of-N) context rule
 * (see docs/multisig-build-plan.md "Lifecycle" step 2).
 *
 * Future flows (remove device, change threshold) will be added here so
 * the screens can all delegate to a single orchestrator.
 *
 * IMPORTANT — runtime verification gap: the simulation/assembly flow
 * mirrors the pattern in src/api/smart-account.ts but has not yet been
 * exercised against the deployed `LatchSmartAccount`. Failure modes worth
 * watching during testnet trials:
 *   1. The factory-discovered verifier addresses match what
 *      __check_auth expects.
 *   2. The dual-op tx (batch_add_signer + add_context_rule) returns the
 *      new signer id and rule id in resultMetaXdr in the order we expect.
 *   3. The single-device fallback path (no admin rule yet, threshold=1)
 *      assembles cleanly through `e.current_contract_address().require_auth()`.
 */

import { bundlerAddress, submitViaBundler } from '@/src/api/transaction-relay';
import {
  Account,
  Keypair,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import {
  addContextRuleOp,
  batchAddSignerOp,
  encodeThresholdPolicyParams,
  fetchFactoryVerifiers,
  liftToRuntimeSigner,
  RuntimeSigner,
} from '@/src/api/account-admin';
import {
  parseSimResult,
  sorobanCall,
  txToBase64,
} from '@/src/api/smart-account';
import { HORIZON_URL } from '@/src/constants/config';
import { AccountSigner, computeMajorityThreshold } from '@/src/lib/account-signers';

export interface CompletePairingInput {
  /** C-address of the LatchSmartAccount being updated. */
  smartAccountAddress: string;
  /**
   * The existing context rule id whose signers we extend. For most accounts
   * this is the default rule (typically id 1 — read it from the on-chain
   * `get_context_rule(id)` enumeration before calling).
   */
  defaultRuleId: number;
  /**
   * Current devices already on the account (must include the local
   * initiator), in the order they were added. Used to compute the
   * post-add signer count for the admin rule.
   */
  existingSigners: AccountSigner[];
  /** The new device's signer descriptor as derived from the pairing response. */
  newSigner: AccountSigner;
  /**
   * Whether the admin (M-of-N) context rule already exists on this
   * account. If false, the dual-op tx adds it as part of this pairing.
   */
  adminRuleInstalled: boolean;
}

export interface CompletePairingResult {
  /** Submitted transaction hash. */
  txHash: string;
  /**
   * Newly assigned on-chain signer id for the new device. Read from
   * resultMetaXdr. Undefined when the chain doesn't surface it (in which
   * case the caller should re-query `get_context_rule(defaultRuleId)`).
   */
  newSignerOnChainId?: number;
  /**
   * Newly assigned admin context rule id, if `adminRuleInstalled` was
   * false at call time. Caller must persist this on the WalletAccount
   * via useWalletStore.updateAccountDevices(..., adminRuleId).
   */
  newAdminRuleId?: number;
}

export interface RpcConfig {
  rpcUrl: string;
  networkPassphrase: string;
  factoryAddress: string;
  /** Horizon URL used to fetch the bundler's current sequence number. */
  horizonUrl?: string;
}

/**
 * Complete a device pairing: assemble + simulate + sign + submit the
 * dual-op admin transaction on the smart account.
 *
 * The transaction contains:
 *   1. `batch_add_signer(defaultRuleId, [newSigner])` — extends the
 *      default rule's signer set.
 *   2. (only if !adminRuleInstalled) `add_context_rule(CallContract(self),
 *      "admin", null, allSigners, {thresholdPolicy: ⌈N/2⌉})` — installs
 *      the higher-threshold rule for self-mutations.
 *
 * The initiator's local keypair signs the bundler-submitted envelope.
 * Authorization for the contract calls themselves is via the smart
 * account's `__check_auth`, which the initial signer alone can satisfy
 * (no admin rule exists yet OR admin rule's threshold of 1 is met by the
 * sole local signer).
 */
export async function completePairing(
  cfg: RpcConfig,
  initiatorKeypair: Keypair,
  input: CompletePairingInput,
): Promise<CompletePairingResult> {
  const verifiers = await fetchFactoryVerifiers(cfg);

  const newRuntimeSigner = liftToRuntimeSigner(input.newSigner, verifiers);
  const allSignersAfter: RuntimeSigner[] = [
    ...input.existingSigners.map((s) => liftToRuntimeSigner(s, verifiers)),
    newRuntimeSigner,
  ];

  const ops: xdr.Operation[] = [
    batchAddSignerOp(input.smartAccountAddress, input.defaultRuleId, [newRuntimeSigner]),
  ];

  // Only install the admin rule the first time we cross from N=1 to N=2.
  // Subsequent device adds extend allSigners but the admin rule already
  // exists; updating its signer set on each add is a separate concern
  // (TODO when implementing 3rd-device pairing).
  if (!input.adminRuleInstalled && allSignersAfter.length >= 2) {
    const adminThreshold = computeMajorityThreshold(allSignersAfter.length);
    ops.push(
      addContextRuleOp(
        input.smartAccountAddress,
        { kind: 'callContract', address: input.smartAccountAddress },
        'admin',
        null,
        allSignersAfter,
        [
          {
            address: verifiers.thresholdPolicy,
            installParam: encodeThresholdPolicyParams(adminThreshold),
          },
        ],
      ),
    );
  }

  // ─── Assemble + simulate + submit ───
  // The bundler sources and pays for this; latch-api holds its key. Only the
  // address is needed here, to simulate against a real sequence number.
  const bundlerG = await bundlerAddress();
  const horizonUrl = cfg.horizonUrl ?? HORIZON_URL;

  const horizonResp = await fetch(`${horizonUrl}/accounts/${bundlerG}`);
  if (!horizonResp.ok) {
    throw new Error(`Bundler account not found on Horizon: ${horizonResp.status}`);
  }
  const horizonJson = await horizonResp.json();
  const bundlerAccount = new Account(bundlerG, horizonJson.sequence);

  const builder = new TransactionBuilder(bundlerAccount, {
    fee: '2000000',
    networkPassphrase: cfg.networkPassphrase,
  }).setTimeout(300);
  for (const op of ops) builder.addOperation(op);
  const tx = builder.build();

  const rawSim = await sorobanCall(cfg.rpcUrl, 'simulateTransaction', {
    transaction: txToBase64(tx),
  });
  if (rawSim.error) throw new Error(`admin-tx simulation failed: ${rawSim.error}`);

  const assembled = rpc.assembleTransaction(tx, parseSimResult(rawSim)).build();
  // The initiator signs the auth payload entries embedded in the simulated tx.
  // Local single-device case: the initiator IS the only signer the smart
  // account requires, so a single keypair.sign is sufficient.
  assembled.sign(initiatorKeypair);

  // Both operations target this one smart account, which is what lets the
  // server accept them as an atomic batch — splitting them would leave the
  // account with a new signer but no admin rule governing it.
  const { hash: txHash, status: finalStatus, resultMetaXdr } = await submitViaBundler(assembled);
  if (finalStatus !== 'SUCCESS') {
    throw new Error(`admin-tx transaction status: ${finalStatus}`);
  }

  return {
    txHash,
    newSignerOnChainId: extractFirstU32FromMeta(resultMetaXdr, 0),
    newAdminRuleId:
      !input.adminRuleInstalled && allSignersAfter.length >= 2
        ? extractFirstU32FromMeta(resultMetaXdr, 1)
        : undefined,
  };
}

/**
 * Pull the u32 return value of operation at `opIndex` out of resultMetaXdr.
 *
 * Soroban returns one ScVal per host-function invocation in
 * sorobanMeta.returnValue() (single op) or the operation results in v4.
 * For multi-op admin transactions we need the per-op breakdown; the SDK's
 * meta accessor surface for that is still in flux across protocol
 * versions, so this helper returns `undefined` when it can't confidently
 * read the value. Callers should fall back to re-querying chain state
 * (e.g. via get_context_rule) in that case.
 */
function extractFirstU32FromMeta(resultMetaXdr: string | undefined, opIndex: number): number | undefined {
  if (!resultMetaXdr) return undefined;
  try {
    const meta = xdr.TransactionMeta.fromXDR(resultMetaXdr, 'base64');
    const arm = (meta as any).arm();
    let sorobanMeta: any;
    if (arm === 'v3') sorobanMeta = meta.v3().sorobanMeta();
    else if (arm === 'v4') sorobanMeta = (meta as any).v4().sorobanMeta();
    if (!sorobanMeta) return undefined;

    // v3 only exposes a single returnValue; for multi-op txs we can't
    // disambiguate per-op there. v4 added per-op return values but the SDK
    // accessor name differs between releases — try a few defensively.
    const tryRead = (val: xdr.ScVal | undefined): number | undefined => {
      if (!val) return undefined;
      const native = scValToNative(val);
      return typeof native === 'number' ? native : undefined;
    };

    if (arm === 'v3') {
      if (opIndex !== 0) return undefined;
      return tryRead(sorobanMeta.returnValue());
    }

    // v4 path — accessor names vary; probe with TODO-resilient access.
    const returnValues = (sorobanMeta as any).returnValues?.() ?? (sorobanMeta as any).returnValueV2?.();
    if (Array.isArray(returnValues) && returnValues[opIndex]) {
      return tryRead(returnValues[opIndex]);
    }
    if (opIndex === 0) return tryRead((sorobanMeta as any).returnValue?.());
    return undefined;
  } catch {
    return undefined;
  }
}

