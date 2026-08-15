/**
 * Smart account API service.
 *
 * Address prediction and lookups run client-side against the Soroban RPC.
 * Deployment goes through latch-api, which owns the bundler keypair — see
 * src/api/smart-account-deploy.ts.
 *
 * Ed25519 path (mobile seed wallet):
 *   deploySmartAccount(publicKeyHex)
 *   lookupSmartAccount(publicKeyHex)
 *
 * Freighter / delegated G-address path:
 *   lookupSmartAccountByGAddress(gAddress)
 *
 */

import {
  Account,
  Address,
  Contract,
  Keypair,
  rpc,
  scValToNative,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import QuickCrypto from 'react-native-quick-crypto';

import { deployMultisigAccount, deploySeedWalletAccount } from '@/src/api/smart-account-deploy';
import { AccountSigner, encodeAccountInitParams } from '@/src/lib/account-signers';
import {
  ACTIVE_NETWORK,
  HORIZON_URL,
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import {
  deriveMultisigSalt,
  generateMultisigNonce,
  sortSignersCanonical,
} from '@/src/lib/multisig-address';

// ─── XHR-based JSON-RPC ───────────────────────────────────────────────────────
// The stellar SDK uses Axios internally, which fails with "Network Error" on
// Android because the bundled Axios doesn't go through the platform TLS stack.
// Using XMLHttpRequest directly routes through OkHttp and respects the
// network_security_config.xml trust anchors.

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function txToBase64(tx: { toEnvelope(): { toXDR(): Uint8Array } }): string {
  return toBase64(new Uint8Array(tx.toEnvelope().toXDR()));
}

export function ledgerKeyToBase64(key: xdr.LedgerKey): string {
  return toBase64(new Uint8Array(key.toXDR()));
}

export function sorobanCall(rpcUrl: string, method: string, params: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', rpcUrl, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 60000;
    xhr.onload = function () {
      try {
        const json = JSON.parse(xhr.responseText);
        if (json.error) {
          reject(new Error(`${method}: ${json.error.message ?? JSON.stringify(json.error)}`));
        } else {
          resolve(json.result);
        }
      } catch {
        reject(new Error(`${method}: parse error (status=${xhr.status})`));
      }
    };
    xhr.onerror = function () {
      reject(new Error(`${method}: network error (status=${xhr.status})`));
    };
    xhr.ontimeout = function () {
      reject(new Error(`${method}: timed out`));
    };
    xhr.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}


export function parseSimResult(raw: any): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    // _parsed: true tells rpc.assembleTransaction's internal parseRawSimulation to skip
    // re-parsing. Without it, the SDK calls fromXDR(xdrObject, 'base64') on already-decoded
    // auth entries, which passes a plain object to Buffer.from and throws "Received type object".
    _parsed: true,
    id: String(raw.id ?? '1'),
    latestLedger: raw.latestLedger,
    minResourceFee: raw.minResourceFee,
    // assembleTransaction calls success.transactionData.build(), so this must be a
    // SorobanDataBuilder, not a raw xdr.SorobanTransactionData.
    transactionData: new SorobanDataBuilder(raw.transactionData),
    cost: raw.cost ?? { cpuInsns: '0', memBytes: '0' },
    events: [],
    result: {
      auth: (raw.results?.[0]?.auth ?? []).map((a: string) =>
        xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64'),
      ),
      retval: (() => {
        try {
          return xdr.ScVal.fromXDR(raw.results?.[0]?.retval || 'AAAAAA==', 'base64');
        } catch {
          return xdr.ScVal.scvVoid();
        }
      })(),
    },
  } as unknown as rpc.Api.SimulateTransactionSuccessResponse;
}

// Reads live off ACTIVE_NETWORK (src/constants/config.ts) on every call, not
// module-top-level, so it follows switchActiveNetwork() without a restart.
const getActiveNetworkConfig = () => ({
  rpcUrl: STELLAR_RPC_URL,
  networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  factoryAddress: STELLAR_FACTORY_ADDRESS,
});

