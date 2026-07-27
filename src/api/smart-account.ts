/**
 * Smart account API service.
 *
 * Handles deploying and looking up Soroban smart accounts directly via
 * the Soroban RPC. Bundler signing, simulation, and polling all run client-side.
 *
 * Ed25519 path (mobile seed wallet):
 *   deploySmartAccount(publicKeyHex)
 *   lookupSmartAccount(publicKeyHex)
 *
 * Freighter / delegated G-address path:
 *   deploySmartAccountForGAddress(gAddress)
 *   lookupSmartAccountByGAddress(gAddress)
 *
 * ⚠️  SECURITY NOTE — EXPO_PUBLIC_BUNDLER_SECRET / EXPO_PUBLIC_BUNDLER_SECRET_MAINNET
 * EXPO_PUBLIC_* variables are baked into the JS bundle at build time and are
 * readable by anyone who extracts the APK/IPA. The bundler keypair should be
 * moved server-side (a backend endpoint that receives { publicKeyHex } and
 * returns { smartAccountAddress }) before shipping either network build.
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

import { AccountSigner, encodeAccountInitParams } from '@/src/lib/account-signers';
import {
  ACTIVE_NETWORK,
  HORIZON_URL,
  STELLAR_BUNDLER_SECRET,
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

function extractAddressFromMeta(resultMetaXdr: string): string | undefined {
  try {
    const meta = xdr.TransactionMeta.fromXDR(resultMetaXdr, 'base64');
    const arm = (meta as any).arm(); // SDK types don't reflect v4 meta changes yet
    let sorobanMeta: any;
    if (arm === 'v3') sorobanMeta = meta.v3().sorobanMeta();
    else if (arm === 'v4') sorobanMeta = (meta as any).v4().sorobanMeta();
    if (sorobanMeta) return scValToNative(sorobanMeta.returnValue());
  } catch (e) {
    if (__DEV__) console.warn('Could not parse address from resultMetaXdr:', e);
  }
  return undefined;
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
  bundlerSecret: STELLAR_BUNDLER_SECRET,
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

// rpc.Server.getAccount() uses getLedgerEntries on the Soroban RPC, which can
// return empty even when the account exists. Horizon is authoritative for sequence.
async function getAccountFromHorizon(publicKey: string): Promise<Account> {
  const response = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
  if (!response.ok) throw new Error(`Account not found: ${publicKey}`);
  const data = await response.json();
  return new Account(publicKey, data.sequence);
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

    if (__DEV__) console.log(`Deploying smart account for pubkey: ${publicKeyHex}`);

    const config = getActiveNetworkConfig();

    if (!config.bundlerSecret) {
      throw new Error(
        `Missing bundler secret for ${ACTIVE_NETWORK.networkName} (EXPO_PUBLIC_BUNDLER_SECRET${ACTIVE_NETWORK.network === 'PUBLIC' ? '_MAINNET' : ''}).`,
      );
    }
    if (!config.factoryAddress) {
      throw new Error(
        `Missing factory address for ${ACTIVE_NETWORK.networkName} (EXPO_PUBLIC_FACTORY_ADDRESS${ACTIVE_NETWORK.network === 'PUBLIC' ? '_MAINNET' : ''}).`,
      );
    }

    const bundlerKeypair = Keypair.fromSecret(config.bundlerSecret);
    const salt = await deriveSalt(publicKeyHex);
    const paramsMap = buildParamsMap(publicKeyHex, salt);
    const contract = new Contract(config.factoryAddress);
    const bundlerAccount = await getAccountFromHorizon(bundlerKeypair.publicKey());

    let smartAccountAddress = '';

    const deployTx = new TransactionBuilder(bundlerAccount, {
      fee: '1500000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(contract.call('create_account', paramsMap))
      .setTimeout(300)
      .build();

    if (__DEV__) console.log('Simulating factory create_account...');
    const rawSim = await sorobanCall(config.rpcUrl, 'simulateTransaction', {
      transaction: txToBase64(deployTx),
    });
    if (rawSim.error) throw new Error(`Factory deployment simulation failed: ${rawSim.error}`);

    try {
      smartAccountAddress = scValToNative(
        xdr.ScVal.fromXDR(rawSim.results?.[0]?.retval || 'AAAAAA==', 'base64'),
      );
      if (__DEV__) console.log(`Simulation preview. Predicted Account: ${smartAccountAddress}`);
    } catch {
      if (__DEV__)
        console.log('Could not pre-read address from simulation — will parse from settled tx.');
    }

    const assembledTx = rpc.assembleTransaction(deployTx, parseSimResult(rawSim)).build();
    assembledTx.sign(bundlerKeypair);

    const sendRaw = await sorobanCall(config.rpcUrl, 'sendTransaction', {
      transaction: txToBase64(assembledTx),
    });

    if (sendRaw.status === 'ERROR') {
      throw new Error(
        `Factory deployment failed: ${sendRaw.errorResultXdr ?? JSON.stringify(sendRaw)}`,
      );
    }

    const txHash: string = sendRaw.hash;
    let finalStatus: string | undefined;
    let returnValueXdr: string | undefined;

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await sorobanCall(config.rpcUrl, 'getTransaction', { hash: txHash });
      finalStatus = poll.status;
      if (poll.status !== 'NOT_FOUND') {
        returnValueXdr = poll.resultMetaXdr;
        break;
      }
    }

    if (!finalStatus) throw new Error('Transaction not found after polling');

    if (finalStatus === 'SUCCESS') {
      if (returnValueXdr) {
        smartAccountAddress = extractAddressFromMeta(returnValueXdr) ?? '';
      }
      if (!smartAccountAddress) {
        throw new Error('Transaction settled but could not extract smart account address');
      }
      if (__DEV__) console.log(`Deployment successful via factory: ${smartAccountAddress}`);
    } else {
      throw new Error(`Factory deployment transaction status: ${finalStatus}`);
    }

    deploymentCache.set(publicKeyHex, { smartAccountAddress, gAddress: userGAddress });

    return {
      smartAccountAddress,
      gAddress: userGAddress,
      factoryAddress: config.factoryAddress,
      alreadyDeployed: false,
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
 * Deploy a smart account using a Stellar G-address as a delegated signer.
 *
 * @param gAddress  Stellar G-address (e.g., "GABC...")
 */
