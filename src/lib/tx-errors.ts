/**
 * tx-errors.ts — turn raw Stellar/Soroban failures into one short, human
 * sentence for the UI.
 *
 * Soroban surfaces failures as giant HostError dumps with diagnostic event
 * logs and contract error codes (e.g. `Error(Auth, InvalidAction)`,
 * `Error(Contract, #3016)`). Showing those verbatim is useless to a user.
 * `friendlyTxError` matches the known shapes and returns a plain message;
 * the raw text is still logged (see the [multisig-send] / send-token logs)
 * for debugging.
 */

function raw(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function friendlyTxError(err: unknown): string {
  const msg = raw(err);
  const lower = msg.toLowerCase();

  // Passkey credential drift — caller may special-case this, but map it too.
  if (msg.startsWith('PASSKEY_KEY_MISMATCH') || lower.includes('passkey_key_mismatch')) {
    return 'Your account credential has changed. Re-initialize the account to continue.';
  }

  // Platform passkey (Google Password Manager / iCloud Keychain) has no
  // locally readable private key — the mismatch-repair / WCK-bundle-opening
  // paths that need one don't apply to this signer.
  if (msg.startsWith('PASSKEY_IS_PLATFORM') || lower.includes('passkey_is_platform')) {
    return "This device's passkey is a synced passkey and doesn't support this action.";
  }

  // Contract rejected the authorization: the signing device isn't an
  // accepted signer for this wallet (e.g. signing a shared wallet from a
  // device that isn't one of its owners, or a stale signer).
  if (
    lower.includes('failed account authentication') ||
    lower.includes('invalidaction') ||
    /error\(contract, #301[0-9]\)/.test(lower) ||
    lower.includes('#3016')
  ) {
    return "This wallet didn't authorize the transfer — the signing device isn't a recognized owner of this wallet.";
  }

  // Not authenticated to the backend.
  if (lower.includes('not signed in') || lower.includes('401') || lower.includes('unauthorized')) {
    return 'Your session expired. Please sign in again.';
  }

  // Funds / fees.
  if (
    lower.includes('insufficient') ||
    lower.includes('underfunded') ||
    lower.includes('balance') ||
    lower.includes('txinsufficientbalance')
  ) {
    return "You don't have enough balance to cover this transfer and its fee.";
  }

  // Recipient can't hold the asset yet.
  if (lower.includes('trustline') || lower.includes('no_trust') || lower.includes('op_no_trust')) {
    return "The recipient can't receive this asset yet (their account is missing a trustline for it).";
  }

  // Simulation / preparation failed.
  if (lower.includes('simulation failed') || lower.includes('simulate')) {
    return "We couldn't prepare this transaction. Please check the amount and recipient, then try again.";
  }

  // Network / confirmation timeouts — the tx may still land.
  if (
    lower.includes('did not confirm') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('network request failed')
  ) {
    return 'The network is slow right now. Your transfer may still go through — check your history in a moment.';
  }

  // Misconfiguration (dev/staging) — keep it honest but non-cryptic.
  if (lower.includes('expo_public_') || lower.includes('is not set') || lower.includes('not configured')) {
    return 'The wallet service is misconfigured. Please contact support.';
  }

  // Fallback.
  return 'Something went wrong sending your transfer. Please try again.';
}
