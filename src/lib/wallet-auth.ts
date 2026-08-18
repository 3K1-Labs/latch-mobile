/**
 * wallet-auth.ts — SEP-10-inspired wallet sign-in against wallet-backend.
 *
 * Acquires a wallet-scope JWT by:
 *   1. POST /v1/auth/challenge to get a single-use 60s nonce.
 *   2. Sign the nonce with the user's wallet key:
 *        - Mnemonic accounts (index >= 0): Stellar Keypair Ed25519.
 *        - Passkey accounts (index === -1): P-256 WebAuthn assertion via
 *          src/lib/passkey-webauthn.ts.
 *   3. POST /v1/auth/sign-in with the signature.
 *   4. Persist the returned tokens under SECURE_KEYS.WALLET_ACCESS_TOKEN /
 *      SECURE_KEYS.WALLET_REFRESH_TOKEN.
 *
 * Independent of the email-scope flow in latch-auth.ts. Skip-backup users
 * have no email token but can still sign in here because the only identity
 * required is wallet control (something every Latch user has by definition).
 */

import * as SecureStore from 'expo-secure-store';
import { Buffer } from 'buffer';
import { getNetworkId, PASSKEY_RP_ID } from '../constants/config';
import { findDeployedNetwork } from './account-network';
import { signWithPasskey } from './passkey-webauthn';
import { deriveWalletAtIndex } from './seed-wallet';
import { getPasskeyStorageKeys, SECURE_KEYS, useWalletStore, type WalletAccount } from '../store/wallet';
import { API_BASE_URL } from '@/src/constants/api-host';

const API_ROOT = API_BASE_URL;
const API_BASE = `${API_ROOT}/v1`;

// ─── Transport ────────────────────────────────────────────────────────────────

function xhrPost(path: string, body: object): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('POST', `${API_BASE}${path}`, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.timeout = 30000;
    req.onload = () => {
      try {
        resolve({ status: req.status, body: JSON.parse(req.responseText) });
      } catch {
        resolve({ status: req.status, body: null });
      }
    };
    req.onerror = () => reject(new Error('Network error'));
    req.ontimeout = () => reject(new Error('Request timed out'));
    req.send(JSON.stringify(body));
  });
}

// ─── Encodings ────────────────────────────────────────────────────────────────

