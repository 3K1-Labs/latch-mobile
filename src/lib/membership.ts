/**
 * membership.ts — shared-wallet discovery: announce on create, poll on launch.
 *
 * A device only ever sees shared wallets it created or manually added; this lets
 * a second signer's device auto-discover wallets it was added to. The creator
 * announces, for each on-chain member, a row keyed by the member's BLIND id
 * (`membershipBlindId` — a one-way hash of the member's public signer key). A
 * joining device computes its own blind id, lists its wallets, and adds them by
 * the public C-address. Discovery is advisory: `addSharedWalletByAddress`
 * re-verifies on-chain that this device is actually a signer before trusting it,
 * so a forged announcement can't inject a wallet.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';

import { fetchDefaultContextRule } from '@/src/api/account-admin';
import { announceMemberships, listMemberships } from '@/src/api/memberships';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { getMySignerKey, pickSigner } from '@/src/lib/cosign-packet-flow';
import { ensureWalletSession } from '@/src/lib/wallet-auth';
import { useSharedWalletNaming } from '@/src/store/shared-wallet-naming';
import { useWalletStore } from '@/src/store/wallet';

const MEMBERSHIP_SCHEME = 'latch-membership:v1:';

// Accounts whose announce hasn't durably landed yet (e.g. a 429 ate it). Held
// in plain AsyncStorage — the value is just public C-addresses already in the
// account list, nothing sensitive — and swept on every foreground so a
// transient failure self-heals instead of silently losing discovery.
const PENDING_ANNOUNCE_KEY = 'latch.pendingAnnounce.v1';

async function getPendingAnnounces(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_ANNOUNCE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function markPendingAnnounce(account: string): Promise<void> {
  const list = await getPendingAnnounces();
  if (list.includes(account)) return;
  try {
    await AsyncStorage.setItem(PENDING_ANNOUNCE_KEY, JSON.stringify([...list, account]));
  } catch {
    // best-effort; a missed mark just means no cross-session retry for this one
  }
}

async function clearPendingAnnounce(account: string): Promise<void> {
  const list = await getPendingAnnounces();
  if (!list.includes(account)) return;
  try {
    await AsyncStorage.setItem(
      PENDING_ANNOUNCE_KEY,
      JSON.stringify(list.filter((a) => a !== account)),
    );
  } catch {
    // best-effort
  }
}

function simParams() {
  return {
    rpcUrl: STELLAR_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    factoryAddress: STELLAR_FACTORY_ADDRESS,
  };
}

/**
 * One-way blind id for a member's on-chain signer key (ed25519 pubkey hex or
 * webauthn key_data hex). Both the creator (reads the key on-chain) and the
 * member (knows its own key) derive the same value, so the server never needs
 * the raw key to route a membership.
 */
export function membershipBlindId(keyDataHex: string): string {
  return Buffer.from(
    sha256(new TextEncoder().encode(MEMBERSHIP_SCHEME + keyDataHex.toLowerCase())),
  ).toString('hex');
}

/**
 * Announce a freshly-created shared wallet to every on-chain device-key member
 * so their devices can discover it. Fire-and-forget after deploy; non-fatal.
 */
export async function announceMembership(account: string): Promise<void> {
  const me = pickSigner();
  if (!me) return;

  // Persist intent before the network leg so an interrupted announce (429,
  // expired token, app kill) is retried by the foreground sweep. Cleared the
  // moment it lands — or when there's genuinely nothing to announce.
  await markPendingAnnounce(account);

  const rule = await fetchDefaultContextRule(simParams(), account);
  const deviceSigners = rule.signers.filter(
    (s) => (s.kind === 'ed25519' || s.kind === 'webauthn') && s.keyDataHex,
  );
  const blindIds = deviceSigners.map((s) => membershipBlindId(s.keyDataHex));
  if (__DEV__) {
    console.log(
      '[membership] announce',
      account,
      '— device signers:',
      rule.signers.map((s) => s.kind).join(','),
      '→ blindIds:',
      blindIds.map((b) => b.slice(0, 10)),
    );
  }
  // Delegated-only multisigs (onboarding model) have no device-key signers to
  // key discovery on — nothing to announce until that path is supported.
  if (blindIds.length === 0) {
    await clearPendingAnnounce(account);
    return;
  }

  const token = await ensureWalletSession(me.account);
  await announceMemberships(token, account, blindIds);
  await clearPendingAnnounce(account);
  if (__DEV__) console.log('[membership] announced ok');
}

/**
 * Re-fire any announce that didn't durably land (e.g. dropped by a 429). Runs
 * on every foreground alongside discovery; each success clears its marker, each
 * failure leaves it for the next sweep. Safe to call when nothing is pending.
 */
export async function retryPendingAnnouncements(): Promise<void> {
  const pending = await getPendingAnnounces();
  if (pending.length === 0) return;
  if (__DEV__) console.log('[membership] re-announce sweep:', pending);
  for (const account of pending) {
    try {
      await announceMembership(account);
    } catch (e: any) {
      if (__DEV__) console.log('[membership] re-announce failed', account, e?.message);
      // stays pending; the next foreground sweep retries
    }
  }
}

/**
 * Discover shared wallets this device was added to and queue the ones not
 * already present (or already pending) for naming. Returns the number newly
 * queued. The user names each via SharedWalletNamingModal, and the add it
 * triggers re-verifies on-chain membership, so forged announcements are
 * rejected at store time.
 */
export async function discoverSharedWallets(): Promise<number> {
  const me = pickSigner();
  if (!me) {
    if (__DEV__) console.log('[membership] discover: no signable personal account');
    return 0;
  }
  const myKey = await getMySignerKey();
  if (!myKey) {
    if (__DEV__) console.log('[membership] discover: no signer key on this device');
    return 0;
  }

  const blindId = membershipBlindId(myKey);
  const token = await ensureWalletSession(me.account);
  const wallets = await listMemberships(token, blindId);
  if (__DEV__) {
    console.log('[membership] discover: blindId', blindId.slice(0, 10), '→ found', wallets.length, 'wallet(s):',
      wallets.map((w) => w.wallet_ref));
  }

  const known = new Set(
    useWalletStore
      .getState()
      .accounts.map((a) => a.smartAccountAddress)
      .filter((a): a is string => !!a),
  );

  const enqueue = useSharedWalletNaming.getState().enqueue;
  let queued = 0;
  for (const w of wallets) {
    if (known.has(w.wallet_ref)) {
      if (__DEV__) console.log('[membership] discover: already have', w.wallet_ref);
      continue;
    }
    // enqueue dedups against wallets already awaiting a name, so repeated
    // foreground sweeps don't re-prompt while the modal is open.
    if (enqueue(w.wallet_ref)) {
      queued += 1;
      if (__DEV__) console.log('[membership] discover: queued for naming', w.wallet_ref);
    }
  }
  return queued;
}
