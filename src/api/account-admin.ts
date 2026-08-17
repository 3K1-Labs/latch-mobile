/**
 * account-admin.ts — XDR builders for post-deploy admin operations on a
 * LatchSmartAccount.
 *
 * All admin ops (add/remove signer, add/remove context rule, set threshold)
 * are inherited from OZ's `SmartAccount` trait and require self-auth on the
 * smart account contract. See:
 *   reference/latch-contracts/latch-smart-account/README.md
 *
 * The functions in this module return `xdr.Operation` values; the caller is
 * responsible for assembling them into a transaction, simulating, and
 * submitting. This module does no RPC submission of its own — the one
 * networked function (`fetchFactoryVerifiers`) is a read-only simulation
 * call used to discover the verifier contract addresses the factory was
 * deployed with.
 *
 * Distinction between deploy-time and runtime signer encoding:
 *
 *   At DEPLOY TIME the factory accepts `AccountSignerInit` (with a
 *   `SignerKind` enum + raw key_data). The factory translates this into the
 *   runtime `Signer::External(verifier_address, key_data)` form internally.
 *
 *   At RUNTIME (after deploy), admin ops on the account contract take the
 *   runtime `Signer` form directly — meaning the caller must know each
 *   verifier contract's address. Use `fetchFactoryVerifiers` to discover
 *   them via the factory's `get_verifier` getter.
 */

import {
  Account,
  Address,
  Contract,
  scValToNative,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import { AccountSigner } from '@/src/lib/account-signers';
import { ledgerKeyToBase64, sorobanCall, txToBase64 } from './soroban-rpc';

/**
 * Runtime form of the on-chain `Signer` enum (post-init).
 *
 * Note this is distinct from `AccountSigner` in account-signers.ts, which
 * is the DEPLOY-TIME form (signer_kind + key_data). At runtime the contract
 * stores the verifier address directly, so the caller must resolve it.
 */
export type RuntimeSigner =
  | { kind: 'delegated'; address: string }
  | { kind: 'external'; verifierAddress: string; keyDataHex: string };

/** Encode a RuntimeSigner to its ScVal representation. */
export function encodeRuntimeSigner(signer: RuntimeSigner): xdr.ScVal {
  if (signer.kind === 'delegated') {
    return xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol('Delegated'),
      new Address(signer.address).toScVal(),
    ]);
  }
  // Signer::External(verifier, key_data) — tuple enum variant
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(signer.verifierAddress).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(signer.keyDataHex, 'hex')),
  ]);
}

/** Lifts an `AccountSigner` (deploy-time form) into a `RuntimeSigner`. */
export function liftToRuntimeSigner(
  signer: AccountSigner,
  verifiers: FactoryVerifiers,
): RuntimeSigner {
  switch (signer.kind) {
    case 'delegated':
      return { kind: 'delegated', address: signer.address };
    case 'ed25519':
      return {
        kind: 'external',
        verifierAddress: verifiers.ed25519,
        keyDataHex: signer.publicKeyHex,
      };
    case 'webauthn':
      return {
        kind: 'external',
        verifierAddress: verifiers.webauthn,
        keyDataHex: signer.keyDataHex,
      };
  }
}

/**
 * The ContextRuleType discriminator: either the catch-all `Default` rule or
 * a `CallContract` rule scoped to a specific contract address. For Latch's
 * split-policy multisig we use `CallContract(<self>)` for the admin rule
 * so every self-mutation flows through the higher-threshold check.
 */
export type ContextRuleType =
  | { kind: 'default' }
  | { kind: 'callContract'; address: string };

function encodeContextRuleType(t: ContextRuleType): xdr.ScVal {
  if (t.kind === 'default') {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Default')]);
  }
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('CallContract'),
    new Address(t.address).toScVal(),
  ]);
}

/** SimpleThresholdAccountParams ScVal — the install payload for ThresholdPolicy. */
export function encodeThresholdPolicyParams(threshold: number): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('threshold'),
      val: xdr.ScVal.scvU32(threshold),
    }),
  ]);
}

/** A policy to install on a rule, with the payload its `install` expects. */
export interface PolicyInstall {
  address: string;
  installParam: xdr.ScVal;
}

