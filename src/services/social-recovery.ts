/**
 * social-recovery.ts — orchestration for the Recovery Policy on a
 * LatchSmartAccount.
 *
 * Social recovery gives a set of guardians a *scoped, time-delayed* path to
 * put a new device key on the account, without ever giving them the ability to
 * spend. The shape is dictated by the deployed policy contract, not chosen
 * here:
 *
 *   - The guardian rule must be `CallContract(<the account itself>)`. The
 *     policy rejects anything else (RecoveryError::NotSelfScoped).
 *   - It must carry the factory's threshold policy as its quorum. A rule that
 *     carries any policy defers signer counting to its policies, so a guardian
 *     rule without a quorum policy is 1-of-N no matter how many guardians it
 *     names. `install` verifies the declared quorum policy is present, which is
 *     why the rule is created WITH it rather than having it added after.
 *   - `target_rule_id` must be a different rule, so the quorum can never
 *     rewrite its own membership. It is the default rule: recovery exists to
 *     restore spending access.
 *   - `delay_ledgers` has a contract-enforced floor of 720 (~1 hour). The delay
 *     is the owner's veto window and the only thing standing between a
 *     colluding quorum and the account.
 *
 * Creating the guardian rule does NOT reduce the owner's control. Rule
 * selection is made by the signer per auth context (AuthPayload.context_rule_ids)
 * and a Default rule matches any context, so rule 0 keeps authorising
 * everything it did before. The guardian rule is an additional narrower path.
 *
 * The lifecycle, and who can do what:
 *
 *   setUpRecovery   owner      creates the guardian rule + installs the policy
 *   propose         guardians  starts the veto window (quorum required)
 *   cancelRecovery  owner      the veto; guardians cannot reach it
 *   finalize        guardians  spends the matured proposal, once
 *
 * Verified end-to-end against testnet — see scripts/recovery-testbed.ts, which
 * drives these same calls outside React Native.
 */

