/**
 * transaction-build.ts — `/v1/transaction/build-send` and `build-swap`.
 *
 * These replace the phone-side build + simulate step for sends and swaps
 * (issue #91 / latch-api#124, "FeeForwarder phase B"): latch-api builds the
 * `forward()`-wrapped invocation, simulates it, and returns the unsigned auth
 * entries plus everything needed to sign one of them. The phone only signs —
 * see signSmartAccountAuthEntryFromDigest / signPasskeyAuthEntryFromDigest in
 * src/services/send-token.ts — and submits via submitBuiltTransaction.
 *
 * Transport is raw XHR, not Axios — see the Android TLS note in AGENTS.md.
 */

import { getNetworkId } from '@/src/constants/config';
import { apiBaseUrl } from '@/src/constants/api-host';
import { SECURE_KEYS, useWalletStore, type WalletAccount } from '@/src/store/wallet';
import { ensureWalletSession, getWalletSessionWithoutSignIn } from '@/src/lib/wallet-auth';
import * as SecureStore from 'expo-secure-store';

const API_PATH = '/v1/transaction';

/** The five fee-related error codes latch-api documents for build-* and submit. */
export type TransactionBuildErrorCode =
  | 'INSUFFICIENT_FEE_BALANCE'
  | 'FEE_QUOTE_STALE'
  | 'FEE_RULE_NOT_FOUND'
  | 'TOO_MANY_FAILED_TRANSACTIONS'
  | 'BAD_GATEWAY'
  | 'UNKNOWN';

export class TransactionBuildError extends Error {
  code: TransactionBuildErrorCode;
  status: number;
  constructor(message: string, code: TransactionBuildErrorCode, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export interface NetworkFee {
  token: string;
  symbol: string;
  maxAmount: string;
  maxAmountRaw: string;
}

export interface BuiltTransaction {
  txXdr: string;
  /** Unsigned Soroban auth entries (base64 XDR), one of which the caller must sign. */
  authEntries: string[];
  /** Index into authEntries of the smart account's own entry — the one to sign. */
  smartAccountAuthEntryIndex: number;
  /** One rule id per auth context in that entry, in the order __check_auth expects. */
  contextRuleIds: number[];
  /** sha256(payloadHash || contextRuleIds) — what the signer actually signs. */
  authDigestHex: string;
  validUntilLedger: number;
  networkFee: NetworkFee;
}

export type SignerType = 'passkey' | 'ed25519' | 'freighter';

export interface BuildSendParams {
  smartAccountAddress: string;
  signerType: SignerType;
  signerG?: string;
  keyDataHex?: string;
  assetId?: string;
  contractId?: string;
  recipient: string;
  amount: string;
}

export interface BuildSwapParams {
  smartAccountAddress: string;
  signerType: SignerType;
  signerG?: string;
  keyDataHex?: string;
  swapChainXdr: string;
  tokenInContractId: string;
  amountInRaw: string;
  amountOutMinRaw: string;
  routerContractId?: string;
}

function activeWalletAccount(): WalletAccount | undefined {
  const { accounts, activeAccountIndex } = useWalletStore.getState();
  return accounts[activeAccountIndex];
}

/** Mirrors transaction-relay.ts's accessToken — same token precedence. */
async function accessToken(): Promise<string> {
  const emailToken = await SecureStore.getItemAsync(SECURE_KEYS.ACCESS_TOKEN);
  if (emailToken) return emailToken;

  const account = activeWalletAccount();
  const walletToken = account
    ? await ensureWalletSession(account)
    : await getWalletSessionWithoutSignIn();
  if (!walletToken) throw new Error('Not authenticated');
  return walletToken;
}

function errorCodeFromBody(body: any): TransactionBuildErrorCode {
  const code = body?.error?.code;
  if (
    code === 'INSUFFICIENT_FEE_BALANCE' ||
    code === 'FEE_QUOTE_STALE' ||
    code === 'FEE_RULE_NOT_FOUND' ||
    code === 'TOO_MANY_FAILED_TRANSACTIONS' ||
    code === 'BAD_GATEWAY'
  ) {
    return code;
  }
  return 'UNKNOWN';
}

function xhrPost(path: string, body: object, token: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('POST', `${apiBaseUrl()}${API_PATH}${path}`, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.setRequestHeader('Authorization', `Bearer ${token}`);
    // The server simulates the forward()-wrapped call before replying.
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

function parseBuiltTransaction(body: any): BuiltTransaction {
  const data = body?.data;
  return {
    txXdr: data.tx_xdr,
    authEntries: data.auth_entries,
    smartAccountAuthEntryIndex: data.smart_account_auth_entry_index,
    contextRuleIds: data.context_rule_ids,
    authDigestHex: data.auth_digest_hex,
    validUntilLedger: data.valid_until_ledger,
    networkFee: {
      token: data.network_fee.token,
      symbol: data.network_fee.symbol,
      maxAmount: data.network_fee.max_amount,
      maxAmountRaw: data.network_fee.max_amount_raw,
    },
  };
}

async function postBuild(path: string, body: object): Promise<BuiltTransaction> {
  const token = await accessToken();
  const res = await xhrPost(path, { ...body, network: getNetworkId() }, token);

  if (res.status !== 200 || !res.body?.data) {
    throw new TransactionBuildError(
      res.body?.error?.message ?? `build request failed (${res.status})`,
      errorCodeFromBody(res.body),
      res.status,
    );
  }
  return parseBuiltTransaction(res.body);
}

export function buildSend(params: BuildSendParams): Promise<BuiltTransaction> {
  return postBuild('/build-send', {
    smart_account_address: params.smartAccountAddress,
    signer_type: params.signerType,
    signer_g: params.signerG,
    key_data_hex: params.keyDataHex,
    asset_id: params.assetId,
    contract_id: params.contractId,
    recipient: params.recipient,
    amount: params.amount,
  });
}

export function buildSwap(params: BuildSwapParams): Promise<BuiltTransaction> {
  return postBuild('/build-swap', {
    smart_account_address: params.smartAccountAddress,
    signer_type: params.signerType,
    signer_g: params.signerG,
    key_data_hex: params.keyDataHex,
    swap_chain_xdr: params.swapChainXdr,
    token_in_contract_id: params.tokenInContractId,
    amount_in_raw: params.amountInRaw,
    amount_out_min_raw: params.amountOutMinRaw,
    router_contract_id: params.routerContractId,
  });
}
