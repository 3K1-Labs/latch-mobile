import { parseSimResult, sorobanCall, toBase64, txToBase64 } from '@/src/api/smart-account';
import { bundlerAddress, submitViaBundler } from '@/src/api/transaction-relay';
import {
  HORIZON_URL,
  PASSKEY_RP_ID,
  STELLAR_AUTH_PREFIX,
  STELLAR_FACTORY_ADDRESS,
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import { fetchDefaultContextRule } from '@/src/api/account-admin';
import {
  encodeWebAuthnSigData,
  getStoredKeyDataHex,
  signWithStoredPasskeyAtIndex
} from '@/src/lib/passkey-webauthn';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  Account,
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  rpc,
  scValToNative,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

import { createLogger } from '@/src/lib/logger';

const log = createLogger('send-token');

// Compute the Soroban auth payload hash for a given auth entry.
// signatureExpirationLedger MUST be set on the entry before calling this.
//
// Uses @noble/hashes (pure JS) instead of stellar-sdk's hash() because
// stellar-sdk delegates to QuickCrypto under the hood in React Native, and
// QuickCrypto's native .update() rejects the RN Buffer polyfill with
// "Received type object". @noble/hashes accepts any Uint8Array/Buffer.
function hashAuthPayload(entry: xdr.SorobanAuthorizationEntry): Buffer {
  const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
  const addrAuth = clone.credentials().address();
  // TextEncoder produces a native Uint8Array (not the RN Buffer polyfill).
  // @noble/hashes sha256 requires Uint8Array — it rejects strings and polyfilled Buffers.
  const networkId = Buffer.from(sha256(new TextEncoder().encode(STELLAR_NETWORK_PASSPHRASE)));
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId,
      nonce: addrAuth.nonce(),
      invocation: clone.rootInvocation(),
      signatureExpirationLedger: addrAuth.signatureExpirationLedger(),
    }),
  );
  // Uint8Array.from() copies any iterable into a native Uint8Array.
  return Buffer.from(sha256(Uint8Array.from(preimage.toXDR())));
}

// Mutates entry in place: sets expiration and attaches the Signatures ScVal that
// stellar_accounts::do_check_auth expects for an External(Ed25519) signer:
//   Map{
//     context_rule_ids: Vec[u32(0)],
//     signers: Map{ Vec[Symbol("External"), Address(verifier), Bytes(pk)] : Bytes(sig64) }
//   }
//
// do_check_auth computes authDigest = sha256(payloadHash || toXDR(Vec[u32(0)])) and
// passes it to verifier.verify(authDigest, pk, sig). The verifier then checks
// ed25519_verify(pk, "Stellar Smart Account Auth:\n" + hex(authDigest), sig).
// Count every invocation node in the auth entry's tree. Soroban flattens this
// tree into the `auth_contexts` Vec passed to __check_auth (one Context per
// node), and OZ's do_check_auth requires context_rule_ids.len() ==
// auth_contexts.len() (else SmartAccountError #3014). A plain transfer is a
// single node; a DEX swap (router → pool → transfer) is several.
function countAuthContexts(inv: xdr.SorobanAuthorizedInvocation): number {
  let n = 1;
  for (const sub of inv.subInvocations()) n += countAuthContexts(sub);
  return n;
}

// One context_rule_id per auth context. Used for BOTH the signed auth digest
// and the AuthPayload's context_rule_ids — they must match.
//
// The rule is chosen by the signer, not matched by the account: __check_auth
// validates each context against the rule id named here, and a Default rule
// matches any context. Rule 0 is therefore right for ordinary spending and for
// the owner's own admin calls. It is WRONG for anything authorised by a
// narrower rule — a guardian signing under the recovery rule must name that
// rule's id, since the guardians are not signers on rule 0.
function buildContextRuleIds(
  entry: xdr.SorobanAuthorizationEntry,
  ruleId: number,
): xdr.ScVal {
  const count = countAuthContexts(entry.rootInvocation());
  return xdr.ScVal.scvVec(Array.from({ length: count }, () => xdr.ScVal.scvU32(ruleId)));
}

/**
 * sha256(payloadHash || context_rule_ids) — what signers actually sign, and
 * what a Delegated signer's require_auth_for_args receives as its argument.
 */
