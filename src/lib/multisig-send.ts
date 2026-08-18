/**
 * multisig-send.ts — chain primitives for transfers FROM a shared (multisig)
 * wallet, EXTERNAL-signer single-entry model.
 *
 * Shared wallets created by the wizard register every member (incl. the
 * creator) as an `External(device key)` signer on the account's Default
 * context rule (rule id 0). A transfer FROM the multisig therefore produces
 * ONE auth entry whose credentials address is the multisig; each member signs
 * THAT entry with their own device key, and the signatures are merged into the
 * entry's AuthPayload.signers map at submit (verifier.verify path). This is the
 * model docs/multisig-contract-analysis.md §4 confirms and the proven
 * send-token signing primitives produce.
 *
 * This module is transport-agnostic: it does no coordination and no backend
 * calls. The P2P co-sign packet flow (lib/cosign-packet-flow.ts) wraps these
 * primitives with a self-contained packet for passing between devices.
 *
 * ── The three steps ──────────────────────────────────────────────────────
 *   buildAssembledTransfer — build + simulate + pin expiration + assemble
 *   signSharedEntry        — sign the single multisig entry with one device key
 *   aggregateAndSubmit     — merge collected entries, bundler-sign, submit
 *
 * THRESHOLD ENFORCEMENT IS NOT THIS MODULE'S JOB. aggregateAndSubmit submits
 * whatever entries it's given; the caller MUST gate on the on-chain threshold
 * (api/account-admin.fetchRuleThreshold) before calling it. The chain's
 * __check_auth is the final backstop, but the client must never present a
 * sub-threshold tx for broadcast.
 */