import {
  Account,
  Address,
  Contract,
  Keypair,
  Operation,
  rpc,
  scValToNative,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import {
  addContextRuleOp,
  encodeRecoveryPolicyParams,
  encodeThresholdPolicyParams,
  fetchFactoryVerifiers,
  fetchRuleThreshold,
  recoveryAddSignerArgs,
  recoveryProposeOp,
  type RuntimeSigner,
} from '@/src/api/account-admin';
import {
  ledgerKeyToBase64,
  parseSimResult,
  sorobanCall,
  toBase64,
  txToBase64,
} from '@/src/api/soroban-rpc';
import { bundlerAddress, submitViaBundler } from '@/src/api/transaction-relay';
import {
  RECOVERY_POLICY_ADDRESS,
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { createLogger } from '@/src/lib/logger';
import { getStoredKeyDataHex } from '@/src/lib/passkey-webauthn';
import { deriveWalletAtIndex } from '@/src/lib/seed-wallet';
import {
  authDigestFor,
  loadAccount,
  resolveRegisteredEd25519Verifier,
  resolveRegisteredWebAuthnVerifier,
  signPasskeyAuthEntry,
  signSmartAccountAuthEntry,
} from '@/src/services/send-token';

const log = createLogger('social-recovery');

/** Ledgers close about every 5 seconds. */
export const SECONDS_PER_LEDGER = 5;

/**
 * Contract floor for `delay_ledgers` (RecoveryError::InvalidParams below this).
 * ~1 hour. Offered in the UI only because a shorter delay is impossible, not
 * because it is a sensible choice — the contract's own guidance is days.
 */
export const MIN_DELAY_LEDGERS = 720;

/** How long a matured proposal stays usable before it lapses. ~24 hours. */
export const DEFAULT_WINDOW_LEDGERS = 17280;

/** Name given to the guardian context rule, used to find it again on chain. */
export const GUARDIAN_RULE_NAME = 'recovery';

/**
 * A guardian, in one of the two forms the account can store.
 *
 *   ed25519    an ordinary Stellar account (G…), held as
 *              `Signer::External(ed25519Verifier, publicKey)`. Authenticating
 *              means producing a detached signature over Latch's auth digest,
 *              so this guardian needs Latch (or a compatible signer) to act.
 *
 *   delegated  any address (C… smart account, or G…), held as
 *              `Signer::Delegated(address)`. The contract authenticates it with
 *              `address.require_auth_for_args((auth_digest,))`, so the guardian
 *              authorises with their OWN account's auth entry — a smart account
 *              guardian can use whatever signers and policies it already has,
 *              including its own passkeys and multisig.
 *
 * G-addresses default to `ed25519` rather than `delegated` because that is the
 * form already proven on chain, and because a delegated G-address guardian must
 * co-sign the recovery transaction itself, which is a heavier flow. A C-address
 * has no ed25519 public key, so it can only be delegated.
 */
export type GuardianKind = 'ed25519' | 'passkey' | 'delegated';

export interface Guardian {
  /**
   * How this guardian is identified to a person. A G- or C-address for the
   * address-backed kinds; for a passkey, which has no address, the guardian
   * code they shared (see encodeGuardianCode).
   */
  address: string;
  kind: GuardianKind;
  /**
   * Raw ed25519 public key hex — what the account stores as key_data.
   * Present only for `kind: 'ed25519'`.
   */
  publicKeyHex?: string;
  /**
   * The verifier this guardian is registered under, as stored on the rule.
   *
   * Kept because __check_auth matches the exact `External(verifier, key_data)`
   * tuple, and a guardian lives on the guardian rule, not the default one — so
   * the default-rule lookup used for the owner's own key cannot find it and
   * would fall back to whatever the factory points at today. Present only for
   * `kind: 'ed25519'`.
   */
  verifierAddress?: string;
  /**
   * WebAuthn key_data as stored on chain — the P-256 point with the credential
   * id appended. Present only for `kind: 'passkey'`.
   */
  keyDataHex?: string;
}

/**
 * A shareable identifier for a guardian who has no address.
 *
 * A passkey is a raw key blob, so there is nothing for the account owner to
 * type. The guardian's device produces this string and sends it over any
 * channel; the owner pastes it in. It carries no secret — the key material is
 * public, and is what the account will store on chain.
 *
 * Deliberately not the device-pairing challenge/response: pairing proves
 * possession because it grants a spending signer. A guardian grants nothing, so
 * the cost of a wrong value is a recovery path that silently will not work, not
 * a compromised account. Proof of possession would be an improvement, not a
 * prerequisite.
 */
const GUARDIAN_CODE_PREFIX = 'latch-guardian:v1:';

export function encodeGuardianCode(guardian: Guardian): string {
  if (guardian.kind === 'passkey') {
    return `${GUARDIAN_CODE_PREFIX}webauthn:${guardian.keyDataHex}`;
  }
  return `${GUARDIAN_CODE_PREFIX}${guardian.kind}:${guardian.address}`;
}

/** Parse a guardian code. Returns null for anything that is not one. */
function parseGuardianCode(text: string): Guardian | null {
  if (!text.startsWith(GUARDIAN_CODE_PREFIX)) return null;
  const rest = text.slice(GUARDIAN_CODE_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep < 0) return null;

  const kind = rest.slice(0, sep);
  const value = rest.slice(sep + 1).trim();

  if (kind === 'webauthn') {
    // 65-byte P-256 point (0x04-prefixed) with the credential id appended, so
    // longer than 65 bytes. A 32-byte value here would be an ed25519 key in the
    // wrong slot.
    if (!/^04[0-9a-f]{128,}$/i.test(value)) return null;
    return { address: text, kind: 'passkey', keyDataHex: value.toLowerCase() };
  }
  if (kind === 'ed25519' || kind === 'delegated') return toGuardian(value);
  return null;
}

/**
 * Classify an address into the guardian form it can take, or null if it is
 * neither a Stellar account nor a contract.
 */
export function guardianKindFor(input: string): GuardianKind | null {
  const value = input.trim();
  if (value.startsWith(GUARDIAN_CODE_PREFIX)) return parseGuardianCode(value)?.kind ?? null;
  if (StrKey.isValidEd25519PublicKey(value)) return 'ed25519';
  if (StrKey.isValidContract(value)) return 'delegated';
  return null;
}

/**
 * Build a Guardian from whatever the owner pasted: a G-address, a C-address, or
 * a guardian code. Throws on anything else.
 */
export function toGuardian(input: string): Guardian {
  const value = input.trim();

  if (value.startsWith(GUARDIAN_CODE_PREFIX)) {
    const parsed = parseGuardianCode(value);
    if (!parsed) throw new Error('that guardian code is not valid');
    return parsed;
  }

  if (StrKey.isValidContract(value)) return { address: value, kind: 'delegated' };
  if (StrKey.isValidEd25519PublicKey(value)) {
    return {
      address: value,
      kind: 'ed25519',
      publicKeyHex: Buffer.from(StrKey.decodeEd25519PublicKey(value)).toString('hex'),
    };
  }
  throw new Error('not an address or a guardian code');
}

export interface PendingRecovery {
  /** The account function the quorum intends to call. */
  fnName: string;
  /** First ledger at which it may be used. */
  readyAt: number;
  /** Last ledger at which it may be used. */
  expiresAt: number;
}

/** One guardian rule, with its configuration and any proposal against it. */
export interface RecoveryRule {
  ruleId: number;
  guardians: Guardian[];
  /** How many guardians must agree. */
  threshold: number;
  /**
   * The rule a recovery on this guardian rule may act on, as the policy stored
   * it at install time. Carried rather than recomputed: propose and finalize
   * must present byte-identical args, and the args name this id.
   */
  targetRuleId: number;
  delayLedgers: number;
  windowLedgers: number;
  pending: PendingRecovery | null;
}

export interface RecoveryStatus {
  /**
   * Every recovery rule on the account, in id order.
   *
   * A list, not one rule. An account is meant to have a single guardian rule
   * and setUpRecovery refuses to add a second, but nothing on chain prevents
   * one — and each rule can independently recover the account. Reporting only
   * the first would hide a live proposal on any of the others, which is exactly
   * the thing the owner has to see.
   */
  rules: RecoveryRule[];
  /** Current ledger, so a caller can position each `pending` in time. */
  currentLedger: number;
}

/** Any proposal in flight, across every rule. */
export function pendingRules(status: RecoveryStatus): RecoveryRule[] {
  return status.rules.filter(
    (r) => r.pending && pendingPhase(r.pending, status.currentLedger) !== 'expired',
  );
}

export type PendingPhase = 'veto' | 'enforceable' | 'expired';

export function pendingPhase(p: PendingRecovery, currentLedger: number): PendingPhase {
  if (currentLedger < p.readyAt) return 'veto';
  if (currentLedger <= p.expiresAt) return 'enforceable';
  return 'expired';
}

/** Ledgers as a rough human duration, for countdowns. */
export function humanLedgers(ledgers: number): string {
  const seconds = Math.max(ledgers, 0) * SECONDS_PER_LEDGER;
  if (seconds < 90) return 'less than a minute';
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 86400) {
    const h = seconds / 3600;
    return `${h < 10 ? h.toFixed(1) : Math.round(h)} hours`;
  }
  const d = seconds / 86400;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}

// ─── reads ────────────────────────────────────────────────────────────────────

function simParams() {
  return {
    rpcUrl: STELLAR_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    factoryAddress: STELLAR_FACTORY_ADDRESS,
  };
}

/**
 * Read-only contract call. Uses a fixed dummy source account: a simulation is
 * never signed or submitted, so the source only has to be a valid address.
 */
const SIM_SOURCE = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * Returns the decoded return value, or null when the function genuinely
 * returned void (`Option::None` decodes this way — `get_pending` does it
 * constantly). THROWS when the call failed.
 *
 * Deliberately not routed through parseSimResult. That helper exists to feed
 * `rpc.assembleTransaction` and papers over a missing return value by
 * substituting scvVoid, which decodes to null — so a *failed* read became
 * indistinguishable from one that returned nothing, and callers expecting an
 * object got null instead of an error. Reads need the opposite bias: fail loudly,
 * and reserve null for real absence.
 */
async function simulateRead(
  contractId: string,
  fn: string,
  ...args: xdr.ScVal[]
): Promise<unknown | null> {
  const tx = new TransactionBuilder(new Account(SIM_SOURCE, '0'), {
    fee: '100',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(contractId).call(fn, ...args))
    .setTimeout(30)
    .build();

  const raw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(tx),
  });
  if (raw?.error) throw new Error(`${fn}: ${raw.error}`);

  const result = raw?.results?.[0];
  if (!result) throw new Error(`${fn}: the simulation returned no result`);

  // The return value lives under `results[0].xdr`. NOT `retval` — that field
  // does not exist on current Soroban RPC, and reading it yields undefined for
  // every call, which silently reads as "this contract returned nothing".
  // `retval` is kept only as a fallback for older RPC shapes, matching
  // simulateRead in src/api/account-admin.ts.
  const encoded = result.xdr ?? result.retval;
  if (!encoded) return null;

  return scValToNative(xdr.ScVal.fromXDR(encoded, 'base64'));
}

