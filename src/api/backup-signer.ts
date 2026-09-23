/**
 * backup-signer.ts — client for latch-api's solo backup-signer confirm
 * endpoints:
 *
 *   POST /v1/smart-account/backup-signer/confirm-add
 *   POST /v1/smart-account/backup-signer/confirm-remove
 *
 * These exist because the on-chain add_signer/remove_signer call alone isn't
 * enough to make a backup signer discoverable: a fresh install holding only
 * the backup signer's key needs latch-api's passkey-credentials index (see
 * passkey-credential.ts) to resolve a bare keyDataHex back to this wallet,
 * and that index is only written here — after the chain call has been
 * independently re-verified server-side, never from the client's own read of
 * resultMetaXdr.
 *
 * See docs/discussion-32... / LATCH_MOBILE_BACKUP_SIGNERS.md §5. As of this
 * writing the backend routes described there are not implemented — this
 * client is ready for them but will 404 until latch-api adds the two
 * handlers on the existing `/v1/smart-account` group.
 *
 * Callers must treat a failed confirm-add/confirm-remove as retryable on its
 * own: the on-chain call already succeeded by the time either of these is
 * called, so retrying it again would attempt a duplicate on-chain mutation.
 * Callers persist the pending txHash/contextRuleId onto the account's
 * `Device` record (see `Device.pendingConfirm` in store/wallet.ts) before
 * calling either function, so a killed app can retry from there.
 */

import { API_BASE_URL } from '@/src/constants/api-host';
import { getNetworkId } from '@/src/constants/config';
import { fetchAnyAccessToken } from '@/src/lib/pairing-context';
import { ApiError } from './api-error';

const API_BASE = `${API_BASE_URL}/v1/smart-account/backup-signer`;

// Raw XHR, matching transaction-relay.ts / passkey-credential.ts — see the
// Android TLS note in AGENTS.md.
function xhrPost(path: string, body: object, token: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('POST', `${API_BASE}${path}`, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.setRequestHeader('Authorization', `Bearer ${token}`);
    req.timeout = 30000;
    req.onload = () => {
      try {
        resolve({ status: req.status, body: JSON.parse(req.responseText) });
      } catch {
        resolve({ status: req.status, body: null });
      }
    };
    req.onerror = () => reject(new Error('Network error'));
    req.ontimeout = () => reject(new Error('Request timed out'));
    req.send(JSON.stringify(body));
  });
}

async function authToken(): Promise<string> {
  const token = await fetchAnyAccessToken();
  if (!token) throw new Error('Not signed in to Latch — cannot confirm backup signer');
  return token;
}

export interface ConfirmAddBackupSignerParams {
  smartAccountAddress: string;
  contextRuleId: number;
  /** The new device's on-chain key_data hex — what the confirm call indexes against. */
  keyDataHex: string;
  /** Hash of the succeeded add_signer transaction, for server-side re-verification. */
  txHash: string;
  label: string;
  seq: number;
}

/**
 * Confirm a successful on-chain backup-signer add and get back the
 * authoritative on-chain signer id (the client's own resultMetaXdr read is
 * best-effort — see extractFirstU32FromMeta in admin-tx.ts — this is the
 * source of truth to persist into Device.onChainSignerId).
 */
export async function confirmAddBackupSigner(
  params: ConfirmAddBackupSignerParams,
): Promise<{ signerId: number }> {
  const token = await authToken();
  // The backend Gin handler uses snake_case JSON struct tags — ShouldBindJSON
  // does exact-match, so camelCase keys are silently dropped and the required-
  // field validation fires, returning 400 "invalid request body".
  const res = await xhrPost(
    '/confirm-add',
    {
      network: getNetworkId(),
      smart_account_address: params.smartAccountAddress,
      context_rule_id: params.contextRuleId,
      key_data_hex: params.keyDataHex,
      tx_hash: params.txHash,
      label: params.label,
      seq: params.seq,
    },
    token,
  );
  if (res.status !== 200 || !res.body?.data?.confirmed) {
    throw new ApiError(
      res.body?.error?.message ?? `confirm-add failed (${res.status})`,
      res.body?.error?.code ?? 'CONFIRM_ADD_FAILED',
      res.status,
    );
  }
  return { signerId: res.body.data.signer_id };
}

export interface ConfirmRemoveBackupSignerParams {
  smartAccountAddress: string;
  contextRuleId: number;
  signerId: number;
  keyDataHex: string;
  txHash: string;
}

/** Confirm a successful on-chain backup-signer removal and deregister its credential index row. */
export async function confirmRemoveBackupSigner(
  params: ConfirmRemoveBackupSignerParams,
): Promise<void> {
  const token = await authToken();
  const res = await xhrPost(
    '/confirm-remove',
    {
      network: getNetworkId(),
      smart_account_address: params.smartAccountAddress,
      context_rule_id: params.contextRuleId,
      signer_id: params.signerId,
      key_data_hex: params.keyDataHex,
      tx_hash: params.txHash,
    },
    token,
  );
  if (res.status !== 200 || !res.body?.data?.confirmed) {
    throw new ApiError(
      res.body?.error?.message ?? `confirm-remove failed (${res.status})`,
      res.body?.error?.code ?? 'CONFIRM_REMOVE_FAILED',
      res.status,
    );
  }
}
