/**
 * use-multisig-roster.ts — the live signer roster for a shared (multisig) wallet,
 * read from chain (read-only simulation). Authoritative + fresh: reflects admin
 * changes, unlike the cached multisigSigners on the account. Display-only — never
 * an authorization input (the cosign flow gates on the live on-chain threshold).
 */

import { useQuery } from '@tanstack/react-query';

import { fetchDefaultContextRule, fetchRuleThreshold } from '@/src/api/account-admin';
import {
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { getMySignerKey } from '@/src/lib/cosign-packet-flow';

export interface RosterMember {
  /** Canonical signer key — stable id for rendering. */
  id: string;
  kind: 'ed25519' | 'webauthn' | 'delegated';
  /** Truncated device key (External) or account address (Delegated). */
  display: string;
  /** True for the signer this device holds. */
  isYou: boolean;
}

export interface MultisigRoster {
  members: RosterMember[];
  threshold: number;
  total: number;
}

function simParams() {
  return {
    rpcUrl: STELLAR_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    factoryAddress: STELLAR_FACTORY_ADDRESS,
  };
}

const short = (s: string): string => (s.length > 14 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s);

export function useMultisigRoster(address: string | null | undefined) {
  return useQuery<MultisigRoster>({
    queryKey: ['multisig-roster', address],
    enabled: !!address,
    staleTime: 60_000,
    queryFn: async () => {
      const p = simParams();
      const [rule, myKey] = await Promise.all([
        fetchDefaultContextRule(p, address as string),
        getMySignerKey(),
      ]);

      let threshold = rule.signers.length;
      try {
        const t = await fetchRuleThreshold(p, address as string, rule.ruleId);
        if (Number.isFinite(t) && t >= 1) threshold = t;
      } catch {
        /* no threshold policy read — fall back to signer count */
      }

      const mine = (myKey ?? '').toLowerCase();
      const members: RosterMember[] = rule.signers.map((s) => ({
        id: s.signerKey,
        kind: s.kind,
        display: s.kind === 'delegated' ? short(s.address ?? '') : short(s.keyDataHex),
        isYou: !!s.keyDataHex && s.keyDataHex.toLowerCase() === mine,
      }));

      return { members, threshold, total: rule.signers.length };
    },
  });
}
