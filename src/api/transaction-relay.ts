/**
 * transaction-relay.ts — submits bundler-paid Soroban transactions through
 * latch-api instead of signing them with a bundler key held in the app.
 *
 * The bundler is the fee sponsor for every smart-account operation: sends,
 * swaps, multisig sends and admin ops all use it as the outer transaction
 * source. Its secret used to be EXPO_PUBLIC_BUNDLER_SECRET, which Expo inlines
 * into the shipped bundle — extractable from any APK/IPA.
 *
 * What stays on the client is unchanged: build the invocation, simulate, and
 * sign the Soroban auth entries with the user's own key. Only the outer
 * envelope — the part that spends bundler XLM — is handed to the server, which
 * rebuilds it with the bundler as source rather than signing what we send.
 *
 * Transport is raw XHR, not Axios — see the Android TLS note in CLAUDE.md.
 */

import type { Transaction } from '@stellar/stellar-sdk';
import * as SecureStore from 'expo-secure-store';

import { getNetworkId } from '@/src/constants/config';
import { ensureWalletSession, getWalletSessionWithoutSignIn } from '@/src/lib/wallet-auth';
import { SECURE_KEYS, useWalletStore, type WalletAccount } from '@/src/store/wallet';

const API_ROOT = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
const API_BASE = `${API_ROOT}/v1/transaction`;

export interface RelayResult {
  hash: string;
  /** "SUCCESS" once the ledger has it, "PENDING" if still settling. */
  status: string;
  /**
   * Settled transaction meta, empty while still PENDING. Callers that need a
   * contract's return value — device pairing reads back the new signer and
   * context-rule ids — parse it from here.
   */
  resultMetaXdr: string;
}

export class TransactionRelayError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function activeWalletAccount(): WalletAccount | undefined {
  const { accounts, activeAccountIndex } = useWalletStore.getState();
  return accounts[activeAccountIndex];
}

/**
 * Bearer token for the relay. Prefers the email-scope token when present,
 * matching the deposit-intent flow; otherwise uses the wallet-scope session.
 * Signing in reads a biometric-gated passkey, so it only happens here because
 * the caller is already in a user-initiated send.
 */
async function accessToken(): Promise<string> {
  const emailToken = await SecureStore.getItemAsync(SECURE_KEYS.ACCESS_TOKEN);
  if (emailToken) return emailToken;

  const account = activeWalletAccount();
  const walletToken = account
    ? await ensureWalletSession(account)
    : await getWalletSessionWithoutSignIn();
  if (!walletToken) throw new Error('Not authenticated');
  return walletToken;
}

function xhrGet(path: string, token: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('GET', `${API_BASE}${path}`, true);
    req.setRequestHeader('Accept', 'application/json');
    req.setRequestHeader('Authorization', `Bearer ${token}`);
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
    req.send();
  });
}

function xhrPost(path: string, body: object, token: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('POST', `${API_BASE}${path}`, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.setRequestHeader('Authorization', `Bearer ${token}`);
    // The server simulates, submits, and polls the ledger before replying.
    req.timeout = 90000;
    req.onload = () => {
      try {
        resolve({ status: req.status, body: JSON.parse(req.responseText) });
      } catch {
        resolve({ status: req.status, body: null });
      }
    };
    req.onerror = () => reject(new Error('Network error'));
    req.ontimeout = () => reject(new Error('Transaction submission timed out'));
    req.send(JSON.stringify(body));
  });
}

/**
 * Extract the signed Soroban auth entries from an assembled transaction.
 *
 * The server rebuilds the operation around these, so they must be the entries
 * the user's key actually signed — not re-derived server-side.
 */
function authEntriesFrom(tx: Transaction): string[] {
  const op = tx.operations[0] as { auth?: { toXDR(format: 'base64'): string }[] } | undefined;
  return (op?.auth ?? []).map((entry) => entry.toXDR('base64'));
}

/**
 * Submit an assembled, auth-signed transaction for the bundler to pay for.
 *
 * Pass the transaction exactly as it would have been submitted directly: the
 * server keeps only its host function and auth entries and rebuilds the rest.
 */
export async function submitViaBundler(tx: Transaction): Promise<RelayResult> {
  const authEntries = authEntriesFrom(tx);
  if (authEntries.length === 0) {
    throw new Error('transaction has no Soroban auth entries to submit');
  }

  const token = await accessToken();
  const res = await xhrPost(
    '/submit',
    {
      tx_xdr: tx.toEnvelope().toXDR('base64'),
      auth_entries: authEntries,
      network: getNetworkId(),
    },
    token,
  );

  if (res.status !== 200 || !res.body?.data?.hash) {
    throw new TransactionRelayError(
      res.body?.error?.message ?? `transaction submission failed (${res.status})`,
      res.status,
    );
  }
  return {
    hash: res.body.data.hash,
    status: res.body.data.status ?? 'PENDING',
    resultMetaXdr: res.body.data.result_meta_xdr ?? '',
  };
}

// The bundler G-address, cached per network for the process lifetime. It only
// changes if the key is rotated, which requires a redeploy anyway.
const bundlerAddressCache = new Map<string, string>();

/**
 * The account that sources and pays for bundler-signed transactions.
 *
 * Callers need it to build and simulate an invocation. It used to be derived
 * from EXPO_PUBLIC_BUNDLER_SECRET; fetching the public half from latch-api
 * instead is what lets the secret leave the bundle entirely.
 */
export async function bundlerAddress(): Promise<string> {
  const network = getNetworkId();
  const cached = bundlerAddressCache.get(network);
  if (cached) return cached;

  const token = await accessToken();
  const res = await xhrGet(`/bundler?network=${network}`, token);
  const address = res.body?.data?.bundler_address;
  if (res.status !== 200 || !address) {
    throw new TransactionRelayError(
      res.body?.error?.message ?? `could not resolve bundler address (${res.status})`,
      res.status,
    );
  }
  bundlerAddressCache.set(network, address);
  return address;
}
