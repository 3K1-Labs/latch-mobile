// /**
//  * use-stellar-transactions.ts — Activity feed for the active Latch account.
//  *
//  * Phase 3 (Step 3.11): fetches paginated history from wallet-backend GraphQL
//  * instead of stitching Horizon + Soroban-RPC + bundler queries client-side.
//  * Balance lookups still go directly to Soroban RPC for latency (see
//  * use-portfolio.ts).
//  *
//  * Auth: wallet-scope JWT acquired via src/lib/wallet-auth.ts. The token is
//  * minted on first call (mnemonic users sign silently; passkey users see one
//  * Face ID prompt per session) and cached in SecureStore.
//  */

// import { Asset, Keypair } from '@stellar/stellar-sdk';
// import { useInfiniteQuery } from '@tanstack/react-query';
// import { STELLAR_NETWORK_PASSPHRASE } from '../constants/config';
// import { WELL_KNOWN_TOKENS } from '../constants/known-tokens';
// import {
//   fetchAccountHistory,
//   GraphQLError,
//   type HistoryStateChange,
// } from '../api/wallet-backend';
// import { ensureWalletSession, reSignInWallet } from '../lib/wallet-auth';
// import { useWalletStore, type WalletAccount } from '../store/wallet';

// const PAGE_SIZE = 50;

// // Kept per the Phase 3 plan: used by the classifier to recognise self-paid
// // Soroban fees when they surface on the activity feed in the future.
// let BUNDLER_G_ADDRESS: string | null = null;
// try {
//   const s = process.env.EXPO_PUBLIC_BUNDLER_SECRET;
//   if (s) BUNDLER_G_ADDRESS = Keypair.fromSecret(s).publicKey();
// } catch {}

// export interface StellarPayment {
//   id: string;
//   transactionHash: string;
//   /** Wallet-backend operation type (e.g. INVOKE_HOST_FUNCTION, PAYMENT) */
//   type: string;
//   /** Derived semantic type — used by the UI for display */
//   txType: 'send' | 'receive' | 'swap' | 'bridge' | 'unknown';
//   from: string;
//   to: string;
//   amount: string;
//   assetType: string;
//   assetCode?: string;
//   createdAt: string;
// }

// // ─── SAC contract ID → asset code lookup ─────────────────────────────────────

// const SAC_CONTRACT_INFO = new Map<string, { code: string; assetType: string }>();

// try {
//   SAC_CONTRACT_INFO.set(Asset.native().contractId(STELLAR_NETWORK_PASSPHRASE), {
//     code: 'XLM',
//     assetType: 'native',
//   });
// } catch {}

// for (const t of WELL_KNOWN_TOKENS) {
//   try {
//     const id =
//       t.sacContractId ?? new Asset(t.code, t.issuer!).contractId(STELLAR_NETWORK_PASSPHRASE);
//     SAC_CONTRACT_INFO.set(id, { code: t.code, assetType: 'credit_alphanum4' });
//   } catch {}
// }

// function assetInfoFor(tokenId: string | undefined): { code?: string; assetType: string } {
//   if (!tokenId) return { assetType: 'native' };
//   const info = SAC_CONTRACT_INFO.get(tokenId);
//   if (!info) return { assetType: 'credit_alphanum4' }; // unknown token; UI will show address
//   return info.code === 'XLM'
//     ? { assetType: 'native' }
//     : { code: info.code, assetType: info.assetType };
// }

// // ─── Map state-change edges → StellarPayment[] ───────────────────────────────

// function mapHistoryToPayments(
//   edges: { node: HistoryStateChange }[],
//   cAddress: string,
// ): StellarPayment[] {
//   const out: StellarPayment[] = [];

//   for (const { node: change } of edges) {
//     // We only render balance-affecting changes in the activity feed.
//     if (change.type !== 'BALANCE' && change.type !== 'balance') continue;

