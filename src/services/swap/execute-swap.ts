import { bundlerAddress, submitViaBundler } from '@/src/api/transaction-relay';
import { Address, Keypair, rpc, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';

import { parseSimResult, sorobanCall, txToBase64 } from '@/src/api/smart-account';
import {
  STELLAR_NETWORK_PASSPHRASE,
  STELLAR_RPC_URL,
} from '@/src/constants/config';
import {
  loadAccount,
  resolveRegisteredEd25519Verifier,
  resolveRegisteredWebAuthnVerifier,
  signPasskeyAuthEntry,
  signSmartAccountAuthEntry,
} from '@/src/services/send-token';

export interface ExecuteSwapResult {
  hash: string;
}

export interface ExecuteSwapParams {
  /** Deployed C-address of the smart account performing the swap */
  smartAccountAddress: string;
  /** Ed25519 signer registered on the smart account — signs the auth entry only */
  keypair: Keypair;
  /** Swap operation from a SwapProvider.buildSwapOperation (no auth attached) */
  operation: xdr.Operation;
}

export interface ExecuteSwapPasskeyParams {
  smartAccountAddress: string;
  /** Position of this account in the accounts array (selects the SecureStore keys) */
  listIndex: number;
  operation: xdr.Operation;
}

const FEE = '1000000';

// Mirrors sendTokenFromSmartAccount: bundler is the outer tx source / fee payer;
// the user keypair only signs the Soroban auth entry the smart account requires.
// The only difference from a send is the operation — here it is a DEX router
// invocation rather than a SAC transfer. See docs/swap-implementation.md.
export async function executeSwapFromSmartAccount(
  params: ExecuteSwapParams,
): Promise<ExecuteSwapResult> {
  const { smartAccountAddress, keypair, operation } = params;

  const account = await loadAccount(await bundlerAddress());

  const tx = new TransactionBuilder(account, {
    fee: FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  const simRaw = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(tx),
  });
  if (simRaw.error) throw new Error(`Simulation failed: ${simRaw.error}`);

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

  const txWithSignedAuth = rpc.assembleTransaction(tx, simResult).build();

  const simRaw2 = await sorobanCall(STELLAR_RPC_URL, 'simulateTransaction', {
    transaction: txToBase64(txWithSignedAuth),
  });
  if (simRaw2.error) throw new Error(`Re-simulation failed: ${simRaw2.error}`);
  const simResult2 = parseSimResult(simRaw2);

  const prepared = rpc.assembleTransaction(txWithSignedAuth, simResult2).build();

  // latch-api holds the bundler key: it rebuilds this envelope with the bundler
  // as fee-paying source, re-simulates in enforcing mode, signs and submits.
  const { hash } = await submitViaBundler(prepared);
  return { hash };
}

// Passkey-backed smart account. Identical to executeSwapFromSmartAccount except
// the auth entry is signed with the stored P-256 credential (Face ID / Touch ID).
export async function executeSwapFromPasskeyAccount(
  params: ExecuteSwapPasskeyParams,
): Promise<ExecuteSwapResult> {
  const { smartAccountAddress, listIndex, operation } = params;

  const webAuthnVerifier = await resolveRegisteredWebAuthnVerifier(smartAccountAddress, listIndex);
  const account = await loadAccount(await bundlerAddress());

  const tx = new TransactionBuilder(account, {
    fee: FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
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

  // latch-api holds the bundler key: it rebuilds this envelope with the bundler
  // as fee-paying source, re-simulates in enforcing mode, signs and submits.
  const { hash } = await submitViaBundler(prepared);
  return { hash };
}
