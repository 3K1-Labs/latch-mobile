/**
 * cosign-backend-flow.ts — the encrypted-backend transport for multisig
 * approvals (docs/multisig-encrypted-queue.md). Lets members fetch pending
 * transactions for a shared wallet asynchronously, without anyone sharing a
 * packet.
 *
 * Same signing core as the P2P path (buildAssembledTransfer / signSharedEntry /
 * aggregateAndSubmit + the AUTHORITATIVE on-chain threshold read). This module
 * owns ALL the crypto: it encrypts payloads with the wallet's WCK, derives the
 * blind queue_index / blind_signer_id, and resolves which of the device's
 * wallets a fetched request belongs to (by matching its queue_index). The server
 * (src/api/cosign.ts) only ever sees ciphertext + opaque blind ids.
 *
 * Auth: a wallet-scope Latch JWT minted by wallet-auth.ts against the SAME
 * backend (EXPO_PUBLIC_API_BASE_URL). Every Latch user has this (wallet control,
 * no email required); it authenticates as the device's PERSONAL account, never
 * the multisig. No refresh-on-401 yet.
 */

import {
  addCosignSignature,
  cancelCosignRequest,
  CosignApiError,
  createCosignRequest,
  getCosignRequest,
  listCosignRequests,
  markCosignSubmitted,
  type CosignRequestRaw,
} from '@/src/api/cosign';
import { getNetworkId } from '@/src/constants/config';
import {
  blindSignerId,
  decryptForWallet,
  encryptForWallet,
  queueIndexFor,
} from '@/src/lib/cosign-crypto';
import type { CosignPacket } from '@/src/lib/cosign-packet';
import {
  getMySignerKey,
  onChainThreshold,
  pickSigner,
  type CreateTransferPacketParams,
} from '@/src/lib/cosign-packet-flow';
import {
  aggregateAndSubmit,
  buildAssembledTransfer,
  signSharedEntry,
  type CollectedEntry,
} from '@/src/lib/multisig-send';
import { ensureWalletSession, reSignInWallet } from '@/src/lib/wallet-auth';
import {
  autoFetchWalletCosignKey,
  ensureWalletCosignKey,
  getWalletCosignKey,
} from '@/src/lib/wallet-cosign-key';
import { useWalletStore } from '@/src/store/wallet';

function isAuthError(e: unknown): boolean {
  if (!(e instanceof CosignApiError)) return false;
  if (e.status === 401 || e.status === 403) return true;
  return /invalid or expired token/i.test(e.message);
}

// Collapses concurrent re-sign-ins into one. The pending-list poll fans out over
// every shared wallet in parallel, so a server-rejected token would otherwise
// trigger one sign-in PER wallet at once — N challenge/sign-in round trips (rate
// limit risk) and, for passkey accounts, N Face ID prompts. Sharing the in-flight
// promise means the burst re-signs in exactly once.
let reSignInFlight: Promise<string> | null = null;

/**
 * Run a cosign API call with a valid wallet-scope token, transparently
 * recovering when the server rejects it. ensureWalletSession only checks the
 * JWT's own `exp`, so a token the backend has invalidated for another reason
 * (e.g. a JWT-secret rotation on redeploy) still looks "live" and is handed back
 * — then 401s. cosign.ts does no refresh-on-401 of its own, so without this a
 * stale token wedges every poll permanently. On an auth error we force one fresh
 * sign-in (deduped) and retry the call once.
 *
 * Safe to retry: a 401 is rejected at the auth middleware BEFORE the handler
 * runs (same property the 429 retry in cosign.ts relies on), so no create is
 * duplicated; signature attach is deduped server-side by blind_signer_id; cancel
 * is idempotent. The one non-idempotent op (on-chain submit) is deliberately
 * NOT wrapped — see submitRequest.
 */
async function withWalletToken<T>(fn: (t: string) => Promise<T>): Promise<T> {
  const me = pickSigner();
  if (!me) {
    throw new Error('No personal account on this device to authenticate with.');
  }
  const t = await ensureWalletSession(me.account);
  try {
    return await fn(t);
  } catch (e) {
    if (!isAuthError(e)) throw e;
    if (__DEV__) console.log('[cosign] token rejected by server — re-signing in and retrying');
    if (!reSignInFlight) {
      reSignInFlight = reSignInWallet(me.account).finally(() => {
        reSignInFlight = null;
      });
    }
    const fresh = await reSignInFlight;
    return fn(fresh);
  }
}

interface ResolvedWallet {
  address: string;
  wck: Uint8Array;
}

/**
 * Identify which of this device's shared wallets a fetched request belongs to,
 * by matching its (opaque) queue_index against each wallet's computed index.
 * Returns null if none match (not ours, or we don't hold the key).
 */
async function resolveWallet(queueIndex: string): Promise<ResolvedWallet | null> {
  const { accounts } = useWalletStore.getState();
  for (const a of accounts) {
    if (!a.isMultisig || !a.smartAccountAddress) continue;
    const wck = await getWalletCosignKey(a.smartAccountAddress);
    if (wck && queueIndexFor(wck, a.smartAccountAddress) === queueIndex) {
      return { address: a.smartAccountAddress, wck };
    }
  }
  return null;
}