/** True for a decoded contract struct — i.e. not void, not a scalar. */
function isStruct(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether the contract exists on the active network.
 *
 * Worth its own check: an account deployed on testnet is absent on mainnet, and
 * every read below would otherwise fail one at a time with a contract error that
 * says nothing useful to the person reading it.
 */
async function isDeployed(smartAccountAddress: string): Promise<boolean> {
  const key = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(smartAccountAddress).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const raw = await sorobanCall(STELLAR_RPC_URL, 'getLedgerEntries', {
    keys: [ledgerKeyToBase64(key)],
  });
  return Boolean(raw?.entries?.length);
}

/**
 * The id space to scan when enumerating context rules.
 *
 * `NextId` is a monotonic counter the account never decrements, so it is an
 * upper bound on live rule ids. `get_context_rules_count()` is NOT: once any
 * rule has been removed the count drops below the highest id in use, and
 * scanning `0..count` both misses live rules at the top and hits missing ids in
 * the middle. Read the counter and tolerate the gaps.
 */
async function fetchRuleIdBound(smartAccountAddress: string): Promise<number> {
  const instanceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(smartAccountAddress).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

  const raw = await sorobanCall(STELLAR_RPC_URL, 'getLedgerEntries', {
    keys: [ledgerKeyToBase64(instanceKey)],
  });
  if (!raw.entries?.length) throw new Error('smart account not found in ledger');

  const entryData = xdr.LedgerEntryData.fromXDR(raw.entries[0].xdr, 'base64');
  const storage = entryData.contractData().val().instance().storage() ?? [];

  for (const pair of storage) {
    const key = scValToNative(pair.key());
    // Unit enum variants decode to a single-element array; accept a bare string
    // too, in case a future encoding flattens them.
    const isNextId = (Array.isArray(key) && key[0] === 'NextId') || key === 'NextId';
    if (isNextId) return Number(scValToNative(pair.val()));
  }

  // Fall back to the count. Equal to NextId until the first rule is removed.
  const count = await simulateRead(smartAccountAddress, 'get_context_rules_count');
  if (typeof count !== 'number' && typeof count !== 'bigint') {
    throw new Error('could not read this account\u2019s context rules');
  }
  return Number(count);
}

/**
 * The id of the account's Default context rule — the one the owner signs under.
 *
 * Every owner action here is authorised by this rule, and the id has to be
 * read rather than assumed. A Default rule matches any auth context, which is
 * why it can authorise a call to the recovery policy at all; the guardian rule,
 * scoped to `CallContract(<account>)`, cannot. So naming the wrong id is not a
 * near miss — for `cancel`, whose context is a call to the POLICY, no other
 * rule on the account can stand in, and the host rejects the transaction with
 * Error(Auth, InvalidAction).
 *
 * Scanned over `fetchRuleIdBound` rather than `get_context_rules_count`,
 * because the count undercounts once any rule has been removed and would miss a
 * default rule living above it.
 */
async function ownerRuleId(smartAccountAddress: string): Promise<number> {
  const bound = await fetchRuleIdBound(smartAccountAddress);

  for (let id = 0; id < bound; id++) {
    let rule: unknown;
    try {
      rule = await simulateRead(smartAccountAddress, 'get_context_rule', xdr.ScVal.scvU32(id));
    } catch {
      continue; // a hole left by a removed rule
    }
    // Unit enum variants decode to a single-element array; a bare string is
    // accepted in case a future encoding flattens them.
    const type = isStruct(rule) ? rule.context_type : null;
    const isDefault =
      (Array.isArray(type) && type[0] === 'Default') || type === 'Default';
    if (isDefault) return id;
  }

  throw new Error(
    'this account has no default context rule, so there is no rule the owner can sign under',
  );
}

/**
 * Everything the recovery UI needs, in one call.
 *
 * An empty `rules` list means recovery is not set up, which is the normal state
 * for most accounts — not an error.
 */
export async function fetchRecoveryStatus(
  smartAccountAddress: string,
): Promise<RecoveryStatus> {
  if (!smartAccountAddress) {
    throw new Error('this account has no smart account address yet');
  }
  if (!(await isDeployed(smartAccountAddress))) {
    throw new Error(
      'this account is not deployed on this network, so it has no recovery settings',
    );
  }

  const latest = await sorobanCall(STELLAR_RPC_URL, 'getLatestLedger', {});
  const currentLedger = Number(latest?.sequence ?? 0);

  const bound = await fetchRuleIdBound(smartAccountAddress);
  const rules: RecoveryRule[] = [];

  // Recovery rules are identified by the policy they carry, not by their name:
  // the name is user-visible metadata that `update_context_rule_name` can
  // change, while the installed policy is what makes it a recovery rule.
  for (let id = 0; id < bound; id++) {
    // A removed rule leaves a hole in the id space; the account answers with
    // ContextRuleNotFound (#3000). Expected while scanning, not an error.
    let rule: unknown;
    try {
      rule = await simulateRead(smartAccountAddress, 'get_context_rule', xdr.ScVal.scvU32(id));
    } catch {
      continue;
    }
    if (!isStruct(rule)) continue;

    const policies = Array.isArray(rule.policies) ? (rule.policies as string[]) : [];
    if (!policies.includes(RECOVERY_POLICY_ADDRESS)) continue;

    // The rule carries the policy, so its config must exist — but read
    // defensively rather than trusting that invariant across a redeploy.
    const data = await simulateRead(
      RECOVERY_POLICY_ADDRESS,
      'get_recovery_data',
      xdr.ScVal.scvU32(id),
      new Address(smartAccountAddress).toScVal(),
    );
    if (!isStruct(data)) continue;

    // Option::None — the common case, and why simulateRead returns null rather
    // than throwing on void.
    const pendingRaw = await simulateRead(
      RECOVERY_POLICY_ADDRESS,
      'get_pending',
      xdr.ScVal.scvU32(id),
      new Address(smartAccountAddress).toScVal(),
    );

    rules.push({
      ruleId: id,
      guardians: decodeGuardians(Array.isArray(rule.signers) ? rule.signers : []),
      threshold: await fetchGuardianThreshold(smartAccountAddress, id),
      targetRuleId: Number(data.target_rule_id),
      delayLedgers: Number(data.delay_ledgers),
      windowLedgers: Number(data.window_ledgers),
      pending: isStruct(pendingRaw)
        ? {
            fnName: String(pendingRaw.fn_name),
            readyAt: Number(pendingRaw.ready_at),
            expiresAt: Number(pendingRaw.expires_at),
          }
        : null,
    });
  }

  return { rules, currentLedger };
}

/**
 * Decode a rule's stored signers back into guardians.
 *
 * `Signer::Delegated(addr)` yields the address directly. `Signer::External` is
 * classified by key length, which is what distinguishes the two kinds on chain:
 * exactly 32 bytes is an ed25519 public key (so it has a G-address form), and a
 * longer 0x04-prefixed key is a WebAuthn credential — a P-256 point with the
 * credential id appended. Anything else is a signer this app does not create,
 * and is skipped rather than shown as a guardian the owner cannot identify.
 */
function decodeGuardians(signers: unknown[]): Guardian[] {
  const out: Guardian[] = [];
  for (const s of signers) {
    if (!Array.isArray(s)) continue;

    if (s[0] === 'Delegated') {
      out.push({ address: String(s[1]), kind: 'delegated' });
      continue;
    }

    if (s[0] !== 'External') continue;
    const keyData = Buffer.from(s[2] as Uint8Array);
    const verifierAddress = String(s[1]);

    if (keyData.length === 32) {
      out.push({
        address: StrKey.encodeEd25519PublicKey(keyData),
        kind: 'ed25519',
        publicKeyHex: keyData.toString('hex'),
        verifierAddress,
      });
      continue;
    }

    if (keyData.length > 65 && keyData[0] === 0x04) {
      const keyDataHex = keyData.toString('hex');
      const guardian: Guardian = { address: '', kind: 'passkey', keyDataHex, verifierAddress };
      out.push({ ...guardian, address: encodeGuardianCode(guardian) });
    }
  }
  return out;
}

async function fetchGuardianThreshold(
  smartAccountAddress: string,
  ruleId: number,
): Promise<number> {
  try {
    return await fetchRuleThreshold(simParams(), smartAccountAddress, ruleId);
  } catch {
    // The threshold policy is installed by setUpRecovery, so its absence means
    // the rule was configured by something else. Report 0 rather than guess.
    return 0;
  }
}

// ─── writes ───────────────────────────────────────────────────────────────────

/**
 * How this device authorises a call on its own smart account.
 *
 * A seed-wallet account signs with a BIP-44 keypair; a passkey account signs a
 * WebAuthn assertion with the stored P-256 credential, which raises the OS
 * biometric prompt. Both end up as one entry in the same AuthPayload — the
 * difference is only which verifier the account registered the key under and
 * how the signature is produced.
 */
export type AccountAuthorizer =
  | { kind: 'ed25519'; keypair: Keypair }
  | { kind: 'passkey'; listIndex: number };

/**
 * Build an authorizer from a wallet account.
 *
 * `listIndex` is the account's POSITION in the wallet's accounts array, which is
 * not `account.index`: that field is the BIP-44 derivation index and is a
 * negative sentinel (-1, -2, …) on passkey and shared accounts, which derive no
 * key. SecureStore keys the device's passkey credential by list position — see
 * getPasskeyStorageKeys — so passing `account.index` reads a slot that has never
 * held anything and no signature can be produced at all.
 */
export function authorizerFor(
  account: { gAddress?: string | null; index: number },
  mnemonic: string | null,
  listIndex: number,
): AccountAuthorizer {
  if (account.gAddress) {
    if (!mnemonic) throw new Error('the wallet must be unlocked to sign');
    return { kind: 'ed25519', keypair: deriveWalletAtIndex(mnemonic, account.index).keypair };
  }
  return { kind: 'passkey', listIndex };
}

/**
 * Simulate → sign the account's auth entries → simulate again → submit.
 *
 * The second simulation is not redundant: with signatures attached the host
 * runs `__check_auth` for real, so a bad signature or a wrong context rule id
 * fails before anything is broadcast, and the assembled resource footprint
 * accounts for the signatures' size.
 *
 * `contextRuleId` is the rule the signers are authorised under — the account's
 * Default rule id (see ownerRuleId) for the owner, the guardian rule id for the
 * quorum. It is never a constant: the id is read off the account.
 */
async function submitAsAccount(
  smartAccountAddress: string,
  ops: xdr.Operation[],
  authorizer: AccountAuthorizer,
  contextRuleId: number,
): Promise<string> {
  const bundlerG = await bundlerAddress();
  const source = await loadAccount(bundlerG);

  const build = () => {
    const builder = new TransactionBuilder(
      new Account(bundlerG, source.sequenceNumber()),
      { fee: '2000000', networkPassphrase: STELLAR_NETWORK_PASSPHRASE },
    ).setTimeout(300);
    for (const op of ops) builder.addOperation(op);
    return builder.build();
  };

  const raw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(build()),
  });
  if (raw.error) throw new Error(`simulation failed: ${raw.error}`);
  const sim = parseSimResult(raw);

  const validUntil = (raw.latestLedger ?? 0) + 100;
  let signedEntries = 0;

  for (const entry of sim.result?.auth ?? []) {
    const creds = entry.credentials();
    if (creds.switch().name !== 'sorobanCredentialsAddress') continue;
    if (Address.fromScAddress(creds.address().address()).toString() !== smartAccountAddress) {
      continue;
    }
    signedEntries++;

    // The verifier must be the one the ACCOUNT registered this key under, not
    // whatever the factory currently points at — __check_auth matches on the
    // exact (verifier, key_data) tuple.
    if (authorizer.kind === 'ed25519') {
      const verifier = await resolveRegisteredEd25519Verifier(
        smartAccountAddress,
        Buffer.from(authorizer.keypair.rawPublicKey()).toString('hex'),
      );
      signSmartAccountAuthEntry(
        entry,
        authorizer.keypair,
        validUntil,
        verifier,
        contextRuleId,
      );
    } else {
      const verifier = await resolveRegisteredWebAuthnVerifier(
        smartAccountAddress,
        authorizer.listIndex,
      );
      // Raises the OS biometric prompt.
      await signPasskeyAuthEntry(
        entry,
        authorizer.listIndex,
        validUntil,
        verifier,
        contextRuleId,
      );
    }
  }

  const signed = rpc.assembleTransaction(build(), sim).build();

  const raw2 = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(signed),
  });
  if (raw2.error) {
    // Error(Auth, InvalidAction) arrives here with no indication of which of
    // the several things it could be went wrong, so say what was presented:
    // the rule the signature named, and whether anything was signed at all.
    throw new Error(
      `authorization check failed (signed ${signedEntries} entr${
        signedEntries === 1 ? 'y' : 'ies'
      } under context rule ${contextRuleId}): ${raw2.error}`,
    );
  }

  const prepared = rpc.assembleTransaction(signed, parseSimResult(raw2)).build();
  const { hash, status } = await submitViaBundler(prepared);
  if (status !== 'SUCCESS') throw new Error(`transaction status: ${status}`);
  log.debug('submitted', hash);
  return hash;
}

