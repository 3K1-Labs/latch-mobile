import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// SHA-256 hex digest of the access PIN. Uses @noble/hashes (pure JS) rather than
// react-native-quick-crypto: QuickCrypto's native .update()/.digest() rejects
// plain strings on some builds ("bufferToString expected 2 arguments, but
// received 4"). The hex output is byte-identical to the old QuickCrypto path,
// so PINs already stored in SecureStore still verify.
export function hashPin(pin: string): string {
  return bytesToHex(sha256(utf8ToBytes(pin)));
}
