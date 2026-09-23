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
 * registered. This module used to fall back to a local key so setup never
 * dead-ended, but that silently handed someone a wallet they believed was
 * synced and was not; they found out on the device where they could not sign
 * in. The fallback is now disabled: a synced platform passkey is the only
 * supported way to back a wallet, and a failed ceremony surfaces as an error.
 * The `local` path and its helpers are kept commented out below for reference.
 */

import * as Sentry from '@sentry/react-native';
// Local-key fallback disabled — see provisionPasskeyAtIndex.
// import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import QuickCrypto from 'react-native-quick-crypto';

import { PASSKEY_RP_ID } from '@/src/constants/config';
import { getPasskeyStorageKeys, SECURE_KEYS } from '@/src/store/wallet';

import { describePasskeyFailure } from './passkey-failure';
import {
  // Local-key fallback disabled — see provisionPasskeyAtIndex.
  // createPasskeyCredential,
  // storePasskeyCredentialAtIndex,
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
  /**
   * The name computed for this passkey ("Latch Wallet 2", "Savings (Latch 3)")
   * — see buildPasskeyName. Present regardless of platform/local outcome, so
   * callers can send it to latch-api's passkey-credentials index (the deploy
   * call's `label` field) even when the OS ceremony fell back to a local key.
   */
  passkeyName: string;
  /** The monotonic seq baked into `passkeyName`. */
  seq: number;
}

export interface ProvisionPasskeyOptions {
  /** Gate the local key behind Face ID / Touch ID. Ignored on the platform path, where the OS ceremony does its own user verification. */
  requireBiometric: boolean;
  /**
   * The account name the user chose, if any. Folded into the passkey's OS-level
   * name so a device with several Latch passkeys can tell them apart — both in
   * the sign-in sheet (`user.displayName`) and in the iCloud Keychain / Google
   * Password Manager entry (`user.name`, the only per-credential text iOS shows
   * there). A running number is always appended regardless; see
   * buildPasskeyName. Omit on onboarding and the deploy-time fallback, which
   * have no name yet — the passkey is then just "Latch Wallet N".
   */
  accountLabel?: string;
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
// Local-key fallback disabled — see provisionPasskeyAtIndex. These probes only
// ever mattered for how a SecureStore-backed local key was gated; a platform
// passkey's user verification is owned by the OS ceremony.
//
// async function hasStrongBiometrics(): Promise<boolean> {
//   try {
//     return (
//       (await LocalAuthentication.getEnrolledLevelAsync()) ===
//       LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG
//     );
//   } catch {
//     // Never let a capability probe be the thing that fails provisioning.
//     return false;
//   }
// }
//
// /** Which protection a local key can actually get on this device. */
// async function resolveBiometricGate(
//   requireBiometric: boolean,
// ): Promise<'keystore' | 'app' | 'none'> {
//   if (!requireBiometric) return 'none';
//   return (await hasStrongBiometrics()) ? 'keystore' : 'app';
// }

/**
 * The next passkey number to show in the OS credential manager — computed, not
 * yet consumed.
 *
 * A standalone monotonic counter, not accounts.length: removing an account and
 * adding another reuses the list index, and two passkeys numbered the same are
 * indistinguishable in the system sign-in sheet. A read failure falls back to 1
 * rather than blocking provisioning — a duplicate number is cosmetic; a thrown
 * error here is a dead end.
 *
 * Split from the persist step (commitPasskeySeq) so a dismissed or failed
 * ceremony no longer burns a number: previously "Latch Wallet 4" could be the
 * first passkey a user ever kept, because 1–3 were spent on cancelled sheets.
 */
async function peekNextPasskeySeq(): Promise<number> {
  try {
    return (Number(await SecureStore.getItemAsync(SECURE_KEYS.PASSKEY_SEQ)) || 0) + 1;
  } catch {
    return 1;
  }
}

/**
 * Persist the counter so the next provisioning call gets the following number.
 * Called only once the credential it names is safely in SecureStore. Never
 * throws — a lost write just risks one duplicate name, same tolerance as
 * peekNextPasskeySeq's read failure.
 */
async function commitPasskeySeq(seq: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(SECURE_KEYS.PASSKEY_SEQ, String(seq));
  } catch {
    // ignore — see peekNextPasskeySeq
  }
}

/**
 * The name a passkey carries in the OS: `<label> (Latch <n>)` when the user
 * named the account, `Latch Wallet <n>` otherwise. Used for both `user.name`
 * and `user.displayName` — the two fields surface in different places (the
 * iCloud Keychain entry vs. the sign-in sheet) and iOS shows no `displayName`
 * in the former, so an opaque `user.name` would leave that screen unreadable.
 */
function buildPasskeyName(seq: number, accountLabel?: string): string {
  const label = accountLabel?.trim();
  return label ? `${label} (Latch ${seq})` : `Latch Wallet ${seq}`;
}

/**
 * Persist a slot's passkey name — either one this device just computed
 * (provisionPasskeyAtIndex, so a later, separate deploy call can read it
 * back) or one a fresh-device recovery lookup just discovered (see
 * lookupWalletByPasskey in src/api/passkey-credential.ts), so this device
 * has it locally from here on too.
 */
export async function storePasskeyLabel(
  keys: ReturnType<typeof getPasskeyStorageKeys>,
  passkeyName: string,
  seq: number,
): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(keys.label, passkeyName),
    SecureStore.setItemAsync(keys.labelSeq, String(seq)),
  ]);
}

