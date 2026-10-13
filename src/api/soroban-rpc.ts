/**
 * soroban-rpc.ts — Soroban JSON-RPC transport and the XDR/base64 helpers that
 * go with it.
 *
 * Split out of smart-account.ts so that modules needing only the transport do
 * not inherit its dependencies. smart-account.ts imports
 * react-native-quick-crypto for one salt hash, which drags the whole native
 * module graph in behind it; account-admin.ts imports three pure functions
 * from it and got the native graph too, which made its XDR builders
 * untestable outside a device.
 *
 * Nothing here touches native modules or app config. It is pure enough to run
 * under plain Node, which is what lets the encoding tests exist.
 */

import { Account, Keypair, rpc, SorobanDataBuilder, xdr } from '@stellar/stellar-sdk';

// ─── XHR-based JSON-RPC ───────────────────────────────────────────────────────
// The stellar SDK uses Axios internally, which fails with "Network Error" on
// Android because the bundled Axios doesn't go through the platform TLS stack.
// Using XMLHttpRequest directly routes through OkHttp and respects the
// network_security_config.xml trust anchors.

/**
 * Base64 without Buffer.
 *
 * React Native's Buffer polyfill mis-encodes `toString('base64')` on some
 * inputs, emitting a decimal byte list ("0,0,0,2,…") instead of base64, which
 * the RPC then rejects. The explicit loop is not a style choice — see the note
 * at the top of src/lib/passkey-webauthn.ts.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function txToBase64(tx: { toEnvelope(): { toXDR(): Uint8Array } }): string {
  return toBase64(new Uint8Array(tx.toEnvelope().toXDR()));
}

export function ledgerKeyToBase64(key: xdr.LedgerKey): string {
  return toBase64(new Uint8Array(key.toXDR()));
}

export function sorobanCall(rpcUrl: string, method: string, params: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', rpcUrl, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 60000;
    xhr.onload = function () {
      try {
        const json = JSON.parse(xhr.responseText);
        if (json.error) {
          reject(new Error(`${method}: ${json.error.message ?? JSON.stringify(json.error)}`));
        } else {
          resolve(json.result);
        }
      } catch {
        reject(new Error(`${method}: parse error (status=${xhr.status})`));
      }
    };
    xhr.onerror = function () {
      reject(new Error(`${method}: network error (status=${xhr.status})`));
    };
    xhr.ontimeout = function () {
      reject(new Error(`${method}: timed out`));
    };
    xhr.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}

export interface RpcAccount {
  sequence: string;
  balanceStroops: bigint;
  subentryCount: number;
}

export function accountLedgerKey(gAddress: string): xdr.LedgerKey {
  return xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(gAddress).xdrAccountId() }),
  );
}

export function parseAccountEntry(entryXdr: string): RpcAccount {
  const account = xdr.LedgerEntryData.fromXDR(entryXdr, 'base64').account();
  return {
    sequence: account.seqNum().toString(),
    balanceStroops: BigInt(account.balance().toString()),
    subentryCount: account.numSubEntries(),
  };
}

/**
 * Reads a classic account straight from ledger state. Resolves null when the
 * entry does not exist (unfunded account) and rejects on any transport or RPC
 * failure, so "unfunded" and "RPC unreachable" stay distinguishable.
 */
export async function fetchRpcAccount(
  rpcUrl: string,
  gAddress: string,
): Promise<RpcAccount | null> {
  const result = await sorobanCall(rpcUrl, 'getLedgerEntries', {
    keys: [ledgerKeyToBase64(accountLedgerKey(gAddress))],
  });
  const entry = result?.entries?.[0];
  return entry ? parseAccountEntry(entry.xdr) : null;
}

export async function loadRpcAccount(rpcUrl: string, gAddress: string): Promise<Account> {
  const account = await fetchRpcAccount(rpcUrl, gAddress);
  if (!account) throw new Error(`Account not found on ledger (${gAddress})`);
  return new Account(gAddress, account.sequence);
}