export function authDigestFor(
  entry: xdr.SorobanAuthorizationEntry,
  contextRuleId: number,
): Buffer {
  const payloadHash = hashAuthPayload(entry);
  const ruleIdsXdr = new Uint8Array(buildContextRuleIds(entry, contextRuleId).toXDR());
  const combined = new Uint8Array(payloadHash.length + ruleIdsXdr.length);
  combined.set(payloadHash);
  combined.set(ruleIdsXdr, payloadHash.length);
  return Buffer.from(sha256(combined));
}

// `verifierAddress` is passed in rather than read from config: it must be the
// verifier the ACCOUNT registered this key under, which
// resolveRegisteredEd25519Verifier reads from the chain. See the note there.
export function signSmartAccountAuthEntry(
  entry: xdr.SorobanAuthorizationEntry,
  keypair: Keypair,
  validUntilLedger: number,
  verifierAddress: string,
  contextRuleId = 0,
): void {
  const creds = entry.credentials();
  if (creds.switch().name !== 'sorobanCredentialsAddress') return;

  const addrCreds = creds.address();
  addrCreds.signatureExpirationLedger(validUntilLedger);

  const payloadHash = hashAuthPayload(entry);

  // authDigest = sha256(payloadHash || toXDR(context_rule_ids)). One id per
  // auth context (see buildContextRuleIds) — a length mismatch fails #3014.
  const ruleIdsScVal = buildContextRuleIds(entry, contextRuleId);
  const ruleIdsXdr = new Uint8Array(ruleIdsScVal.toXDR());
  const combined = new Uint8Array(payloadHash.length + ruleIdsXdr.length);
  combined.set(payloadHash);
  combined.set(ruleIdsXdr, payloadHash.length);
  const authDigest = Buffer.from(sha256(combined));

  const message = STELLAR_AUTH_PREFIX + authDigest.toString('hex').toLowerCase();
  const sigBytes = keypair.sign(Buffer.from(message, 'utf8'));
  const pkBytes = StrKey.decodeEd25519PublicKey(keypair.publicKey());

  const signerKey = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(verifierAddress).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(Uint8Array.from(pkBytes))),
  ]);

  const signaturesScVal = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: ruleIdsScVal,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signers'),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: signerKey,
          val: xdr.ScVal.scvBytes(Buffer.from(Uint8Array.from(sigBytes))),
        }),
      ]),
    }),
  ]);

  addrCreds.signature(signaturesScVal);
}

export async function loadAccount(gAddress: string): Promise<Account> {
  const res = await fetch(`${HORIZON_URL}/accounts/${gAddress}`);
  if (!res.ok) throw new Error(`Horizon ${res.status}: account not found (${gAddress})`);
  const data = await res.json();
  return new Account(gAddress, data.sequence);
}

// Convert a human-readable token amount (e.g. "1.5") to SAC base units (7 decimals).
// Uses string arithmetic to avoid floating-point precision loss.
export function toBaseUnits(amount: string): bigint {
  const [intPart = '0', fracPart = ''] = amount.split('.');
  const paddedFrac = fracPart.padEnd(7, '0').slice(0, 7);
  return BigInt(intPart) * 10_000_000n + BigInt(paddedFrac);
}

export interface SendTokenParams {
  /** Deployed C-address of the smart account (the "from" in the transfer) */
  smartAccountAddress: string;
  /** Ed25519 keypair that is a registered signer on the smart account — signs auth entries only */
  keypair: Keypair;
  /** SAC contract ID of the token to send */
  sacContractId: string;
  /** Destination G-address or C-address */
  destinationAddress: string;
  /** Human-readable amount, e.g. "1.5" */
  amount: string;
}

export interface SendTokenResult {
  hash: string;
}

/**
 * Sends tokens from a Latch smart account (C-address) to any Stellar address.
 *
 * Fee model: the bundler is the outer transaction
 * source and pays all Soroban resource fees. The user's keypair only signs the
 * Soroban auth entry to authorise the smart account transfer — it never touches
 * fee payment. Move bundler signing server-side before production.
 *
 * Flow:
 *  1. Build SAC `transfer(from, to, amount)` with bundler as source
 *  2. Simulate (auth-record pass — no __check_auth yet)
 *  3. Sign auth entries with user keypair (Latch Ed25519 verifier format)
 *  4. Re-simulate with signed auth injected (accurate resource count)
 *  5. Assemble final tx (resource fees + signed auth)
 *  6. Bundler signs outer transaction
 *  7. Submit and poll for confirmation
 */
