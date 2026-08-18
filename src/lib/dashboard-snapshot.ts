/**
 * dashboard-snapshot.ts — last-known dashboard data, for instant first paint.
 *
 * React Query's cache is memory-only (see queryClient in src/api/client.ts), so
 * every cold start began with nothing: `isLoading` was true for both the
 * portfolio and the history query, and the home screen blocked on a full-screen
 * spinner until the slower of the two returned. On a cold RPC that is tens of
 * seconds of blank app.
 *
 * A snapshot gives the first render something real to show while the live fetch
 * runs behind it. It is a display aid, never evidence:
 *   • it carries the wall-clock time it was written, so the UI can say so;
 *   • it is only ever surfaced through React Query's `placeholderData`, which
 *     keeps `isPlaceholderData` true until real data replaces it;
 *   • anything that spends funds must re-read live balances first — a snapshot
 *     is never sufficient authority to sign.
 *
 * Distinct from sac-transfer-cache.ts, which is a durable *store*: transfers
 * that would otherwise age out of the RPC scan window and be lost for good.
 * This is a throwaway copy of whatever was last on screen, safe to discard.
 *
 * Plain AsyncStorage, not SecureStore: balances and transfers are public
 * on-chain data, already visible in any block explorer.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ACTIVE_NETWORK } from '@/src/constants/config';

const SNAPSHOT_KEY = 'latch.dashboardSnapshot.v1';

export type SnapshotKind = 'portfolio' | 'history';

export interface Snapshot<T> {
  data: T;
  /** epoch ms the snapshot was written — drives the "as of …" label. */
  updatedAt: number;
}

type SnapshotStore = Record<string, Snapshot<unknown>>;

// Balances and contract ids are network-specific, so testnet and mainnet
// snapshots must never mix. ACTIVE_NETWORK is a live binding reassigned by
// switchActiveNetwork(), so it is read per call, never memoized at module load.
function scopeKey(kind: SnapshotKind, cAddress: string): string {
  return `${ACTIVE_NETWORK.network}:${kind}:${cAddress}`;
}

async function readStore(): Promise<SnapshotStore> {
  try {
    const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as SnapshotStore) : {};
  } catch {
    return {};
  }
}

/** Last snapshot for this account, or null when there is none to show. */
export async function readSnapshot<T>(
  kind: SnapshotKind,
  cAddress: string,
): Promise<Snapshot<T> | null> {
  const entry = (await readStore())[scopeKey(kind, cAddress)];
  if (!entry || typeof entry.updatedAt !== 'number') return null;
  return entry as Snapshot<T>;
}

/**
 * Overwrites the snapshot for this account.
 *
 * Call this ONLY with data from a fetch that actually succeeded. Persisting a
 * failure's empty result would show the user a confident, timestamped empty
 * wallet on their next launch.
 *
 * Never throws: a storage failure degrades to "no instant first paint", which
 * is the pre-existing behaviour, and must not fail the surrounding fetch.
 */
export async function writeSnapshot<T>(
  kind: SnapshotKind,
  cAddress: string,
  data: T,
): Promise<void> {
  try {
    const store = await readStore();
    store[scopeKey(kind, cAddress)] = { data, updatedAt: Date.now() };
    await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(store));
  } catch {
    // best-effort — the live data is already on screen either way
  }
}
