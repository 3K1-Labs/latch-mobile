/**
 * tx-diagnostics.ts — resolve "why did __check_auth reject my signature?"
 *
 * When a transfer fails with an authentication error (Error(Auth,
 * InvalidAction) / Error(Contract, #3016)) even though the device produced a
 * locally-valid signature, the cause is almost always that the signer the
 * device presents is NOT registered on the account's context rule. That
 * happens when:
 *   - the account is a shared (multisig) wallet whose rule holds `delegated`
 *     member signers, not this device's webauthn/ed25519 key, OR
 *   - the device's passkey/key drifted from what the account was deployed
 *     with (the local keyPairMatch check can't catch this — it only compares
 *     the device's own private↔public key, never the on-chain registration).
 *
 * `diagnoseAuthFailure` reads the account's real signers off-chain via
 * read-only simulation and compares them to what the device presented, so we
 * can tell the user exactly which case they're in instead of guessing.
 */

import { fetchDefaultContextRule } from '@/src/api/account-admin';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';

export type AuthFailureKind =
  | 'multisig' // rule holds delegated signers — needs the cosign flow, not single-device signing
  | 'key-drift' // account expects a webauthn/ed25519 key that isn't this device's current one
  | 'unknown'; // couldn't read the rule

export interface AuthFailureDiagnosis {
  kind: AuthFailureKind;
  /** True if the presented key_data matches a registered signer on the default rule. */
  presentedKeyRegistered: boolean;
  /** Decoded registered signers, summarized for logging. */
  registered: { kind: string; keyDataHex?: string; address?: string }[];
}

function looksLikeAuthFailure(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('failed account authentication') ||
    m.includes('invalidaction') ||
    m.includes('#3016') ||
    /error\(contract, #301[0-9]\)/.test(m)
  );
}

/** Whether `err` is the kind of failure worth running the on-chain diagnosis for. */
export function isAuthFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return looksLikeAuthFailure(msg);
}

/**
 * Read the account's default context-rule signers and classify why auth
 * failed. `presentedKeyDataHex` is the device's current key_data (passkey
 * webauthn key_data or ed25519 pubkey hex) that was just rejected.
 */
export async function diagnoseAuthFailure(
  accountAddress: string,
  presentedKeyDataHex: string | null,
): Promise<AuthFailureDiagnosis> {
  const factoryAddress = STELLAR_FACTORY_ADDRESS;
  if (!factoryAddress) {
    return { kind: 'unknown', presentedKeyRegistered: false, registered: [] };
  }

  try {
    const rule = await fetchDefaultContextRule(
      { rpcUrl: STELLAR_RPC_URL, networkPassphrase: STELLAR_NETWORK_PASSPHRASE, factoryAddress },
      accountAddress,
    );

    const registered = rule.signers.map((s) => ({
      kind: s.kind,
      keyDataHex: s.keyDataHex || undefined,
      address: s.address,
    }));

    if (__DEV__) {
      console.log('[tx-diagnostics] account', accountAddress, 'rule', rule.ruleId, 'signers:');
      registered.forEach((s, i) =>
        console.log(`  [${i}] ${s.kind}`, s.address ?? s.keyDataHex ?? '(none)'),
      );
      console.log('[tx-diagnostics] device presented key_data:', presentedKeyDataHex ?? '(none)');
    }

    const hasDelegated = rule.signers.some((s) => s.kind === 'delegated');
    const presentedKeyRegistered = Boolean(
      presentedKeyDataHex &&
        rule.signers.some(
          (s) => s.keyDataHex && s.keyDataHex.toLowerCase() === presentedKeyDataHex.toLowerCase(),
        ),
    );

    let kind: AuthFailureKind;
    if (presentedKeyRegistered) {
      // Device key IS registered but auth still failed — not a registration
      // problem (threshold/rule-id/expiration). Report unknown so we don't
      // mislead with a re-init prompt.
      kind = 'unknown';
    } else if (hasDelegated) {
      kind = 'multisig';
    } else {
      kind = 'key-drift';
    }

    if (__DEV__) {
      console.log('[tx-diagnostics] verdict:', { kind, presentedKeyRegistered, hasDelegated });
    }

    return { kind, presentedKeyRegistered, registered };
  } catch (err) {
    if (__DEV__) console.log('[tx-diagnostics] could not read on-chain rule:', err);
    return { kind: 'unknown', presentedKeyRegistered: false, registered: [] };
  }
}
