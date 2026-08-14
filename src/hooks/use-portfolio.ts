// ─── Balance data source ────────────────────────────────────────────────────
//
// This hook has TWO interchangeable balance fetchers:
//
//   1. fetchAllSacBalances              — direct Soroban RPC getLedgerEntries
//                                         (the default; what shipped pre-Phase-3)
//   2. fetchAllSacBalancesViaWalletBackend — wallet-backend GraphQL
//                                            (Phase 3, requires auth)
//
// To switch, set EXPO_PUBLIC_USE_WALLET_BACKEND_BALANCES=true in .env (any
// other value or unset → option 1). Build-time switch; restart Metro after
// changing.
//
// TO REVERT to the legacy RPC behavior:
//   • Unset EXPO_PUBLIC_USE_WALLET_BACKEND_BALANCES, OR
//   • Delete the wallet-backend code path (the constant USE_WB_BALANCES, the
//     function fetchAllSacBalancesViaWalletBackend, and the conditional at
//     the call site around line `chooseSacBalanceFetcher`).
//
// History (use-stellar-transactions.ts) is on wallet-backend GraphQL with no
// fallback. See docs/phase-3-wallet-auth-and-history.md for the rationale.

import { Address, Asset, scValToNative, xdr } from '@stellar/stellar-sdk';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { HORIZON_URL, STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL } from '../constants/config';
import { getWellKnownTokens, type TokenConfig } from '../constants/known-tokens';
import { fetchAccountBalances, GraphQLError } from '../api/wallet-backend';
import { writeSnapshot } from '../lib/dashboard-snapshot';
import { ensureWalletSession, reSignInWallet } from '../lib/wallet-auth';
import { useWalletStore } from '../store/wallet';
import { useSnapshotSeed } from './use-snapshot-seed';

const USE_WB_BALANCES = process.env.EXPO_PUBLIC_USE_WALLET_BACKEND_BALANCES === 'true';

export interface TokenBalance {
  code: string;
  issuer?: string; // undefined for native XLM
  sacContractId: string;
  amount: string; // human-readable, 7 decimal places
  usdValue: number;
}

function buildLedgerKeyB64(cAddress: string, sacContractId: string): string {
  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(sacContractId).toScAddress(),
      key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Balance'), new Address(cAddress).toScVal()]),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
  const bytes = new Uint8Array(ledgerKey.toXDR());
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function parseBalanceFromXdr(entryXdr: string): string {
  try {
    const entryData = xdr.LedgerEntryData.fromXDR(entryXdr, 'base64');
    const parsed = scValToNative(entryData.contractData().val()) as { amount: bigint };
    const n = Number(parsed.amount);
    if (!isFinite(n)) return '0';
    return (n / 10_000_000).toFixed(7);
  } catch {
    return '0';
  }
}

/**
 * Fetch all SAC token balances for a C-address in a single getLedgerEntries call.
 * Returns a map of sacId → human-readable balance string.
 * Uses XHR to avoid the Axios Android TLS failure on Soroban JSON-RPC.
 */
function fetchAllSacBalances(cAddress: string, sacIds: string[]): Promise<Record<string, string>> {
  const zero = Object.fromEntries(sacIds.map((id) => [id, '0']));
  if (sacIds.length === 0) return Promise.resolve(zero);

  const keys = sacIds.map((id) => buildLedgerKeyB64(cAddress, id));
  const keyToSacId = new Map(keys.map((k, i) => [k, sacIds[i]]));

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', STELLAR_RPC_URL, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 15000;
    // A transport failure is NOT a balance of zero. Resolving `zero` here meant
    // a slow or unreachable RPC rendered as a confident, fully-loaded empty
    // wallet — indistinguishable from actually having no funds. Rejecting hands
    // React Query an error, which keeps the last known balances on screen (see
    // placeholderData in usePortfolio) and drives the error state instead.
    //
    // A key that is simply absent from `result.entries` is different: the chain
    // has no balance entry for it, which genuinely is zero. That still resolves.
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (json.error) {
          reject(new Error(`getLedgerEntries: ${json.error.message ?? 'RPC error'}`));
          return;
        }
        const result = { ...zero };
        for (const entry of json.result?.entries ?? []) {
          const sacId = keyToSacId.get(entry.key);
          if (sacId) result[sacId] = parseBalanceFromXdr(entry.xdr);
        }
        resolve(result);
      } catch {
        reject(new Error('getLedgerEntries: unparseable response'));
      }
    };
    xhr.onerror = () => reject(new Error('getLedgerEntries: network error'));
    xhr.ontimeout = () => reject(new Error('getLedgerEntries: request timed out'));
    xhr.send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getLedgerEntries',
        params: { keys },
      }),
    );
  });
}