export async function sendTokenFromSmartAccount(params: SendTokenParams): Promise<SendTokenResult> {
  const { smartAccountAddress, keypair, sacContractId, destinationAddress, amount } = params;

  const amountInBaseUnits = toBaseUnits(amount);

  // 1. Load the bundler account as the simulation source. Only its address is
  //    needed here; latch-api re-sources and re-sequences the final envelope.
  const account = await loadAccount(await bundlerAddress());

  // 2. Build the SAC transfer transaction
  const contract = new Contract(sacContractId);
  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'transfer',
        new Address(smartAccountAddress).toScVal(),
        new Address(destinationAddress).toScVal(),
        nativeToScVal(amountInBaseUnits, { type: 'i128' }),
      ),
    )
    .setTimeout(300)
    .build();

  // 3. Simulate — mandatory for Soroban (resource fee calculation)
  const simRaw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(tx),
  });
  if (simRaw.error) throw new Error(`Simulation failed: ${simRaw.error}`);

  // 4. Sign auth entries from first simulation (auth-record mode — no __check_auth yet)
  const simResult = parseSimResult(simRaw);
  const validUntilLedger = (simRaw.latestLedger ?? 0) + 100;

  const verifier = await resolveRegisteredEd25519Verifier(
    smartAccountAddress,
    Buffer.from(StrKey.decodeEd25519PublicKey(keypair.publicKey())).toString('hex'),
  );

  for (const entry of simResult.result?.auth ?? []) {
    const creds = entry.credentials();
    if (creds.switch().name !== 'sorobanCredentialsAddress') continue;
    const credAddr = Address.fromScAddress(creds.address().address()).toString();
    if (credAddr === smartAccountAddress) {
      signSmartAccountAuthEntry(entry, keypair, validUntilLedger, verifier);
    }
  }

  // 5. Assemble with signed auth so the second simulation can run __check_auth
  const txWithSignedAuth = rpc.assembleTransaction(tx, simResult).build();

  // 6. Re-simulate with signed auth injected — this time __check_auth executes,
  //    giving accurate instruction count and resourceFee that covers the full cost.
  const simRaw2 = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(txWithSignedAuth),
  });
  if (simRaw2.error) throw new Error(`Re-simulation failed: ${simRaw2.error}`);
  const simResult2 = parseSimResult(simRaw2);

  //    keeps the signed auth already in txWithSignedAuth (existingAuth.length > 0).
  const prepared = rpc.assembleTransaction(txWithSignedAuth, simResult2).build();

  // 8. latch-api signs the outer transaction with the bundler key and submits.
  //    It rebuilds the envelope around this one's host function and auth
  //    entries rather than signing what we send, then polls to confirmation.
  const { hash } = await submitViaBundler(prepared);
  return { hash };
}

// ─── Passkey send ─────────────────────────────────────────────────────────────

// Read the WebAuthn verifier address from the factory's on-chain instance storage.
// Uses getLedgerEntries (no simulation, no source account needed) to read a
// verifier address directly out of the factory's persistent FactoryConfig.
// The factory stores separate verifier addresses per signer type; using the wrong
// one (e.g. the Ed25519 verifier for a passkey) produces a signer-mismatch error
// (#3002).
//
// Read from the chain rather than from EXPO_PUBLIC_VERIFIER_ADDRESS. That
// variable is a second, unenforced copy of a value the factory already
// publishes, so it silently goes stale whenever the contracts are redeployed —
// and a stale verifier fails every signature with #3002.
async function fetchFactoryVerifier(field: 'ed25519_verifier' | 'webauthn_verifier'): Promise<string> {
  const factoryAddress = STELLAR_FACTORY_ADDRESS;
  if (!factoryAddress) throw new Error('Factory address is not configured for the active network');

  const instanceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(factoryAddress).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );

  const raw = await sorobanCall(STELLAR_RPC_URL, 'getLedgerEntries', {
    keys: [toBase64(new Uint8Array(instanceKey.toXDR()))],
  });

  if (!raw.entries?.length) throw new Error('Factory contract not found in ledger');

  // getLedgerEntries xdr field is LedgerEntryData (not the full LedgerEntry wrapper)
  const entryData = xdr.LedgerEntryData.fromXDR(raw.entries[0].xdr, 'base64');
  const storage = entryData.contractData().val().instance().storage() ?? [];

  for (const pair of storage) {
    const keyNative = scValToNative(pair.key());
    // DataKey::Config is a #[contracttype] unit variant → ScVec([ScSymbol("Config")])
    // scValToNative converts this to ["Config"]. Guard against plain-string encoding too.
    const isConfig =
      (Array.isArray(keyNative) && keyNative[0] === 'Config') || keyNative === 'Config';
    if (!isConfig) continue;

    const config = scValToNative(pair.val()) as Record<string, string>;
    const verifier = config[field];
    if (!verifier) throw new Error(`${field} missing in FactoryConfig`);

    if (__DEV__) {
      log.debug(`factory ${field}:`, verifier);
    }
    return verifier;
  }

  throw new Error('Config not found in factory instance storage');
}