import { parseSimResult, sorobanCall, toBase64, txToBase64 } from '@/src/api/smart-account';
import {
  getNetworkId,
  STELLAR_BUNDLER_SECRET,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { deriveWalletAtIndex } from '@/src/lib/seed-wallet';
import { aggregateAuthEntries } from '@/src/lib/soroban-auth-payload';
import {
  fetchWebAuthnVerifier,
  loadAccount,
  signPasskeyAuthEntry,
  signSmartAccountAuthEntry,
  toBaseUnits,
} from '@/src/services/send-token';
import { getPasskeyStorageKeys, type WalletAccount } from '@/src/store/wallet';
import * as SecureStore from 'expo-secure-store';
import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  Operation,
  rpc,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

// ─── Logging ───────────────────────────────────────────────────────────────
// Dev-gated under [multisig-send] so the full transfer process is filterable
// in Metro / Reactotron.
const log = (...args: unknown[]) => {
  if (__DEV__) console.log('[multisig-send]', ...args);
};

/**
 * Dump the auth-entry tree of a simulation/assembled tx — THE diagnostic for
 * the single-entry model: how many entries exist and each one's credentials
 * address, nonce, expiration, and the contract+function it authorizes.
 */
function describeAuthEntries(label: string, entries: xdr.SorobanAuthorizationEntry[]): void {
  if (!__DEV__) return;
  log(`${label}: ${entries.length} auth entr${entries.length === 1 ? 'y' : 'ies'}`);
  entries.forEach((e, i) => {
    const credType = e.credentials().switch().name;
    let addr = '(not address creds)';
    let nonce = '-';
    let exp = '-';
    if (credType === 'sorobanCredentialsAddress') {
      const a = e.credentials().address();
      addr = credentialsAddress(e) || '(unparseable)';
      nonce = a.nonce().toString();
      exp = String(a.signatureExpirationLedger());
    }
    let invoke = '-';
    try {
      const fn = e.rootInvocation().function();
      if (fn.switch().name === 'sorobanAuthorizedFunctionTypeContractFn') {
        const c = fn.contractFn();
        invoke = `${Address.fromScAddress(c.contractAddress()).toString()}::${c.functionName().toString()}`;
      } else {
        invoke = fn.switch().name;
      }
    } catch {
      /* best-effort */
    }
    log(`  [${i}] creds=${credType} addr=${addr} nonce=${nonce} exp=${exp} invoke=${invoke}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. BUILD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * How far ahead to pin the signatures' on-chain expiration. ~5s/ledger, so
 * 17280 ledgers ≈ 24 hours — the async-approval window in which all members
 * must sign + the tx must be submitted. The backend queue's TTL (latch-api
 * cosignRequestTTL = 23h) deliberately sits under this, so a listed request
 * always has live signatures. The packet TTL shown in the pending list
 * (use-pending-packets.ts) derives from this so display + reality stay in sync.
 *
 * The bundler's sequence number is NOT pinned for this window: aggregateAndSubmit
 * rebuilds the envelope on a fresh sequence at submit time (member signatures
 * cover only the auth entry), so delayed approvals can't die with txBadSeq.
 */
export const SIGNATURE_VALIDITY_LEDGERS = 17280;

/**
 * Fresh tx time-bound window (seconds) applied at SUBMIT time. The tx is
 * broadcast immediately, so a few minutes is ample — and it's independent of
 * how long approval collection took.
 */
const SUBMIT_TIMEBOUND_SECONDS = 300;

export interface BuildTransferParams {
  /** The multisig C-address funds move FROM. */
  multisigAddress: string;
  sacContractId: string;
  destinationAddress: string;
  /** Human-readable amount, e.g. "1.5". */
  amount: string;
}

export interface AssembledTransfer {
  /** Assembled tx (resource fees + pinned auth entries), base64 XDR. */
  unsignedTxXdr: string;
  /** Ledger the pinned signatures expire at. */
  expiresLedger: number;
}

/** One member's contribution. Structurally compatible with the packet's signatures. */
export interface CollectedEntry {
  signerKey: string;
  authEntryXdr: string;
}

/**
 * Build the transfer, simulate, pin the expiration ledger on every auth entry
 * (so all members + the assembled template agree — the shared-invocation
 * contract), and assemble. Does NOT sign or coordinate: entries keep their
 * placeholder signatures for members to fill. Statically sound — it assembles
 * whatever the simulation returns.
 */
export async function buildAssembledTransfer(p: BuildTransferParams): Promise<AssembledTransfer> {
  const { multisigAddress, sacContractId, destinationAddress, amount } = p;
  log('build ▶', {
    multisigAddress,
    sacContractId,
    destinationAddress,
    amount,
    network: getNetworkId(),
  });

  const bundler = Keypair.fromSecret(bundlerSecret());
  const account = await loadAccount(bundler.publicKey());
  log('bundler source', bundler.publicKey(), 'seq', account.sequenceNumber());

  const contract = new Contract(sacContractId);
  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'transfer',
        new Address(multisigAddress).toScVal(),
        new Address(destinationAddress).toScVal(),
        nativeToScVal(toBaseUnits(amount), { type: 'i128' }),
      ),
    )
    // Match the tx time bound to the signature window (~2h). Multi-member
    // approval (build → sign → share → approve → submit) easily exceeds the old
    // 5-min default, which failed at submit with txTooLate. ~5s/ledger.
    .setTimeout(SIGNATURE_VALIDITY_LEDGERS * 5)
    .build();
  log('built transfer tx, simulating…');

  const simRaw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(tx),
  });
  if (simRaw.error) {
    log('simulation returned error', simRaw.error);
    throw new Error(`multisig transfer simulation failed: ${simRaw.error}`);
  }
  const simResult = parseSimResult(simRaw);
  log('simulation ok, latestLedger', simRaw.latestLedger);
  describeAuthEntries('sim auth entries', simResult.result?.auth ?? []);

  // Pin expiration on every entry. We can't re-simulate after members sign (a
  // fresh sim mints new nonces), so the nonce is fixed here; aggregateAndSubmit
  // corrects resource fees via an enforcing re-sim at submit.
  const expiresLedger = (simRaw.latestLedger ?? 0) + SIGNATURE_VALIDITY_LEDGERS;
  for (const entry of simResult.result?.auth ?? []) {
    if (entry.credentials().switch().name === 'sorobanCredentialsAddress') {
      entry.credentials().address().signatureExpirationLedger(expiresLedger);
    }
  }
  log('pinned signatureExpirationLedger', expiresLedger);

  const assembled = rpc.assembleTransaction(tx, simResult).build();
  // Use the app's toBase64 (String.fromCharCode + btoa), NOT assembled.toXDR():
  // the SDK's toXDR('base64') goes through the RN Buffer polyfill's broken
  // toString('base64'), which yields comma-joined decimal bytes that can't be
  // re-parsed. Every transport string in this module must use toBase64.
  const unsignedTxXdr = txToBase64(assembled);
  log('assembled, unsignedTxXdr length', unsignedTxXdr.length);
  return { unsignedTxXdr, expiresLedger };
}

export interface BuildOperationParams {
  /** The multisig C-address that will authorize the operation. */
  multisigAddress: string;
  /** Pre-built operation (e.g. a DEX swap invocation). */
  operation: xdr.Operation;
}

/**
 * Build + simulate + pin expiration for ANY pre-built Soroban operation.
 * Identical to buildAssembledTransfer but takes an operation directly instead
 * of constructing a SAC transfer — so both swap and transfer share the same
 * signing and submit primitives (signSharedEntry / aggregateAndSubmit).
 */
export async function buildAssembledOperation(p: BuildOperationParams): Promise<AssembledTransfer> {
  const { multisigAddress, operation } = p;
  log('buildOp ▶', { multisigAddress, network: getNetworkId() });

  const bundler = Keypair.fromSecret(bundlerSecret());
  const account = await loadAccount(bundler.publicKey());

  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(SIGNATURE_VALIDITY_LEDGERS * 5)
    .build();

  const simRaw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(tx),
  });
  if (simRaw.error) throw new Error(`operation simulation failed: ${simRaw.error}`);
  const simResult = parseSimResult(simRaw);
  describeAuthEntries('buildOp sim auth entries', simResult.result?.auth ?? []);

  const expiresLedger = (simRaw.latestLedger ?? 0) + SIGNATURE_VALIDITY_LEDGERS;
  for (const entry of simResult.result?.auth ?? []) {
    if (entry.credentials().switch().name === 'sorobanCredentialsAddress') {
      entry.credentials().address().signatureExpirationLedger(expiresLedger);
    }
  }
  log('buildOp: pinned expiresLedger', expiresLedger);

  const assembled = rpc.assembleTransaction(tx, simResult).build();
  return { unsignedTxXdr: txToBase64(assembled), expiresLedger };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. SIGN  (each member signs the SAME single multisig entry, op.auth[0])
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign the single multisig auth entry with `signer`'s device key (Ed25519 or
 * passkey). Returns the signer's device-key id + the signed entry. There is
 * ONE shared entry (creds = the multisig); members fill its AuthPayload map.
 */
export async function signSharedEntry(
  unsignedTxXdr: string,
  signer: WalletAccount,
  signerListIndex: number,
  mnemonic: string | null,
): Promise<CollectedEntry> {
  log('signShared ▶', {
    signer: signer.smartAccountAddress,
    signerListIndex,
    isPasskey: !signer.gAddress,
  });
  const tx = new Transaction(unsignedTxXdr, STELLAR_NETWORK_PASSPHRASE);
  const op = tx.operations[0] as Operation.InvokeHostFunction | undefined;
  const entry = op?.auth?.[0];
  if (!op || op.type !== 'invokeHostFunction' || !entry) {
    throw new Error('multisig: unsignedTxXdr has no auth entry to sign');
  }
  const validUntil = entryExpiration(entry);

  let signerKey: string;
  if (signer.gAddress && signer.publicKeyHex) {
    if (!mnemonic) throw new Error('multisig: mnemonic required to sign with an Ed25519 device');
    const { keypair } = deriveWalletAtIndex(mnemonic, signer.index);
    signSmartAccountAuthEntry(entry, keypair, validUntil);
    signerKey = signer.publicKeyHex;
  } else {
    log('passkey branch ▶ fetching webauthn verifier…');
    const verifier = await fetchWebAuthnVerifier();
    log('passkey branch: verifier', verifier, '— prompting biometric to sign…');
    await signPasskeyAuthEntry(entry, signerListIndex, validUntil, verifier);
    log('passkey branch: signed; reading keyDataHex at slot', signerListIndex);
    const keyDataHex = await SecureStore.getItemAsync(
      getPasskeyStorageKeys(signerListIndex).keyDataHex,
    );
    if (!keyDataHex) throw new Error('multisig: device key not found in secure store');
    signerKey = keyDataHex;
  }
  log('✓ shared entry signed by', signerKey.slice(0, 12));
  return { signerKey, authEntryXdr: toBase64(new Uint8Array(entry.toXDR())) };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. SUBMIT  (merge collected single-signer entries → bundler-sign → submit)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Merge collected entries (each the multisig entry signed by one device) into
 * one entry via aggregateAuthEntries, then bundler-sign + submit.
 *
 * ⚠️ Does NOT enforce threshold — the caller MUST verify
 * entries.length >= on-chain threshold (fetchRuleThreshold) before calling.
 */
export async function aggregateAndSubmit(
  unsignedTxXdr: string,
  entries: CollectedEntry[],
): Promise<{ hash: string; wasFirstBroadcaster: boolean }> {
  log('aggregateSubmit ▶', { entries: entries.length });
  const decoded = entries.map((e) =>
    xdr.SorobanAuthorizationEntry.fromXDR(e.authEntryXdr, 'base64'),
  );
  const merged = aggregateAuthEntries(decoded);

  // Rebuild the envelope on a FRESH bundler sequence. The original envelope
  // pinned the bundler's seq at build time; over a multi-hour approval window
  // the shared bundler account will have advanced, and submitting the stale
  // envelope dies with txBadSeq. Member signatures cover only the auth entry
  // (nonce / invocation / signatureExpirationLedger) — never the envelope — so
  // wrapping the same operation + merged auth in a new tx is legal (the same
  // property setMaxTime already exploits for time bounds).
  const bundler = Keypair.fromSecret(bundlerSecret());
  const source = await loadAccount(bundler.publicKey());
  log('fresh bundler seq', source.sequenceNumber());
  const original = new Transaction(unsignedTxXdr, STELLAR_NETWORK_PASSPHRASE);
  const op = original.operations[0] as Operation.InvokeHostFunction | undefined;
  if (!op || op.type !== 'invokeHostFunction') {
    throw new Error('multisig broadcast: unsignedTxXdr has no invokeHostFunction op');
  }
  const rebuilt = new TransactionBuilder(source, {
    fee: '1000000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({ func: op.func, auth: [merged] }))
    .setTimeout(SUBMIT_TIMEBOUND_SECONDS)
    .build();
  const patchedXdr = txToBase64(rebuilt);

  // Enforcing simulation. The recording sim that produced unsignedTxXdr STUBS
  // __check_auth, so its footprint/resources omit the multisig's
  // ContextRuleData (rule signers + threshold) and the verifier reads. With the
  // signatures now attached, simulate again so the host runs __check_auth for
  // real and returns the COMPLETE footprint + resources; submitting the
  // recording-assembled tx instead traps with "contract data key outside of the
  // footprint" (verified on testnet — see docs/multisig-contract-analysis.md §3
  // and scripts/verify-multisig-transfer.js).
  const enforcedRaw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: patchedXdr,
  });
  if (enforcedRaw.error) {
    throw new Error(`multisig enforcing simulation failed: ${enforcedRaw.error}`);
  }
  const reassembled = rpc
    .assembleTransaction(new Transaction(patchedXdr, STELLAR_NETWORK_PASSPHRASE), parseSimResult(enforcedRaw))
    .build();
  // assembleTransaction rewrites op.auth from its own recommendation — re-assert
  // the merged, signed entry (its nonce/expiration/signatures must be preserved).
  // setOpAuth round-trips through toBase64 (the SDK's toXDR('base64') is broken
  // under the RN Buffer polyfill — see buildAssembledTransfer).
  const withAuth = setOpAuth(txToBase64(reassembled), [merged]);

  // Reset the tx time bound at SUBMIT time. Member auth signatures cover the
  // auth entry (nonce/invocation/signatureExpirationLedger), NOT the tx time
  // bounds — only the bundler's envelope signature (applied next) does — so the
  // broadcaster sets a fresh window here. This prevents txTooLate when collecting
  // approvals took a while, as long as the auth is still valid (the enforcing sim
  // above already confirmed that).
  const finalTx = new Transaction(
    setMaxTime(withAuth, SUBMIT_TIMEBOUND_SECONDS),
    STELLAR_NETWORK_PASSPHRASE,
  );
  finalTx.sign(bundler);
  log('enforcing-sim ok, bundler-signed, submitting…');

  const sent = await sorobanCall(STELLAR_RPC_URL, 'sendTransaction', {
    transaction: txToBase64(finalTx),
  });
  log('sendTransaction result', { status: sent.status, hash: sent.hash, error: sent.errorResultXdr });

  let wasFirstBroadcaster = true;
  if (sent.status === 'ERROR') {
    if (/DUPLICATE|already/i.test(sent.errorResultXdr ?? '')) wasFirstBroadcaster = false;
    else throw new Error(`multisig submit failed: ${sent.errorResultXdr ?? JSON.stringify(sent)}`);
  }
  if (wasFirstBroadcaster) await waitForConfirmation(sent.hash);
  log('✓ aggregateSubmit complete', { hash: sent.hash, wasFirstBroadcaster });
  return { hash: sent.hash, wasFirstBroadcaster };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function credentialsAddress(entry: xdr.SorobanAuthorizationEntry): string {
  if (entry.credentials().switch().name !== 'sorobanCredentialsAddress') return '';
  try {
    return Address.fromScAddress(entry.credentials().address().address()).toString();
  } catch {
    return '';
  }
}

function entryExpiration(entry: xdr.SorobanAuthorizationEntry): number {
  return entry.credentials().address().signatureExpirationLedger();
}

/** Replace the first InvokeHostFunction op's auth array at the XDR level. */
function setOpAuth(unsignedTxXdr: string, entries: xdr.SorobanAuthorizationEntry[]): string {
  const env = xdr.TransactionEnvelope.fromXDR(unsignedTxXdr, 'base64');
  if (env.switch().name !== 'envelopeTypeTx') {
    throw new Error(`multisig broadcast: expected v1 tx envelope, got ${env.switch().name}`);
  }
  const ops = env.v1().tx().operations();
  if (ops.length === 0) throw new Error('multisig broadcast: assembled tx has no operations');
  const body = ops[0].body();
  if (body.switch().name !== 'invokeHostFunction') {
    throw new Error(`multisig broadcast: expected invokeHostFunction op, got ${body.switch().name}`);
  }
  body.invokeHostFunctionOp().auth(entries);
  return toBase64(new Uint8Array(env.toXDR()));
}

/**
 * Set a fresh upper time bound (now + secondsFromNow) on a v1 tx envelope.
 * Safe to call after signing the member auth entries: their signatures cover the
 * auth payload, not the tx time bounds (only the bundler's envelope signature
 * does, applied after this). Leaves operations + Soroban data untouched.
 */
function setMaxTime(txXdr: string, secondsFromNow: number): string {
  const env = xdr.TransactionEnvelope.fromXDR(txXdr, 'base64');
  if (env.switch().name !== 'envelopeTypeTx') return txXdr;
  const maxTime = Math.floor(Date.now() / 1000) + secondsFromNow;
  env.v1().tx().cond(
    xdr.Preconditions.precondTime(
      new xdr.TimeBounds({
        minTime: xdr.Uint64.fromString('0'),
        maxTime: xdr.Uint64.fromString(String(maxTime)),
      }),
    ),
  );
  return toBase64(new Uint8Array(env.toXDR()));
}

async function waitForConfirmation(hash: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await sorobanCall(STELLAR_RPC_URL, 'getTransaction', { hash });
    log(`poll ${i + 1}/30`, hash, poll.status);
    if (poll.status === 'SUCCESS') return;
    if (poll.status === 'FAILED') {
      log('tx FAILED, resultXdr', poll.resultXdr ?? poll.resultMetaXdr);
      throw new Error(`multisig broadcast: tx ${hash} status ${poll.status}`);
    }
  }
  throw new Error(`multisig broadcast: tx ${hash} did not confirm within 30s`);
}

function bundlerSecret(): string {
  const secret = STELLAR_BUNDLER_SECRET;
  if (!secret) throw new Error('Bundler secret is not configured for the active network');
  return secret;
}