export function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function b64URLToBytes(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

// Convert a 64-byte compact P-256 signature (r || s) to ASN.1 DER, the
// format the wallet-backend's ecdsa.VerifyASN1 expects.
export function compactSigToDER(compact: Uint8Array): Uint8Array {
  const r = compact.slice(0, 32);
  const s = compact.slice(32, 64);
  const rDER = asn1Int(r);
  const sDER = asn1Int(s);
  const total = rDER.length + sDER.length;
  const out = new Uint8Array(2 + total);
  out[0] = 0x30;
  out[1] = total;
  out.set(rDER, 2);
  out.set(sDER, 2 + rDER.length);
  return out;
}

function asn1Int(b: Uint8Array): Uint8Array {
  // Strip leading zeros (but keep at least one byte).
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  let stripped = b.slice(i);
  // If the high bit is set, prepend a 0x00 to mark the integer positive.
  if (stripped[0] & 0x80) {
    const padded = new Uint8Array(stripped.length + 1);
    padded.set(stripped, 1);
    stripped = padded;
  }
  const out = new Uint8Array(2 + stripped.length);
  out[0] = 0x02;
  out[1] = stripped.length;
  out.set(stripped, 2);
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Acquire wallet-scope tokens for the given account. Triggers Face ID/Touch ID
 * for passkey users; silent for mnemonic users.
 */
export async function signInWithWallet(account: WalletAccount): Promise<TokenPair> {
  const isPasskey = account.index < 0;
  const wallet = isPasskey ? account.smartAccountAddress : account.gAddress;
  const keyType = isPasskey ? 'passkey' : 'ed25519';
  if (__DEV__) console.log('[wallet-auth] signInWithWallet: wallet=', wallet, 'keyType=', keyType, 'index=', account.index);
  if (!wallet) throw new Error('wallet address not available — smart account may not be deployed yet');

  // The backend resolves a passkey wallet's on-chain signers over the RPC for
  // the network it's told, and defaults to testnet when told nothing — so a
  // mainnet account signing in without this finds no signer and is rejected as
  // "signature verification failed". The nonce is bound to the network at issue
  // and re-checked on consume, so both calls must carry the same value.
  const network = getNetworkId();

  if (isPasskey) await assertWalletIsOnNetwork(account, wallet, network);

  const ch = await xhrPost('/auth/challenge', { wallet, key_type: keyType, network });
  if (__DEV__) console.log('[wallet-auth] challenge status=', ch.status, 'body=', JSON.stringify(ch.body));
  if (ch.status !== 200 || !ch.body?.data?.nonce) {
    throw new Error(ch.body?.error?.message ?? `challenge failed (${ch.status})`);
  }
  const nonceB64URL = ch.body.data.nonce as string;
  const nonceBytes = b64URLToBytes(nonceB64URL);

  let payload;
  try {
    payload = isPasskey
      ? await buildPasskeyPayload(account, nonceB64URL, nonceBytes, wallet, keyType)
      : await buildEd25519Payload(account, nonceBytes, wallet, keyType, nonceB64URL);
    if (__DEV__) console.log('[wallet-auth] payload built; signature len=', (payload as any).signature?.length ?? 'n/a');
  } catch (e: any) {
    if (__DEV__) console.log('[wallet-auth] BUILD PAYLOAD FAILED:', e?.message, e?.stack);
    throw e;
  }

  const si = await xhrPost('/auth/sign-in', { ...payload, network });
  if (__DEV__) console.log('[wallet-auth] sign-in status=', si.status, 'body=', JSON.stringify(si.body));
  if (si.status !== 200 || !si.body?.data?.access_token) {
    throw new Error(si.body?.error?.message ?? `sign-in failed (${si.status})`);
  }

  const tokens: TokenPair = {
    accessToken: si.body.data.access_token,
    refreshToken: si.body.data.refresh_token,
  };
  await Promise.all([
    SecureStore.setItemAsync(SECURE_KEYS.WALLET_ACCESS_TOKEN, tokens.accessToken),
    SecureStore.setItemAsync(SECURE_KEYS.WALLET_REFRESH_TOKEN, tokens.refreshToken),
  ]);
  return tokens;
}

/**
 * Refuse a sign-in for a wallet that lives on a different network than the app
 * is pointed at. The backend reads a passkey wallet's signers from the chain we
 * declare, so a mismatch comes back as an opaque "signature verification
 * failed" — indistinguishable from a forged assertion, and unactionable. Here
 * we still know which network the wallet is really on, so say so.
 *
 * Passkey accounts only: an ed25519 sign-in is verified against the G-address
 * alone, with no chain read that could be aimed at the wrong ledger.
 *
 * Accounts deployed after `network` was added carry it and cost nothing to
 * check; older ones are probed once and stamped. A network that can't be
 * resolved (RPC down, or a wallet on neither chain) proceeds exactly as before
 * — a bad connection must never lock someone out of their own wallet.
 */
async function assertWalletIsOnNetwork(
  account: WalletAccount,
  wallet: string,
  network: 'testnet' | 'mainnet',
): Promise<void> {
  let deployedOn = account.network;
  if (!deployedOn) {
    const found = await findDeployedNetwork(wallet);
    if (!found) return;
    deployedOn = found;
    // Best-effort cache of the probe result; a failed write just re-probes.
    await useWalletStore.getState().setAccountNetwork(wallet, found).catch(() => {});
  }
  if (deployedOn === network) return;

  const label = (n: string) => (n === 'testnet' ? 'Testnet' : 'Mainnet');
  throw new Error(
    `This wallet is on ${label(deployedOn)}, but the app is on ${label(network)}. ` +
      `Switch networks under Profile → Network to use it.`,
  );
}

async function buildEd25519Payload(
  account: WalletAccount,
  nonceBytes: Uint8Array,
  wallet: string,
  keyType: string,
  nonceB64URL: string,
): Promise<Record<string, string>> {
  const mnemonic = await SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC);
  if (!mnemonic) throw new Error('mnemonic not available — sign in requires the wallet to be unlocked');
  // Derive the same Ed25519 keypair the user signs transactions with.
  // Pure and network-free; safe to call on the JS thread.
  const stellar = deriveWalletAtIndex(mnemonic, account.index);
  if (stellar.gAddress !== account.gAddress) {
    throw new Error('account mismatch: signing key does not match wallet address');
  }
  const sigBuf = stellar.keypair.sign(Buffer.from(nonceBytes));
  return {
    wallet,
    key_type: keyType,
    nonce: nonceB64URL,
    signature: bytesToB64(new Uint8Array(sigBuf)),
  };
}

async function buildPasskeyPayload(
  account: WalletAccount,
  nonceB64URL: string,
  nonceBytes: Uint8Array,
  wallet: string,
  keyType: string,
): Promise<Record<string, string>> {
  // Find this account's passkey privateKey in SecureStore.
  // List index 0 uses the legacy non-indexed keys; later indices use suffixes.
  // We don't have the list index handy here, so probe index 0 first (the
  // common case) then fall back if missing.
  const keys0 = getPasskeyStorageKeys(0);
  let privateKeyHex = await SecureStore.getItemAsync(keys0.privateKey);
  if (!privateKeyHex) {
    // Try indexed slots up to a small bound.
    for (let i = 1; i < 10; i++) {
      const keys = getPasskeyStorageKeys(i);
      const credIdHex = await SecureStore.getItemAsync(keys.credentialId);
      if (credIdHex && credIdHex === account.credentialId) {
        privateKeyHex = await SecureStore.getItemAsync(keys.privateKey);
        break;
      }
    }
  }
  if (!privateKeyHex) throw new Error('passkey private key not found in SecureStore');

  // signWithPasskey embeds challenge=b64url(nonceBytes) inside clientDataJSON
  // and sets origin=rpId (PASSKEY_RP_ID). The backend allowlist must contain
  // this rpId value (LATCH_WEBAUTHN_ALLOWED_ORIGINS).
  const { authenticatorData, clientDataJSON, signature } = await signWithPasskey(
    privateKeyHex,
    nonceBytes,
    PASSKEY_RP_ID,
  );
  const derSig = compactSigToDER(signature);

  return {
    wallet,
    key_type: keyType,
    nonce: nonceB64URL,
    authenticator_data: bytesToB64(authenticatorData),
    client_data_json: bytesToB64(clientDataJSON),
    passkey_signature: bytesToB64(derSig),
  };
}

// Decode a JWT's `exp` and report whether it's past (with a small skew so we
// don't hand out a token that dies mid-flight). Unparseable / exp-less tokens
// are treated as live — never force a refresh we can't justify.
function isJwtExpired(token: string, skewSeconds = 30): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return false;
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
      'utf8',
    );
    const exp = JSON.parse(json)?.exp;
    if (typeof exp !== 'number') return false;
    return Date.now() / 1000 >= exp - skewSeconds;
  } catch {
    return false;
  }
}

