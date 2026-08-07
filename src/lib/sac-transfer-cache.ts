/**
 * sac-transfer-cache.ts — makes SAC transfer history durable.
 *
 * The Soroban RPC scan in use-stellar-transactions.ts is anchored to the chain
 * tip (`startLedger = latestLedger - SAC_EVENTS_REACH_LEDGERS`), so a transfer
 * is not "in history" — it is "recent enough to still be inside the window".
 * Measured on testnet at 5.01s/ledger, a 6,000-ledger reach is ~8.3 hours.
 *
 * That window cannot be widened: getEvents has no end-ledger parameter, so every
 * call scans from startLedger to the current tip and reaching further back costs
 * more, not the same (mainnet rejects ~12,000 ledgers with "request exceeded
 * processing limit threshold"). Incoming transfers from non-Latch wallets have
 * no other source — Horizon G-address ops and bundler ops never see them — so
 * once they age out of the window they disappear from history for good.
 *
 * So the scan is treated as a discovery mechanism rather than the store: every
 * transfer it observes is persisted here and merged back on later fetches. Seen
 * once, kept.
 *
 * This is a client-side stand-in for an indexer. The real fix is the
 * commented-out wallet-backend GraphQL path atop use-stellar-transactions.ts —
 * a server that indexes events and serves real paginated history.
 *
 * Plain AsyncStorage, not SecureStore: these are public on-chain transfers
 * already visible in any block explorer, nothing sensitive.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ACTIVE_NETWORK } from '@/src/constants/config';
import type { StellarPayment } from '@/src/hooks/use-stellar-transactions';

const SAC_TRANSFER_CACHE_KEY = 'latch.sacTransfers.v1';

// Per-account ceiling. The cache only ever accumulates, so without a cap a busy
// account would grow the blob unboundedly and slow every fetch's read/parse.
// Oldest entries are dropped first — they are the ones a widened scan could
// never recover anyway.
const MAX_ENTRIES_PER_ACCOUNT = 200;

type TransferCache = Record<string, StellarPayment[]>;

/**
 * Identity of a payment row. Composite rather than just the tx hash so the legs
 * of a swap (same hash, different assets) survive as separate rows. Shared with
 * the merge in fetchStellarPayments — both sides must agree or a cached row
 * would reappear as a duplicate of its live counterpart.
 */
export function sacPaymentKey(tx: StellarPayment): string {
  return `${tx.transactionHash || tx.id}|${tx.from}|${tx.to}|${tx.assetCode ?? 'XLM'}`;
}

// Contract ids are network-specific, so testnet and mainnet rows must never mix.
// ACTIVE_NETWORK is a live binding reassigned by switchActiveNetwork(), so this
// is read per call, never memoized at module load.
function scopeKey(cAddress: string): string {
  return `${ACTIVE_NETWORK.network}:${cAddress}`;
}

async function readCache(): Promise<TransferCache> {
  try {
    const raw = await AsyncStorage.getItem(SAC_TRANSFER_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as TransferCache) : {};
  } catch {
    return {};
  }
}

/**
 * Merges a completed scan's transfers into the stored set and returns everything
 * known for this account, newest first.
 *
 * Call this ONLY with the result of a scan that actually succeeded — a failed
 * fetch that resolved to an empty array must never be treated as evidence, or
 * the cache stops growing exactly when it is needed most.
 *
 * Never throws: a storage failure degrades to "no durable history", which is the
 * pre-existing behaviour, and must not fail the surrounding fetch.
 */
export async function rememberSacTransfers(
  cAddress: string,
  fresh: StellarPayment[],
): Promise<StellarPayment[]> {
  const scope = scopeKey(cAddress);
  const cache = await readCache();
  const stored = Array.isArray(cache[scope]) ? cache[scope] : [];

  // Fresh first so a re-observed transfer keeps the live copy — a stored row
  // could have been written by an older mapping of the same event.
  const seen = new Set<string>();
  const merged = [...fresh, ...stored]
    .filter((tx) => {
      const key = sacPaymentKey(tx);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MAX_ENTRIES_PER_ACCOUNT);

  try {
    await AsyncStorage.setItem(
      SAC_TRANSFER_CACHE_KEY,
      JSON.stringify({ ...cache, [scope]: merged }),
    );
  } catch {
    // best-effort — the merged list is still returned, it just won't outlive
    // this session
  }

  return merged;
}

/** Full wipe — used on logout / account removal alongside the SecureStore keys. */
export async function clearSacTransferCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SAC_TRANSFER_CACHE_KEY);
  } catch {
    // best-effort
  }
}
