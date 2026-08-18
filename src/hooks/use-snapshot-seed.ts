import { useEffect, useState } from 'react';

import { readSnapshot, type Snapshot, type SnapshotKind } from '../lib/dashboard-snapshot';

/**
 * Reads the persisted snapshot for an account and hands it back for use as
 * React Query `placeholderData`.
 *
 * AsyncStorage is async and `placeholderData` has to be available synchronously
 * at render time, so the read lands via state: the first render has no seed,
 * the one after it does. That is still far ahead of any network round trip, and
 * the query stays in `isPlaceholderData` until real data replaces the seed.
 */
export function useSnapshotSeed<T>(
  kind: SnapshotKind,
  cAddress: string | null | undefined,
): Snapshot<T> | null {
  // The address the loaded snapshot belongs to is stored alongside it, and
  // checked on the way out. Without that, switching accounts would show the
  // previous account's balances for the render between the key changing and
  // this effect re-reading storage — brief, but it is someone else's money.
  const [seed, setSeed] = useState<{ address: string; snapshot: Snapshot<T> | null } | null>(null);

  useEffect(() => {
    if (!cAddress) {
      setSeed(null);
      return;
    }
    let cancelled = false;
    readSnapshot<T>(kind, cAddress).then((snapshot) => {
      if (!cancelled) setSeed({ address: cAddress, snapshot });
    });
    return () => {
      cancelled = true;
    };
  }, [kind, cAddress]);

  return seed && seed.address === cAddress ? seed.snapshot : null;
}
