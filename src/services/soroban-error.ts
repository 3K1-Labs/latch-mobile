/**
 * Turn a Soroban simulation failure into something a person can act on.
 *
 * Every authorization failure reaches the caller as the same outer string —
 * `HostError: Error(Auth, InvalidAction)` — no matter what actually went wrong.
 * The host wraps whatever `__check_auth` returned, so a mismatched proposal, an
 * unregistered key and an unmatured veto window are indistinguishable at the
 * top. The real cause is in the diagnostic event log the RPC returns underneath,
 * which the app was discarding.
 *
 * The log is printed newest-first, so the LAST contract error in the text is the
 * innermost frame — the one that actually failed.
 */

const CONTRACT_ERROR = /Error\(Contract, #(\d+)\)/g;
const CONTRACT_ID = /contract:(C[A-Z2-7]{55})/;

export interface SorobanFailure {
  /** Innermost contract error code, or null when the log named none. */
  code: number | null;
  /** The contract that raised it, when the log attributes it to one. */
  contract: string | null;
  /** First line of the error — always present, even with no event log. */
  headline: string;
}

export function parseSorobanError(raw: unknown): SorobanFailure {
  const text = typeof raw === 'string' ? raw : String(raw ?? '');
  const headline = text.split('\n')[0]?.trim() ?? 'the network rejected this call';

  const matches = [...text.matchAll(CONTRACT_ERROR)];
  const deepest = matches[matches.length - 1];
  if (!deepest) return { code: null, contract: null, headline };

  // The line the deepest error appears on names the contract that raised it.
  const line = text.slice(0, deepest.index).split('\n').pop() ?? '';
  const rest = text.slice(deepest.index).split('\n')[0] ?? '';
  const contract = CONTRACT_ID.exec(line + rest)?.[1] ?? null;

  return { code: Number(deepest[1]), contract, headline };
}

// Verified on testnet rather than read off a header: each of these was produced
// deliberately and the code observed in the event log.
const POLICY_ERRORS: Record<number, string> = {
  6: 'the guardians are not allowed to make this call',
  7: 'there is no recovery request on this account any more',
  8: 'this does not match what the guardians proposed — the key or the target rule differs',
  9: 'the waiting period has not finished yet',
};

const ACCOUNT_ERRORS: Record<number, string> = {
  3000: 'that context rule does not exist on the account',
  3002: 'the account did not accept this signature — the signing key is not registered on the rule it was signed under',
  3007: 'that key is already a signer on the account',
  3014: 'the signature named the wrong number of context rules',
};

/**
 * A one-line cause for the UI. Falls back to the raw headline when the log
 * names no contract error, so nothing is ever swallowed.
 */
export function explainSorobanError(raw: unknown): string {
  const { code, headline } = parseSorobanError(raw);
  if (code === null) return headline;

  const known = code >= 3000 ? ACCOUNT_ERRORS[code] : POLICY_ERRORS[code];
  return known ? `${known} (#${code})` : `${headline} — contract error #${code}`;
}
