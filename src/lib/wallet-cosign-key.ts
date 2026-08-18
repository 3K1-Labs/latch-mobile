/**
 * wallet-cosign-key.ts — the Wallet Cosign Key (WCK) lifecycle
 * (docs/multisig-encrypted-queue.md, Phase 2 step 2).
 *
 * One 32-byte AES key per shared wallet, held by every member, that the backend
 * never sees. Generated at wallet creation, cached in SecureStore keyed by the
 * smart-account address, and bootstrapped to other members over a trusted
 * channel via a latch://cosign-key deep link.
 *
 * Sensitive material → SecureStore only (never AsyncStorage). The key is stored
 * as hex; hex is also the link param encoding (URL-safe, no base64 padding).
 */

import { sha256 } from '@noble/hashes/sha2.js';
import * as SecureStore from 'expo-secure-store';

import { fetchDefaultContextRule } from '@/src/api/account-admin';
import { fetchWckBundle, uploadWckBundle } from '@/src/api/wck-bundle';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { generateWalletCosignKey } from '@/src/lib/cosign-crypto';
import { getMySignerKey, pickSigner } from '@/src/lib/cosign-packet-flow';
import { getStoredPrivateKeyHex } from '@/src/lib/passkey-webauthn';
import {
  buildWckBundle,
  openWckBundle,
  type WckBundleOpener,
  type WckRecipient,
} from '@/src/lib/sealed-wck';
import { deriveWalletAtIndex } from '@/src/lib/seed-wallet';
import { ensureWalletSession } from '@/src/lib/wallet-auth';
import { SECURE_KEYS } from '@/src/store/wallet';

const WCK_PREFIX = 'latch_wck_';
const KEY_LEN = 32;

function simParams() {
  return {
    rpcUrl: STELLAR_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    factoryAddress: STELLAR_FACTORY_ADDRESS,
  };
}

// ─── hex codec (storage + link param) ────────────────────────────────────────

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

function hexToBytes(h: string): Uint8Array {
  const clean = h.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) {
    throw new Error('wallet-cosign-key: invalid hex');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Encode a WCK for the latch://cosign-key `wck` param (hex is URL-safe). */
export function encodeWck(wck: Uint8Array): string {
  return bytesToHex(wck);
}

// ─── storage ─────────────────────────────────────────────────────────────────

export async function getWalletCosignKey(account: string): Promise<Uint8Array | null> {
  const hex = await SecureStore.getItemAsync(WCK_PREFIX + account);
  return hex ? hexToBytes(hex) : null;
}

async function setWalletCosignKey(account: string, wck: Uint8Array): Promise<void> {
  if (wck.length !== KEY_LEN) throw new Error('wallet-cosign-key: WCK must be 32 bytes');
  await SecureStore.setItemAsync(WCK_PREFIX + account, bytesToHex(wck));
}

export async function hasWalletCosignKey(account: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(WCK_PREFIX + account)) !== null;
}

/**
 * Return the wallet's WCK, generating + persisting one if absent. Called at
 * wizard creation by the creator (the first member to hold the key).
 */
export async function ensureWalletCosignKey(account: string): Promise<Uint8Array> {
  const existing = await getWalletCosignKey(account);
  if (existing) return existing;
  const wck = generateWalletCosignKey();
  await setWalletCosignKey(account, wck);
  return wck;
}

// ─── bootstrap import (member-checked) ───────────────────────────────────────

/**
 * Import a WCK received over a latch://cosign-key link. Stores it ONLY if this
 * device is actually a signer on `account` on-chain — otherwise a stray/forged
 * link can't plant a key for a wallet you're not in. Throws with a user-facing
 * message on any failure.
 */
export async function importWalletCosignKey(account: string, wckParam: string): Promise<void> {
  const wck = hexToBytes(wckParam);
  if (wck.length !== KEY_LEN) throw new Error('Invalid wallet key (must be 32 bytes).');

  const myKey = await getMySignerKey();
  if (!myKey) throw new Error('No signing key on this device.');

  const rule = await fetchDefaultContextRule(simParams(), account);
  const mine = myKey.toLowerCase();
  const isMember = rule.signers.some((s) => s.keyDataHex && s.keyDataHex.toLowerCase() === mine);
  if (!isMember) {
    throw new Error(
      "This device isn't a signer on that multisig wallet, so it can't hold its key.",
    );
  }

  await setWalletCosignKey(account, wck);
}

// ─── sealed bundle distribution (no trusted channel needed) ───────────────────

/**
 * Build a sealed bundle of this wallet's WCK for every on-chain device-key member
 * — one blob with a copy encrypted to each member's signer key (X25519 box for
 * ed25519 members, P-256 box for passkey/webauthn members). Safe to send over ANY
 * channel: only each member's device can open its own entry. Delegated members
 * have no device key and are skipped.
 */