// ─── Unified deployment cache ─────────────────────────────────────────────────
// Keyed by publicKeyHex (Ed25519 path) or G-address (Freighter path).
const deploymentCache = new Map<string, { smartAccountAddress: string; gAddress?: string }>();

async function deriveSalt(input: string): Promise<Buffer> {
  const SMART_ACCOUNT_VERSION = 'factory-v2';
  const saltHex = QuickCrypto.createHash('sha256')
    .update(input + SMART_ACCOUNT_VERSION)
    .digest('hex');
  return Buffer.from(saltHex, 'hex');
}

// Builds the AccountInitParams ScVal map for a single-Ed25519-signer deploy
// (the historical default for mobile seed wallets). Multi-signer deploys go
// through encodeAccountInitParams directly.
function buildParamsMap(publicKeyHex: string, salt: Buffer): xdr.ScVal {
  return encodeAccountInitParams({
    signers: [{ kind: 'ed25519', publicKeyHex }],
    salt,
  });
}

/**
 * Build AccountInitParams for an arbitrary signer set. Caller is responsible
 * for picking a salt that uniquely identifies the account (the factory uses
 * salt + signer set to derive the deterministic C-address). Exposed for
 * future multi-signer deploys; existing single-signer paths continue to use
 * `buildParamsMap`.
 */
export function buildMultiSignerParamsMap(
  signers: AccountSigner[],
  threshold: number | undefined,
  salt: Buffer,
): xdr.ScVal {
  return encodeAccountInitParams({ signers, threshold, salt });
}

function deriveGAddressFromPubkey(pubkeyHex: string): string {
  try {
    return StrKey.encodeEd25519PublicKey(Buffer.from(pubkeyHex, 'hex'));
  } catch (err) {
    throw new Error(
      `Failed to derive G-address from pubkey: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function fundAccountIfNeeded(gAddress: string): Promise<void> {
  try {
    const horizonResponse = await fetch(`${HORIZON_URL}/accounts/${gAddress}`);
    if (horizonResponse.ok) return;
  } catch {}

  // Friendbot only exists on testnet — on mainnet an unfunded account means
  // the user hasn't sent it XLM yet (e.g. via the onramp), which we can't
  // paper over here.
  if (ACTIVE_NETWORK.network !== 'TESTNET') {
    throw new Error(`Account ${gAddress} is not funded and Friendbot is unavailable on mainnet.`);
  }

  if (__DEV__) console.log(`Funding account ${gAddress} via Friendbot...`);
  const response = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(gAddress)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to fund account: ${response.statusText}`);
  }
}



async function predictAddress(
  rpcUrl: string,
  networkPassphrase: string,
  factoryAddress: string,
  paramsMap: xdr.ScVal,
): Promise<string> {
  const dummyKp = Keypair.random();
  const dummyAccount = new Account(dummyKp.publicKey(), '0');
  const factory = new Contract(factoryAddress);

  const tx = new TransactionBuilder(dummyAccount, { fee: '100', networkPassphrase })
    .addOperation(factory.call('get_account_address', paramsMap))
    .setTimeout(30)
    .build();

  const raw = await sorobanCall(rpcUrl, 'simulateTransaction', { transaction: txToBase64(tx) });
  if (raw.error) throw new Error(`get_account_address simulation failed: ${raw.error}`);

  const retval = xdr.ScVal.fromXDR(raw.results?.[0]?.retval ?? 'AAAAAA==', 'base64');
  return scValToNative(retval);
}

export interface DeployResult {
  smartAccountAddress: string;
  gAddress?: string;
  factoryAddress?: string;
  alreadyDeployed: boolean;
}

export interface LookupResult {
  deployed: boolean;
  smartAccountAddress: string;
}

// ─── Ed25519 (seed-wallet) path ───────────────────────────────────────────────

/**
 * Deploy a smart account using an Ed25519 public key from the seed wallet.
 *
 * @param publicKeyHex  64-char hex string — the raw Ed25519 public key
 */