export interface SetUpRecoveryInput {
  smartAccountAddress: string;
  /** How this device signs. Authorises under the default rule. */
  authorizer: AccountAuthorizer;
  guardians: Guardian[];
  /** How many guardians must agree. Must be ≥ 1 and ≤ guardians.length. */
  threshold: number;
  /** The veto window. Floored at MIN_DELAY_LEDGERS by the contract. */
  delayLedgers: number;
}

/**
 * Create the guardian rule with both its policies, in one operation.
 *
 * Not two operations, and not two transactions. A Soroban transaction may carry
 * exactly one InvokeHostFunction, so `add_context_rule` + `add_policy` cannot
 * share a transaction — attempting it fails with "Transaction contains more
 * than one operation". Doing them as two sequential transactions would leave a
 * window in which the guardian rule is live with its quorum policy but WITHOUT
 * the recovery time-lock, and in that window the quorum holds unrestricted
 * self-call rights over the account: it could add its own signer to the
 * spending rule, or move funds through `execute`, with no veto period.
 *
 * Passing both policies to `add_context_rule` closes that window. The contract
 * assembles `context_rule.policies` from every key before installing any of
 * them, so the recovery policy's `install` sees the quorum policy it requires.
 */
export async function setUpRecovery(input: SetUpRecoveryInput): Promise<string> {
  const { smartAccountAddress, authorizer, guardians, threshold, delayLedgers } = input;

  if (guardians.length === 0) throw new Error('at least one guardian is required');
  if (threshold < 1 || threshold > guardians.length) {
    throw new Error('threshold must be between 1 and the number of guardians');
  }
  if (delayLedgers < MIN_DELAY_LEDGERS) {
    throw new Error(`the veto window must be at least ${MIN_DELAY_LEDGERS} ledgers`);
  }
  if (!RECOVERY_POLICY_ADDRESS) {
    throw new Error('no recovery policy is configured for this network');
  }

  // Refuse to add a second guardian rule.
  //
  // Nothing on chain prevents one, and each rule can independently recover the
  // account — so a duplicate silently doubles the attack surface and leaves the
  // owner with guardians they may not remember granting. It is easy to reach by
  // accident: a submit that times out or reports an error can still land, and
  // retrying then creates a second rule. Reading the chain first is the only
  // reliable guard, since local state cannot know what landed.
  const existing = await fetchRecoveryStatus(smartAccountAddress);
  if (existing.rules.length > 0) {
    throw new Error(
      'this account already has social recovery set up — remove the existing guardians before adding new ones',
    );
  }

  const verifiers = await fetchFactoryVerifiers(simParams());
  const runtimeGuardians: RuntimeSigner[] = guardians.map((g) => {
    if (g.kind === 'delegated') return { kind: 'delegated', address: g.address };
    // The verifier is chosen by signer kind: the account matches on the exact
    // (verifier, key_data) tuple, so a passkey registered under the ed25519
    // verifier could never authenticate.
    return g.kind === 'passkey'
      ? { kind: 'external', verifierAddress: verifiers.webauthn, keyDataHex: g.keyDataHex! }
      : { kind: 'external', verifierAddress: verifiers.ed25519, keyDataHex: g.publicKeyHex! };
  });

  // One read, used twice: recovery exists to restore spending access, so the
  // rule it targets is the same Default rule the owner is signing under.
  const defaultRuleId = await ownerRuleId(smartAccountAddress);

  const op = addContextRuleOp(
    smartAccountAddress,
    { kind: 'callContract', address: smartAccountAddress },
    GUARDIAN_RULE_NAME,
    null,
    runtimeGuardians,
    [
      {
        address: verifiers.thresholdPolicy,
        installParam: encodeThresholdPolicyParams(threshold),
      },
      {
        address: RECOVERY_POLICY_ADDRESS,
        installParam: encodeRecoveryPolicyParams({
          delayLedgers,
          windowLedgers: DEFAULT_WINDOW_LEDGERS,
          targetRuleId: defaultRuleId,
          quorumPolicy: verifiers.thresholdPolicy,
        }),
      },
    ],
  );

  return submitAsAccount(smartAccountAddress, [op], authorizer, defaultRuleId);
}

