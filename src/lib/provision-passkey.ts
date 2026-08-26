/**
 * provision-passkey.ts — the one place that decides how an account's passkey
 * is created, and what the user is told about it.
 *
 * Two kinds of credential can back a wallet, and they are not interchangeable
 * from the user's point of view:
 *
 *   platform — the real OS ceremony (react-native-passkey). The private key
 *              lives in the Secure Enclave/Keystore and the credential syncs
 *              through whichever provider ran the sheet (iCloud Keychain,
 *              Google Password Manager, …), so signing in on a second device
 *              can find it.
 *   local    — the hand-rolled P-256 key in SecureStore (passkey-webauthn.ts).
 *              It works everywhere, needs no associated-domain setup, and
 *              exists on exactly one device, forever.
 *
 * The OS ceremony fails for reasons the user cannot see — a dismissed sheet, a
 * device with no passkey provider, an app whose associated domain was never
 * registered. Falling back to a local key keeps setup from dead-ending, but
 * doing it silently hands someone a wallet they believe is synced and is not;
 * they find out on the device where they cannot sign in. So the fallback is
 * kept, and `notifyIfDeviceOnly` says plainly that it happened.
 */

import * as Sentry from '@sentry/react-native';
import { Alert } from 'react-native';
import QuickCrypto from 'react-native-quick-crypto';

import { PASSKEY_RP_ID } from '@/src/constants/config';

import {
  createPasskeyCredential,
  storePasskeyCredentialAtIndex,
  storePlatformPasskeyCredentialAtIndex,
} from './passkey-webauthn';
import { createPlatformPasskeyCredential, isPlatformPasskeySupported } from './platform-passkey';

export interface ProvisionedPasskey {
  credentialId: string;
  /** Uncompressed P-256 public key hex (130 chars, 0x04-prefixed). */
  publicKeyHex: string;
  /** publicKeyHex + credentialId hex — the on-chain signer's key_data. */
  keyDataHex: string;
  kind: 'platform' | 'local';
  /**
   * Why the OS ceremony did not produce the credential. Set only when
   * `kind === 'local'` and a platform passkey was actually attempted.
   */
  deviceOnlyReason?: string;
}

export interface ProvisionPasskeyOptions {
  /** Gate the local key behind Face ID / Touch ID. Ignored on the platform path, where the OS ceremony does its own user verification. */
  requireBiometric: boolean;
  /** Shown in the system passkey sheet. */
  displayName?: string;
}

/**
 * Turn a failed ceremony into something worth showing a user. react-native-passkey
 * rejects with `{ error, message }`; a native module failure can reject with
 * anything.
 */
export function describePasskeyFailure(err: unknown): string {
  const code = (err as { error?: string })?.error;
  switch (code) {
    case 'UserCancelled':
      return 'the system passkey sheet was dismissed';
    case 'NotSupported':
      return 'this device does not support passkeys';
    case 'NoCreateOption':
      return 'no passkey provider is set up on this device';
    case 'BadConfiguration':
      return `this build is not registered with ${PASSKEY_RP_ID}`;
    case 'Timeout':
      return 'the system passkey sheet timed out';
    default: {
      const message = (err as { message?: string })?.message;
      return message ? message : 'the system passkey sheet did not complete';
    }
  }
}

/**
 * Create and store the passkey credential for an account list index, preferring
 * a real platform passkey and falling back to a local key.
 *
 * Index 0 writes the same SecureStore keys the non-indexed helpers use, so this
 * is a drop-in for both onboarding and additional accounts.
 */
export async function provisionPasskeyAtIndex(
  listIndex: number,
  options: ProvisionPasskeyOptions,
): Promise<ProvisionedPasskey> {
  if (isPlatformPasskeySupported()) {
    try {
      const credential = await createPlatformPasskeyCredential({
        rpId: PASSKEY_RP_ID,
        rpName: 'Latch',
        userId: new Uint8Array(QuickCrypto.randomBytes(16)),
        userName: 'latch-wallet',
        userDisplayName: options.displayName || 'Latch Wallet',
        challenge: new Uint8Array(QuickCrypto.randomBytes(32)),
      });
      await storePlatformPasskeyCredentialAtIndex(credential, listIndex);
      return { ...credential, kind: 'platform' };
    } catch (err) {
      const deviceOnlyReason = describePasskeyFailure(err);
      // Warn, not log-in-__DEV__-only: on a real build this line is the only
      // way to tell a dismissed sheet from a misconfigured associated domain.
      console.warn('[passkey] platform ceremony failed, using a device-only key:', deviceOnlyReason);
      Sentry.captureException(err, { tags: { scope: 'platform-passkey-fallback' } });

      const local = createPasskeyCredential();
      await storePasskeyCredentialAtIndex(local, listIndex, options.requireBiometric);
      return {
        credentialId: local.credentialId,
        publicKeyHex: local.publicKeyHex,
        keyDataHex: local.publicKeyHex + local.credentialId,
        kind: 'local',
        deviceOnlyReason,
      };
    }
  }

  const local = createPasskeyCredential();
  await storePasskeyCredentialAtIndex(local, listIndex, options.requireBiometric);
  return {
    credentialId: local.credentialId,
    publicKeyHex: local.publicKeyHex,
    keyDataHex: local.publicKeyHex + local.credentialId,
    kind: 'local',
    deviceOnlyReason: 'this device does not support passkeys',
  };
}

/**
 * Tell the user their wallet is backed by a device-only key. No-op for a
 * platform passkey, which is the case that needs no explanation.
 */
export function notifyIfDeviceOnly(result: ProvisionedPasskey): void {
  if (result.kind === 'platform') return;
  Alert.alert(
    'Passkey saved to this device only',
    `Your wallet is secured with a key stored on this device, because ${result.deviceOnlyReason}.\n\n` +
      "It won't appear in iCloud Keychain or Google Password Manager, so signing in on another device won't find it. Keep your recovery options up to date.",
  );
}
