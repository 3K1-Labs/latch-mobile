/**
 * push-registration.ts — registers this device's Expo push token for the blind
 * cosign queues it can decrypt, so the backend can send a CONTENT-FREE
 * "pending approval" push when another member signs.
 *
 * Privacy: the registration carries only {queue_index, blind_signer_id} HMACs —
 * the server learns a push-token ↔ blind-queue link (accepted trade-off,
 * docs/multisig-encrypted-queue.md) but never a wallet address, device key,
 * or tx content. Wallets without a local WCK can't derive their blind ids and
 * are simply skipped; re-running after a key import picks them up.
 *
 * Replace-set semantics: every call replaces the token's full registration set,
 * so removed wallets fall off without bookkeeping.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { deleteDevice, registerDevice } from '@/src/api/devices';
import {
  deletePushRegistrations,
  replacePushRegistrations,
  type PushRegistration,
} from '@/src/api/push-tokens';
import { blindSignerId, queueIndexFor } from '@/src/lib/cosign-crypto';
import { getMySignerKey, pickSigner } from '@/src/lib/cosign-packet-flow';
import { ensureWalletSession, getWalletSessionWithoutSignIn } from '@/src/lib/wallet-auth';
import { getWalletCosignKey } from '@/src/lib/wallet-cosign-key';
import { useWalletStore } from '@/src/store/wallet';

const log = (...args: unknown[]) => {
  if (__DEV__) console.log('[push-registration]', ...args);
};

const PUSH_TOKEN_KEY = 'latch_expo_push_token';

async function getExpoPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    log('skipped: not a physical device');
    return null;
  }

  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) {
    log('skipped: permission not granted');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Approvals',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, data);
  return data;
}

/**
 * Register this device for activity notifications. Independent of multisig: a
 * solo wallet still wants backup-signer / recovery / funding pushes. Uses the
 * cached session only — never signs in, so no unexpected biometric prompt.
 */
export async function registerDevicePushToken(): Promise<boolean> {
  const jwt = await getWalletSessionWithoutSignIn();
  if (!jwt) {
    log('device registration deferred: no cached session');
    return false;
  }
  const pushToken = await getExpoPushToken();
  if (!pushToken) return false;
  await registerDevice(jwt, pushToken, 'expo');
  log('device registered');
  return true;
}

/** Logout hygiene: best-effort removal of this device's server-side registrations. */
export async function unregisterPush(): Promise<void> {
  try {
    const pushToken = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!pushToken) return;
    const jwt = await getWalletSessionWithoutSignIn();
    if (jwt) {
      await Promise.allSettled([
        deleteDevice(jwt, pushToken),
        deletePushRegistrations(jwt, pushToken),
      ]);
    }
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch (err) {
    log('unregister failed', err instanceof Error ? err.message : err);
  }
}

/**
 * Register (or refresh) this device's push token for every shared wallet whose
 * WCK is held locally. Safe to call repeatedly; soft-fails on simulators,
 * denied permission, or missing accounts — push is an enhancement, never a
 * gate. Returns true when a registration was sent.
 */
export async function registerPushToken(): Promise<boolean> {
  if (!Device.isDevice) {
    log('skipped: not a physical device');
    return false;
  }

  const me = pickSigner();
  if (!me) return false;
  const myKey = await getMySignerKey();
  if (!myKey) return false;

  // Build the blind registrations first — if there's nothing to watch, don't
  // prompt for notification permission at all.
  const registrations: PushRegistration[] = [];
  for (const a of useWalletStore.getState().accounts) {
    if (!a.isMultisig || !a.smartAccountAddress) continue;
    const wck = await getWalletCosignKey(a.smartAccountAddress);
    if (!wck) continue; // no key → can't derive the queue → nothing to register
    registrations.push({
      queueIndex: queueIndexFor(wck, a.smartAccountAddress),
      blindSignerId: blindSignerId(wck, myKey),
    });
  }
  if (registrations.length === 0) {
    log('skipped: no shared wallets with a local key');
    return false;
  }

  const pushToken = await getExpoPushToken();
  if (!pushToken) return false;

  await replacePushRegistrations(await ensureWalletSession(me.account), pushToken, registrations);
  log('registered', registrations.length, 'queue(s)');
  return true;
}