/**
 * The owner's veto. Signed under the default rule, which is the only way to
 * reach `cancel` — the policy never admits it from the guardian rule.
 */
export async function cancelRecovery(
  smartAccountAddress: string,
  authorizer: AccountAuthorizer,
  ruleId: number,
): Promise<string> {
  const op = new Contract(RECOVERY_POLICY_ADDRESS).call(
    'cancel',
    new Address(smartAccountAddress).toScVal(),
    xdr.ScVal.scvU32(ruleId),
  );
  return submitAsAccount(
    smartAccountAddress,
    [op],
    authorizer,
    await ownerRuleId(smartAccountAddress),
  );
}

// ─── guardian actions ─────────────────────────────────────────────────────────
//
// Taken by a guardian, from their own device, against an account they do not
// otherwise control. Both calls are authorised under the GUARDIAN rule, not the
// default one, so the AuthPayload names that rule's id — the guardians are not
// signers on rule 0 and signing under 0 would be rejected outright.

/** A guardian entry matched to something this device can actually sign with. */
export interface LocalGuardian {
  rule: RecoveryRule;
  guardian: Guardian;
  /** Present for an ed25519 guardian — the key that signs. */
  keypair?: Keypair;
  /** Present for a passkey guardian — which credential slot signs. */
  passkeyListIndex?: number;
  /** Present for a delegated guardian — the smart account that authorises. */
  delegated?: OwnedAccount;
}

export interface OwnedAccount {
  address: string;
  /** Position in the wallet's account list — selects the passkey slot. */
  listIndex: number;
  /** BIP-44 index, or -1 for a passkey account. */
  bip44Index: number;
}

/**
 * Why this device cannot act as a guardian on an account. Distinguished so the
 * UI can say something true instead of a generic failure.
 *
 *   not-a-guardian    none of this wallet's identities appear on any rule
 *   delegated-only    it IS a guardian, as a smart account rather than a key,
 *                     and that path is not implemented (see below)
 *   no-seed           a passkey wallet has no derived keys to match against
 */
