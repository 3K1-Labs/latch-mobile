import { unwrap } from './unwrap';

describe('unwrap', () => {
  it('returns the nested data envelope', () => {
    expect(unwrap({ data: { unread_count: 3 } })).toEqual({ unread_count: 3 });
  });

  it('falls back to the body when there is no envelope', () => {
    expect(unwrap({ unread_count: 3 })).toEqual({ unread_count: 3 });
  });

  it('handles an empty body', () => {
    expect(unwrap(null)).toBeNull();
  });
});
