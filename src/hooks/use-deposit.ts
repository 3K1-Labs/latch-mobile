import { useMutation, useQuery } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import {
  createDepositIntent,
  fetchDepositIntentStatus,
  LatchAPIError,
  type DepositIntent,
  type DepositIntentOptions,
  type DepositStatus,
} from '../api/latch-auth';
import { getNetworkId } from '../constants/config';

interface CreateDepositIntentVars extends DepositIntentOptions {
  smartAccountAddress: string;
}

/**
 * A minted intent, tagged with the network it was minted on.
 *
 * The pool address in an intent exists on one network only, but ACTIVE_NETWORK
 * is switchable without a restart and this mutation's cache is not keyed by it
 * — so after a switch the last intent is still sitting in `data`, and a sheet
 * rendering it would show the user a pool address nothing is watching on the
 * network they're now on. Callers compare `mintedOn` against the live network
 * before trusting the rest.
 */
export interface MintedDepositIntent extends DepositIntent {
  mintedOn: 'testnet' | 'mainnet';
}

/**
 * True when a mint failed because the deposit relayer was still booting.
 *
 * The relayer idles out on its host and takes ~25s to come back; latch-api gives
 * up waiting before that finishes and answers "funding is temporarily
 * unavailable, please retry" instead of an intent. Retrying is unusually
 * effective here because the attempt that failed is what started the relayer —
 * measured 12.9s on a cold hit, 0.47s once warm — so the second attempt lands on
 * a live instance.
 *
 * Matched on status rather than message text, per LatchAPIError's contract that
 * callers branch on status/code. The message test is only a fallback: the status
 * latch-api wraps a relayer timeout in hasn't been observed yet. Narrow this to
 * the error code once a failure has been logged carrying one.
 */
function isRelayerWarmingUp(error: unknown): boolean {
  if (!(error instanceof LatchAPIError)) return false;
  return error.status >= 500 || /temporarily unavailable/i.test(error.message);
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
    mutationFn: async ({
      smartAccountAddress,
      ...options
    }: CreateDepositIntentVars): Promise<MintedDepositIntent> => ({
      ...(await createDepositIntent(smartAccountAddress, options)),
      // Read after the await: the request itself sends getNetworkId(), so this
      // records the network the backend actually minted against.
      mintedOn: getNetworkId(),
    }),
    // Exactly one extra attempt, and only for a cold relayer. retry() is called
    // before failureCount is incremented, so failureCount is 0 on the first
    // failure — `< 1` permits one retry and stops. Anything else (auth, bad
    // address) fails the same way twice and is not worth a second ~25s wait.
    retry: (failureCount, error) => failureCount < 1 && isRelayerWarmingUp(error),
    // A mint that never settles pins isPending true, and the Fund button's guard
    // reads "in flight" as "don't mint" — so one hung request dead-ends funding
    // until Home remounts. Log both edges with a duration: the absence of a
    // settle line is what distinguishes a stuck mint from a slow one.
    onMutate: () => ({ startedAt: Date.now() }),
    onSettled: (data, error, _vars, context) => {
      if (!__DEV__) return;
      const ms = context ? Date.now() - context.startedAt : -1;
      if (error) {
        const detail =
          error instanceof LatchAPIError ? ` status=${error.status} code=${error.code}` : '';
        console.log(`[deposit] mint FAILED after ${ms}ms${detail} —`, error);
      } else {
        console.log(`[deposit] mint ok in ${ms}ms — memo=${data?.memo_id}`);
      }
    },
    // Fires once, after the retry above is exhausted. Both callers swallow the
    // failure by design — the Fund sheet opens with no memo, prepareOnrampIntent
    // returns undefined — which leaves a flow that looks functional but hands a
    // provider no tag, and an untagged deposit is swept to the relayer's recovery
    // address rather than credited. The user has to be told before that happens.
    onError: (error) => {
      Toast.show({
        type: 'error',
        text1: 'Funding unavailable',
        text2: isRelayerWarmingUp(error)
          ? 'Deposits are temporarily unavailable. Please try again in a moment.'
          : 'Could not start funding. Please try again.',
      });
    },
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
