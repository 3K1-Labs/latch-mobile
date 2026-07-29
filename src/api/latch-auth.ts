/**
 * latch-auth.ts — Latch backend API for auth, backup, and account recovery.
 *
 * Backup is encrypted client-side (Argon2id + AES-256-GCM) before upload.
 * The backend stores and returns an opaque ciphertext blob and never sees
 * plaintext credentials.
 */

import { StrKey } from '@stellar/stellar-sdk';
import * as SecureStore from 'expo-secure-store';
import { decryptBackup, encryptBackup, type EncryptedBackup } from '../lib/backup-crypto';
import {
  ensureWalletSession,
  getWalletSessionWithoutSignIn,
  reSignInWallet,
} from '../lib/wallet-auth';
import {
  getPasskeyStorageKeys,
  SECURE_KEYS,
  useWalletStore,
  type WalletAccount,
} from '../store/wallet';

const API_ROOT = process.env.EXPO_PUBLIC_WALLET_BACKEND_URL ?? '';
const API_BASE = `${API_ROOT}/v1`;

// Raw XHR — resolves with { status, body } so callers can inspect the status
// before deciding whether to throw. Never rejects on HTTP errors; only rejects
// on network failure or timeout.
function xhrRaw(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method ?? 'GET', `${API_BASE}${path}`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 30000;
    xhr.onload = () => {
      try {
        resolve({ status: xhr.status, body: JSON.parse(xhr.responseText) });
      } catch {
        resolve({ status: xhr.status, body: null });
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.ontimeout = () => reject(new Error('Request timed out'));
    xhr.send(options.body as string | undefined);
  });
}

// Attempt a silent token refresh. Returns the new access token on success, null
// if the refresh token is missing or the server rejects it.
async function silentRefresh(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync(SECURE_KEYS.REFRESH_TOKEN);
  if (!refreshToken) return null;
  try {
    const { status, body } = await xhrRaw('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (status !== 200 || !body?.data?.access_token) return null;
    await Promise.all([
      SecureStore.setItemAsync(SECURE_KEYS.ACCESS_TOKEN, body.data.access_token),
      SecureStore.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, body.data.refresh_token),
    ]);
    return body.data.access_token as string;
  } catch {
    return null;
  }
}

// Error thrown by latchFetch for any 4xx/5xx. Carries the HTTP status and the
// server-provided error code so callers can branch on specific failures (e.g.
// 409 ADDRESS_MISMATCH for the "email linked to another wallet" case) without
// resorting to message string matching.
export class LatchAPIError extends Error {
  status: number;
  code?: string;
  /** Present only on GET /recovery/blob's 400 when the account has more than
   * one wallet — the addresses to offer the user, e.g. via a wallet picker. */
  wallets?: string[];
  constructor(status: number, code: string | undefined, message: string, wallets?: string[]) {
    super(message);
    this.name = 'LatchAPIError';
    this.status = status;
    this.code = code;
    this.wallets = wallets;
  }
}

// latchFetch wraps xhrRaw with a single 401 → refresh → retry cycle.
// On a 401, it calls silentRefresh and retries once with the new token.
// All other 4xx/5xx statuses throw LatchAPIError carrying the status + code.
async function latchFetch(path: string, options: RequestInit = {}, token?: string): Promise<any> {
  let { status, body } = await xhrRaw(path, options, token);

  if (status === 401 && token) {
    const newToken = await silentRefresh();
    if (newToken) {
      ({ status, body } = await xhrRaw(path, options, newToken));
    }
  }

  if (status >= 400) {
    throw new LatchAPIError(
      status,
      body?.error?.code,
      body?.error?.message ?? `Request failed (${status})`,
      body?.wallets,
    );
  }
  return body?.data;
}

/**
 * Clear the email-scope session from SecureStore. Used when we discover the
 * email the user authenticated against is anchored to a different wallet:
 * leaving the tokens behind would mean the device is "logged in" to an
 * identity it can't actually back up against.
 */
export async function clearEmailSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SECURE_KEYS.ACCESS_TOKEN),
    SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN),
    SecureStore.deleteItemAsync(SECURE_KEYS.USER_EMAIL),
  ]);
}

/**
 * Revoke the current session's refresh token server-side. Best-effort: never
 * throws — a network failure here shouldn't block whatever the caller is
 * doing (logging out, or clearing a stale session before a fresh wallet
 * takes over). Does not touch SecureStore; callers clear tokens separately.
 */
