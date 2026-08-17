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

import { rpc, SorobanDataBuilder, xdr } from '@stellar/stellar-sdk';

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
