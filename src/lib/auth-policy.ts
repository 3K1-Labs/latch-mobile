import * as SecureStore from 'expo-secure-store';

export type AuthPolicy = 'transaction' | '2' | '5' | '10' | '15' | '20' | 'never';

export const AUTH_POLICIES: { value: AuthPolicy; label: string }[] = [
  { value: 'transaction', label: 'Every Transaction' },
  { value: '2', label: 'After Inactive for 2 minutes' },
  { value: '5', label: '5 minutes' },
  { value: '10', label: '10 minutes' },
  { value: '15', label: '15 minutes' },
  { value: '20', label: '20 minutes' },
  { value: 'never', label: 'Never' },
];

const AUTH_POLICY_KEY = 'latch_auth_policy';

export const DEFAULT_AUTH_POLICY: AuthPolicy = 'transaction';

/**
 * This setting only adds an inactivity lock. Signing confirmation and the
 * cold-start unlock always apply, so 'transaction' and 'never' add no timer
 * rather than removing either of those checks.
 */
export const lockAfterMs = (policy: AuthPolicy): number | null =>
  policy === 'transaction' || policy === 'never' ? null : Number(policy) * 60_000;

export const shouldLock = (policy: AuthPolicy, lastActiveAt: number, now: number): boolean => {
  const limit = lockAfterMs(policy);
  return limit !== null && now - lastActiveAt >= limit;
};

export const saveAuthPolicy = (policy: AuthPolicy) =>
  SecureStore.setItemAsync(AUTH_POLICY_KEY, policy);

export const loadAuthPolicy = async (): Promise<AuthPolicy> => {
  const stored = await SecureStore.getItemAsync(AUTH_POLICY_KEY);
  return AUTH_POLICIES.find((p) => p.value === stored)?.value ?? DEFAULT_AUTH_POLICY;
};