//     const reason = change.reason.toUpperCase();
//     const isCredit = reason === 'CREDIT' || reason === 'MINT';
//     const isDebit = reason === 'DEBIT' || reason === 'BURN';
//     if (!isCredit && !isDebit) continue;

//     // Counterparty = the other StandardBalanceChange on the same operation
//     // affecting a different account with the same token.
//     const counter = change.operation?.stateChanges.edges.find(({ node: c }) => {
//       const r = c.reason.toUpperCase();
//       const opposite = isCredit ? r === 'DEBIT' || r === 'BURN' : r === 'CREDIT' || r === 'MINT';
//       return (
//         opposite &&
//         c.account.address !== cAddress &&
//         c.tokenId === change.tokenId &&
//         c.type.toUpperCase() === 'BALANCE'
//       );
//     });
//     const counterAddress = counter?.node.account.address ?? '';

//     const info = assetInfoFor(change.tokenId);

//     out.push({
//       id: change.operation?.id?.toString() ?? change.transaction.hash,
//       transactionHash: change.transaction.hash,
//       type: change.operation?.operationType ?? 'unknown',
//       txType: 'unknown', // filled in by classifyTxTypes
//       from: isCredit ? counterAddress : cAddress,
//       to: isCredit ? cAddress : counterAddress,
//       amount: change.amount ?? '0',
//       assetType: info.assetType,
//       assetCode: info.code,
//       createdAt: change.ledgerCreatedAt,
//     });
//   }

//   return out;
// }

// // ─── Send/receive/swap classification ────────────────────────────────────────

// function classifyTxTypes(payments: StellarPayment[], cAddress: string): StellarPayment[] {
//   const byHash = new Map<string, StellarPayment[]>();
//   for (const p of payments) {
//     const key = p.transactionHash || p.id;
//     const group = byHash.get(key) ?? [];
//     group.push(p);
//     byHash.set(key, group);
//   }

//   return payments.map((p) => {
//     const key = p.transactionHash || p.id;
//     const group = byHash.get(key) ?? [p];

//     const hasOutgoing = group.some((g) => g.from === cAddress);
//     const hasIncoming = group.some((g) => g.to === cAddress);
//     const distinctAssets = new Set(group.map((g) => g.assetCode ?? 'XLM')).size;

//     let txType: StellarPayment['txType'];
//     if (hasOutgoing && hasIncoming && distinctAssets > 1) {
//       txType = 'swap';
//     } else if (p.from === cAddress) {
//       txType = 'send';
//     } else if (p.to === cAddress) {
//       txType = 'receive';
//     } else {
//       txType = 'unknown';
//     }

//     return { ...p, txType };
//   });
// }

// // ─── Public API ──────────────────────────────────────────────────────────────

// interface StellarPaymentPage {
//   payments: StellarPayment[];
//   endCursor: string | null;
//   hasNextPage: boolean;
// }

// /**
//  * Fetch one page of activity. Cursor is the GraphQL connection endCursor from
//  * the previous page; pass undefined for the first page.
//  */
// export async function fetchStellarPaymentsPage(
//   account: WalletAccount,
//   cAddress: string,
//   cursor: string | undefined,
// ): Promise<StellarPaymentPage> {
//   let accessToken = await ensureWalletSession(account);

//   let conn;
//   try {
//     conn = await fetchAccountHistory(cAddress, PAGE_SIZE, cursor, accessToken);
//   } catch (err) {
//     if (err instanceof GraphQLError && err.code === 'UNAUTHORIZED') {
//       // Cached token rejected (likely expired). Refresh-token rotation for
//       // wallet-scope JWTs is not yet implemented backend-side, so we sign in
//       // fresh instead.
//       accessToken = await reSignInWallet(account);
//       conn = await fetchAccountHistory(cAddress, PAGE_SIZE, cursor, accessToken);
//     } else {
//       throw err;
//     }
//   }

//   return {
//     payments: mapHistoryToPayments(conn.edges, cAddress),
//     endCursor: conn.pageInfo.endCursor,
//     hasNextPage: conn.pageInfo.hasNextPage,
//   };
// }