/**
 * `add_context_rule(type, name, valid_until, signers, policies)`
 *
 * Creates a named rule on the account, installing every policy in `policies` as
 * part of the same call.
 *
 * INSTALLING SEVERAL POLICIES AT ONCE IS THE ONLY WAY TO DO IT ATOMICALLY. A
 * Soroban transaction may carry exactly one InvokeHostFunction operation, so
 * `add_context_rule` followed by `add_policy` is necessarily two transactions,
 * with a live window in between where the rule exists under only some of its
 * policies. For a guardian rule that window is exploitable: the quorum would
 * briefly hold self-call rights with no recovery time-lock in front of them.
 *
 * The contract supports this: it builds `context_rule.policies` from all the
 * map's keys BEFORE calling any policy's `install`, so a policy that requires
 * another to be present (the recovery policy requires its quorum policy) sees it
 * regardless of iteration order.
 *
 * @param accountAddress       C-address of the LatchSmartAccount
 * @param ruleType             Default | CallContract(<address>)
 * @param name                 Human label (≤ ~30 chars by convention)
 * @param validUntilLedger     null = never expires
 * @param signers              Runtime signer set
 * @param policies             Policies to install, in any order
 */
export function addContextRuleOp(
  accountAddress: string,
  ruleType: ContextRuleType,
  name: string,
  validUntilLedger: number | null,
  signers: RuntimeSigner[],
  policies: PolicyInstall[],
): xdr.Operation {
  const account = new Contract(accountAddress);
  const validUntil =
    validUntilLedger === null
      ? xdr.ScVal.scvVoid()
      : xdr.ScVal.scvU32(validUntilLedger);
  const signerVec = xdr.ScVal.scvVec(signers.map(encodeRuntimeSigner));

  // Soroban maps are canonically ordered; an unsorted map is rejected outright
  // as Object/InvalidInput, before any contract code runs. Harmless with one
  // policy, essential with two.
  const policyEntries = policies
    .map(
      (p) =>
        new xdr.ScMapEntry({
          key: new Address(p.address).toScVal(),
          val: p.installParam,
        }),
    )
    .sort((a, b) => Buffer.compare(a.key().toXDR(), b.key().toXDR()));

  return account.call(
    'add_context_rule',
    encodeContextRuleType(ruleType),
    xdr.ScVal.scvString(name),
    validUntil,
    signerVec,
    xdr.ScVal.scvMap(policyEntries),
  );
}

/**
 * Parameters a Recovery Policy is installed with. Read from the deployed
 * contract's own spec (`RecoveryAccountParams`), not guessed:
 *
 *   delay_ledgers   how long after `propose` before the recovery may be
 *                   enforced — the owner's veto window
 *   window_ledgers  how long it stays enforceable once ready, before it lapses
 *   target_rule_id  the rule the recovered call acts on (usually the Default
 *                   rule, since recovery exists to restore spending access)
 *   quorum_policy   optional nested policy governing guardian quorum
 *
 * Ledgers close roughly every 5 seconds, so 17280 ledgers ≈ 24 hours.
 */
export interface RecoveryPolicyParams {
  delayLedgers: number;
  windowLedgers: number;
  targetRuleId: number;
  quorumPolicy?: string | null;
}

/** `RecoveryAccountParams` ScVal — fields in alphabetical key order, as Soroban requires. */
export function encodeRecoveryPolicyParams(p: RecoveryPolicyParams): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('delay_ledgers'),
      val: xdr.ScVal.scvU32(p.delayLedgers),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('quorum_policy'),
      val: p.quorumPolicy
        ? new Address(p.quorumPolicy).toScVal()
        : xdr.ScVal.scvVoid(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('target_rule_id'),
      val: xdr.ScVal.scvU32(p.targetRuleId),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('window_ledgers'),
      val: xdr.ScVal.scvU32(p.windowLedgers),
    }),
  ]);
}

