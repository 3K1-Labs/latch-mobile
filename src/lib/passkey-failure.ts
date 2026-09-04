/**
 * passkey-failure.ts — turning a failed OS passkey ceremony into something a
 * user can act on.
 *
 * A leaf module on purpose. This lived in provision-passkey.ts, which covers
 * only credential *creation*; the signing path in passkey-webauthn.ts needs the
 * same mapping, and provision-passkey.ts already imports from
 * passkey-webauthn.ts, so importing it back would close a cycle.
 *
 * It imports nothing at all — deliberately. Reading PASSKEY_RP_ID from config
 * here instead of taking it as an argument pulled AsyncStorage and stellar-sdk
 * into passkey-webauthn.ts's dependency graph and broke two suites that exist
 * precisely because that file can run under plain Node. Taking `rpId` as a
 * parameter also lets the signing path pass the RP the ceremony actually used
 * rather than whatever is configured globally.
 */

/**
 * Turn a failed ceremony into something worth showing a user. react-native-passkey
 * rejects with `{ error, message }`; a native module failure can reject with
 * anything.
 *
 * @param rpId  The relying party the ceremony ran against — named in the
 *              messages, so it must be the one actually used, not a default.
 */
export function describePasskeyFailure(err: unknown, rpId: string): string {
  const code = (err as { error?: string })?.error;
  switch (code) {
    case 'UserCancelled':
      return 'the system passkey sheet was dismissed';
    case 'NotSupported':
      return 'this device does not support passkeys';
    case 'NoCreateOption':
      return 'no passkey provider is set up on this device';
    case 'BadConfiguration':
      return `this build is not registered with ${rpId}`;
    case 'Timeout':
      return 'the system passkey sheet timed out';
    default: {
      const message = (err as { message?: string })?.message;
      if (!message) return 'the system passkey sheet did not complete';
      // Android's Credential Manager reports a dismissed sheet and a sheet that
      // had nothing to show identically — "User canceled the selector" is both.
      // The second is what an RP change produces: the OS is asked for a
      // credential scoped to a domain it holds none for, so the selector opens
      // empty and closes immediately. Naming only "dismissed" sends someone
      // looking for a mistake they did not make, so say both; the API genuinely
      // cannot tell us which happened.
      if (/cancell?ed the selector|activity is cancell?ed|CancellationException/i.test(message)) {
        return `the system passkey sheet closed without signing — it was dismissed, or this device holds no passkey for ${rpId}`;
      }
      // Android Credential Manager reports a failed Digital Asset Links check
      // with any of "RP ID cannot be validated", "the incoming request cannot
      // be validated", or "...not associated with domain" — never a
      // BadConfiguration code. They all mean the same thing: the OS could not
      // verify this build against the RP's /.well-known/assetlinks.json — either
      // the signing cert is not listed, or (common on emulators with a skewed
      // clock) Play Services could not fetch the file over HTTPS at all.
      if (/cannot be validated|not associated|asset[\s_]?links|asset_?statements/i.test(message)) {
        return `this build could not be verified against ${rpId} — check the signing cert in assetlinks.json, or the device's clock and network`;
      }
      // These read as "…because <reason>." so a native message — capitalised
      // and full-stopped as its own sentence — has to be folded back into the
      // middle of one, or the user sees "because The operation couldn't be
      // completed.." See notifyIfDeviceOnly.
      const trimmed = message.trim().replace(/\.+$/, '');
      return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
    }
  }
}