/** Decrypt a raw request into the transport-agnostic packet shape. */
function decryptToPacket(raw: CosignRequestRaw, w: ResolvedWallet): CosignPacket {
  return {
    v: 1,
    id: raw.id,
    network: raw.network === 'mainnet' ? 'mainnet' : 'testnet',
    smartAccountAddress: w.address,
    unsignedTxXdr: decryptForWallet(w.wck, raw.unsignedTxXdr, w.address),
    threshold: raw.threshold,
    // signerKey carries the blind id here (the real device key is never stored
    // server-side). aggregateAndSubmit dedupes via the decrypted entry, not this
    // field, so submit is unaffected; "have I signed" is checked via blind id in
    // approveRequest.
    signatures: raw.signatures.map((s) => ({
      signerKey: s.blindSignerId,
      authEntryXdr: decryptForWallet(w.wck, s.authEntryXdr, w.address),
    })),
    expiresLedger: 0,
    createdAt: raw.createdAt,
    submittedTxHash: raw.submittedTxHash,
  };
}

function decryptedEntries(raw: CosignRequestRaw, w: ResolvedWallet): CollectedEntry[] {
  return raw.signatures.map((s) => ({
    signerKey: s.blindSignerId,
    authEntryXdr: decryptForWallet(w.wck, s.authEntryXdr, w.address),
  }));
}

export async function createTransferRequest(p: CreateTransferPacketParams): Promise<CosignPacket> {
  const account = p.multisigAccount.smartAccountAddress;
  if (!account) throw new Error('This multisig wallet is not deployed yet.');
  const me = pickSigner();
  if (!me) throw new Error('No personal account on this device to sign with.');

  // Creator generates the wallet's key on first send if absent (idempotent —
  // returns the wizard-created key when present). Members get it via the
  // latch://cosign-key link; this is the creator's bootstrap point.
  const wck = await ensureWalletCosignKey(account);
  const w: ResolvedWallet = { address: account, wck };
  const threshold = await onChainThreshold(account);

  const assembled = await buildAssembledTransfer({
    multisigAddress: account,
    sacContractId: p.sacContractId,
    destinationAddress: p.destinationAddress,
    amount: p.amount,
  });

  const queueIndex = queueIndexFor(wck, account);
  if (__DEV__) {
    // Compare this prefix against the [cosign] poll log on the OTHER device — if
    // they differ, the two devices hold different WCKs and will never see each
    // other's requests (the queue is scoped by HMAC(WCK, address)).
    console.log('[cosign] created request on queue', queueIndex.slice(0, 12), 'for', account);
  }

  // Sign our own member entry up front so an auth-retry of the server calls
  // doesn't re-run the signing (which can prompt biometrics for passkey users).
  const entry = await signSharedEntry(
    assembled.unsignedTxXdr,
    me.account,
    me.listIndex,
    useWalletStore.getState().mnemonic,
  );

  const raw = await withWalletToken(async (t) => {
    const created = await createCosignRequest(t, {
      queueIndex,
      unsignedTxXdr: encryptForWallet(wck, assembled.unsignedTxXdr, account),
      network: getNetworkId(),
      threshold,
    });
    // Attach our blind-id'd, encrypted entry. Uses the SAME token the create just
    // succeeded with, so this never auth-fails on its own.
    return addCosignSignature(
      t,
      created.id,
      blindSignerId(wck, entry.signerKey),
      encryptForWallet(wck, entry.authEntryXdr, account),
    );
  });
  return decryptToPacket(raw, w);
}

export async function getRequest(id: string): Promise<CosignPacket | null> {
  try {
    return await withWalletToken(async (t) => {
      const raw = await getCosignRequest(t, id);
      const w = await resolveWallet(raw.queueIndex);
      return w ? decryptToPacket(raw, w) : null;
    });
  } catch (e) {
    if (e instanceof CosignApiError && e.status === 404) return null;
    throw e;
  }
}

export async function approveRequest(id: string): Promise<CosignPacket> {
  const me = pickSigner();
  if (!me) throw new Error('No personal account on this device to sign with.');

  return withWalletToken(async (t) => {
    const raw = await getCosignRequest(t, id);
    const w = await resolveWallet(raw.queueIndex);
    if (!w) throw new Error("This wallet's encryption key isn't on this device.");

    const myKey = await getMySignerKey();
    const myBlind = myKey ? blindSignerId(w.wck, myKey) : null;
    if (myBlind && raw.signatures.some((s) => s.blindSignerId === myBlind)) {
      throw new Error('You have already approved this transfer.');
    }

    const unsignedTxXdr = decryptForWallet(w.wck, raw.unsignedTxXdr, w.address);
    const entry = await signSharedEntry(
      unsignedTxXdr,
      me.account,
      me.listIndex,
      useWalletStore.getState().mnemonic,
    );
    const updated = await addCosignSignature(
      t,
      id,
      blindSignerId(w.wck, entry.signerKey),
      encryptForWallet(w.wck, entry.authEntryXdr, w.address),
    );
    return decryptToPacket(updated, w);
  });
}

