import { normalizePasskeyRpId } from '../passkey-rp-id';

describe('normalizePasskeyRpId', () => {
  it.each([
    ['michaelesenwa.me', 'michaelesenwa.me'],
    ['https://michaelesenwa.me', 'michaelesenwa.me'],
    ['http://localhost', 'localhost'],
    ['https://michaelesenwa.me/', 'michaelesenwa.me'],
    ['https://michaelesenwa.me/.well-known/', 'michaelesenwa.me'],
    ['  latch.finance  ', 'latch.finance'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePasskeyRpId(input)).toBe(expected);
  });
});
