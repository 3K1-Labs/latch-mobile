import { DEFAULT_AUTH_POLICY, loadAuthPolicy, shouldLock, type AuthPolicy } from '@/src/lib/auth-policy';
import { useRouter, useSegments } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

const CHECK_INTERVAL_MS = 15_000;
const SETUP_AND_UNLOCK_GROUPS = new Set(['(onboarding)', '(auth)', '(migration)', 'onboarding']);

/** Returns the handler that records user activity; attach it to a root view. */
export function useInactivityLock() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const guarded = segments.length > 0 && !SETUP_AND_UNLOCK_GROUPS.has(segments[0]);

  const guardedRef = useRef(guarded);
  const policyRef = useRef<AuthPolicy>(DEFAULT_AUTH_POLICY);
  const lastActiveAt = useRef(0);

  useEffect(() => {
    guardedRef.current = guarded;
    if (!guarded) return;
    lastActiveAt.current = Date.now();
    loadAuthPolicy().then((policy) => {
      policyRef.current = policy;
    });
  }, [guarded]);

  const lockIfExpired = useCallback(() => {
    if (!guardedRef.current || !shouldLock(policyRef.current, lastActiveAt.current, Date.now())) {
      return;
    }
    guardedRef.current = false;
    router.replace({ pathname: '/(auth)/biometric', params: { mode: 'unlock' } });
  }, [router]);

  useEffect(() => {
    const interval = setInterval(lockIfExpired, CHECK_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') lockIfExpired();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [lockIfExpired]);

  return useCallback(() => {
    lastActiveAt.current = Date.now();
  }, []);
}
