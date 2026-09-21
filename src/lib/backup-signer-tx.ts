/**
 * backup-signer-tx.ts — orchestration for enrolling or removing a solo
 * backup signer: a second WebAuthn passkey added to a smart account's
 * Default context rule WITHOUT installing or touching the admin
 * (ThresholdPolicy) rule. The account stays 1-of-N forever — either passkey
 * can sign alone, and adding a backup signer never raises the bar for
 * spending.
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
  addSignerOp,
  fetchDefaultContextRule,
  fetchFactoryVerifiers,
  liftToRuntimeSigner,
  removeSignerOp,
} from '@/src/api/account-admin';
import { parseSimResult, sorobanCall, txToBase64 } from '@/src/api/smart-account';
import { bundlerAddress, submitViaBundler } from '@/src/api/transaction-relay';
import { PASSKEY_RP_ID, STELLAR_FACTORY_ADDRESS, STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL } from '@/src/constants/config';
import { AccountSigner } from '@/src/lib/account-signers';
import { extractFirstU32FromMeta } from '@/src/lib/admin-tx';
import { createLogger } from '@/src/lib/logger';
import { encodeWebAuthnSigData, getStoredKeyDataHex } from '@/src/lib/passkey-webauthn';
import {
  classifyPasskeyFailure,
  describePasskeyFailure,
  PasskeyProvisionError,
} from '@/src/lib/provision-passkey';
import {
  createPlatformPasskeyCredential,
  isPlatformPasskeySupported,
  signWithPlatformPasskey,
  type PlatformPasskeyCredential,
} from '@/src/lib/platform-passkey';
import { aggregateAuthEntries } from '@/src/lib/soroban-auth-payload';
import {
  authDigestFor,
  buildContextRuleIds,
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
 * Add a WebAuthn backup signer on-chain. The ONLY operation is
 * `add_signer(defaultRuleId, newSigner)` — never `add_context_rule`, never a
 * threshold change, never branches on how many signers already exist.
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
  const runtimeSigner = liftToRuntimeSigner(input.newSigner, verifiers);
  const op = addSignerOp(input.smartAccountAddress, input.defaultRuleId, runtimeSigner);

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
  if (simRaw.error) throw new Error(`backup signer add simulation failed: ${simRaw.error}`);
  const simResult = parseSimResult(simRaw);
  const validUntilLedger = (simRaw.latestLedger ?? 0) + 100;

  const webAuthnVerifier = await resolveRegisteredWebAuthnVerifier(
    input.smartAccountAddress,
    input.initiatorListIndex,
  );

  // Sign the resulting Soroban auth entry with the existing device's own
  // key. Adding a self-mutation op is authorized the same way an ordinary
  // spend is (rule 0 — see signSmartAccountAuthEntry's comment in
  // send-token.ts), never with a bundler key.
  for (const entry of simResult.result?.auth ?? []) {
    if (entry.credentials().switch().name !== 'sorobanCredentialsAddress') continue;
    await signPasskeyAuthEntry(entry, input.initiatorListIndex, validUntilLedger, webAuthnVerifier);
  }

  const txWithSignedAuth = rpc.assembleTransaction(tx, simResult).build();

  const simRaw2 = await sorobanCall(cfg.rpcUrl, 'simulateTransaction', {
    transaction: txToBase64(txWithSignedAuth),
  });
  if (simRaw2.error) throw new Error(`backup signer add re-simulation failed: ${simRaw2.error}`);
  const prepared = rpc.assembleTransaction(txWithSignedAuth, parseSimResult(simRaw2)).build();

  // Submit via the relay, never with a bundler key held on-device.
  const { hash: txHash, status, resultMetaXdr } = await submitViaBundler(prepared);
  if (status !== 'SUCCESS') {
    throw new Error(`backup signer add transaction status: ${status}`);
  }

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

  const op = removeSignerOp(input.smartAccountAddress, input.defaultRuleId, input.signerId);

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
  if (simRaw.error) throw new Error(`backup signer remove simulation failed: ${simRaw.error}`);
  const simResult = parseSimResult(simRaw);
  const validUntilLedger = (simRaw.latestLedger ?? 0) + 100;

  const webAuthnVerifier = await resolveRegisteredWebAuthnVerifier(
    input.smartAccountAddress,
    input.initiatorListIndex,
  );

  for (const entry of simResult.result?.auth ?? []) {
    if (entry.credentials().switch().name !== 'sorobanCredentialsAddress') continue;
    await signPasskeyAuthEntry(entry, input.initiatorListIndex, validUntilLedger, webAuthnVerifier);

    // If the contract rule currently has multiple signers and no threshold policy,
    // OpenZeppelin's stellar-accounts contract enforces unanimous approval (N-of-N).
    // In that case, removing a signer requires both the initiator AND the backup signer
    // being removed to co-sign the auth entry.
    if (rule.signers.length > 1) {
      const backupSigner = rule.signers.find(
        (s) => s.keyDataHex.toLowerCase() === input.keyDataHex.toLowerCase(),
      );
      const backupVerifier = backupSigner?.verifierAddress ?? webAuthnVerifier;
      const authDigest = authDigestFor(entry, input.defaultRuleId);

      // Extract credentialId from keyDataHex if present (keyDataHex = 65-byte uncompressed point + credentialId)
      const credIdHex =
        input.keyDataHex.length > 130 ? input.keyDataHex.slice(130) : undefined;

      const passkeySig = await signWithPlatformPasskey({
        rpId: PASSKEY_RP_ID,
        challenge: new Uint8Array(authDigest),
        allowCredentialIdHex: credIdHex,
      });

      const backupSigXdr = encodeWebAuthnSigData(passkeySig);

      const backupEntry = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
      const ruleIdsScVal = buildContextRuleIds(entry, input.defaultRuleId);
      const backupPayload = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('context_rule_ids'),
          val: ruleIdsScVal,
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('signers'),
          val: xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
              key: xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('External'),
                xdr.ScVal.scvAddress(Address.fromString(backupVerifier).toScAddress()),
                xdr.ScVal.scvBytes(Buffer.from(input.keyDataHex, 'hex')),
              ]),
              val: xdr.ScVal.scvBytes(Buffer.from(backupSigXdr)),
            }),
          ]),
        }),
      ]);
      backupEntry.credentials().address().signature(backupPayload);

      const merged = aggregateAuthEntries([entry, backupEntry]);
      entry.credentials().address().signature(merged.credentials().address().signature());
    }
  }

  const txWithSignedAuth = rpc.assembleTransaction(tx, simResult).build();

  const simRaw2 = await sorobanCall(cfg.rpcUrl, 'simulateTransaction', {
    transaction: txToBase64(txWithSignedAuth),
  });
  if (simRaw2.error) throw new Error(`backup signer remove re-simulation failed: ${simRaw2.error}`);
  const prepared = rpc.assembleTransaction(txWithSignedAuth, parseSimResult(simRaw2)).build();

  const { hash: txHash, status } = await submitViaBundler(prepared);
  if (status !== 'SUCCESS') {
    throw new Error(`backup signer remove transaction status: ${status}`);
  }

  return { txHash };
}