export async function logout(): Promise<void> {
  try {
    const [accessToken, refreshToken] = await Promise.all([
      SecureStore.getItemAsync(SECURE_KEYS.ACCESS_TOKEN),
      SecureStore.getItemAsync(SECURE_KEYS.REFRESH_TOKEN),
    ]);
    if (!accessToken || !refreshToken) return;
    await latchFetch(
      '/auth/logout',
      { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) },
      accessToken,
    );
  } catch {
    // Best-effort — the local token clear that follows is what actually matters.
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * Register an email address and trigger an OTP. Always resolves (backend
 * returns 200 regardless of whether the email already exists).
 */
export async function registerEmail(email: string): Promise<void> {
  await latchFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/**
 * Pre-OTP check: does this email already anchor a stored wallet backup? Used
 * at registration time so the user can be prompted with "this email is tied
 * to another wallet" before an OTP is sent. Returns false on network errors
 * to fail open — the post-OTP check in collect-email and the 409 from upload
 * still catch any collision we miss here.
 */
export async function checkEmailHasBackup(email: string): Promise<boolean> {
  try {
    const data = await latchFetch(
      `/auth/email-status?email=${encodeURIComponent(email)}`,
      { method: 'GET' },
    );
    return data?.has_backup === true;
  } catch {
    return false;
  }
}

/**
 * Verify a registration OTP. Returns access + refresh tokens on success.
 */
export async function verifyOTP(
  email: string,
  otp: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const data = await latchFetch('/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}

/**
 * Persist auth tokens and email to SecureStore after a successful OTP verify.
 */
export async function saveAuthTokens(
  accessToken: string,
  refreshToken: string,
  email: string,
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(SECURE_KEYS.ACCESS_TOKEN, accessToken),
    SecureStore.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, refreshToken),
    SecureStore.setItemAsync(SECURE_KEYS.USER_EMAIL, email),
  ]);
}

// ─── Backup ───────────────────────────────────────────────────────────────────

/**
 * Upload an encrypted credential backup to the Latch backend.
 *
 * Credentials are encrypted on-device with Argon2id + AES-256-GCM before
 * leaving the phone. The backend stores the opaque ciphertext and cannot
 * read or decrypt it.
 *
 * Requires SECURE_KEYS.RECOVERY_PASSWORD_SESSION to be set (written by the
 * set-recovery-password onboarding screen). Deletes the session key after a
 * successful upload so it does not linger in SecureStore.
 */
export async function uploadBackup(): Promise<void> {
  const accessToken = await SecureStore.getItemAsync(SECURE_KEYS.ACCESS_TOKEN);
  if (!accessToken) throw new Error('Not authenticated — cannot upload backup');

  const password = await SecureStore.getItemAsync(SECURE_KEYS.RECOVERY_PASSWORD_SESSION);
  if (!password) throw new Error('No recovery password set');

  const [passkeyPrivateKey, credentialId, keyDataHex, smartAccount, mnemonic, accountsJson] =
    await Promise.all([
      SecureStore.getItemAsync(SECURE_KEYS.PASSKEY_PRIVATE_KEY),
      SecureStore.getItemAsync(SECURE_KEYS.CREDENTIAL_ID),
      SecureStore.getItemAsync(SECURE_KEYS.KEY_DATA_HEX),
      SecureStore.getItemAsync(SECURE_KEYS.SMART_ACCOUNT),
      SecureStore.getItemAsync(SECURE_KEYS.MNEMONIC),
      SecureStore.getItemAsync(SECURE_KEYS.ACCOUNTS),
    ]);

  // The backend tracks recovery against a single wallet per user. With multi-
  // account support, SECURE_KEYS.SMART_ACCOUNT follows the *active* account, so
  // we resolve the index-0 (primary) account explicitly and register that one.
  let primarySmartAccount: string | null = null;
  if (accountsJson) {
    try {
      const parsed = JSON.parse(accountsJson) as WalletAccount[];
      primarySmartAccount = parsed[0]?.smartAccountAddress ?? null;
    } catch {
      // fall through — primarySmartAccount stays null
    }
  }
  const registeredSmartAccount = primarySmartAccount ?? smartAccount ?? '';

  const blob: Record<string, string> = { version: '2' };
  if (passkeyPrivateKey) blob.passkey_private_key = passkeyPrivateKey;
  if (credentialId) blob.credential_id = credentialId;
  if (keyDataHex) blob.key_data_hex = keyDataHex;
  if (registeredSmartAccount) blob.smart_account = registeredSmartAccount;
  if (mnemonic) blob.mnemonic = mnemonic;
  if (accountsJson) blob.accounts = accountsJson;

  // Back up indexed passkey keys for any additional passkey accounts (list index 1+).
  if (accountsJson) {
    const accounts = JSON.parse(accountsJson) as WalletAccount[];
    const indexedReads = accounts
      .map((account, listIndex) => ({ account, listIndex }))
      .filter(({ account, listIndex }) => account.index < 0 && listIndex > 0)
      .map(async ({ listIndex }) => {
        const keys = getPasskeyStorageKeys(listIndex);
        const [pk, cid, kdh] = await Promise.all([
          SecureStore.getItemAsync(keys.privateKey),
          SecureStore.getItemAsync(keys.credentialId),
          SecureStore.getItemAsync(keys.keyDataHex),
        ]);
        return { listIndex, pk, cid, kdh };
      });

    for (const { listIndex, pk, cid, kdh } of await Promise.all(indexedReads)) {
      if (pk) blob[`passkey_private_key_${listIndex}`] = pk;
      if (cid) blob[`credential_id_${listIndex}`] = cid;
      if (kdh) blob[`key_data_hex_${listIndex}`] = kdh;
    }
  }

  const encryptedBlob = encryptBackup(JSON.stringify(blob), password);

  await latchFetch(
    '/backup',
    {
      method: 'POST',
      body: JSON.stringify({
        encrypted_blob: encryptedBlob,
        smart_account_address: registeredSmartAccount,
      }),
    },
    accessToken,
  );

  // Session key is no longer needed — delete immediately after successful upload.
  await SecureStore.deleteItemAsync(SECURE_KEYS.RECOVERY_PASSWORD_SESSION);
}

// ─── Recovery ─────────────────────────────────────────────────────────────────

/**
 * Send a recovery OTP to the given email.
 * Always resolves — backend returns 200 regardless of whether account exists.
 */
export async function initiateRecovery(email: string): Promise<void> {
  await latchFetch('/recovery/initiate', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

/**
 * Verify a recovery OTP. Returns a short-lived recovery token (15 min TTL).
 */
export async function verifyRecoveryOTP(email: string, otp: string): Promise<string> {
  const data = await latchFetch('/recovery/verify', {
    method: 'POST',
    body: JSON.stringify({ email, otp }),
  });
  return data.recovery_token;
}

/**
 * Guard against declaring recovery "complete" on a truncated or corrupted
 * blob — validates the restored accounts array is non-empty and every entry
 * has a well-formed C-address before any SecureStore writes happen.
 */
function validateRestoredAccounts(accountsJson: string | undefined): void {
  if (!accountsJson) throw new Error('Recovered backup is incomplete or corrupted');

  let accounts: WalletAccount[];
  try {
    accounts = JSON.parse(accountsJson);
  } catch {
    throw new Error('Recovered backup is incomplete or corrupted');
  }

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('Recovered backup is incomplete or corrupted');
  }
  for (const account of accounts) {
    if (!account.smartAccountAddress || !StrKey.isValidContract(account.smartAccountAddress)) {
      throw new Error('Recovered backup is incomplete or corrupted');
    }
  }
}

/**
 * Fetch the encrypted backup blob, decrypt it client-side, and restore all
 * keys to SecureStore. Called after a successful recovery OTP verify.
 *
 * The recovery token is unscoped unless the account has exactly one wallet.
 * If the account has more than one, the backend responds 400 with a
 * `wallets` list on the thrown LatchAPIError — call again with the address
 * the user picked, reusing the same still-valid token (no new OTP needed).
 *
 * Throws 'Incorrect recovery password' if the password is wrong (GCM auth tag
 * mismatch), so the caller can surface a user-facing error.
 */
export async function fetchAndRestoreBackup(
  recoveryToken: string,
  password: string,
  smartAccountAddress?: string,
): Promise<void> {
  const path = smartAccountAddress
    ? `/recovery/blob?address=${encodeURIComponent(smartAccountAddress)}`
    : '/recovery/blob';
  const data = await latchFetch(path, { method: 'GET' }, recoveryToken);

  const encryptedBlob = data.encrypted_blob as EncryptedBackup;

  let plaintext: string;
  try {
    plaintext = decryptBackup(encryptedBlob, password);
  } catch {
    throw new Error('Incorrect recovery password');
  }

  const blob = JSON.parse(plaintext) as Record<string, string>;

  validateRestoredAccounts(blob.accounts);

  const writes: Promise<void>[] = [];

  if (blob.passkey_private_key) {
    writes.push(
      SecureStore.setItemAsync(SECURE_KEYS.PASSKEY_PRIVATE_KEY, blob.passkey_private_key),
    );
  }
  if (blob.credential_id) {
    writes.push(SecureStore.setItemAsync(SECURE_KEYS.CREDENTIAL_ID, blob.credential_id));
  }
  if (blob.key_data_hex) {
    writes.push(SecureStore.setItemAsync(SECURE_KEYS.KEY_DATA_HEX, blob.key_data_hex));
  }
  if (blob.smart_account) {
    writes.push(SecureStore.setItemAsync(SECURE_KEYS.SMART_ACCOUNT, blob.smart_account));
  }
  if (blob.mnemonic) {
    writes.push(SecureStore.setItemAsync(SECURE_KEYS.MNEMONIC, blob.mnemonic));
  }
  if (blob.accounts) {
    writes.push(SecureStore.setItemAsync(SECURE_KEYS.ACCOUNTS, blob.accounts));

    // Restore indexed passkey keys for additional passkey accounts (list index 1+).
    const accounts = JSON.parse(blob.accounts) as WalletAccount[];
    accounts.forEach((account, listIndex) => {
      if (account.index < 0 && listIndex > 0) {
        const keys = getPasskeyStorageKeys(listIndex);
        if (blob[`passkey_private_key_${listIndex}`]) {
          writes.push(
            SecureStore.setItemAsync(keys.privateKey, blob[`passkey_private_key_${listIndex}`]),
          );
        }
        if (blob[`credential_id_${listIndex}`]) {
          writes.push(
            SecureStore.setItemAsync(keys.credentialId, blob[`credential_id_${listIndex}`]),
          );
        }
        if (blob[`key_data_hex_${listIndex}`]) {
          writes.push(SecureStore.setItemAsync(keys.keyDataHex, blob[`key_data_hex_${listIndex}`]));
        }
      }
    });
  }

  await Promise.all(writes);
}

// ─── Backup (continued) ───────────────────────────────────────────────────────

export interface BackupStatus {
  exists: boolean;
  /** Wallet address the existing backup is bound to. Empty when !exists. */
  smartAccountAddress: string;
}

/**
 * Returns the authenticated user's backup status: whether one exists, and
 * which wallet address it's bound to. The address lets callers detect that
 * the email is already anchored to a different wallet and prompt for a
 * different email before attempting to upload.
 */
export async function getBackupStatus(): Promise<BackupStatus> {
  const accessToken = await SecureStore.getItemAsync(SECURE_KEYS.ACCESS_TOKEN);
  if (!accessToken) return { exists: false, smartAccountAddress: '' };
  const data = await latchFetch('/backup', {}, accessToken);
  return {
    exists: data?.exists === true,
    smartAccountAddress: data?.smart_account_address ?? '',
  };
}

/**
 * Returns true if the authenticated user has a stored credential backup.
 */
export async function checkBackupExists(): Promise<boolean> {
  const status = await getBackupStatus();
  return status.exists;
}

// ─── Market ───────────────────────────────────────────────────────────────────

export interface PriceData {
  price: string;
  change_24h: number;
}

/**
 * Fetch live USD prices for the given Stellar asset symbols.
 * Results are Redis-cached on the backend for 60 seconds.
 */
export async function getPrices(tokens: string[]): Promise<Record<string, PriceData | null>> {
  return latchFetch(`/prices?tokens=${encodeURIComponent(tokens.join(','))}`);
}

// ─── Deposit ─────────────────────────────────────────────────────────────────

export interface DepositIntent {
  intent_id: string;
  memo_id: string;
  pool_address: string;
  expires_at: string;
}

export interface DepositForward {
  tx_hash: string;
  amount: string;
  asset: string;
  status: string;
  forward_tx?: string;
  created_at: string;
}

export interface DepositStatus {
  intent_id: string;
  memo_id: string;
  c_address: string;
  pool_address: string;
  status: 'pending' | 'completed' | 'expired' | 'failed';
  expires_at: string;
  forwards: DepositForward[];
}

export interface DepositIntentOptions {
  /**
   * Expected deposit size, in the deposited asset's own units (e.g. XLM) — not
   * fiat. The relayer compares it against what actually arrives and logs a
   * mismatch; a fiat figure here would differ from every real deposit. Advisory
   * only: a mismatch never blocks crediting.
   */
  expectedAmt?: string;
  /** On-ramp provider's order/transaction ID, so a deposit can be traced end to end. */
  externalId?: string;
  /** Seconds until the intent expires. The backend clamps; omit for its default (1h). */
  expiresIn?: number;
}

/**
 * TTL for an intent the user is about to fund through an on-ramp.
 *
 * The relayer's 1h default is sized for someone pasting an address into a wallet
 * they already hold funds in. A card purchase usually settles inside that, but an
 * ACH/SEPA bank transfer can take days — and an expired memo_id is swept to the
 * recovery address exactly like an unknown one, so a slow settlement would lose
 * the deposit outright.
 */
export const ONRAMP_INTENT_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Bearer token for the deposit endpoints.
 *
 * Funding is the one latch-api feature reachable by a user who never entered an
 * email — onboarding's collect-email step is skippable — so the email-scope
 * ACCESS_TOKEN cannot be the only credential we look for, or those users hit
 * "Not authenticated" and the request never leaves the device. Prefer the email
 * token when it exists (unchanged for users who did back up), then fall back to
 * the wallet-scope session every user has by definition.
 *
 * `allowSignIn` is false on timer-driven callers: minting a wallet session reads
 * a biometric-gated passkey key, and a Face ID prompt raised by a 15s poll the
 * user didn't trigger is worse than a skipped refresh.
 */
async function depositAccessToken(allowSignIn: boolean): Promise<string> {
  const emailToken = await SecureStore.getItemAsync(SECURE_KEYS.ACCESS_TOKEN);
  if (emailToken) return emailToken;

  const account = activeWalletAccount();
  const walletToken =
    account && allowSignIn
      ? await ensureWalletSession(account)
      : await getWalletSessionWithoutSignIn();
  if (!walletToken) throw new Error('Not authenticated');
  return walletToken;
}

function activeWalletAccount(): WalletAccount | undefined {
  const { accounts, activeAccountIndex } = useWalletStore.getState();
  return accounts[activeAccountIndex];
}

/**
 * Mints a fresh, TTL-bound funding intent for smartAccountAddress. Call this
 * when the user opens the Fund flow — not cached across sessions, since
 * latch-relayer intents are one-per-funding-session (default 1hr expiry),
 * not permanent per-account registrations.
 *
 * `expectedAmt`/`externalId`/`expiresIn` are optional pass-throughs to the
 * relayer's POST /intents. The relayer stores them on the intent row; a backend
 * that doesn't forward them yet simply ignores them — so always read the TTL you
 * actually got back off `expires_at`, never assume the one you asked for.
 */
export async function createDepositIntent(
  smartAccountAddress: string,
  options: DepositIntentOptions = {},
): Promise<DepositIntent> {
  const accessToken = await depositAccessToken(true);
  const body: Record<string, string | number> = { smart_account_address: smartAccountAddress };
  if (options.expectedAmt) body.expected_amt = options.expectedAmt;
  if (options.externalId) body.external_id = options.externalId;
  if (options.expiresIn) body.expires_in = options.expiresIn;
  const request = { method: 'POST', body: JSON.stringify(body) };

  try {
    return await latchFetch('/accounts/deposit-intent', request, accessToken);
  } catch (err) {
    // latchFetch's built-in 401 retry refreshes the EMAIL session, so a rejected
    // wallet-scope token still lands here. Re-sign-in once and retry — the same
    // recovery use-portfolio applies to its own wallet-scope 401s. Safe to
    // prompt: this call only ever runs off a user opening the Fund flow.
    const account = activeWalletAccount();
    if (err instanceof LatchAPIError && err.status === 401 && account) {
      return latchFetch('/accounts/deposit-intent', request, await reSignInWallet(account));
    }
    throw err;
  }
}

/**
 * The relayer parses inbound deposits with `memo.ParseID` — it only recognises
 * MEMO_ID (numeric). A deposit sent with a TEXT memo, no memo, or an expired
 * memo_id is swept to the relayer's recovery address and is NOT credited to the
 * user. Surface this wherever the memo is shown or handed to a provider.
 */
export const DEPOSIT_MEMO_TYPE = 'id' as const;

/** True once a minted intent's TTL has elapsed and it can no longer be deposited against. */
export function isDepositIntentExpired(expiresAt: string | undefined): boolean {
  if (!expiresAt) return true;
  const ts = Date.parse(expiresAt);
  return Number.isNaN(ts) || ts <= Date.now();
}

/**
 * Polls the status of a previously-created funding intent by memo_id.
 */
export async function fetchDepositIntentStatus(memoId: string): Promise<DepositStatus> {
  const accessToken = await depositAccessToken(false);
  return latchFetch(`/accounts/deposit/status/${encodeURIComponent(memoId)}`, {}, accessToken);
}