/**
 * Whether this device can still add an approval to a backend packet. Unlike the
 * P2P check, a decrypted backend packet stores each signature's signerKey as the
 * BLIND id (the real device key never leaves the device), so "have I signed?"
 * must compare against blindSignerId(wck, myKey) — exactly the dedup approveRequest
 * uses. Without this the comparison can't match and the Approve button never clears.
 */
export async function canApprove(packet: CosignPacket): Promise<boolean> {
  const myKey = await getMySignerKey();
  if (!myKey) return false;
  const wck = await getWalletCosignKey(packet.smartAccountAddress);
  if (!wck) return false; // no key → can't derive blind id (and couldn't sign anyway)
  const myBlind = blindSignerId(wck, myKey);
  return !packet.signatures.some((s) => s.signerKey === myBlind);
}

/**
 * Of the given on-chain signer keys (raw keyDataHex), return the subset that has
 * already approved this packet. Backend signatures carry BLIND ids, so each
 * candidate key is matched by its blindSignerId(wck, key) — the same derivation
 * used when a signature is attached. Empty when the WCK isn't on this device.
 */
export async function approvedKeyData(
  packet: CosignPacket,
  keyDataHexList: string[],
): Promise<Set<string>> {
  const wck = await getWalletCosignKey(packet.smartAccountAddress);
  if (!wck) return new Set();
  const signed = new Set(packet.signatures.map((s) => s.signerKey)); // blind ids
  const out = new Set<string>();
  for (const k of keyDataHexList) {
    if (signed.has(blindSignerId(wck, k))) out.add(k);
  }
  return out;
}

/**
 * Submit once threshold is met, then mark the request submitted. The gate
 * re-reads the threshold from chain (defense in depth, same as the P2P path).
 */
export async function submitRequest(id: string): Promise<{ hash: string }> {
  // Read (and recover from a stale token) UP FRONT, before anything irreversible.
  // The token returned here is server-validated, so the later markCosignSubmitted
  // reuses it without needing its own retry — crucial because aggregateAndSubmit
  // broadcasts on-chain and must never be re-run by an auth retry.
  const { raw, token: t } = await withWalletToken(async (tok) => ({
    raw: await getCosignRequest(tok, id),
    token: tok,
  }));
  const w = await resolveWallet(raw.queueIndex);
  if (!w) throw new Error("This wallet's encryption key isn't on this device.");

  const threshold = await onChainThreshold(w.address);
  if (raw.signatures.length < threshold) {
    throw new Error(`Not enough approvals yet (${raw.signatures.length}/${threshold}).`);
  }

  const unsignedTxXdr = decryptForWallet(w.wck, raw.unsignedTxXdr, w.address);
  const { hash } = await aggregateAndSubmit(unsignedTxXdr, decryptedEntries(raw, w));
  await markCosignSubmitted(t, id, hash);
  return { hash };
}

// Accounts we already tried (and failed) to auto-fetch a WCK for this session,
// so the 15s pending-list poll doesn't hammer the server with 404 lookups.
const wckFetchAttempted = new Set<string>();

/**
 * Clear the one-shot auto-fetch guard so a manual pull-to-refresh can retry a
 * WCK that failed to arrive on an earlier poll — e.g. this device's first poll
 * landed before the sealing device published the bundle. Without this, that
 * single failed attempt blocks every future poll (interval AND pull-to-refresh)
 * for the rest of the app session.
 */
export function resetWckFetchAttempts(): void {
  wckFetchAttempted.clear();
}

/** All pending requests for one shared wallet (decrypted, packet-shaped). */
export async function listForAccount(account: string): Promise<CosignPacket[]> {
  let wck = await getWalletCosignKey(account);
  if (!wck && !wckFetchAttempted.has(account)) {
    // Self-healing bootstrap: first pending-list poll without a key tries the
    // server-side sealed bundle once (zero-touch member pickup).
    wckFetchAttempted.add(account);
    try {
      if (await autoFetchWalletCosignKey(account)) {
        wck = await getWalletCosignKey(account);
      }
    } catch {
      /* no bundle / not sealed for us — manual link remains the fallback */
    }
  }
  if (!wck) {
    // no key for this wallet on this device → can't derive the queue index, so
    // nothing to show. This is the #1 reason a member sees an empty list for a
    // request another device created (the WCK never reached this device).
    if (__DEV__) console.log('[cosign] no WCK for', account, '→ cannot poll its queue');
    return [];
  }
  const queueIndex = queueIndexFor(wck, account);
  const raws = await withWalletToken((t) => listCosignRequests(t, queueIndex));
  if (__DEV__) {
    console.log(
      '[cosign] poll',
      account,
      'queue',
      queueIndex.slice(0, 12),
      '→',
      raws.length,
      'request(s)',
    );
  }
  const w: ResolvedWallet = { address: account, wck };
  return raws.map((r) => decryptToPacket(r, w));
}

export async function cancelRequest(id: string): Promise<void> {
  await withWalletToken((t) => cancelCosignRequest(t, id));
}