export function fetchWebAuthnVerifier(): Promise<string> {
  return fetchFactoryVerifier('webauthn_verifier');
}

export function fetchEd25519Verifier(): Promise<string> {
  return fetchFactoryVerifier('ed25519_verifier');
}

// Resolve the verifier address this device's passkey is registered under ON-CHAIN.
//
// The smart account's __check_auth matches the presented signer against the
// stored rule signer by EXACT `External(verifier, key_data)` tuple equality. The
// signature verifying is not enough: if we present the current factory's verifier
// but the account registered the signer under a different (older) verifier, the
// tuple won't match and check_auth fails with #3002 UnvalidatedContext (NOT
// #3003, which is a signature failure). So we must present the same verifier the
// signer was registered under, not whatever the factory config currently points
// at. Falls back to the factory config verifier if the device key isn't found.
export async function resolveRegisteredWebAuthnVerifier(
  smartAccountAddress: string,
  listIndex: number,
): Promise<string> {
  const deviceKeyDataHex = await getStoredKeyDataHex(listIndex);
  const factoryAddress = STELLAR_FACTORY_ADDRESS;
  if (!deviceKeyDataHex || !factoryAddress) return fetchWebAuthnVerifier();

  try {
    const rule = await fetchDefaultContextRule(
      { rpcUrl: STELLAR_RPC_URL, networkPassphrase: STELLAR_NETWORK_PASSPHRASE, factoryAddress },
      smartAccountAddress,
    );
    const match = rule.signers.find(
      (s) =>
        s.kind === 'webauthn' &&
        s.keyDataHex.toLowerCase() === deviceKeyDataHex.toLowerCase() &&
        s.verifierAddress,
    );
    if (match?.verifierAddress) {
      if (__DEV__ && match.foreignVerifier) {
        log.debug('device signer is on a non-current verifier:', match.verifierAddress);
      }
      return match.verifierAddress;
    }
  } catch (e) {
    if (__DEV__) log.debug('could not read on-chain signer verifier:', e);
  }

  return fetchWebAuthnVerifier();
}

// The Ed25519 counterpart of resolveRegisteredWebAuthnVerifier, and it exists
// for the same reason: __check_auth matches on the exact
// `External(verifier, key_data)` tuple, so an account registered under an older
// verifier must be presented with that older verifier, not the current one.
//
// Falls back to the factory's current ed25519_verifier when the key isn't found
// on the account — a newly deployed account is the common case.
export async function resolveRegisteredEd25519Verifier(
  smartAccountAddress: string,
  publicKeyHex: string,
): Promise<string> {
  const factoryAddress = STELLAR_FACTORY_ADDRESS;
  if (!factoryAddress) return fetchEd25519Verifier();

  try {
    const rule = await fetchDefaultContextRule(
      { rpcUrl: STELLAR_RPC_URL, networkPassphrase: STELLAR_NETWORK_PASSPHRASE, factoryAddress },
      smartAccountAddress,
    );
    const match = rule.signers.find(
      (s) =>
        s.kind === 'ed25519' &&
        s.keyDataHex.toLowerCase() === publicKeyHex.toLowerCase() &&
        s.verifierAddress,
    );
    if (match?.verifierAddress) {
      if (__DEV__ && match.foreignVerifier) {
        log.debug('device signer is on a non-current verifier:', match.verifierAddress);
      }
      return match.verifierAddress;
    }
  } catch (e) {
    if (__DEV__) log.debug('could not read on-chain signer verifier:', e);
  }

  return fetchEd25519Verifier();
}