/**
 * Wallet-backend variant of fetchAllSacBalances. Pulls every balance the
 * server has indexed for cAddress, filters down to the requested sacIds, and
 * returns the same Record<sacId, balanceString> shape.
 *
 * Wallet-backend does not currently index native XLM held by contract
 * addresses (there is no `native_balances` row for a C-address, and the
 * native XLM SAC is not in `contract_tokens`). To avoid showing 0 XLM, we
 * fall back to the direct-RPC fetcher for the native SAC ID. Remove the
 * fallback once wallet-backend indexes contract-held XLM.
 *
 * Requires a wallet-scope JWT; uses ensureWalletSession from
 * src/lib/wallet-auth.ts and re-signs in on 401.
 */
async function fetchAllSacBalancesViaWalletBackend(
  cAddress: string,
  sacIds: string[],
): Promise<Record<string, string>> {
  const zero = Object.fromEntries(sacIds.map((id) => [id, '0']));
  if (sacIds.length === 0) return zero;

  const account = useWalletStore.getState().accounts[useWalletStore.getState().activeAccountIndex];
  if (!account) throw new Error('wallet-backend balances: no active account');

  let token = await ensureWalletSession(account);
  let balances;
  try {
    balances = await fetchAccountBalances(cAddress, token);
  } catch (err) {
    if (err instanceof GraphQLError && err.code === 'UNAUTHORIZED') {
      token = await reSignInWallet(account);
      balances = await fetchAccountBalances(cAddress, token);
    } else {
      // Same reasoning as the RPC fetcher: a failed request is not a zero
      // balance, and must not be cached or rendered as one.
      throw err;
    }
  }

  const result = { ...zero };
  for (const b of balances) {
    if (sacIds.includes(b.tokenId)) result[b.tokenId] = b.balance;
  }

  // Native XLM is not tracked by wallet-backend for C-addresses — fetch via RPC.
  const nativeSacId = Asset.native().contractId(STELLAR_NETWORK_PASSPHRASE);
  if (sacIds.includes(nativeSacId)) {
    const xlmOnly = await fetchAllSacBalances(cAddress, [nativeSacId]);
    result[nativeSacId] = xlmOnly[nativeSacId];
  }

  return result;
}

const chooseSacBalanceFetcher = USE_WB_BALANCES
  ? fetchAllSacBalancesViaWalletBackend
  : fetchAllSacBalances;

/**
 * Assets held by the classic G-address, as extra tokens to price.
 *
 * Deliberately its own request (and its own query — see useTrustlineTokens):
 * discovery only ever *widens* the token set, so awaiting it before fetching
 * balances put a 10s Horizon round trip in front of the XLM balance that never
 * needed it. Rejects rather than returning [] so a flaky Horizon isn't cached
 * as "this account has no trustlines".
 */