export async function deploySmartAccount(
  publicKeyHex: string,
  { skipFunding = false }: { skipFunding?: boolean } = {},
): Promise<DeployResult> {
  try {
    const userGAddress = deriveGAddressFromPubkey(publicKeyHex);

    const cached = deploymentCache.get(publicKeyHex);
    if (cached) {
      return {
        smartAccountAddress: cached.smartAccountAddress,
        gAddress: cached.gAddress,
        alreadyDeployed: true,
      };
    }

    if (!skipFunding) await fundAccountIfNeeded(userGAddress);

    // The bundler signs and pays for this on the server; the app proves it
    // holds `publicKeyHex` rather than holding the bundler key itself.
    const { smartAccountAddress, alreadyDeployed } = await deploySeedWalletAccount(publicKeyHex);

    deploymentCache.set(publicKeyHex, { smartAccountAddress, gAddress: userGAddress });

    return {
      smartAccountAddress,
      gAddress: userGAddress,
      factoryAddress: getActiveNetworkConfig().factoryAddress,
      alreadyDeployed,
    };
  } catch (error) {
    console.error('Error creating via factory:', error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Look up whether a smart account already exists for the given Ed25519 public key.
 *
 * @param publicKeyHex  64-char hex string — the raw Ed25519 public key
 */
export async function lookupSmartAccount(publicKeyHex: string): Promise<LookupResult> {
  try {
    if (!publicKeyHex || publicKeyHex.length !== 64) {
      throw new Error('Missing or invalid pubkey query param (expected 64-char hex).');
    }

    const config = getActiveNetworkConfig();
    if (!config.factoryAddress) {
      return { deployed: false, smartAccountAddress: '' };
    }

    const cached = deploymentCache.get(publicKeyHex);
    if (cached) {
      return { deployed: true, smartAccountAddress: cached.smartAccountAddress };
    }

    const salt = await deriveSalt(publicKeyHex);
    const params = buildParamsMap(publicKeyHex, salt);
    const predictedAddress = await predictAddress(
      config.rpcUrl,
      config.networkPassphrase,
      config.factoryAddress,
      params,
    );

    const instanceLedgerKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(predictedAddress).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );

    const raw = await sorobanCall(config.rpcUrl, 'getLedgerEntries', {
      keys: [ledgerKeyToBase64(instanceLedgerKey)],
    });
    const deployed = (raw.entries ?? []).length > 0;

    if (deployed) {
      const gAddress = deriveGAddressFromPubkey(publicKeyHex);
      deploymentCache.set(publicKeyHex, { smartAccountAddress: predictedAddress, gAddress });
    }

    return { deployed, smartAccountAddress: predictedAddress };
  } catch (error) {
    console.error('Error looking up smart account:', error);
    return { deployed: false, smartAccountAddress: '' };
  }
}

// ─── G-address / Freighter (delegated) path ───────────────────────────────────

/**
 * Look up whether a smart account already exists for the given G-address.
 *
 * @param gAddress  Stellar G-address
 */
export async function lookupSmartAccountByGAddress(gAddress: string): Promise<LookupResult> {
  try {
    if (!gAddress || !StrKey.isValidEd25519PublicKey(gAddress)) {
      return { deployed: false, smartAccountAddress: '' };
    }

    const cached = deploymentCache.get(gAddress);
    if (cached) {
      return { deployed: true, smartAccountAddress: cached.smartAccountAddress };
    }

    const config = getActiveNetworkConfig();
    if (!config.factoryAddress) {
      return { deployed: false, smartAccountAddress: '' };
    }

    const salt = await deriveSalt(gAddress);
    const paramsMap = buildParamsMap(gAddress, salt);
    const predictedAddress = await predictAddress(
      config.rpcUrl,
      config.networkPassphrase,
      config.factoryAddress,
      paramsMap,
    );

    const instanceKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: new Address(predictedAddress).toScAddress(),
        key: xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: xdr.ContractDataDurability.persistent(),
      }),
    );
    const raw = await sorobanCall(config.rpcUrl, 'getLedgerEntries', {
      keys: [ledgerKeyToBase64(instanceKey)],
    });
    const deployed = (raw.entries?.length ?? 0) > 0;
    if (deployed) deploymentCache.set(gAddress, { smartAccountAddress: predictedAddress });

    return { deployed, smartAccountAddress: predictedAddress };
  } catch (error) {
    console.error('Freighter account lookup error:', error);
    return { deployed: false, smartAccountAddress: '' };
  }
}

