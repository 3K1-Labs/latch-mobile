import { lockAfterMs, shouldLock } from '../auth-policy';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

describe('auth policy', () => {
  it('adds no inactivity timer for transaction and never', () => {
    expect(lockAfterMs('transaction')).toBeNull();
    expect(lockAfterMs('never')).toBeNull();
    expect(shouldLock('never', 0, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('locks once the chosen number of minutes has passed', () => {
    expect(shouldLock('2', 0, 119_999)).toBe(false);
    expect(shouldLock('2', 0, 120_000)).toBe(true);
    expect(shouldLock('20', 0, 1_200_000)).toBe(true);
  });
});