export type GuardianMatchFailure = 'not-a-guardian' | 'no-seed';

export type GuardianMatch =
  | { ok: true; local: LocalGuardian }
  | { ok: false; reason: GuardianMatchFailure };

export interface GuardianIdentity {
  /** Seed phrase, when this is a seed wallet. Passkey wallets have none. */
  mnemonic: string | null;
  /** Smart accounts this wallet controls, for delegated guardians. */
  ownedAccounts: OwnedAccount[];
  /** How many passkey credential slots to check. Usually the account count. */
  passkeySlots?: number;
}

/**
 * Find a rule on which this device can act as a guardian.
 *
 * Two ways to be one:
 *
 *   ed25519    the rule stores this wallet's own public key. Matched by
 *              deriving the first few BIP-44 indices and comparing keys, rather
 *              than trusting a caller-supplied index — a device can then only
 *              ever act as a guardian it genuinely is.
 *
 *   delegated  the rule stores a smart account address this wallet controls.
 *              Recognised here so the UI can say so, but NOT actionable yet:
 *              the contract authenticates it with
 *              `address.require_auth_for_args((auth_digest,))`, which needs a
 *              second auth entry addressed to the guardian account — one the
 *              simulation never returns, because the nested require_auth only
 *              runs once __check_auth executes in the enforcing pass. Producing
 *              it means synthesising the entry and signing it with the guardian
 *              account's own signers.
 */
export async function findLocalGuardian(
  status: RecoveryStatus,
  identity: GuardianIdentity,
  maxIndexProbe = 10,
): Promise<GuardianMatch> {
  const derived = new Map<string, Keypair>();
  if (identity.mnemonic) {
    for (let index = 0; index < maxIndexProbe; index++) {
      const { publicKeyHex, keypair } = deriveWalletAtIndex(identity.mnemonic, index);
      derived.set(publicKeyHex.toLowerCase(), keypair);
    }
  }

  // Passkey credentials this device holds, by slot. Read once rather than per
  // guardian: SecureStore access is not free and the slot count is small.
  const passkeys = new Map<string, number>();
  const slots = Math.max(identity.passkeySlots ?? 0, 1);
  for (let index = 0; index < slots; index++) {
    const keyDataHex = await getStoredKeyDataHex(index);
    if (keyDataHex) passkeys.set(keyDataHex.toLowerCase(), index);
  }

  const owned = new Map(identity.ownedAccounts.map((a) => [a.address, a]));
  let delegatedMatch: { rule: RecoveryRule; guardian: Guardian; account: OwnedAccount } | null =
    null;

  for (const rule of status.rules) {
    for (const guardian of rule.guardians) {
      if (guardian.kind === 'delegated') {
        const account = owned.get(guardian.address);
        if (account && !delegatedMatch) delegatedMatch = { rule, guardian, account };
        continue;
      }

      if (guardian.kind === 'passkey' && guardian.keyDataHex) {
        const passkeyListIndex = passkeys.get(guardian.keyDataHex.toLowerCase());
        if (passkeyListIndex !== undefined) {
          return { ok: true, local: { rule, guardian, passkeyListIndex } };
        }
        continue;
      }

      if (!guardian.publicKeyHex) continue;
      const keypair = derived.get(guardian.publicKeyHex.toLowerCase());
      if (keypair) return { ok: true, local: { rule, guardian, keypair } };
    }
  }

  // Preferred last: a direct key signs with one entry, a delegated guardian
  // needs a second nested one. Same result, more moving parts.
  if (delegatedMatch) {
    return {
      ok: true,
      local: {
        rule: delegatedMatch.rule,
        guardian: delegatedMatch.guardian,
        delegated: delegatedMatch.account,
      },
    };
  }
  if (!identity.mnemonic && passkeys.size === 0) return { ok: false, reason: 'no-seed' };
  return { ok: false, reason: 'not-a-guardian' };
}

/**
 * This device's own guardian code, for the slot backing `listIndex`.
 *
 * A passkey guardian has no address, so this is what they send to the person
 * adding them. Returns null when the slot holds no credential.
 */
export async function localPasskeyGuardianCode(listIndex: number): Promise<string | null> {
  const keyDataHex = await getStoredKeyDataHex(listIndex);
  if (!keyDataHex) return null;
  return encodeGuardianCode({ address: '', kind: 'passkey', keyDataHex });
}

/**
 * The `Signer` a recovery installs on the default rule.
 *
 * Encoded identically at propose and at finalize: the policy compares the
 * pending args to the presented args for exact equality, so any difference —
 * including a different verifier address — fails as ProposalMismatch. Both
 * paths call this, so they cannot drift.
 */
async function recoveryArgs(publicKeyHex: string, targetRuleId: number): Promise<xdr.ScVal[]> {
  const verifiers = await fetchFactoryVerifiers(simParams());
  return recoveryAddSignerArgs(targetRuleId, {
    kind: 'external',
    verifierAddress: verifiers.ed25519,
    keyDataHex: publicKeyHex,
  });
}

/**
 * The operation for either guardian action.
 *
 * Shared by the direct path and the multi-guardian packet path so the two can
 * never build different transactions for the same request — the packet's whole
 * premise is that every guardian signs the identical entry.
 */
export async function recoveryActionOp(
  smartAccountAddress: string,
  rule: RecoveryRule,
  action: 'propose' | 'finalize',
  newSignerPublicKeyHex: string,
): Promise<xdr.Operation> {
  const args = await recoveryArgs(newSignerPublicKeyHex, rule.targetRuleId);
  if (action === 'finalize') {
    return new Contract(smartAccountAddress).call('add_signer', ...args);
  }
  return recoveryProposeOp(
    smartAccountAddress,
    RECOVERY_POLICY_ADDRESS,
    rule.ruleId,
    'add_signer',
    args,
  );
}

/**
 * Sign one shared auth entry as a guardian, in the form the packet flow
 * collects. Mutates the entry, as the signing primitives do.
 *
 * The expiration is read off the entry rather than set: the packet pins it when
 * the transaction is frozen, and changing it per signer would change the digest
 * and invalidate every signature already gathered.
 */
export async function signRecoveryEntryAs(
  entry: xdr.SorobanAuthorizationEntry,
  local: LocalGuardian,
): Promise<{ signerKey: string; authEntryXdr: string }> {
  const validUntil = entry.credentials().address().signatureExpirationLedger();
  const verifier = await guardianVerifier(local);

  if (local.passkeyListIndex !== undefined) {
    await signPasskeyAuthEntry(
      entry,
      local.passkeyListIndex,
      validUntil,
      verifier,
      local.rule.ruleId,
    );
  } else if (local.keypair) {
    signSmartAccountAuthEntry(entry, local.keypair, validUntil, verifier, local.rule.ruleId);
  } else {
    throw new Error('this guardian has no signing key on this device');
  }

  return {
    signerKey: guardianSignerKey(local),
    authEntryXdr: toBase64(new Uint8Array(entry.toXDR())),
  };
}

