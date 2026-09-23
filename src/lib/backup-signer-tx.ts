/**
 * backup-signer-tx.ts — orchestration for enrolling or removing a solo
 * backup signer: a second WebAuthn passkey added to a smart account's
 * Default context rule WITHOUT installing or touching the admin rule. The
 * Default rule is kept 1-of-N by a ThresholdPolicy of 1, installed before the
 * first backup signer is added — without a policy the contract requires every
 * signer on the rule, which would make a backup signer a second lock rather
 * than a spare key. Either passkey can sign alone.
 *
 * This is deliberately NOT built on top of `completePairing`
 * (src/lib/admin-tx.ts): that flow unconditionally installs a ⌈N/2⌉-of-N
 * admin rule the moment a 2nd signer joins — a backup signer must suppress
 * that always, not conditionally. It also has no device-to-device pairing
 * step at all — see createBackupSignerPasskey below.
 *
 * No pairing code, no QR, no second device present during setup. A platform
 * passkey (src/lib/platform-passkey.ts) is a discoverable, *synced*
 * credential — the whole reason `react-native-passkey` requests one is so a
 * device that never ran any ceremony can still find it later via iCloud
 * Keychain / Google Password Manager (see signWithPlatformPasskey's own
 * comment, and the OS's native "use another device" hybrid-transport picker,
 * which the app never has to build). So the *only* device that needs to be
 * present is the one already holding a signer on this account: it mints a
 * brand-new passkey locally and authorizes it, in one sitting. This mirrors
 * the web extension's AddBackupPasskeyFlow exactly — see
 * LATCH_MOBILE_BACKUP_SIGNERS.md for why the mobile build first shipped with
 * a two-device pairing-code screen instead, and why that was wrong: it
 * solved a problem synced passkeys don't have, on top of a `/v1/pair-codes`
 * backend route that doesn't exist.
 *
 * Signing reuses the proven passkey auth-entry primitives from
 * src/services/send-token.ts (`signPasskeyAuthEntry`,
 * `resolveRegisteredWebAuthnVerifier`) — the same ones a passkey send uses to
 * build the contract's custom AuthPayload.
 *
 * Add/remove are each split into an on-chain step and a confirm step so the
 * caller can persist `Device.pendingConfirm` durably in between (see
 * store/wallet.ts) — a killed app between the two no longer loses the
 * txHash needed to retry just the confirm call.
 *
 * WebAuthn-only. Ed25519 backup signers are a small, separate follow-up.
 *
 * This module does no store mutation — callers persist the resulting Device
 * via `useWalletStore.updateAccountDevices`.
 */