function fetchTrustlineTokens(gAddress: string): Promise<TokenConfig[]> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${HORIZON_URL}/accounts/${encodeURIComponent(gAddress)}`, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 10000;
    xhr.onload = () => {
      try {
        const account = JSON.parse(xhr.responseText);
        const tokens: TokenConfig[] = [];
        for (const b of account.balances ?? []) {
          if (b.asset_type === 'native' || b.asset_type === 'liquidity_pool_shares') continue;
          tokens.push({ code: b.asset_code, issuer: b.asset_issuer, name: b.asset_code });
        }
        resolve(tokens);
      } catch {
        reject(new Error('trustline lookup: unparseable response'));
      }
    };
    xhr.onerror = () => reject(new Error('trustline lookup: network error'));
    xhr.ontimeout = () => reject(new Error('trustline lookup: request timed out'));
    xhr.send();
  });
}

/**
 * G-address trustline discovery, cached separately from balances.
 *
 * Trustlines change rarely, so this is refetched far less often than balances
 * and — crucially — never blocks them. Its result feeds usePortfolio's query
 * key, so when it does land the balance query refetches in the background with
 * the previous balances still on screen.
 */
export function useTrustlineTokens(gAddress?: string | null) {
  return useQuery({
    queryKey: ['trustline-tokens', gAddress],
    queryFn: () => fetchTrustlineTokens(gAddress!),
    enabled: !!gAddress,
    staleTime: 5 * 60_000,
  });
}

/**
 * Fetch all token balances for a smart account (C-address).
 *
 * Token discovery strategy (union of all, deduplicated by code+issuer):
 *  1. XLM — always included (native SAC).
 *  2. Well-known tokens — auto-checked; zero-balance ones are filtered out.
 *  3. Tracked tokens — the user's persisted list (managed via useTrackedTokens).
 *  4. G-address trustlines — discovered by useTrustlineTokens and passed in;
 *     absent on the first load, which is the point (see fetchTrustlineTokens).
 *
 * All SAC balance fetches run in parallel. Tokens with zero balance are hidden
 * (except XLM which is always shown).
 */
async function fetchPortfolio(
  cAddress: string,
  trackedTokens: TokenConfig[],
  trustlineTokens: TokenConfig[],
): Promise<TokenBalance[]> {
  const nativeSacId = Asset.native().contractId(STELLAR_NETWORK_PASSPHRASE);

  // Build deduplicated list of non-native tokens to check (well-known + tracked + G-address trustlines)
  // Key is sacContractId when available (C-address tokens), otherwise code:issuer.
  const tokenMap = new Map<string, TokenConfig>();

  // 1. Well-known tokens — auto-detected; zero-balance ones are filtered out below
  for (const t of getWellKnownTokens()) {
    const key = t.sacContractId ?? `${t.code}:${t.issuer}`;
    tokenMap.set(key, t);
  }

  // 2. Tracked tokens (user-managed list)
  for (const t of trackedTokens) {
    const key = t.sacContractId ?? `${t.code}:${t.issuer}`;
    tokenMap.set(key, t);
  }

  // 3. G-address trustlines — first occurrence wins, so a well-known or tracked
  //    entry keeps its richer config.
  for (const t of trustlineTokens) {
    const key = t.sacContractId ?? `${t.code}:${t.issuer}`;
    if (!tokenMap.has(key)) tokenMap.set(key, t);
  }

  const nonNativeTokens = Array.from(tokenMap.values()).map((t) => ({
    config: t,
    sacId: t.sacContractId ?? new Asset(t.code, t.issuer!).contractId(STELLAR_NETWORK_PASSPHRASE),
  }));

  // Single batched call for all tokens (XLM + non-native). The fetcher is
  // selected once at module load via the EXPO_PUBLIC_USE_WALLET_BACKEND_BALANCES
  // flag (see top-of-file doc block).
  const allSacIds = [nativeSacId, ...nonNativeTokens.map((t) => t.sacId)];
  const balances = await chooseSacBalanceFetcher(cAddress, allSacIds);

  const xlmAmount = balances[nativeSacId];
  const results: TokenBalance[] = [
    {
      code: 'XLM',
      issuer: undefined,
      sacContractId: nativeSacId,
      amount: xlmAmount,
      usdValue: 0,
    },
  ];

  for (const { config: t, sacId } of nonNativeTokens) {
    const amount = balances[sacId];
    if (parseFloat(amount) <= 0) continue;
    results.push({
      code: t.code,
      issuer: t.issuer,
      sacContractId: sacId,
      amount,
      usdValue: 0,
    });
  }

  return results;
}

export function usePortfolio(
  cAddress: string | null,
  gAddress?: string | null,
  trackedTokens: TokenConfig[] = [],
) {
  const { data: trustlineTokens } = useTrustlineTokens(gAddress);
  const snapshot = useSnapshotSeed<TokenBalance[]>('portfolio', cAddress);

  const tokenKey = trackedTokens.map((t) => t.sacContractId ?? `${t.code}:${t.issuer}`).join(',');
  const trustlineKey = (trustlineTokens ?? [])
    .map((t) => t.sacContractId ?? `${t.code}:${t.issuer}`)
    .join(',');

  const query = useQuery({
    queryKey: ['portfolio', cAddress, tokenKey, trustlineKey],
    queryFn: () => fetchPortfolio(cAddress!, trackedTokens, trustlineTokens ?? []),
    // Previous data first (a token-set change must not blank the screen), then
    // the persisted snapshot on a cold start. Either way the query reports
    // success + isPlaceholderData rather than isLoading, so nothing blocks.
    placeholderData: (previous) => previous ?? snapshot?.data,
    enabled: !!cAddress,
    staleTime: 30_000,
  });

  const { data, isPlaceholderData } = query;

  useEffect(() => {
    if (!cAddress || isPlaceholderData || !data) return;
    void writeSnapshot('portfolio', cAddress, data);
  }, [cAddress, data, isPlaceholderData]);

  return {
    ...query,
    /** When showing the persisted snapshot, when it was captured — else null. */
    snapshotAt: isPlaceholderData ? (snapshot?.updatedAt ?? null) : null,
  };
}