export async function buildWckBundleForMembers(
  account: string,
): Promise<{ bundle: string; recipientCount: number }> {
  const wck = await getWalletCosignKey(account);
  if (!wck) throw new Error("This wallet's key isn't on this device.");

  const rule = await fetchDefaultContextRule(simParams(), account);
  const recipients: WckRecipient[] = rule.signers
    .filter((s) => (s.kind === 'ed25519' || s.kind === 'webauthn') && s.keyDataHex)
    .map((s) => ({ kind: s.kind as 'ed25519' | 'webauthn', keyDataHex: s.keyDataHex }));
  if (recipients.length === 0) {
    throw new Error('No on-chain device-key members to share the key with yet.');
  }
  return { bundle: buildWckBundle(wck, recipients), recipientCount: recipients.length };
}

// ─── server-side pickup (zero-touch bootstrap) ────────────────────────────────

/**
 * Deterministic, secret-free pickup key for a wallet's sealed bundle:
 * sha256("latch-wck-pickup:v1:" + C-address), hex. A joining member knows only
 * the C-address, so the key can't require the WCK (chicken-and-egg). The
 * C-address is public on-chain data, and the bundle behind the key is sealed —
 * possession of the key yields only ciphertext members alone can open.
 */
export function pickupKeyFor(account: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(`latch-wck-pickup:v1:${account}`)));
}

async function walletToken(): Promise<string> {
  const me = pickSigner();
  if (!me) throw new Error('No personal account on this device to authenticate with.');
  return ensureWalletSession(me.account);
}

/**
 * Seal this wallet's WCK to every on-chain ed25519 member and store the bundle
 * server-side, so members pick it up automatically (no manual key link).
 * Non-fatal by design — callers fire-and-forget after deploy; the manual
 * latch://cosign-key link remains the fallback path.
 */
export async function publishWckBundle(account: string): Promise<void> {
  const { bundle } = await buildWckBundleForMembers(account);
  await uploadWckBundle(await walletToken(), pickupKeyFor(account), bundle);
}

/**
 * Try to fetch + import this wallet's WCK from the server-side sealed bundle.
 * Resolves true when the key landed (or was already present), false when no
 * bundle exists for the wallet. All importWalletCosignKeyFromBundle gates
 * apply: the entry must be sealed to THIS device's key, and the device must be
 * a current on-chain signer.
 */
export async function autoFetchWalletCosignKey(account: string): Promise<boolean> {
  if (await hasWalletCosignKey(account)) return true;
  const bundle = await fetchWckBundle(await walletToken(), pickupKeyFor(account));
  if (!bundle) return false;
  await importWalletCosignKeyFromBundle(account, bundle);
  return true;
}

/**
 * Import the WCK from a sealed bundle: open this device's entry with its device
 * key, confirm we're a current on-chain signer, then cache it. Throws a
 * user-facing message on any failure. Works for ed25519 (mnemonic seed) and
 * passkey (stored P-256 secret — may prompt biometrics) devices.
 */
export async function importWalletCosignKeyFromBundle(account: string, bundle: string): Promise<void> {
  const me = pickSigner();
  if (!me) throw new Error('No personal account on this device to receive the key.');
  const myKey = await getMySignerKey();
  if (!myKey) throw new Error('No signing key on this device.');

  let opener: WckBundleOpener;
  if (me.account.gAddress && me.account.index >= 0) {
    // ed25519 device: open with the mnemonic-derived seed.
    const mnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);
    if (!mnemonic) throw new Error('Unlock your wallet, then open the link again.');
    const edSeed = Uint8Array.from(
      deriveWalletAtIndex(mnemonic, me.account.index).keypair.rawSecretKey(),
    );
    opener = { edSeed };
  } else {
    // passkey device: open with the stored P-256 secret (reading it may prompt Face ID).
    const p256SecHex = await getStoredPrivateKeyHex(me.listIndex);
    if (!p256SecHex) throw new Error('No passkey on this device to receive the key.');
    opener = { p256SecHex };
  }

  const wck = openWckBundle(bundle, myKey, opener);
  if (!wck) throw new Error("This key bundle isn't sealed for your device.");

  // Defense in depth: confirm this device is actually a current signer on-chain.
  const rule = await fetchDefaultContextRule(simParams(), account);
  const mine = myKey.toLowerCase();
  if (!rule.signers.some((s) => s.keyDataHex && s.keyDataHex.toLowerCase() === mine)) {
    throw new Error("This device isn't a signer on that multisig wallet.");
  }
  await setWalletCosignKey(account, wck);
}