// export function useStellarTransactions(cAddress: string | null) {
//   const { accounts, activeAccountIndex } = useWalletStore();
//   const account = accounts[activeAccountIndex];

//   const q = useInfiniteQuery({
//     queryKey: ['stellar-transactions', cAddress, account?.gAddress, account?.smartAccountAddress],
//     queryFn: ({ pageParam }) =>
//       fetchStellarPaymentsPage(account!, cAddress!, pageParam as string | undefined),
//     enabled: !!cAddress && !!account,
//     staleTime: 30_000,
//     retry: 1,
//     initialPageParam: undefined as string | undefined,
//     getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.endCursor ?? undefined : undefined),
//     // Flatten pages → sort → classify across the whole loaded set so swap
//     // detection still works when txs span page boundaries.
//     select: (data) => {
//       const all = data.pages.flatMap((p) => p.payments);
//       const sorted = all.sort(
//         (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
//       );
//       return classifyTxTypes(sorted, cAddress ?? '');
//     },
//   });

//   return {
//     data: q.data as StellarPayment[] | undefined,
//     isLoading: q.isLoading,
//     isFetching: q.isFetching,
//     isError: q.isError,
//     isRefetching: q.isRefetching,
//     refetch: q.refetch,
//     fetchNextPage: q.fetchNextPage,
//     hasNextPage: q.hasNextPage,
//     isFetchingNextPage: q.isFetchingNextPage,
//   };
// }

// // Re-export the bundler address for any future caller — currently unused by
// // the new flow but kept per the Phase 3 plan in case classification needs it.
// export { BUNDLER_G_ADDRESS };
import { Address, Asset, Keypair, scValToNative, xdr } from '@stellar/stellar-sdk';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { HORIZON_URL, STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL } from '../constants/config';
import { WELL_KNOWN_TOKENS } from '../constants/known-tokens';
import { useWalletStore } from '../store/wallet';

// Derived once at module load — safe since the secret is EXPO_PUBLIC_* (client-visible)
let BUNDLER_G_ADDRESS: string | null = null;
try {
  const s = process.env.EXPO_PUBLIC_BUNDLER_SECRET;
  if (s) BUNDLER_G_ADDRESS = Keypair.fromSecret(s).publicKey();
} catch {}

export interface StellarPayment {
  id: string;
  transactionHash: string;
  /** Raw Horizon/Soroban operation type */
  type: string;
  /** Derived semantic type — used by the UI for display */
  txType: 'send' | 'receive' | 'swap' | 'bridge' | 'unknown';
  from: string;
  to: string;
  amount: string;
  assetType: string;
  assetCode?: string;
  createdAt: string;
}

// ─── Shared XHR helpers ──────────────────────────────────────────────────────

function horizonGet(url: string): Promise<any> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 12000;
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        resolve(null);
      }
    };
    xhr.onerror = () => resolve(null);
    xhr.ontimeout = () => resolve(null);
    xhr.send();
  });
}

function sorobanRpc(method: string, params: object): Promise<any> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', STELLAR_RPC_URL, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 15000;
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        resolve({});
      }
    };
    xhr.onerror = () => resolve({});
    xhr.ontimeout = () => resolve({});
    xhr.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}