/**
 * The second auth entry a Delegated guardian needs.
 *
 * `Signer::Delegated(addr)` is authenticated by
 * `addr.require_auth_for_args((auth_digest,))` inside the recovered account's
 * __check_auth. That nested requirement never appears in a recording
 * simulation, so the entry has to be constructed: it authorises
 * `<recovered account>.__check_auth(auth_digest)` on the guardian's behalf, and
 * is itself signed by the guardian account's own signers.
 *
 * Verified on testnet with two controls: omitting this entry fails with
 * "Unauthorized function call for address", and attaching it succeeds even when
 * the transaction source is unrelated to the guardian.
 */
async function buildDelegatedGuardianEntry(
  recoveredAccount: string,
  local: LocalGuardian,
  accountEntry: xdr.SorobanAuthorizationEntry,
  validUntil: number,
  mnemonic: string | null,
): Promise<xdr.SorobanAuthorizationEntry> {
  const guardianAddress = local.guardian.address;
  const authDigest = authDigestFor(accountEntry, local.rule.ruleId);

  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(guardianAddress).toScAddress(),
        nonce: new xdr.Int64(BigInt(Date.now())),
        signatureExpirationLedger: validUntil,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(recoveredAccount).toScAddress(),
          functionName: '__check_auth',
          args: [xdr.ScVal.scvBytes(authDigest)],
        }),
      ),
      subInvocations: [],
    }),
  });

  const owned = local.delegated!;
  const guardianRuleId = await ownerRuleId(guardianAddress);

  if (owned.bip44Index >= 0) {
    if (!mnemonic) throw new Error('unlock your wallet to authorise as this guardian');
    const { keypair, publicKeyHex } = deriveWalletAtIndex(mnemonic, owned.bip44Index);
    const verifier = await resolveRegisteredEd25519Verifier(guardianAddress, publicKeyHex);
    signSmartAccountAuthEntry(entry, keypair, validUntil, verifier, guardianRuleId);
  } else {
    const verifier = await resolveRegisteredWebAuthnVerifier(guardianAddress, owned.listIndex);
    await signPasskeyAuthEntry(entry, owned.listIndex, validUntil, verifier, guardianRuleId);
  }

  return entry;
}

/** Stable identity for dedupe: whichever key the account actually stores. */
export function guardianSignerKey(local: LocalGuardian): string {
  return local.guardian.publicKeyHex ?? local.guardian.keyDataHex ?? local.guardian.address;
}

/**
 * The verifier the ACCOUNT registered this guardian under.
 *
 * Preferred over the factory's current one: __check_auth matches the exact
 * (verifier, key_data) tuple, so a guardian added under an older verifier must
 * be presented with that one. The fallback is per kind, because a passkey under
 * the ed25519 verifier could never authenticate.
 */
async function guardianVerifier(local: LocalGuardian): Promise<string> {
  if (local.guardian.verifierAddress) return local.guardian.verifierAddress;
  const verifiers = await fetchFactoryVerifiers(simParams());
  return local.passkeyListIndex !== undefined ? verifiers.webauthn : verifiers.ed25519;
}

export interface GuardianActionInput {
  smartAccountAddress: string;
  /** Needed only for a delegated guardian backed by a seed account. */
  mnemonic?: string | null;
  /** The guardian rule being acted under. */
  rule: RecoveryRule;
  /** This guardian's own key. */
  guardian: LocalGuardian;
  /** Public key of the replacement device, hex. */
  newSignerPublicKeyHex: string;
}

/**
 * Start a recovery: record the intended `add_signer` and open the veto window.
 *
 * Routed through the account's own `execute` rather than called on the policy
 * directly. The policy's `enforce` admits exactly one `execute` shape — one
 * aimed at its own `propose` — and the guardian rule is scoped to
 * `CallContract(<account>)`, so a direct call on the policy would not match the
 * rule at all. The nested `require_auth` inside `propose` needs no second
 * signature: the account is the immediate invoker, so Soroban treats it as
 * authorised, leaving exactly one auth context to sign.
 */
export async function proposeRecovery(input: GuardianActionInput): Promise<string> {
  const { smartAccountAddress, rule, guardian, newSignerPublicKeyHex } = input;
  assertGuardianCanAct(rule, newSignerPublicKeyHex);

  const op = await recoveryActionOp(smartAccountAddress, rule, 'propose', newSignerPublicKeyHex);
  return submitAsGuardian(smartAccountAddress, op, guardian, rule.ruleId, input.mnemonic ?? null);
}

/**
 * Complete a matured recovery. Consumes the proposal — it authorises exactly
 * one call, and the policy deletes it on success.
 */
export async function finalizeRecovery(input: GuardianActionInput): Promise<string> {
  const { smartAccountAddress, rule, guardian, newSignerPublicKeyHex } = input;
  assertGuardianCanAct(rule, newSignerPublicKeyHex);

  const op = await recoveryActionOp(smartAccountAddress, rule, 'finalize', newSignerPublicKeyHex);
  return submitAsGuardian(smartAccountAddress, op, guardian, rule.ruleId, input.mnemonic ?? null);
}

function assertGuardianCanAct(rule: RecoveryRule, newSignerPublicKeyHex: string): void {
  if (!RECOVERY_POLICY_ADDRESS) {
    throw new Error('no recovery policy is configured for this network');
  }
  if (!/^[0-9a-f]{64}$/i.test(newSignerPublicKeyHex)) {
    throw new Error('the new device key must be a 32-byte ed25519 public key');
  }
  // A quorum above 1 cannot be met by one device: every guardian must sign the
  // same frozen entry and the signatures merged before broadcast. That path is
  // recovery-cosign.ts, so callers route there instead of here.
  if (rule.threshold > 1) {
    throw new Error(
      `this group needs ${rule.threshold} guardians to agree — start a request they can approve instead`,
    );
  }
}

/**
 * Simulate → sign as the guardian → re-simulate → submit.
 *
 * Separate from submitAsAccount because the signer is a guardian rather than the
 * account owner: the rule id is the guardian rule, and the verifier is the one
 * the guardian is registered under on THAT rule.
 */