/**
 * `add_policy(context_rule_id, policy, install_param)` — attach a policy
 * contract to an existing context rule.
 *
 * ORDER MATTERS, IRREVERSIBLY, for the admin guard. Installing it on an
 * account whose "admin" context rule does not yet exist permanently destroys
 * that account's ability to be administered — the host rejects the re-entry
 * that would be needed to undo it. Create the rule first, verify it, then
 * install the policy. See BUILD.md in the contracts repo.
 */
export function addPolicyOp(
  accountAddress: string,
  ruleId: number,
  policyAddress: string,
  installParam: xdr.ScVal,
): xdr.Operation {
  return new Contract(accountAddress).call(
    'add_policy',
    xdr.ScVal.scvU32(ruleId),
    new Address(policyAddress).toScVal(),
    installParam,
  );
}

/**
 * `remove_policy(context_rule_id, policy_id)` — note this takes the policy's
 * *id* within the rule, not its address. Read it with `get_policy_id(address)`.
 */
export function removePolicyOp(
  accountAddress: string,
  ruleId: number,
  policyId: number,
): xdr.Operation {
  return new Contract(accountAddress).call(
    'remove_policy',
    xdr.ScVal.scvU32(ruleId),
    xdr.ScVal.scvU32(policyId),
  );
}

/** `remove_context_rule(id)` */
export function removeContextRuleOp(accountAddress: string, ruleId: number): xdr.Operation {
  return new Contract(accountAddress).call('remove_context_rule', xdr.ScVal.scvU32(ruleId));
}

/** `add_signer(rule_id, signer)` — returns a stable signer u32 id on-chain. */
export function addSignerOp(
  accountAddress: string,
  ruleId: number,
  signer: RuntimeSigner,
): xdr.Operation {
  return new Contract(accountAddress).call(
    'add_signer',
    xdr.ScVal.scvU32(ruleId),
    encodeRuntimeSigner(signer),
  );
}

/**
 * `execute(<recovery policy>, "propose", [account, rule_id, fn_name, args])`
 *
 * A guardian quorum opening a recovery. Routed through the account's own
 * `execute` rather than called on the policy directly, because the policy's
 * `enforce` admits exactly one shape — an `execute` aimed at its own `propose` —
 * and the guardian rule is scoped to `CallContract(<account>)`, so a direct call
 * on the policy would not match the rule at all.
 *
 * `args` must be byte-identical to what is later presented to the account, or
 * the policy rejects the finalize as ProposalMismatch. Build both with
 * `recoveryAddSignerArgs`.
 */
export function recoveryProposeOp(
  accountAddress: string,
  policyAddress: string,
  guardianRuleId: number,
  fnName: string,
  args: xdr.ScVal[],
): xdr.Operation {
  return new Contract(accountAddress).call(
    'execute',
    new Address(policyAddress).toScVal(),
    xdr.ScVal.scvSymbol('propose'),
    xdr.ScVal.scvVec([
      new Address(accountAddress).toScVal(),
      xdr.ScVal.scvU32(guardianRuleId),
      xdr.ScVal.scvSymbol(fnName),
      xdr.ScVal.scvVec(args),
    ]),
  );
}

/**
 * The two arguments `add_signer(context_rule_id, signer)` takes, as a recovery
 * pins them. Shared by propose and finalize so the encodings cannot drift — the
 * policy compares them for exact equality.
 */
export function recoveryAddSignerArgs(
  targetRuleId: number,
  signer: RuntimeSigner,
): xdr.ScVal[] {
  return [xdr.ScVal.scvU32(targetRuleId), encodeRuntimeSigner(signer)];
}

/** `batch_add_signer(rule_id, signers)` — adds multiple signers in one tx. */
export function batchAddSignerOp(
  accountAddress: string,
  ruleId: number,
  signers: RuntimeSigner[],
): xdr.Operation {
  return new Contract(accountAddress).call(
    'batch_add_signer',
    xdr.ScVal.scvU32(ruleId),
    xdr.ScVal.scvVec(signers.map(encodeRuntimeSigner)),
  );
}

/**
 * `remove_signer(rule_id, signer_id)`
 *
 * SAFETY: callers MUST verify that the resulting signer_count >= threshold
 * for the rule. Removing past that point makes the rule unreachable and can
 * lock the account permanently (see latch-smart-account/README.md "Risks").
 */