import { Address, rpc, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import QuickCrypto from 'react-native-quick-crypto';

import {
  addPolicyOp,
  addSignerOp,
  encodeThresholdPolicyParams,
  fetchDefaultContextRule,
  fetchFactoryVerifiers,
  fetchRuleThreshold,
  liftToRuntimeSigner,
  removeSignerOp,
} from '@/src/api/account-admin';
import { parseSimResult, sorobanCall, txToBase64 } from '@/src/api/smart-account';
import { bundlerAddress, submitViaBundler } from '@/src/api/transaction-relay';
import { PASSKEY_RP_ID, STELLAR_FACTORY_ADDRESS, STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL } from '@/src/constants/config';
import { AccountSigner } from '@/src/lib/account-signers';
import { extractFirstU32FromMeta } from '@/src/lib/admin-tx';
import { createLogger } from '@/src/lib/logger';
import { getStoredKeyDataHex } from '@/src/lib/passkey-webauthn';
import {
  classifyPasskeyFailure,
  describePasskeyFailure,
  PasskeyProvisionError,
} from '@/src/lib/provision-passkey';
import {
  createPlatformPasskeyCredential,
  isPlatformPasskeySupported,
  type PlatformPasskeyCredential,
} from '@/src/lib/platform-passkey';
import {
  loadAccount,
  resolveRegisteredWebAuthnVerifier,
  signPasskeyAuthEntry,
} from '@/src/services/send-token';

const log = createLogger('backup-signer-tx');

interface RpcConfig {
  rpcUrl: string;
  networkPassphrase: string;
  factoryAddress: string;
}

// Read live, inside a function body — STELLAR_RPC_URL et al. are `let`
// bindings reassigned in place by switchActiveNetwork (see config.ts). A
// module-top-level read here would capture a stale network forever.
function activeRpcConfig(): RpcConfig {
  const factoryAddress = STELLAR_FACTORY_ADDRESS;
  if (!factoryAddress) {
    throw new Error('Factory address is not configured for the active network');
  }
  return { rpcUrl: STELLAR_RPC_URL, networkPassphrase: STELLAR_NETWORK_PASSPHRASE, factoryAddress };
}

export class BackupSignerAlreadyPresentError extends Error {
  constructor(public readonly keyDataHex: string) {
    super('This device is already a signer on the account.');
    this.name = 'BackupSignerAlreadyPresentError';
  }
}

// ─── Passkey creation ─────────────────────────────────────────────────────

/**
 * Mint a brand-new platform passkey to serve as a backup signer. Unlike
 * `provisionPasskeyAtIndex` (src/lib/provision-passkey.ts), this does not
 * write to any SecureStore account slot: the credential's private key never
 * leaves the OS, and this device never needs to sign with it, so there is
 * nothing local to persist beyond the `Device` bookkeeping the caller adds
 * once it's authorized on-chain. Throws `PasskeyProvisionError` on any
 * ceremony failure (cancelled sheet, unsupported device) — same
 * classification `provisionPasskeyAtIndex` uses, so callers can reuse
 * `classifyPasskeyFailure`/`shouldOfferDeviceOnlyFallback`-style handling if
 * they want to. There is deliberately no device-only fallback here: a
 * non-syncing backup signer defeats the point of this feature.
 */
export async function createBackupSignerPasskey(label: string): Promise<PlatformPasskeyCredential> {
  if (!isPlatformPasskeySupported()) {
    throw new PasskeyProvisionError(
      'This device has no passkey provider (iCloud Keychain or Google Password Manager).',
      'unsupported',
    );
  }
  try {
    return await createPlatformPasskeyCredential({
      rpId: PASSKEY_RP_ID,
      rpName: 'Latch',
      userId: new Uint8Array(QuickCrypto.randomBytes(16)),
      userName: label,
      userDisplayName: label,
      challenge: new Uint8Array(QuickCrypto.randomBytes(32)),
    });
  } catch (err) {
    const kind = classifyPasskeyFailure(err);
    const reason = describePasskeyFailure(err, PASSKEY_RP_ID);
    throw new PasskeyProvisionError(`Couldn't create a backup passkey: ${reason}`, kind, err);
  }
}

// ─── Submission ─────────────────────────────────────────────────────────

/**
 * Build, simulate, sign and submit a single self-mutation op on the smart
 * account. Only auth entries whose credentials address IS the smart account
 * are signed — the same guard send-token.ts applies — and they're signed with
 * the existing device's own passkey (rule 0 — see signSmartAccountAuthEntry's
 * comment in send-token.ts), never with a bundler key. Submission goes via the
 * relay, never with a bundler key held on-device.
 */
async function submitSelfAuthOp(
  cfg: RpcConfig,
  smartAccountAddress: string,
  initiatorListIndex: number,
  op: xdr.Operation,
  label: string,
): Promise<{ txHash: string; resultMetaXdr?: string }> {
  const bundlerG = await bundlerAddress();
  const account = await loadAccount(bundlerG);
  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(300)
    .build();

  const simRaw = await sorobanCall(cfg.rpcUrl, 'simulateTransaction', { transaction: txToBase64(tx) });
  if (simRaw.error) throw new Error(`${label} simulation failed: ${simRaw.error}`);
  const simResult = parseSimResult(simRaw);
  const validUntilLedger = (simRaw.latestLedger ?? 0) + 100;

  const webAuthnVerifier = await resolveRegisteredWebAuthnVerifier(
    smartAccountAddress,
    initiatorListIndex,
  );

  for (const entry of simResult.result?.auth ?? []) {
    const creds = entry.credentials();
    if (creds.switch().name !== 'sorobanCredentialsAddress') continue;
    const credAddr = Address.fromScAddress(creds.address().address()).toString();
    if (credAddr !== smartAccountAddress) continue;
    await signPasskeyAuthEntry(entry, initiatorListIndex, validUntilLedger, webAuthnVerifier);
  }

  const txWithSignedAuth = rpc.assembleTransaction(tx, simResult).build();

  const simRaw2 = await sorobanCall(cfg.rpcUrl, 'simulateTransaction', {
    transaction: txToBase64(txWithSignedAuth),
  });
  if (simRaw2.error) throw new Error(`${label} re-simulation failed: ${simRaw2.error}`);
  const prepared = rpc.assembleTransaction(txWithSignedAuth, parseSimResult(simRaw2)).build();

  const { hash: txHash, status, resultMetaXdr } = await submitViaBundler(prepared);
  if (status !== 'SUCCESS') {
    throw new Error(`${label} transaction status: ${status}`);
  }
  return { txHash, resultMetaXdr };
}

// ─── Add ────────────────────────────────────────────────────────────────

export interface AddBackupSignerInput {
  smartAccountAddress: string;
  /** The account's Default rule id, read via fetchDefaultContextRule — never assumed to be 0. */
  defaultRuleId: number;
  /** The freshly created backup passkey. Must be WebAuthn (it always is — createBackupSignerPasskey only produces one). */
  newSigner: AccountSigner;
  /** This device's (the authorizer's) position in the accounts array. */
  initiatorListIndex: number;
}

export interface AddBackupSignerChainResult {
  txHash: string;
  /** Best-effort — undefined if resultMetaXdr couldn't be parsed. The confirm-add response is authoritative. */
  signerId?: number;
  keyDataHex: string;
}

/**
 * Add a WebAuthn backup signer on-chain: `add_signer(defaultRuleId, newSigner)`,
 * preceded — only when the Default rule has no ThresholdPolicy yet — by
 * `add_policy(defaultRuleId, thresholdPolicy, {threshold: 1})`. Never
 * `add_context_rule`, never raises an existing threshold. The returned
 * txHash is the add_signer transaction's.
 *
 * Does not call the backend confirm-add endpoint — see the module doc.
 * Persist a pending `Device` (via updateAccountDevices) immediately after
 * this resolves and before calling `confirmAddBackupSigner`
 * (src/api/backup-signer.ts), so a killed app can retry confirm alone later.
 */
export async function addBackupSignerOnChain(
  input: AddBackupSignerInput,
): Promise<AddBackupSignerChainResult> {
  if (input.newSigner.kind !== 'webauthn') {
    throw new Error('addBackupSignerOnChain: newSigner must be a WebAuthn signer');
  }
  const cfg = activeRpcConfig();
  const newKeyDataHex = input.newSigner.keyDataHex.toLowerCase();

  // Exact keyDataHex match, mirroring the backend's own idempotency check
  // (ruleHasExactExternalSigner), before building anything on-chain.
  const before = await fetchDefaultContextRule(cfg, input.smartAccountAddress);
  if (
    before.signers.some(
      (s) => s.kind === 'webauthn' && s.keyDataHex.toLowerCase() === newKeyDataHex,
    )
  ) {
    throw new BackupSignerAlreadyPresentError(input.newSigner.keyDataHex);
  }

  const verifiers = await fetchFactoryVerifiers(cfg);

  // A rule with no policies requires EVERY signer, so adding a second signer
  // to a bare Default rule would silently turn the account 2-of-2. Install a
  // threshold of 1 first, while this device is still the only signer. It's a
  // separate transaction because Soroban allows one contract call per tx; if
  // the add below fails, the account is left 1-of-1 with the policy, and a
  // retry skips this step.
  if (!before.policies.includes(verifiers.thresholdPolicy)) {
    if (before.signers.length > 1) {
      throw new Error(
        'This account already has several signers and no approval threshold, so every one of them must approve changes. Adding a backup signer from this device alone isn’t possible.',
      );
    }
    await submitSelfAuthOp(
      cfg,
      input.smartAccountAddress,
      input.initiatorListIndex,
      addPolicyOp(
        input.smartAccountAddress,
        input.defaultRuleId,
        verifiers.thresholdPolicy,
        encodeThresholdPolicyParams(1),
      ),
      'backup signer threshold policy',
    );
  }

  const runtimeSigner = liftToRuntimeSigner(input.newSigner, verifiers);
  const { txHash, resultMetaXdr } = await submitSelfAuthOp(
    cfg,
    input.smartAccountAddress,
    input.initiatorListIndex,
    addSignerOp(input.smartAccountAddress, input.defaultRuleId, runtimeSigner),
    'backup signer add',
  );

  // Read the new signer id from resultMetaXdr; this is single-op, so only
  // opIndex 0 is relevant.
  let signerId = extractFirstU32FromMeta(resultMetaXdr, 0);
  if (signerId === undefined) {
    // Fall back to confirming the add actually landed, rather than guessing
    // a position in the returned Vec<Signer> — get_context_rule doesn't
    // expose per-signer ids at all, so this can only confirm presence, not
    // recover the id. The confirm-add backend call is authoritative for the
    // id (it independently re-verifies the tx server-side); this is purely
    // a diagnostic so a failed extraction isn't silent.
    const after = await fetchDefaultContextRule(cfg, input.smartAccountAddress);
    const landed = after.signers.some(
      (s) => s.kind === 'webauthn' && s.keyDataHex.toLowerCase() === newKeyDataHex,
    );
    log.warn('could not read new signer id from resultMetaXdr; on-chain presence:', landed);
  }

  return { txHash, signerId, keyDataHex: input.newSigner.keyDataHex };
}

// ─── Remove ─────────────────────────────────────────────────────────────

export interface RemoveBackupSignerInput {
  smartAccountAddress: string;
  defaultRuleId: number;
  /** The backup signer's stable on-chain id (Device.onChainSignerId). */
  signerId: number;
  /** The backup signer's key_data hex, for the confirm-remove call. */
  keyDataHex: string;
  /** This device's (the authorizer's) position in the accounts array. */
  initiatorListIndex: number;
}

export interface RemoveBackupSignerChainResult {
  txHash: string;
}

/**
 * Remove a backup signer on-chain. Does not call the backend confirm-remove
 * endpoint — see the module doc; persist a pending `Device` before calling
 * it, same as the add path.
 *
 * Safety checks:
 *   - never remove the account's last remaining signer
 *   - never let a device remove its own only signer on this account
 * Both are checked client-side before building any transaction; the confirm
 * endpoint is expected to refuse the first case too.
 */
export async function removeBackupSignerOnChain(
  input: RemoveBackupSignerInput,
): Promise<RemoveBackupSignerChainResult> {
  const cfg = activeRpcConfig();
  const rule = await fetchDefaultContextRule(cfg, input.smartAccountAddress);

  if (rule.signers.length <= 1) {
    throw new Error("Can't remove the account's only remaining signer.");
  }

  const initiatorKeyDataHex = await getStoredKeyDataHex(input.initiatorListIndex);
  if (
    initiatorKeyDataHex &&
    initiatorKeyDataHex.toLowerCase() === input.keyDataHex.toLowerCase()
  ) {
    throw new Error(
      "Can't remove this device's own signer from here — it would lock this device out of managing the account.",
    );
  }

  // With no threshold policy the rule is N-of-N, and this device alone can't
  // authorize the removal. remove_signer doesn't re-check the threshold, so
  // also make sure the remaining signers can still meet it.
  const verifiers = await fetchFactoryVerifiers(cfg);
  if (!rule.policies.includes(verifiers.thresholdPolicy)) {
    throw new Error(
      'This account has no approval threshold, so every signer must approve removing one. It can’t be done from this device alone.',
    );
  }
  const threshold = await fetchRuleThreshold(
    cfg,
    input.smartAccountAddress,
    input.defaultRuleId,
    verifiers,
  );
  if (threshold > rule.signers.length - 1) {
    throw new Error(
      `Removing this signer would leave fewer signers than the account's approval threshold (${threshold}).`,
    );
  }

  const { txHash } = await submitSelfAuthOp(
    cfg,
    input.smartAccountAddress,
    input.initiatorListIndex,
    removeSignerOp(input.smartAccountAddress, input.defaultRuleId, input.signerId),
    'backup signer remove',
  );

  return { txHash };
}
