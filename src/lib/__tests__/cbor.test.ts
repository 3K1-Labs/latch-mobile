import { decodeCBOR } from '../cbor';

// Test vectors from RFC 8949 Appendix A (the canonical CBOR examples).
describe('decodeCBOR', () => {
  it('decodes small and multi-byte unsigned integers', () => {
    expect(decodeCBOR(Uint8Array.from([0x00]))).toBe(0);
    expect(decodeCBOR(Uint8Array.from([0x01]))).toBe(1);
    expect(decodeCBOR(Uint8Array.from([0x17]))).toBe(23);
    expect(decodeCBOR(Uint8Array.from([0x18, 0x18]))).toBe(24);
    expect(decodeCBOR(Uint8Array.from([0x18, 0x64]))).toBe(100);
    expect(decodeCBOR(Uint8Array.from([0x19, 0x03, 0xe8]))).toBe(1000);
  });

  it('decodes negative integers', () => {
    expect(decodeCBOR(Uint8Array.from([0x20]))).toBe(-1);
    expect(decodeCBOR(Uint8Array.from([0x29]))).toBe(-10);
    expect(decodeCBOR(Uint8Array.from([0x38, 0x63]))).toBe(-100);
  });

  it('decodes byte strings', () => {
    expect(decodeCBOR(Uint8Array.from([0x40]))).toEqual(new Uint8Array([]));
    expect(decodeCBOR(Uint8Array.from([0x44, 0x01, 0x02, 0x03, 0x04]))).toEqual(
      new Uint8Array([0x01, 0x02, 0x03, 0x04]),
    );
  });

  it('decodes text strings', () => {
    expect(decodeCBOR(Uint8Array.from([0x60]))).toBe('');
    expect(decodeCBOR(Uint8Array.from([0x61, 0x61]))).toBe('a');
    expect(decodeCBOR(Uint8Array.from([0x64, 0x49, 0x45, 0x54, 0x46]))).toBe('IETF');
  });

  it('decodes arrays', () => {
    expect(decodeCBOR(Uint8Array.from([0x80]))).toEqual([]);
    expect(decodeCBOR(Uint8Array.from([0x83, 0x01, 0x02, 0x03]))).toEqual([1, 2, 3]);
  });

  it('decodes maps, including negative int keys as used by COSE_Key', () => {
    expect(decodeCBOR(Uint8Array.from([0xa0]))).toEqual(new Map());
    expect(decodeCBOR(Uint8Array.from([0xa2, 0x01, 0x02, 0x03, 0x04]))).toEqual(
      new Map([
        [1, 2],
        [3, 4],
      ]),
    );
    // {1: 2, -1: 3} — mirrors a COSE_Key's mix of positive/negative int keys
    expect(decodeCBOR(Uint8Array.from([0xa2, 0x01, 0x02, 0x20, 0x03]))).toEqual(
      new Map([
        [1, 2],
        [-1, 3],
      ]),
    );
  });

  it('decodes simple values', () => {
    expect(decodeCBOR(Uint8Array.from([0xf4]))).toBe(false);
    expect(decodeCBOR(Uint8Array.from([0xf5]))).toBe(true);
    expect(decodeCBOR(Uint8Array.from([0xf6]))).toBe(null);
  });

  it('rejects indefinite-length items', () => {
    expect(() => decodeCBOR(Uint8Array.from([0x5f]))).toThrow(/indefinite-length/);
  });

  it('rejects trailing bytes after a complete value', () => {
    expect(() => decodeCBOR(Uint8Array.from([0x00, 0x00]))).toThrow(/trailing byte/);
  });

  it('rejects truncated input', () => {
    expect(() => decodeCBOR(Uint8Array.from([0x44, 0x01, 0x02]))).toThrow(/unexpected end/);
  });
});