export function removeSignerOp(
  accountAddress: string,
  ruleId: number,
  signerId: number,
): xdr.Operation {
  return new Contract(accountAddress).call(
    'remove_signer',
    xdr.ScVal.scvU32(ruleId),
    xdr.ScVal.scvU32(signerId),
  );
}

/**
 * `ThresholdPolicy.set_threshold(threshold, context_rule, smart_account)`
 *
 * Called on the threshold-policy contract (not the account itself). The
 * context_rule argument identifies which rule's threshold to change.
 */
export function setThresholdOp(
  thresholdPolicyAddress: string,
  threshold: number,
  contextRule: ContextRuleScVal,
  smartAccountAddress: string,
): xdr.Operation {
  return new Contract(thresholdPolicyAddress).call(
    'set_threshold',
    xdr.ScVal.scvU32(threshold),
    contextRule,
    new Address(smartAccountAddress).toScVal(),
  );
}

/**
 * The ContextRule struct that `set_threshold` requires. Callers normally
 * obtain this by calling `get_context_rule(id)` on the account contract
 * and forwarding the returned ScVal opaquely.
 */
export type ContextRuleScVal = xdr.ScVal;

// ─── Factory verifier discovery ───────────────────────────────────────────

export interface FactoryVerifiers {
  ed25519: string;
  webauthn: string;
  secp256k1: string;
  thresholdPolicy: string;
}

type SimulationParams = { rpcUrl: string; networkPassphrase: string; factoryAddress: string };

/**
 * Discover the factory-deployed verifier and threshold-policy addresses by
 * simulating `get_verifier` / `get_threshold_policy` calls. Cache the
 * result — these are constants for the lifetime of a factory deployment.
 */
export async function fetchFactoryVerifiers(p: SimulationParams): Promise<FactoryVerifiers> {
  const [ed25519, webauthn, secp256k1, thresholdPolicy] = await Promise.all([
    simulateScalarCall(p, 'get_verifier', [
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Ed25519')]),
    ]),
    simulateScalarCall(p, 'get_verifier', [
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('WebAuthn')]),
    ]),
    simulateScalarCall(p, 'get_verifier', [
      xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Secp256k1')]),
    ]),
    simulateScalarCall(p, 'get_threshold_policy', []),
  ]);
  return { ed25519, webauthn, secp256k1, thresholdPolicy };
}

/**
 * Fixed source account for read-only simulations (the all-zero Ed25519 seed's
 * public key). Simulations are never signed or submitted, so the source only
 * needs to be a syntactically valid address — this avoids a CSPRNG dependency.
 */
const SIM_SOURCE_ACCOUNT = 'GA5WUJ54Z23KILLCUOUNAKTPBVZWKMQVO4O6EQ5GHLAERIMLLHNCSKYH';

/**
 * Run a read-only contract call via `simulateTransaction` and return its
 * return value as a native JS value. Used for view getters on either the
 * factory or an account contract.
 */