export interface RpcTransactionSummary {
  ledger: number;
  createdAt: string;
  feeCharged: string;
}

export function summarizeRpcTransaction(raw: any): RpcTransactionSummary | null {
  if (!raw || raw.status === 'NOT_FOUND') return null;
  const result = xdr.TransactionResult.fromXDR(raw.resultXdr, 'base64');
  return {
    ledger: Number(raw.ledger),
    createdAt: new Date(Number(raw.createdAt) * 1000).toISOString(),
    feeCharged: result.feeCharged().toString(),
  };
}

export async function fetchRpcTransaction(
  rpcUrl: string,
  hash: string,
): Promise<RpcTransactionSummary | null> {
  return summarizeRpcTransaction(await sorobanCall(rpcUrl, 'getTransaction', { hash }));
}

export function txResultCode(resultXdr: string): string {
  const name = xdr.TransactionResult.fromXDR(resultXdr, 'base64').result().switch().name;
  return name.replace(/([A-Z])/g, '_$1').toLowerCase();
}

export interface SubmitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Submits a signed envelope and waits for it to land. sendTransaction only
 * acknowledges receipt; unlike Horizon's POST /transactions it does not block
 * until inclusion, so success is only reported once getTransaction says so.
 * Rejects with the Horizon-style result code (e.g. tx_bad_seq) on failure.
 */
export async function submitAndConfirm(
  rpcUrl: string,
  signedXdr: string,
  { timeoutMs = 30_000, intervalMs = 1_000 }: SubmitOptions = {},
): Promise<string> {
  const sent = await sorobanCall(rpcUrl, 'sendTransaction', { transaction: signedXdr });

  if (sent.status === 'ERROR') {
    throw new Error(sent.errorResultXdr ? txResultCode(sent.errorResultXdr) : 'tx_rejected');
  }
  if (sent.status === 'TRY_AGAIN_LATER') throw new Error('try_again_later');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tx = await sorobanCall(rpcUrl, 'getTransaction', { hash: sent.hash });
    if (tx.status === 'SUCCESS') return sent.hash;
    if (tx.status === 'FAILED') {
      throw new Error(tx.resultXdr ? txResultCode(tx.resultXdr) : 'tx_failed');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for confirmation');
}

export function parseSimResult(raw: any): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    // _parsed: true tells rpc.assembleTransaction's internal parseRawSimulation to skip
    // re-parsing. Without it, the SDK calls fromXDR(xdrObject, 'base64') on already-decoded
    // auth entries, which passes a plain object to Buffer.from and throws "Received type object".
    _parsed: true,
    id: String(raw.id ?? '1'),
    latestLedger: raw.latestLedger,
    minResourceFee: raw.minResourceFee,
    // assembleTransaction calls success.transactionData.build(), so this must be a
    // SorobanDataBuilder, not a raw xdr.SorobanTransactionData.
    transactionData: new SorobanDataBuilder(raw.transactionData),
    cost: raw.cost ?? { cpuInsns: '0', memBytes: '0' },
    events: [],
    result: {
      auth: (raw.results?.[0]?.auth ?? []).map((a: string) =>
        xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64'),
      ),
      // Soroban RPC returns the call's return value under `results[0].xdr`;
      // `retval` is a fallback for older RPC shapes. Reading only `retval`
      // yields undefined on current RPC, and the scvVoid default below then
      // makes a real return value indistinguishable from "returned nothing" —
      // which is how a read helper built on this silently reported an account
      // as having no context rules. Callers assembling a transaction only need
      // `auth`, but anyone reading a return value needs this to be right.
      retval: (() => {
        try {
          const encoded = raw.results?.[0]?.xdr ?? raw.results?.[0]?.retval;
          return xdr.ScVal.fromXDR(encoded || 'AAAAAA==', 'base64');
        } catch {
          return xdr.ScVal.scvVoid();
        }
      })(),
    },
  } as unknown as rpc.Api.SimulateTransactionSuccessResponse;
}