/**
 * Read back the name provisionPasskeyAtIndex computed for a slot, for a
 * caller that deploys separately from where provisioning happened (e.g.
 * deploy-account.tsx picking up credentials biometric.tsx already created).
 * Returns null for a slot that predates this (nothing stored) rather than
 * fabricating a label — the deploy call already treats it as optional.
 */
export async function getStoredPasskeyLabel(
  listIndex: number,
): Promise<{ passkeyName: string; seq: number } | null> {
  const keys = getPasskeyStorageKeys(listIndex);
  const [passkeyName, seqStr] = await Promise.all([
    SecureStore.getItemAsync(keys.label),
    SecureStore.getItemAsync(keys.labelSeq),
  ]);
  if (!passkeyName) return null;
  return { passkeyName, seq: Number(seqStr) || 0 };
}

/**
 * Wipe every SecureStore key for a passkey slot so the next provisioning call
 * runs a fresh OS ceremony instead of reusing what is there.
 *
 * Onboarding's "already have a credential" check keys on CREDENTIAL_ID alone,
 * and a platform passkey survives an app reinstall (it lives in the iCloud
 * Keychain / Google Password Manager entry, not just app storage). Without
 * this, a credential left behind by an earlier run makes "Create a New Wallet"
 * silently skip the passkey sheet. Call it when the user explicitly restarts
 * new-wallet onboarding — at that point no smart account is deployed against
 * this slot, so nothing reachable is lost.
 */
export async function clearProvisionedPasskeyAtIndex(listIndex: number): Promise<void> {
  const keys = getPasskeyStorageKeys(listIndex);
  await Promise.all([
    SecureStore.deleteItemAsync(keys.credentialId),
    SecureStore.deleteItemAsync(keys.keyDataHex),
    SecureStore.deleteItemAsync(keys.privateKey),
    SecureStore.deleteItemAsync(keys.requiresBiometric),
    SecureStore.deleteItemAsync(keys.kind),
    SecureStore.deleteItemAsync(keys.rpId),
    SecureStore.deleteItemAsync(keys.label),
    SecureStore.deleteItemAsync(keys.labelSeq),
  ]);
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
  // Computed before the ceremony so the OS sheet can show the name, but only
  // committed (commitPasskeySeq) after the credential is stored — a dismissed
  // sheet must not advance the counter.
  const seq = await peekNextPasskeySeq();
  const passkeyName = buildPasskeyName(seq, options.accountLabel);
  const keys = getPasskeyStorageKeys(listIndex);

  if (isPlatformPasskeySupported()) {
    try {
      const credential = await createPlatformPasskeyCredential({
        rpId: PASSKEY_RP_ID,
        rpName: 'Latch',
        userId: new Uint8Array(QuickCrypto.randomBytes(16)),
        userName: passkeyName,
        userDisplayName: passkeyName,
        challenge: new Uint8Array(QuickCrypto.randomBytes(32)),
      });
      await storePlatformPasskeyCredentialAtIndex(credential, listIndex, PASSKEY_RP_ID);
      await storePasskeyLabel(keys, passkeyName, seq);
      await commitPasskeySeq(seq);
      return { ...credential, kind: 'platform', passkeyName, seq };
    } catch (err) {
      const deviceOnlyReason = describePasskeyFailure(err, PASSKEY_RP_ID);
      // Warn, not log-in-__DEV__-only: on a real build this line is the only
      // way to tell a dismissed sheet from a misconfigured associated domain.
      console.warn('[passkey] platform ceremony failed, no fallback:', deviceOnlyReason);
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

      // Local-key fallback disabled: a synced platform passkey (iCloud Keychain
      // / Google Password Manager) is the only supported way to back a wallet,
      // so a failed OS ceremony surfaces as an error instead of silently
      // handing the user a device-only key. Kept here for reference.
      //
      // const local = createPasskeyCredential();
      // const gate = await resolveBiometricGate(options.requireBiometric);
      // await storePasskeyCredentialAtIndex(local, listIndex, gate === 'keystore');
      // await storePasskeyLabel(keys, passkeyName, seq);
      // return {
      //   credentialId: local.credentialId,
      //   publicKeyHex: local.publicKeyHex,
      //   keyDataHex: local.publicKeyHex + local.credentialId,
      //   kind: 'local',
      //   deviceOnlyReason,
      //   biometricGate: gate,
      //   passkeyName,
      //   seq,
      // };
      throw new Error(`Couldn't create a passkey: ${deviceOnlyReason}`);
    }
  }

  // Local-key fallback disabled — see the catch block above. A device with no
  // passkey provider can no longer provision a wallet.
  //
  // const local = createPasskeyCredential();
  // const gate = await resolveBiometricGate(options.requireBiometric);
  // await storePasskeyCredentialAtIndex(local, listIndex, gate === 'keystore');
  // await storePasskeyLabel(keys, passkeyName, seq);
  // return {
  //   credentialId: local.credentialId,
  //   publicKeyHex: local.publicKeyHex,
  //   keyDataHex: local.publicKeyHex + local.credentialId,
  //   kind: 'local',
  //   deviceOnlyReason: 'this device does not support passkeys',
  //   biometricGate: gate,
  //   passkeyName,
  //   seq,
  // };
  throw new Error(
    "Couldn't create a passkey: this device has no passkey provider (iCloud Keychain or Google Password Manager).",
  );
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
