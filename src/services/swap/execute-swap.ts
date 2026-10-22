import { submitBuiltTransaction } from '@/src/api/transaction-relay';
import { buildSwap, type NetworkFee } from '@/src/api/transaction-build';
import { Keypair, StrKey, xdr } from '@stellar/stellar-sdk';

import { toBase64 } from '@/src/api/smart-account';
import { getStoredKeyDataHex } from '@/src/lib/passkey-webauthn';
import {
  assertCredentialsAddressMatches,
  resolveRegisteredEd25519Verifier,
  resolveRegisteredWebAuthnVerifier,
  signPasskeyAuthEntryFromDigest,
  signSmartAccountAuthEntryFromDigest,
} from '@/src/services/send-token';

export interface ExecuteSwapResult {
  hash: string;
  /** The max network fee latch-api charged the wallet for this swap. */
  networkFee: NetworkFee;
}

/** Fields a SwapProvider.buildSwapOperation result contributes to build-swap. */
interface SwapOperationInput {
  /** Pre-built operation from a SwapProvider.buildSwapOperation (no auth attached). Used as a fallback when swapChainXdr isn't set. */
  operation: xdr.Operation;
  /** Bare ScVal swaps_chain argument from a SwapProvider.buildSwapOperation (base64 XDR). Preferred over `operation` when present. */
  swapChainXdr?: string;
  tokenInContractId: string;
  amountInRaw: string;
  amountOutMinRaw: string;
  routerContractId?: string;
}

export interface ExecuteSwapParams extends SwapOperationInput {
  /** Deployed C-address of the smart account performing the swap */
  smartAccountAddress: string;
  /** Ed25519 signer registered on the smart account — signs the auth entry only */
  keypair: Keypair;
}

export interface ExecuteSwapPasskeyParams extends SwapOperationInput {
  smartAccountAddress: string;
  /** Position of this account in the accounts array (selects the SecureStore keys) */
  listIndex: number;
}

// Mirrors sendTokenFromSmartAccount: latch-api builds the FeeForwarder-wrapped
// swap server-side (POST /v1/transaction/build-swap) and the wallet pays the
// network fee; the user keypair only signs the returned Soroban auth entry.
// The only difference from a send is the operation this wraps — a DEX router
// invocation rather than a SAC transfer. See docs/swap-implementation.md.
export async function executeSwapFromSmartAccount(
  params: ExecuteSwapParams,
): Promise<ExecuteSwapResult> {
  const { smartAccountAddress, keypair, operation, swapChainXdr, tokenInContractId, amountInRaw, amountOutMinRaw, routerContractId } =
    params;

  const keyDataHex = Buffer.from(StrKey.decodeEd25519PublicKey(keypair.publicKey())).toString('hex');

  const built = await buildSwap({
    smartAccountAddress,
    signerType: 'ed25519',
    keyDataHex,
    swapChainXdr: swapChainXdr ?? toBase64(new Uint8Array(operation.toXDR())),
    tokenInContractId,
    amountInRaw,
    amountOutMinRaw,
    routerContractId,
  });

  const verifier = await resolveRegisteredEd25519Verifier(smartAccountAddress, keyDataHex);

  const entry = xdr.SorobanAuthorizationEntry.fromXDR(
    built.authEntries[built.smartAccountAuthEntryIndex],
    'base64',
  );
  assertCredentialsAddressMatches(entry, smartAccountAddress);
  signSmartAccountAuthEntryFromDigest(
    entry,
    keypair,
    built.authDigestHex,
    built.contextRuleIds,
    verifier,
  );

  const authEntries = [...built.authEntries];
  authEntries[built.smartAccountAuthEntryIndex] = toBase64(new Uint8Array(entry.toXDR()));

  const { hash } = await submitBuiltTransaction(built.txXdr, authEntries);
  return { hash, networkFee: built.networkFee };
}

// Passkey-backed smart account. Identical to executeSwapFromSmartAccount except
// the auth entry is signed with the stored P-256 credential (Face ID / Touch ID).
export async function executeSwapFromPasskeyAccount(
  params: ExecuteSwapPasskeyParams,
): Promise<ExecuteSwapResult> {
  const { smartAccountAddress, listIndex, operation, swapChainXdr, tokenInContractId, amountInRaw, amountOutMinRaw, routerContractId } =
    params;

  const webAuthnVerifier = await resolveRegisteredWebAuthnVerifier(smartAccountAddress, listIndex);
  const keyDataHex = (await getStoredKeyDataHex(listIndex)) ?? undefined;

  const built = await buildSwap({
    smartAccountAddress,
    signerType: 'passkey',
    keyDataHex,
    swapChainXdr: swapChainXdr ?? toBase64(new Uint8Array(operation.toXDR())),
    tokenInContractId,
    amountInRaw,
    amountOutMinRaw,
    routerContractId,
  });

  const entry = xdr.SorobanAuthorizationEntry.fromXDR(
    built.authEntries[built.smartAccountAuthEntryIndex],
    'base64',
  );
  assertCredentialsAddressMatches(entry, smartAccountAddress);
  await signPasskeyAuthEntryFromDigest(
    entry,
    listIndex,
    built.authDigestHex,
    built.contextRuleIds,
    webAuthnVerifier,
  );

  const authEntries = [...built.authEntries];
  authEntries[built.smartAccountAuthEntryIndex] = toBase64(new Uint8Array(entry.toXDR()));

  const { hash } = await submitBuiltTransaction(built.txXdr, authEntries);
  return { hash, networkFee: built.networkFee };
}