function scValB64(val: xdr.ScVal): string {
  const bytes = new Uint8Array(val.toXDR());
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ─── G-address Horizon: ops → asset_balance_changes (+ effects fallback) ─────
//
// Confirmed via live Horizon testnet:
//   `/accounts/{gAddress}/operations` → each invoke_host_function op has
//   `asset_balance_changes` entries with `from`/`to` set to the C-address.
//
// Also processes classic `payment` ops (external senders may use classic
// Stellar payments to the user's G-address). G-address is mapped to C-address
// in the result so the existing send/receive classifier works correctly.
//
// NOTE: `/accounts/{C-addr}/operations` returns HTTP 400 — Horizon only accepts
// G-addresses on the /accounts path. Use SAC events for passkey users.

async function fetchGAddressOps(gAddress: string, cAddress: string): Promise<StellarPayment[]> {
  const resp = await horizonGet(
    `${HORIZON_URL}/accounts/${encodeURIComponent(gAddress)}/operations?limit=50&order=desc&include_failed=false`,
  );

  const allOps = (resp?._embedded?.records ?? []) as any[];

  if (__DEV__) {
    const invokeCount = allOps.filter((r: any) => r.type === 'invoke_host_function').length;
    const paymentCount = allOps.filter((r: any) => r.type === 'payment').length;
    console.log(
      '[G-addr] ops:',
      allOps.length,
      '| invoke:',
      invokeCount,
      '| payment:',
      paymentCount,
      '| error:',
      resp?.title ?? null,
    );
  }

  if (allOps.length === 0) return [];

  const results: StellarPayment[] = [];

  // Classic payment ops — external wallets may send XLM/tokens to the user's G-address
  // Map gAddress → cAddress so classifyTxTypes works correctly
  const paymentOps = allOps.filter((r: any) => r.type === 'payment');
  for (const op of paymentOps) {
    results.push({
      id: op.id,
      transactionHash: op.transaction_hash ?? '',
      type: 'payment',
      txType: 'unknown',
      from: op.from === gAddress ? cAddress : op.from,
      to: op.to === gAddress ? cAddress : op.to,
      amount: op.amount ?? '0',
      assetType: op.asset_type ?? 'native',
      assetCode: op.asset_code,
      createdAt: op.created_at ?? '',
    });
  }

  // create_account ops — friendbot (and account-creation flows) fund the G-address this way
  const createOps = allOps.filter((r: any) => r.type === 'create_account');
  for (const op of createOps) {
    results.push({
      id: op.id,
      transactionHash: op.transaction_hash ?? '',
      type: 'create_account',
      txType: 'unknown',
      from: op.funder ?? '',
      to: op.account === gAddress ? cAddress : op.account,
      amount: op.starting_balance ?? '0',
      assetType: 'native',
      assetCode: undefined,
      createdAt: op.created_at ?? '',
    });
  }

  const invokeOps = allOps.filter((r: any) => r.type === 'invoke_host_function');
  const needEffects: any[] = [];

  for (const op of invokeOps) {
    const changes: any[] = op.asset_balance_changes ?? [];
    const matched = changes.filter((c: any) => c.from === cAddress || c.to === cAddress);

    if (matched.length > 0) {
      matched.forEach((change, ci) => {
        results.push({
          id: matched.length > 1 ? `${op.id}_${ci}` : op.id,
          transactionHash: op.transaction_hash ?? '',
          type: 'invoke_host_function',
          txType: 'unknown',
          from: change.from ?? '',
          to: change.to ?? '',
          amount: change.amount ?? '0',
          assetType: change.asset_type === 'native' ? 'native' : 'credit_alphanum4',
          assetCode: change.asset_code,
          createdAt: op.created_at ?? '',
        });
      });
    } else {
      needEffects.push(op);
    }
  }

  // Effects fallback for the rare op where balance_changes is absent
  if (needEffects.length > 0) {
    const effectsBatch = await Promise.all(
      needEffects.map((op: any) =>
        horizonGet(`${HORIZON_URL}/operations/${op.id}/effects`).then(
          (r) => (r?._embedded?.records ?? []) as any[],
        ),
      ),
    );

    if (__DEV__) {
      console.log('[G-addr] effects fallback for', needEffects.length, 'ops');
    }

    for (let i = 0; i < needEffects.length; i++) {
      const op = needEffects[i];
      const effects: any[] = effectsBatch[i];

      // C-address is in effect.contract (effect.account holds the G-addr)
      const matchesCAddr = (e: any) => e.contract === cAddress || e.account === cAddress;
      const creditEffect = effects.find(
        (e: any) => e.type === 'contract_credited' && matchesCAddr(e),
      );
      const debitEffect = effects.find(
        (e: any) => e.type === 'contract_debited' && matchesCAddr(e),
      );

      if (!creditEffect && !debitEffect) continue;

      const isIncoming = !!creditEffect;
      const effect = (creditEffect ?? debitEffect) as any;

      results.push({
        id: op.id,
        transactionHash: op.transaction_hash ?? '',
        type: 'invoke_host_function',
        txType: 'unknown',
        from: isIncoming ? op.source_account : cAddress,
        to: isIncoming ? cAddress : op.source_account,
        amount: effect.amount ?? '0',
        assetType: effect.asset_type === 'native' ? 'native' : 'credit_alphanum4',
        assetCode: effect.asset_code,
        createdAt: op.created_at ?? '',
      });
    }
  }

  if (__DEV__) console.log('[G-addr] total results:', results.length);
  return results;
}

// ─── Bundler Horizon: ops for passkey users ──────────────────────────────────
//
// Passkey users have no G-address — the bundler is the outer transaction signer
// for ALL their operations. Querying the bundler's op history and filtering
// asset_balance_changes by the user's C-address finds both sends AND receives
// (Latch-to-Latch transfers go through the same bundler on both sides).

async function fetchBundlerOps(cAddress: string): Promise<StellarPayment[]> {
  if (!BUNDLER_G_ADDRESS) return [];

  const resp = await horizonGet(
    `${HORIZON_URL}/accounts/${BUNDLER_G_ADDRESS}/operations?limit=200&order=desc&include_failed=false`,
  );

  const allOps = (resp?._embedded?.records ?? []) as any[];
  const invokeOps = allOps.filter((r: any) => r.type === 'invoke_host_function');

  if (__DEV__) {
    console.log(
      '[bundler] ops:',
      allOps.length,
      '| invoke:',
      invokeOps.length,
      '| error:',
      resp?.title ?? null,
    );
  }

  const results: StellarPayment[] = [];

  for (const op of invokeOps) {
    const changes: any[] = op.asset_balance_changes ?? [];
    const matched = changes.filter((c: any) => c.from === cAddress || c.to === cAddress);

    matched.forEach((change, ci) => {
      results.push({
        id: matched.length > 1 ? `${op.id}_${ci}` : op.id,
        transactionHash: op.transaction_hash ?? '',
        type: 'invoke_host_function',
        txType: 'unknown',
        from: change.from ?? '',
        to: change.to ?? '',
        amount: change.amount ?? '0',
        assetType: change.asset_type === 'native' ? 'native' : 'credit_alphanum4',
        assetCode: change.asset_code,
        createdAt: op.created_at ?? '',
      });
    });
  }

  if (__DEV__) console.log('[bundler] matched for cAddress:', results.length);
  return results;
}

// ─── Soroban RPC: SAC transfer events (last ~7 days) ─────────────────────────
//
// Catches: incoming transfers from ANY sender (external wallets, other Latch
// users, passkey accounts). Queries ALL contracts — no contractIds filter —
// so any SAC (including custom tokens) is covered. Just 2 XHR requests vs the
// previous 14+ batched requests.
// Coverage limited to the RPC retention window (~7 days / ~17,000 ledgers).

const SAC_CONTRACT_INFO = new Map<string, { code: string; assetType: string }>();

try {
  SAC_CONTRACT_INFO.set(Asset.native().contractId(STELLAR_NETWORK_PASSPHRASE), {
    code: 'XLM',
    assetType: 'native',
  });
} catch {}

for (const t of WELL_KNOWN_TOKENS) {
  try {
    const id =
      t.sacContractId ?? new Asset(t.code, t.issuer!).contractId(STELLAR_NETWORK_PASSPHRASE);
    SAC_CONTRACT_INFO.set(id, { code: t.code, assetType: 'credit_alphanum4' });
  } catch {}
}

async function fetchSacTransferEvents(cAddress: string): Promise<StellarPayment[]> {
  const latestLedgerResp = await sorobanRpc('getLatestLedger', {});
  const latestLedger: number = latestLedgerResp?.result?.sequence ?? 0;
  if (latestLedger === 0) return [];

  const startLedger = Math.max(1, latestLedger - 17_000);
  const transferSym = scValB64(xdr.ScVal.scvSymbol('transfer'));
  const cAddressVal = scValB64(new Address(cAddress).toScVal());
  const wildcard = '*';

  if (__DEV__) {
    console.log('[SAC events] cAddress:', cAddress, '| startLedger:', startLedger);
  }

  // No contractIds filter — catches transfers from any SAC, including unknown tokens
  const buildParams = (sender: string, recipient: string, start: number) => ({
    startLedger: start,
    filters: [
      {
        type: 'contract',
        topics: [[transferSym, sender, recipient, wildcard]],
      },
    ],
    pagination: { limit: 200 },
  });

  const runQueries = (start: number) =>
    Promise.all([
      sorobanRpc('getEvents', buildParams(wildcard, cAddressVal, start)), // incoming
      sorobanRpc('getEvents', buildParams(cAddressVal, wildcard, start)), // outgoing
    ]);

  let responses = await runQueries(startLedger);

  if (responses.some((r) => r?.error)) {
    if (__DEV__) console.warn('[SAC events] error — retrying with 4,320-ledger window');
    responses = await runQueries(Math.max(1, latestLedger - 4_320));
  }

  if (__DEV__) {
    const total = responses.reduce((s, r) => s + (r?.result?.events?.length ?? 0), 0);
    console.log('[SAC events] total raw events:', total);
    responses.forEach((r, i) => {
      if (r?.error) console.warn('[SAC events] response', i, 'error:', JSON.stringify(r.error));
    });
  }

  const mapEvent = (event: any): StellarPayment | null => {
    try {
      // stellar-rpc names this `topic` (singular). `topicXdr`/`topics` are
      // accepted too so a provider using either spelling still decodes —
      // reading the wrong key silently drops every event (see the mapped-count
      // warning below, which exists to make that failure loud).
      const topics: string[] = event.topic ?? event.topicXdr ?? event.topics ?? [];
      if (topics.length < 3) return null;

      const fnNameScVal = xdr.ScVal.fromXDR(topics[0], 'base64');
      const fromScVal = xdr.ScVal.fromXDR(topics[1], 'base64');
      const toScVal = xdr.ScVal.fromXDR(topics[2], 'base64');

      if (scValToNative(fnNameScVal).toString() !== 'transfer') return null;

      const from = Address.fromScVal(fromScVal).toString();
      const to = Address.fromScVal(toScVal).toString();

      const rawAmountXdr: string | undefined = event.value ?? event.valueXdr;
      if (!rawAmountXdr) return null;
      const amountRaw = scValToNative(xdr.ScVal.fromXDR(rawAmountXdr, 'base64'));
      const rawValue = typeof amountRaw === 'bigint' ? amountRaw : BigInt(amountRaw ?? 0);

      const assetInfo = SAC_CONTRACT_INFO.get(event.contractId) ?? {
        code: 'XLM',
        assetType: 'native',
      };

      return {
        id: event.id ?? event.txHash,
        transactionHash: event.txHash ?? '',
        type: 'invoke_host_function',
        txType: 'unknown',
        from,
        to,
        amount: (Number(rawValue) / 10_000_000).toFixed(7),
        assetType: assetInfo.assetType,
        assetCode: assetInfo.code === 'XLM' ? undefined : assetInfo.code,
        createdAt: event.ledgerClosedAt ?? new Date().toISOString(),
      };
    } catch (err) {
      if (__DEV__) console.error('[SAC events] parse error:', err);
      return null;
    }
  };

  const raw = responses.flatMap((r) => r?.result?.events ?? []);
  const mapped = raw.map(mapEvent);

  if (__DEV__ && raw.length > 0 && mapped.every((tx) => tx === null)) {
    console.warn(
      '[SAC events] fetched',
      raw.length,
      'events but mapped 0 — event shape may have changed. Keys:',
      Object.keys(raw[0] ?? {}).join(','),
    );
  }

  const seen = new Set<string>();
  return mapped.filter((tx): tx is StellarPayment => {
    if (!tx) return false;
    const key = `${tx.transactionHash || tx.id}|${tx.from}|${tx.to}|${tx.assetCode ?? 'XLM'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Transaction type classification ─────────────────────────────────────────
//
// Group by transaction hash — a single tx that moves two different assets for
// the same C-address is a swap. Otherwise it's a plain send or receive.

function classifyTxTypes(payments: StellarPayment[], cAddress: string): StellarPayment[] {
  const byHash = new Map<string, StellarPayment[]>();
  for (const p of payments) {
    const key = p.transactionHash || p.id;
    const group = byHash.get(key) ?? [];
    group.push(p);
    byHash.set(key, group);
  }

  return payments.map((p) => {
    const key = p.transactionHash || p.id;
    const group = byHash.get(key) ?? [p];

    const hasOutgoing = group.some((g) => g.from === cAddress);
    const hasIncoming = group.some((g) => g.to === cAddress);
    const distinctAssets = new Set(group.map((g) => g.assetCode ?? 'XLM')).size;

    let txType: StellarPayment['txType'];
    if (hasOutgoing && hasIncoming && distinctAssets > 1) {
      txType = 'swap';
    } else if (p.from === cAddress) {
      txType = 'send';
    } else if (p.to === cAddress) {
      txType = 'receive';
    } else {
      txType = 'unknown';
    }

    return { ...p, txType };
  });
}

// ─── Merge + deduplicate ──────────────────────────────────────────────────────
//
// G-addr ops: outgoing + all G-addr-signed txs (full history via asset_balance_changes)
// SAC events: incoming from other users, passkey accounts, last ~7 days
//
// Dedup key: composite of hash+from+to+asset — preserves swap legs (different
// assets in the same tx) while dropping true duplicates across sources.

export async function fetchStellarPayments(
  cAddress: string,
  gAddress?: string | null,
): Promise<StellarPayment[]> {
  const [gAddrResult, bundlerResult, sacResult] = await Promise.allSettled([
    gAddress ? fetchGAddressOps(gAddress, cAddress) : Promise.resolve([]),
    fetchBundlerOps(cAddress),
    fetchSacTransferEvents(cAddress),
  ]);

  const gAddrTxs = gAddrResult.status === 'fulfilled' ? gAddrResult.value : [];
  const bundlerTxs = bundlerResult.status === 'fulfilled' ? bundlerResult.value : [];
  const sacTxs = sacResult.status === 'fulfilled' ? sacResult.value : [];

  if (__DEV__) {
    console.log(
      '[merge] G-addr:',
      gAddrTxs.length,
      '| bundler:',
      bundlerTxs.length,
      '| SAC events:',
      sacTxs.length,
    );
  }

  const seen = new Set<string>();

  // G-addr / bundler first (full Horizon history), SAC events fill incoming from non-Latch wallets
  const merged = [...gAddrTxs, ...bundlerTxs, ...sacTxs].filter((tx) => {
    const key = `${tx.transactionHash || tx.id}|${tx.from}|${tx.to}|${tx.assetCode ?? 'XLM'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (__DEV__) console.log('[merge] final after dedup:', merged.length);

  const sorted = merged.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return classifyTxTypes(sorted, cAddress);
}

export function useStellarTransactions(cAddress: string | null) {
  const { accounts, activeAccountIndex } = useWalletStore();
  const gAddress = accounts[activeAccountIndex]?.gAddress || null;

  return useQuery({
    queryKey: ['stellar-transactions', cAddress, gAddress],
    queryFn: () => fetchStellarPayments(cAddress!, gAddress),
    enabled: !!cAddress,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: 1,
  });
}
