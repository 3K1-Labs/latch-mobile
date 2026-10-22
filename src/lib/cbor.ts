/**
 * cbor.ts — minimal CBOR decoder (RFC 8949) for parsing WebAuthn attestation
 * objects and COSE public keys returned by react-native-passkey.
 *
 * Only decoding is implemented (the app never encodes CBOR), and only the
 * major types that appear in a WebAuthn attestationObject / COSE_Key are
 * handled: unsigned/negative integers, byte strings, text strings, arrays,
 * maps, and simple values (booleans/null). Indefinite-length items are not
 * supported — authenticators emit deterministic (definite-length) CBOR per
 * the WebAuthn/COSE spec, so encountering one indicates malformed input.
 */

export type CBORValue =
  | number
  | bigint
  | Uint8Array
  | string
  | boolean
  | null
  | CBORValue[]
  | Map<CBORValue, CBORValue>;

interface DecodeState {
  buf: Uint8Array;
  offset: number;
}

function readLength(state: DecodeState, additionalInfo: number): number | bigint {
  if (additionalInfo < 24) return additionalInfo;
  if (additionalInfo === 24) return readUint(state, 1);
  if (additionalInfo === 25) return readUint(state, 2);
  if (additionalInfo === 26) return readUint(state, 4);
  if (additionalInfo === 27) return readUint(state, 8);
  throw new Error(`cbor: indefinite-length items are not supported (additionalInfo=${additionalInfo})`);
}

function readUint(state: DecodeState, byteLength: number): number | bigint {
  const { buf, offset } = state;
  if (offset + byteLength > buf.length) throw new Error('cbor: unexpected end of buffer');
  let value = 0n;
  for (let i = 0; i < byteLength; i++) {
    value = (value << 8n) | BigInt(buf[offset + i]);
  }
  state.offset += byteLength;
  return byteLength <= 4 ? Number(value) : value;
}

function readBytes(state: DecodeState, length: number): Uint8Array {
  const { buf, offset } = state;
  if (offset + length > buf.length) throw new Error('cbor: unexpected end of buffer');
  const out = buf.subarray(offset, offset + length);
  state.offset += length;
  return out;
}

function decodeItem(state: DecodeState): CBORValue {
  const initial = state.buf[state.offset];
  if (initial === undefined) throw new Error('cbor: unexpected end of buffer');
  state.offset += 1;

  const majorType = initial >> 5;
  const additionalInfo = initial & 0x1f;

  switch (majorType) {
    case 0: {
      // unsigned integer
      const len = readLength(state, additionalInfo);
      return len;
    }
    case 1: {
      // negative integer: value = -1 - n
      const n = readLength(state, additionalInfo);
      return typeof n === 'bigint' ? -1n - n : -1 - n;
    }
    case 2: {
      // byte string
      const length = readLength(state, additionalInfo);
      if (typeof length === 'bigint') throw new Error('cbor: byte string too long');
      return readBytes(state, length);
    }
    case 3: {
      // text string
      const length = readLength(state, additionalInfo);
      if (typeof length === 'bigint') throw new Error('cbor: text string too long');
      const bytes = readBytes(state, length);
      return new TextDecoder().decode(bytes);
    }
    case 4: {
      // array
      const length = readLength(state, additionalInfo);
      if (typeof length === 'bigint') throw new Error('cbor: array too long');
      const arr: CBORValue[] = [];
      for (let i = 0; i < length; i++) arr.push(decodeItem(state));
      return arr;
    }
    case 5: {
      // map
      const length = readLength(state, additionalInfo);
      if (typeof length === 'bigint') throw new Error('cbor: map too long');
      const map = new Map<CBORValue, CBORValue>();
      for (let i = 0; i < length; i++) {
        const key = decodeItem(state);
        const value = decodeItem(state);
        map.set(key, value);
      }
      return map;
    }
    case 6: {
      // tag — decode and discard the tag number, return the tagged value as-is
      readLength(state, additionalInfo);
      return decodeItem(state);
    }
    case 7: {
      // simple values / floats
      if (additionalInfo === 20) return false;
      if (additionalInfo === 21) return true;
      if (additionalInfo === 22) return null;
      if (additionalInfo === 25 || additionalInfo === 26 || additionalInfo === 27) {
        // floats — not needed for WebAuthn/COSE parsing, but consume the bytes
        // to keep the offset correct for any sibling values.
        const byteLength = additionalInfo === 25 ? 2 : additionalInfo === 26 ? 4 : 8;
        readBytes(state, byteLength);
        throw new Error('cbor: floating point values are not supported');
      }
      throw new Error(`cbor: unsupported simple value (additionalInfo=${additionalInfo})`);
    }
    default:
      throw new Error(`cbor: unsupported major type ${majorType}`);
  }
}

/** Decode a single CBOR item from the start of `buf`. Trailing bytes are ignored. */
export function decodeCBORFirst(buf: Uint8Array): { value: CBORValue; bytesRead: number } {
  const state: DecodeState = { buf, offset: 0 };
  const value = decodeItem(state);
  return { value, bytesRead: state.offset };
}

/** Decode a single CBOR item, requiring the entire buffer to be consumed. */
export function decodeCBOR(buf: Uint8Array): CBORValue {
  const { value, bytesRead } = decodeCBORFirst(buf);
  if (bytesRead !== buf.length) {
    throw new Error(`cbor: ${buf.length - bytesRead} trailing byte(s) after decoded value`);
  }
  return value;
}
