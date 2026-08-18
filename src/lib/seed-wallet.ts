import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { Keypair } from '@stellar/stellar-sdk';

export interface StellarWallet {
  mnemonic: string; // 12-word phrase — user must save this
  publicKeyHex: string; // 64-char hex — used to deploy smart account
  gAddress: string; // G... address — human-readable public key
  keypair: Keypair; // full keypair — used to sign transactions
}

// SLIP-0010 Ed25519 HD derivation (SEP-0005)
function masterKey(seed: Uint8Array) {
  const I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function childKey(parent: { key: Uint8Array; chainCode: Uint8Array }, index: number) {
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, index + 0x80000000, false);
  const data = new Uint8Array([0x00, ...parent.key, ...indexBytes]);
  const I = hmac(sha512, parent.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

// m/44'/148'/{accountIndex}' — SEP-0005 Stellar path, hardened account index
function deriveKeypairAtIndex(seed: Uint8Array, accountIndex: number): Keypair {
  let node = masterKey(seed);
  node = childKey(node, 44);
  node = childKey(node, 148);
  node = childKey(node, accountIndex);
  return Keypair.fromRawEd25519Seed(Buffer.from(node.key));
}

function walletFromMnemonic(mnemonic: string, accountIndex = 0): StellarWallet {
  const seed = mnemonicToSeedSync(mnemonic);
  const keypair = deriveKeypairAtIndex(seed, accountIndex);
  const publicKeyHex = Buffer.from(keypair.rawPublicKey()).toString('hex');
  const gAddress = keypair.publicKey();
  return { mnemonic, publicKeyHex, gAddress, keypair };
}

export function generateStellarWallet(): StellarWallet {
  const mnemonic = generateMnemonic(wordlist, 128); // 128 bits = 12 words
  return walletFromMnemonic(mnemonic, 0);
}

/** Restore account 0 from a mnemonic (backward-compatible default). */
export function restoreStellarWallet(mnemonic: string): StellarWallet {
  return walletFromMnemonic(mnemonic, 0);
}

/**
 * Derive the Stellar wallet at a specific BIP-44 account index.
 * Each index produces a unique Ed25519 keypair from the same seed.
 * Path: m/44'/148'/{accountIndex}'
 */
export function deriveWalletAtIndex(mnemonic: string, accountIndex: number): StellarWallet {
  return walletFromMnemonic(mnemonic, accountIndex);
}