// ─── Multi-signer (at-deploy multisig) path ──────────────────────────────────

export interface MultiSigDeployResult extends DeployResult {
  /** The N signers actually deployed, sorted canonically. */
  signers: AccountSigner[];
  /** Threshold the rule was deployed with. */
  threshold: number;
  /** Per-wallet uniqueness nonce (hex) folded into the deploy salt. */
  nonceHex: string;
}

/**
 * Deploy a smart account with N≥2 signers + a chosen threshold in a
 * single factory call. The salt is derived deterministically from the
 * (signer set, threshold) pair so every participating device can
 * predict the resulting C-address without coordination.
 *
 * Used by the onboarding-time multisig flow — see Phase P3 in
 * docs/multisig-build-plan.md.
 *
 * For incremental "upgrade single→multisig" use the existing
 * `deploySmartAccount` + `account-admin.addContextRuleOp` path instead.
 */
export async function deployMultiSigSmartAccount(
  signers: AccountSigner[],
  threshold: number,
): Promise<MultiSigDeployResult> {
  if (signers.length < 2) {
    throw new Error(
      'deployMultiSigSmartAccount: requires ≥ 2 signers; use deploySmartAccount for single-signer',
    );
  }
  if (threshold < 1 || threshold > signers.length) {
    throw new Error(
      `deployMultiSigSmartAccount: threshold ${threshold} out of range for ${signers.length} signers`,
    );
  }

  const canonicalSigners = sortSignersCanonical(signers);
  // Fresh nonce per deploy so the same signer set can open multiple distinct
  // wallets (distinct salt → distinct C-address).
  const nonceHex = generateMultisigNonce();
  const salt = deriveMultisigSalt({ signers: canonicalSigners, threshold, nonceHex });

  // Signer order and salt are computed here and sent verbatim: every
  // participating device derives the same pair and so predicts the same
  // C-address without coordination. The server must not re-derive either.
  const { smartAccountAddress, alreadyDeployed } = await deployMultisigAccount(
    canonicalSigners,
    threshold,
    salt.toString('hex'),
  );

  return {
    smartAccountAddress,
    alreadyDeployed,
    factoryAddress: getActiveNetworkConfig().factoryAddress,
    signers: canonicalSigners,
    threshold,
    nonceHex,
  };
}

/**
 * Predict the C-address a (signer set, threshold) pair would deploy to,
 * without touching the chain except via the read-only factory simulation.
 *
 * Use this on the joiner side during onboarding so each joiner can
 * monitor + interact with the smart account before the initiator deploys.
 */
export async function predictMultiSigAddress(
  signers: AccountSigner[],
  threshold: number,
  nonceHex?: string,
): Promise<string> {
  if (signers.length < 1) throw new Error('predictMultiSigAddress: at least one signer required');
  const config = getActiveNetworkConfig();
  if (!config.factoryAddress) throw new Error(`Missing factory address for ${ACTIVE_NETWORK.networkName}.`);

  const canonicalSigners = sortSignersCanonical(signers);
  const salt = deriveMultisigSalt({ signers: canonicalSigners, threshold, nonceHex });
  const paramsMap = encodeAccountInitParams({
    signers: canonicalSigners,
    threshold,
    salt,
  });
  return predictAddress(config.rpcUrl, config.networkPassphrase, config.factoryAddress, paramsMap);
}