async function submitAsGuardian(
  smartAccountAddress: string,
  op: xdr.Operation,
  local: LocalGuardian,
  contextRuleId: number,
  mnemonic: string | null = null,
): Promise<string> {
  if (!local.keypair && local.passkeyListIndex === undefined && !local.delegated) {
    throw new Error('this guardian has no signing key on this device');
  }
  const bundlerG = await bundlerAddress();
  const source = await loadAccount(bundlerG);

  const build = () =>
    new TransactionBuilder(new Account(bundlerG, source.sequenceNumber()), {
      fee: '2000000',
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(300)
      .build();

  const raw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(build()),
  });
  if (raw.error) throw new Error(`simulation failed: ${raw.error}`);
  const sim = parseSimResult(raw);

  const validUntil = (raw.latestLedger ?? 0) + 100;

  // The verifier stored on the guardian rule, not the factory's current one —
  // an account whose guardians were registered under an older verifier must be
  // presented with that one, or the signer tuple will not match. The fallback
  // is per kind, because a passkey under the ed25519 verifier could never
  // authenticate.
  const isPasskey = local.passkeyListIndex !== undefined;
  const isDelegated = Boolean(local.delegated);
  const verifiers =
    local.guardian.verifierAddress || isDelegated
      ? null
      : await fetchFactoryVerifiers(simParams());
  const verifier =
    local.guardian.verifierAddress ??
    (isPasskey ? verifiers?.webauthn : verifiers?.ed25519) ??
    '';

  let delegatedEntry: xdr.SorobanAuthorizationEntry | null = null;

  for (const entry of sim.result?.auth ?? []) {
    const creds = entry.credentials();
    if (creds.switch().name !== 'sorobanCredentialsAddress') continue;
    if (Address.fromScAddress(creds.address().address()).toString() !== smartAccountAddress) {
      continue;
    }

    if (isDelegated) {
      // The signature bytes are ignored for a Delegated signer; the key must be
      // present so the rule's signer set matches, and the real authorisation is
      // the nested entry built below.
      entry.credentials().address().signatureExpirationLedger(validUntil);
      entry
        .credentials()
        .address()
        .signature(
          xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('context_rule_ids'),
              val: xdr.ScVal.scvVec([xdr.ScVal.scvU32(contextRuleId)]),
            }),
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvSymbol('signers'),
              val: xdr.ScVal.scvMap([
                new xdr.ScMapEntry({
                  key: xdr.ScVal.scvVec([
                    xdr.ScVal.scvSymbol('Delegated'),
                    new Address(local.guardian.address).toScVal(),
                  ]),
                  val: xdr.ScVal.scvBytes(Buffer.alloc(0)),
                }),
              ]),
            }),
          ]),
        );
      delegatedEntry = await buildDelegatedGuardianEntry(
        smartAccountAddress,
        local,
        entry,
        validUntil,
        mnemonic,
      );
    } else if (isPasskey) {
      await signPasskeyAuthEntry(
        entry,
        local.passkeyListIndex!,
        validUntil,
        verifier,
        contextRuleId,
      );
    } else {
      signSmartAccountAuthEntry(entry, local.keypair!, validUntil, verifier, contextRuleId);
    }
  }

  let signed = rpc.assembleTransaction(build(), sim).build();

  if (delegatedEntry) {
    const accountEntry = sim.result!.auth![0];
    const hostFn = (signed.operations[0] as { func: xdr.HostFunction }).func;
    signed = new TransactionBuilder(new Account(bundlerG, source.sequenceNumber()), {
      fee: '4000000',
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.invokeHostFunction({ func: hostFn, auth: [accountEntry, delegatedEntry] }),
      )
      .setTimeout(300)
      .build();
  }

  const raw2 = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(signed),
  });
  if (raw2.error) throw new Error(`authorization check failed: ${raw2.error}`);

  const prepared = rpc.assembleTransaction(signed, parseSimResult(raw2)).build();
  const { hash, status } = await submitViaBundler(prepared);
  if (status !== 'SUCCESS') throw new Error(`transaction status: ${status}`);
  log.debug('guardian action submitted', hash);
  return hash;
}

// ─── new-device recovery ──────────────────────────────────────────────────────
//
// The half of social recovery that runs on a device which has never seen the
// account. Everything else in this file assumes a wallet is already unlocked;
// the person recovery exists for has lost exactly that, so this path has to work
// from a fresh install with nothing but the account address.

export interface RecoveryProgress {
  /** True once this device's key is a signer on the account's spending rule. */
  keyInstalled: boolean;
  /** A pending proposal for this key, if the guardians have started one. */
  pending: PendingRecovery | null;
  currentLedger: number;
}

/**
 * Has the guardian quorum put this device's key on the account yet?
 *
 * Polled by the recovery screen. Reads the DEFAULT rule rather than the guardian
 * rule: recovery finishes by adding a signer to the rule that can spend, and
 * that signer appearing is the only thing that actually means "you have your
 * account back".
 *
 * Also reports any pending proposal naming this key, so the screen can say
 * "your guardians have started this, it completes in about an hour" instead of
 * an unqualified "waiting".
 */
export async function checkRecoveryProgress(
  smartAccountAddress: string,
  publicKeyHex: string,
): Promise<RecoveryProgress> {
  if (!(await isDeployed(smartAccountAddress))) {
    throw new Error('No account with that address exists on this network.');
  }

  const wanted = publicKeyHex.toLowerCase();
  const status = await fetchRecoveryStatus(smartAccountAddress);

  // Check every rule a recovery is allowed to write to, not a hardcoded 0. Each
  // policy names its own target_rule_id, and an account can carry more than one
  // recovery group; the key could legitimately land on any of their targets.
  const targets = new Set<number>(status.rules.map((r) => r.targetRuleId));
  if (targets.size === 0) targets.add(await ownerRuleId(smartAccountAddress));

  let keyInstalled = false;
  for (const ruleId of targets) {
    let rule: unknown;
    try {
      rule = await simulateRead(smartAccountAddress, 'get_context_rule', xdr.ScVal.scvU32(ruleId));
    } catch {
      continue;
    }
    const signers = isStruct(rule) && Array.isArray(rule.signers) ? rule.signers : [];
    if (decodeGuardians(signers).some((s) => s.publicKeyHex?.toLowerCase() === wanted)) {
      keyInstalled = true;
      break;
    }
  }

  const pending = keyInstalled
    ? null
    : (status.rules.map((r) => r.pending).find((p): p is PendingRecovery => p !== null) ?? null);

  return { keyInstalled, pending, currentLedger: status.currentLedger };
}
