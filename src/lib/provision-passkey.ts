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
import * as LocalAuthentication from 'expo-local-authentication';
import { Alert } from 'react-native';
import QuickCrypto from 'react-native-quick-crypto';

import { PASSKEY_RP_ID } from '@/src/constants/config';

import { describePasskeyFailure } from './passkey-failure';
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
  /**
   * How a local key is actually protected. 'keystore' = bound to a Class 3
   * biometric by the OS; 'app' = stored ungated because the device has no
   * Class 3 biometric, with LocalAuthentication guarding access instead;
   * 'none' = the caller did not ask for a biometric gate. Undefined on the
   * platform path, where the OS ceremony owns user verification.
   */
  biometricGate?: 'keystore' | 'app' | 'none';
}

export interface ProvisionPasskeyOptions {
  /** Gate the local key behind Face ID / Touch ID. Ignored on the platform path, where the OS ceremony does its own user verification. */
  requireBiometric: boolean;
  /** Shown in the system passkey sheet. */
  displayName?: string;
}

// Moved to ./passkey-failure so the signing path can share it without closing
// an import cycle through this module. Re-exported because this has been its
// import site since it was written.
export { describePasskeyFailure };

/**
 * Whether the OS can bind a stored key to a biometric.
 *
 * expo-secure-store's `requireAuthentication` maps to Android Keystore's
 * setUserAuthenticationRequired, and expo gates that on BIOMETRIC_STRONG
 * (AuthenticationHelper.kt: canAuthenticate(BIOMETRIC_STRONG)). A device whose
 * only biometric is Class 2 — face unlock on a Galaxy A05, say — throws
 * ERROR_NO_HARDWARE there rather than degrading, which turned the device-only
 * fallback into a dead end and surfaced as a bare "Setup Failed". iOS has no
 * Class 2 tier, so this only ever bit Android.
 *
 * Class 2 devices are still supported: the key is stored without the Keystore
 * gate and the biometric check happens at the app level instead, via
 * LocalAuthentication.authenticateAsync, which accepts Class 2 by default.
 * That is a real difference in strength — an app-level prompt is not
 * hardware-enforced the way a Keystore-bound key is — so it is recorded in
 * `biometricGate` and said out loud by notifyIfWeakBiometricGate, never
 * silently downgraded.
 */
async function hasStrongBiometrics(): Promise<boolean> {
  try {
    return (
      (await LocalAuthentication.getEnrolledLevelAsync()) ===
      LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG
    );
  } catch {
    // Never let a capability probe be the thing that fails provisioning.
    return false;
  }
}

/** Which protection a local key can actually get on this device. */
async function resolveBiometricGate(
  requireBiometric: boolean,
): Promise<'keystore' | 'app' | 'none'> {
  if (!requireBiometric) return 'none';
  return (await hasStrongBiometrics()) ? 'keystore' : 'app';
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
      await storePlatformPasskeyCredentialAtIndex(credential, listIndex, PASSKEY_RP_ID);
      return { ...credential, kind: 'platform' };
    } catch (err) {
      const deviceOnlyReason = describePasskeyFailure(err, PASSKEY_RP_ID);
      // Warn, not log-in-__DEV__-only: on a real build this line is the only
      // way to tell a dismissed sheet from a misconfigured associated domain.
      console.warn(
        '[passkey] platform ceremony failed, using a device-only key:',
        deviceOnlyReason,
      );
      // react-native-passkey rejects with a plain `{ error, message }` object, not
      // an Error — passing that straight to captureException logs it as "Object
      // captured as exception with keys: error, message" and buries the reason.
      // Wrap it so the issue title is the actual failure.
      Sentry.captureException(
        err instanceof Error
          ? err
          : new Error(`platform passkey ceremony failed: ${deviceOnlyReason}`),
        {
          tags: { scope: 'platform-passkey-fallback' },
          extra: {
            deviceOnlyReason,
            rawError: err,
            errorCode: (err as { error?: string })?.error,
            errorMessage: (err as { message?: string })?.message,
          },
        },
      );

      const local = createPasskeyCredential();
      const gate = await resolveBiometricGate(options.requireBiometric);
      await storePasskeyCredentialAtIndex(local, listIndex, gate === 'keystore');
      return {
        credentialId: local.credentialId,
        publicKeyHex: local.publicKeyHex,
        keyDataHex: local.publicKeyHex + local.credentialId,
        kind: 'local',
        deviceOnlyReason,
        biometricGate: gate,
      };
    }
  }

  const local = createPasskeyCredential();
  const gate = await resolveBiometricGate(options.requireBiometric);
  await storePasskeyCredentialAtIndex(local, listIndex, gate === 'keystore');
  return {
    credentialId: local.credentialId,
    publicKeyHex: local.publicKeyHex,
    keyDataHex: local.publicKeyHex + local.credentialId,
    kind: 'local',
    deviceOnlyReason: 'this device does not support passkeys',
    biometricGate: gate,
  };
}

/**
 * Tell the user their wallet is backed by a device-only key. No-op for a
 * platform passkey, which is the case that needs no explanation.
 */
/**
 * Tell the user their biometric gate is app-level, not hardware-bound.
 *
 * Separate from notifyIfDeviceOnly because it is a different fact about a
 * different layer: a wallet can be device-only AND keystore-gated, or synced
 * AND irrelevant here. Saying nothing would let someone believe their key is
 * hardware-protected when the device cannot do that.
 */
export function notifyIfWeakBiometricGate(result: ProvisionedPasskey): void {
  if (result.biometricGate !== 'app') return;
  Alert.alert(
    'Biometrics protected by the app',
    "This device's biometric hardware isn't strong enough (Class 2) for Android to bind your wallet key to it. " +
      'Latch will still ask for your biometric before unlocking, but the check happens in the app rather than in secure hardware.\n\n' +
      'Your PIN remains the fallback. Keep your recovery options up to date.',
  );
}

export function notifyIfDeviceOnly(result: ProvisionedPasskey): void {
  if (result.kind === 'platform') return;
  Alert.alert(
    'Passkey saved to this device only',
    `Your wallet is secured with a key stored on this device, because ${result.deviceOnlyReason}.\n\n` +
      "It won't appear in iCloud Keychain or Google Password Manager, so signing in on another device won't find it. Keep your recovery options up to date.",
  );
}