async function simulateRead(
  p: SimulationParams,
  contractAddress: string,
  method: string,
  args: xdr.ScVal[],
): Promise<any> {
  // Read-only simulation: nothing is signed, so any valid source address
  // works. Use a fixed, deterministic one rather than Keypair.random(), which
  // needs crypto.getRandomValues — not polyfilled in every RN context.
  const dummyAccount = new Account(SIM_SOURCE_ACCOUNT, '0');
  const contract = new Contract(contractAddress);
  const tx = new TransactionBuilder(dummyAccount, {
    fee: '100',
    networkPassphrase: p.networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const raw = await sorobanCall(p.rpcUrl, 'simulateTransaction', { transaction: txToBase64(tx) });
  if (raw.error) throw new Error(`${method} simulation failed: ${raw.error}`);
  // Soroban RPC returns the call's return value under `results[0].xdr`.
  // (`retval` is kept as a defensive fallback for older RPC shapes.)
  const encoded = raw.results?.[0]?.xdr ?? raw.results?.[0]?.retval;
  if (!encoded) throw new Error(`${method}: no return value in simulation result`);
  return scValToNative(xdr.ScVal.fromXDR(encoded, 'base64'));
}

async function simulateScalarCall(
  p: SimulationParams,
  method: string,
  args: xdr.ScVal[],
): Promise<string> {
  return simulateRead(p, p.factoryAddress, method, args);
}

// ─── On-chain signer reads ────────────────────────────────────────────────

/** A signer as it currently exists on-chain in a context rule. */
export interface ChainSigner {
  kind: 'ed25519' | 'webauthn' | 'delegated';
  /** Canonical signer key, matching `signerKeyOf()` in pairing-context.ts. */
  signerKey: string;
  /** Hex key material for external signers; '' for delegated. */
  keyDataHex: string;
  /** Contract/account address for delegated signers; undefined otherwise. */
  address?: string;
  /** Verifier contract this External signer is registered under; undefined for delegated. */
  verifierAddress?: string;
  /**
   * True when `verifierAddress` is NOT one of the CURRENT factory's verifiers —
   * i.e. the account was deployed under a different (older) factory. The `kind`
   * is then inferred from key shape, and the caller MUST verify the verifier is
   * byte-compatible (isVerifierCompatible) before re-registering this signer.
   */
  foreignVerifier?: boolean;
}

export interface DefaultContextRule {
  /** On-chain id of the Default rule — discovered, not assumed to be 0 or 1. */
  ruleId: number;
  /** Signers currently attached to the Default rule. */
  signers: ChainSigner[];
}

function bytesToHex(value: unknown): string {
  if (typeof value === 'string') return value; // already hex (defensive)
  return Buffer.from(value as Uint8Array).toString('hex');
}

/** Reverse of `encodeRuntimeSigner` — decode a `Signer` enum native back to a ChainSigner. */
function decodeChainSigner(native: any, verifiers: FactoryVerifiers): ChainSigner {
  // Signer enum natives: ["Delegated", address] | ["External", verifier, bytes]
  const variant = Array.isArray(native) ? native[0] : undefined;
  if (variant === 'Delegated') {
    const address = String(native[1]);
    return { kind: 'delegated', signerKey: `delegated:${address}`, keyDataHex: '', address };
  }
  if (variant === 'External') {
    const verifierAddress = String(native[1]);
    const keyDataHex = bytesToHex(native[2]);
    if (verifierAddress === verifiers.ed25519) {
      return { kind: 'ed25519', signerKey: `ed25519:${keyDataHex}`, keyDataHex, verifierAddress };
    }
    if (verifierAddress === verifiers.webauthn) {
      return { kind: 'webauthn', signerKey: `webauthn:${keyDataHex}`, keyDataHex, verifierAddress };
    }
    // Foreign verifier (account deployed under a different factory). Don't give
    // up — infer the kind from the key shape so the caller can decide, after a
    // wasm-compatibility check, whether the signer is still usable.
    const kind = inferExternalKindFromKey(keyDataHex);
    if (!kind) {
      throw new Error(
        `unrecognized signer key shape for foreign verifier ${verifierAddress}`,
      );
    }
    return {
      kind,
      signerKey: `${kind}:${keyDataHex}`,
      keyDataHex,
      verifierAddress,
      foreignVerifier: true,
    };
  }
  throw new Error(`unrecognised Signer variant: ${JSON.stringify(variant)}`);
}

/**
 * Infer an External signer's kind from its raw key bytes when the verifier
 * address is unrecognized. Ed25519 keys are exactly 32 bytes; WebAuthn keys are
 * a 65-byte uncompressed P-256 point (0x04 prefix) with the credential id
 * appended (so > 65 bytes). A bare 65-byte 0x04 point is Secp256k1, which Latch
 * doesn't use as a member signer — returns null so the caller rejects it.
 */
function inferExternalKindFromKey(keyDataHex: string): 'ed25519' | 'webauthn' | null {
  const len = keyDataHex.length / 2;
  if (len === 32) return 'ed25519';
  if (len > 65 && keyDataHex.startsWith('04')) return 'webauthn';
  return null;
}

function isDefaultRuleType(contextType: any): boolean {
  if (Array.isArray(contextType)) return contextType[0] === 'Default';
  return contextType === 'Default';
}

/**
 * Read the account's Default context rule — the normal-operations rule that
 * holds every paired device — directly from chain via read-only simulation.
 *
 * The Default rule id is discovered by enumerating `get_context_rule(i)`, NOT
 * assumed to be 0 or 1: the admin rule installed during the first pairing
 * occupies its own id, so hardcoding the default id is a latent bug.
 */
export async function fetchDefaultContextRule(
  p: SimulationParams,
  accountAddress: string,
): Promise<DefaultContextRule> {
  const verifiers = await fetchFactoryVerifiers(p);
  const count = Number(await simulateRead(p, accountAddress, 'get_context_rules_count', []));

  for (let i = 0; i < count; i++) {
    let rule: any;
    try {
      rule = await simulateRead(p, accountAddress, 'get_context_rule', [xdr.ScVal.scvU32(i)]);
    } catch {
      continue; // id gap left by a prior rule removal — skip
    }
    if (rule && isDefaultRuleType(rule.context_type)) {
      const ruleId = typeof rule.id === 'number' ? rule.id : i;
      const signers = (rule.signers as any[]).map((s) => decodeChainSigner(s, verifiers));
      return { ruleId, signers };
    }
  }
  throw new Error('no Default context rule found on account');
}

/**
 * Read the AUTHORITATIVE on-chain approval threshold for a context rule by
 * querying the factory's threshold-policy contract (`get_threshold(rule_id,
 * account)`). This is the single source of truth for "how many signatures
 * does a transfer from this account need" — the client must gate submission
 * on THIS value, never on a locally-cached field that can drift from chain
 * (the drift is what let a 1-of-N transfer through; see the multisig audit).
 *
 * Throws if the rule has no threshold policy installed (i.e. a single-signer
 * account) — callers that might hit a non-multisig account should catch and
 * treat the absence as "no multisig threshold to enforce".
 */
export async function fetchRuleThreshold(
  p: SimulationParams,
  accountAddress: string,
  ruleId: number,
): Promise<number> {
  const verifiers = await fetchFactoryVerifiers(p);
  const threshold = await simulateRead(p, verifiers.thresholdPolicy, 'get_threshold', [
    xdr.ScVal.scvU32(ruleId),
    new Address(accountAddress).toScVal(),
  ]);
  return Number(threshold);
}

/**
 * Read a contract's installed Wasm hash (hex) from its instance ledger entry.
 * Used to compare two verifier contracts for byte-identical implementation.
 */
export async function fetchContractWasmHash(
  p: SimulationParams,
  contractId: string,
): Promise<string> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const raw = await sorobanCall(p.rpcUrl, 'getLedgerEntries', { keys: [ledgerKeyToBase64(key)] });
  const entryXdr = raw.entries?.[0]?.xdr;
  if (!entryXdr) throw new Error(`contract ${contractId}: no instance ledger entry`);
  const data = xdr.LedgerEntryData.fromXDR(entryXdr, 'base64');
  const exec = data.contractData().val().instance().executable();
  if (exec.switch().name !== 'contractExecutableWasm') {
    throw new Error(`contract ${contractId}: not a wasm contract`);
  }
  return exec.wasmHash().toString('hex');
}

/**
 * Whether `verifierAddress` is safe to treat as the current factory's verifier
 * of `kind`. True when it IS the current verifier, or when it's a different
 * contract address with a byte-identical Wasm (same verification logic — e.g. a
 * factory redeployed pointing at the same verifier code). A different Wasm means
 * a member's device signatures may not verify under our verifier, so callers
 * must reject those signers rather than register a broken one.
 */
export async function isVerifierCompatible(
  p: SimulationParams,
  verifierAddress: string,
  kind: 'ed25519' | 'webauthn',
): Promise<boolean> {
  const verifiers = await fetchFactoryVerifiers(p);
  const current = kind === 'ed25519' ? verifiers.ed25519 : verifiers.webauthn;
  if (verifierAddress === current) return true;
  const [foreign, cur] = await Promise.all([
    fetchContractWasmHash(p, verifierAddress),
    fetchContractWasmHash(p, current),
  ]);
  return foreign === cur;
}