export async function deploySmartAccountForGAddress(gAddress: string): Promise<DeployResult> {
  try {
    if (!gAddress || !StrKey.isValidEd25519PublicKey(gAddress)) {
      return { smartAccountAddress: '', gAddress: '', alreadyDeployed: false };
    }

    const cached = deploymentCache.get(gAddress);
    if (cached) {
      return { smartAccountAddress: cached.smartAccountAddress, alreadyDeployed: true };
    }

    await fundAccountIfNeeded(gAddress);

    const cfg = getActiveNetworkConfig();
    const bundlerKeypair = Keypair.fromSecret(cfg.bundlerSecret || '');
    const salt = await deriveSalt(gAddress);
    const paramsMap = buildParamsMap(gAddress, salt);
    const factory = new Contract(cfg.factoryAddress || '');

    const predictedAddress = await predictAddress(
      cfg.rpcUrl,
      cfg.networkPassphrase,
      cfg.factoryAddress || '',
      paramsMap,
    );

    const bundlerAccount = await getAccountFromHorizon(bundlerKeypair.publicKey());

    const createTx = new TransactionBuilder(bundlerAccount, {
      fee: '1500000',
      networkPassphrase: cfg.networkPassphrase,
    })
      .addOperation(factory.call('create_account', paramsMap))
      .setTimeout(300)
      .build();

    const rawSim = await sorobanCall(cfg.rpcUrl, 'simulateTransaction', {
      transaction: txToBase64(createTx),
    });
    if (rawSim.error) throw new Error(`create_account simulation failed: ${rawSim.error}`);

    const assembled = rpc.assembleTransaction(createTx, parseSimResult(rawSim)).build();
    assembled.sign(bundlerKeypair);

    const sendRaw = await sorobanCall(cfg.rpcUrl, 'sendTransaction', {
      transaction: txToBase64(assembled),
    });
    if (sendRaw.status === 'ERROR') {
      throw new Error(
        `Factory create_account failed: ${sendRaw.errorResultXdr ?? JSON.stringify(sendRaw)}`,
      );
    }

    let smartAccountAddress: string | undefined;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const poll = await sorobanCall(cfg.rpcUrl, 'getTransaction', { hash: sendRaw.hash });
      if (poll.status === 'NOT_FOUND') continue;
      if (poll.status === 'SUCCESS') {
        if (poll.resultMetaXdr) smartAccountAddress = extractAddressFromMeta(poll.resultMetaXdr);
        break;
      }
      throw new Error(`Factory deployment failed with status: ${poll.status}`);
    }

    if (!smartAccountAddress) smartAccountAddress = predictedAddress;
    if (smartAccountAddress !== predictedAddress) {
      throw new Error(
        `Address mismatch: predicted=${predictedAddress} actual=${smartAccountAddress}`,
      );
    }

    deploymentCache.set(gAddress, { smartAccountAddress });
    return { smartAccountAddress, alreadyDeployed: false };
  } catch (error) {
    console.error('Freighter account deploy error:', error);
    return { smartAccountAddress: '', gAddress: '', alreadyDeployed: false };
  }
}

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

  const config = getActiveNetworkConfig();
  if (!config.bundlerSecret) {
    throw new Error(`Missing bundler secret for ${ACTIVE_NETWORK.networkName}.`);
  }
  if (!config.factoryAddress) {
    throw new Error(`Missing factory address for ${ACTIVE_NETWORK.networkName}.`);
  }

  const canonicalSigners = sortSignersCanonical(signers);
  // Fresh nonce per deploy so the same signer set can open multiple distinct
  // wallets (distinct salt → distinct C-address).
  const nonceHex = generateMultisigNonce();
  const salt = deriveMultisigSalt({ signers: canonicalSigners, threshold, nonceHex });
  const paramsMap = encodeAccountInitParams({
    signers: canonicalSigners,
    threshold,
    salt,
  });

  const bundlerKeypair = Keypair.fromSecret(config.bundlerSecret);
  const contract = new Contract(config.factoryAddress);
  const bundlerAccount = await getAccountFromHorizon(bundlerKeypair.publicKey());

  const deployTx = new TransactionBuilder(bundlerAccount, {
    fee: '2000000',
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call('create_account', paramsMap))
    .setTimeout(300)
    .build();

  const rawSim = await sorobanCall(config.rpcUrl, 'simulateTransaction', {
    transaction: txToBase64(deployTx),
  });
  console.log({ error: rawSim.error });
  if (rawSim.error) throw new Error(`multisig deploy simulation failed: ${rawSim.error}`);

  let predicted = '';
  try {
    predicted = scValToNative(
      xdr.ScVal.fromXDR(rawSim.results?.[0]?.retval || 'AAAAAA==', 'base64'),
    );
  } catch {
    /* best-effort; final address comes from settled tx */
  }

  const assembled = rpc.assembleTransaction(deployTx, parseSimResult(rawSim)).build();
  assembled.sign(bundlerKeypair);

  const sendRaw = await sorobanCall(config.rpcUrl, 'sendTransaction', {
    transaction: txToBase64(assembled),
  });
  if (sendRaw.status === 'ERROR') {
    throw new Error(
      `multisig deploy send failed: ${sendRaw.errorResultXdr ?? JSON.stringify(sendRaw)}`,
    );
  }

  const txHash: string = sendRaw.hash;
  let finalStatus: string | undefined;
  let returnMeta: string | undefined;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await sorobanCall(config.rpcUrl, 'getTransaction', { hash: txHash });
    finalStatus = poll.status;
    if (poll.status !== 'NOT_FOUND') {
      returnMeta = poll.resultMetaXdr;
      break;
    }
  }
  if (finalStatus !== 'SUCCESS') {
    throw new Error(`multisig deploy status: ${finalStatus}`);
  }

  const smartAccountAddress = (returnMeta && extractAddressFromMeta(returnMeta)) || predicted;
  if (!smartAccountAddress) {
    throw new Error('multisig deploy succeeded but could not read account address');
  }

  return {
    smartAccountAddress,
    alreadyDeployed: false,
    factoryAddress: config.factoryAddress,
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