export async function signPasskeyAuthEntry(
  entry: xdr.SorobanAuthorizationEntry,
  listIndex: number,
  validUntilLedger: number,
  webAuthnVerifier: string,
  contextRuleId = 0,
): Promise<void> {
  const creds = entry.credentials();
  if (creds.switch().name !== 'sorobanCredentialsAddress') return;

  const addrCreds = creds.address();
  addrCreds.signatureExpirationLedger(validUntilLedger);

  const payloadHash = hashAuthPayload(entry);
  // auth_digest = sha256(payloadHash || toXDR(Vec[u32(0)])) — this is what do_check_auth
  // passes to verifier.verify(). The WebAuthn verifier checks that
  // clientDataJSON.challenge == base64url(auth_digest), so we must sign authDigest, not payloadHash.
  const ruleIdsScVal = buildContextRuleIds(entry, contextRuleId);
  const ruleIdsXdr = new Uint8Array(ruleIdsScVal.toXDR());
  const combined = new Uint8Array(payloadHash.length + ruleIdsXdr.length);
  combined.set(payloadHash);
  combined.set(ruleIdsXdr, payloadHash.length);
  const authDigest = new Uint8Array(sha256(combined));

  if (__DEV__) {
    // payloadHash and authDigest are the exact bytes the user's key signs.
    log.debug('signing auth entry against verifier', webAuthnVerifier);
  }

  const { sig, keyDataHex } = await signWithStoredPasskeyAtIndex(
    listIndex,
    authDigest,
    PASSKEY_RP_ID,
    'Authenticate to send tokens',
  );
  const sigDataXdr = encodeWebAuthnSigData(sig);

  const payload = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('context_rule_ids'),
      val: ruleIdsScVal,
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signers'),
      val: xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvVec([
            xdr.ScVal.scvSymbol('External'),
            xdr.ScVal.scvAddress(Address.fromString(webAuthnVerifier).toScAddress()),
            xdr.ScVal.scvBytes(Buffer.from(keyDataHex, 'hex')),
          ]),
          val: xdr.ScVal.scvBytes(Buffer.from(sigDataXdr)),
        }),
      ]),
    }),
  ]);
  addrCreds.signature(payload);
}

export interface SendTokenPasskeyParams {
  smartAccountAddress: string;
  /** Position of this account in the accounts array (used to read the correct SecureStore keys). */
  listIndex: number;
  sacContractId: string;
  destinationAddress: string;
  amount: string;
}

/**
 * Send tokens from a passkey-backed Latch smart account (C-address).
 *
 * Identical flow to sendTokenFromSmartAccount except auth entries are signed
 * with the stored P-256 passkey credential (triggers Face ID / Touch ID).
 */
export async function sendTokenFromPasskeyAccount(
  params: SendTokenPasskeyParams,
): Promise<SendTokenResult> {
  const { smartAccountAddress, listIndex, sacContractId, destinationAddress, amount } = params;

  const amountInBaseUnits = toBaseUnits(amount);
  const webAuthnVerifier = await resolveRegisteredWebAuthnVerifier(smartAccountAddress, listIndex);
  const account = await loadAccount(await bundlerAddress());

  const contract = new Contract(sacContractId);
  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'transfer',
        new Address(smartAccountAddress).toScVal(),
        new Address(destinationAddress).toScVal(),
        nativeToScVal(amountInBaseUnits, { type: 'i128' }),
      ),
    )
    .setTimeout(300)
    .build();

  const simRaw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(tx),
  });
  if (simRaw.error) throw new Error(`Simulation failed: ${simRaw.error}`);

  const simResult = parseSimResult(simRaw);
  const validUntilLedger = (simRaw.latestLedger ?? 0) + 100;

  for (const entry of simResult.result?.auth ?? []) {
    const creds = entry.credentials();
    if (creds.switch().name !== 'sorobanCredentialsAddress') continue;
    const credAddr = Address.fromScAddress(creds.address().address()).toString();
    if (credAddr === smartAccountAddress) {
      await signPasskeyAuthEntry(entry, listIndex, validUntilLedger, webAuthnVerifier);
    }
  }

  const txWithSignedAuth = rpc.assembleTransaction(tx, simResult).build();

  const simRaw2 = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(txWithSignedAuth),
  });
  if (simRaw2.error) throw new Error(`Re-simulation failed: ${simRaw2.error}`);
  const simResult2 = parseSimResult(simRaw2);

  const prepared = rpc.assembleTransaction(txWithSignedAuth, simResult2).build();

  // Outer signing and submission happen server-side — see the note above.
  const { hash } = await submitViaBundler(prepared);
  return { hash };
}
