import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createDepositIntent,
  fetchDepositIntentStatus,
  type DepositIntentOptions,
  type DepositStatus,
} from '../api/latch-auth';

interface CreateDepositIntentVars extends DepositIntentOptions {
  smartAccountAddress: string;
}

/**
 * Mints a fresh funding intent (memo_id + pool_address) for the given smart
 * account. Call this when the user opens the Fund flow, not on Home mount —
 * intents are TTL-bound funding sessions, not permanent registrations.
 *
 * Pass `externalId`/`expectedAmt` when the deposit originates from an on-ramp
 * order so the relayer row can be reconciled against the provider's order.
 */
export function useCreateDepositIntent() {
  return useMutation({
    mutationFn: ({ smartAccountAddress, ...options }: CreateDepositIntentVars) =>
      createDepositIntent(smartAccountAddress, options),
  });
}

/** Intent states the relayer will never move off of — no point polling past them. */
const TERMINAL_STATUSES: DepositStatus['status'][] = ['completed', 'expired', 'failed'];

/**
 * Polls a funding intent's status every 15s while enabled, mirroring
 * useFonbnkOrderStatus's polling convention. Polling stops once the intent
 * reaches a terminal state, so a sheet left open doesn't hit the backend
 * forever after the deposit has settled (or the intent has expired).
 */
export function useDepositIntentStatus(memoId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['deposit-intent-status', memoId],
    queryFn: () => fetchDepositIntentStatus(memoId as string),
    enabled: enabled && !!memoId,
    refetchInterval: (query) =>
      query.state.data && TERMINAL_STATUSES.includes(query.state.data.status) ? false : 15_000,
    retry: 3,
    staleTime: 0,
  });
}