/**
 * Return a usable wallet-scope access token, signing in or refreshing as
 * needed. A cached-but-expired token is silently refreshed via the refresh
 * token first (no biometric prompt); only a missing token triggers a full
 * sign-in. If the refresh fails the (stale) cached token is returned so the
 * caller's own 401 handling still applies — never worse than before.
 */
/**
 * Return a usable session token without ever signing in, or null if that isn't
 * possible. Signing in reads this device's passkey private key, and on a
 * biometric-gated key that read raises an OS Face ID / Touch ID prompt — which
 * must never happen on background work the user didn't ask for. Callers running
 * off a timer or an app-foreground event use this and skip when it returns null.
 */
export async function getWalletSessionWithoutSignIn(): Promise<string | null> {
  const existing = await SecureStore.getItemAsync(SECURE_KEYS.WALLET_ACCESS_TOKEN);
  if (!existing) return null;
  if (!isJwtExpired(existing)) return existing;
  return (await refreshWalletSession()) ?? existing;
}

export async function ensureWalletSession(account: WalletAccount): Promise<string> {
  const cached = await getWalletSessionWithoutSignIn();
  if (cached) return cached;
  const tokens = await signInWithWallet(account);
  return tokens.accessToken;
}

/**
 * Force a fresh sign-in, replacing any cached tokens. Used by the history
 * hook when a cached token returns 401.
 */
export async function reSignInWallet(account: WalletAccount): Promise<string> {
  await SecureStore.deleteItemAsync(SECURE_KEYS.WALLET_ACCESS_TOKEN);
  await SecureStore.deleteItemAsync(SECURE_KEYS.WALLET_REFRESH_TOKEN);
  const tokens = await signInWithWallet(account);
  return tokens.accessToken;
}

/**
 * Attempt a silent refresh of the wallet-scope tokens. Returns the new access
 * token on success or null when the refresh token is missing/rejected.
 */
export async function refreshWalletSession(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync(SECURE_KEYS.WALLET_REFRESH_TOKEN);
  if (!refreshToken) return null;
  try {
    const { status, body } = await xhrPost('/auth/refresh', { refresh_token: refreshToken });
    if (status !== 200 || !body?.data?.access_token) return null;
    await Promise.all([
      SecureStore.setItemAsync(SECURE_KEYS.WALLET_ACCESS_TOKEN, body.data.access_token),
      SecureStore.setItemAsync(SECURE_KEYS.WALLET_REFRESH_TOKEN, body.data.refresh_token),
    ]);
    return body.data.access_token as string;
  } catch {
    return null;
  }
}

