import type { HistoryStateChange } from '../../api/wallet-backend';
import { assetInfoFromSacMap, mapHistoryToPayments } from '../history-mapping';

const ME = 'CME';
const OTHER = 'COTHER';
const USDC = 'CUSDC';

const sac = new Map([
  ['CXLM', { code: 'XLM', assetType: 'native' }],
  [USDC, { code: 'USDC', assetType: 'credit_alphanum4' }],
]);
const lookup = assetInfoFromSacMap(sac);

function change(
  reason: string,
  tokenId: string,
  counterparty?: { reason: string; tokenId?: string; address?: string },
  overrides: Partial<HistoryStateChange> = {},
): { node: HistoryStateChange } {
  return {
    node: {
      type: 'BALANCE',
      reason,
      ledgerNumber: 100,
      ledgerCreatedAt: '2026-01-02T03:04:05Z',
      transaction: { hash: 'hash1' },
      tokenId,
      amount: '12.5000000',
      operation: {
        id: 77,
        operationType: 'INVOKE_HOST_FUNCTION',
        stateChanges: {
          edges: counterparty
            ? [
                {
                  cursor: 'c',
                  node: {
                    type: 'BALANCE',
                    reason: counterparty.reason,
                    account: { address: counterparty.address ?? OTHER },
                    tokenId: counterparty.tokenId ?? tokenId,
                    amount: '12.5000000',
                  },
                },
              ]
            : [],
          pageInfo: { startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
        },
      },
      ...overrides,
    },
  };
}

describe('assetInfoFromSacMap', () => {
  it('treats a missing token id and the native SAC as native', () => {
    expect(lookup(undefined)).toEqual({ assetType: 'native' });
    expect(lookup('CXLM')).toEqual({ assetType: 'native' });
  });

  it('resolves known tokens and falls back for unknown ones', () => {
    expect(lookup(USDC)).toEqual({ code: 'USDC', assetType: 'credit_alphanum4' });
    expect(lookup('CUNKNOWN')).toEqual({ assetType: 'credit_alphanum4' });
  });
});

describe('mapHistoryToPayments', () => {
  it('maps a credit with the debiting account as sender', () => {
    const [p] = mapHistoryToPayments([change('CREDIT', USDC, { reason: 'DEBIT' })], ME, lookup);
    expect(p).toMatchObject({
      id: '77',
      transactionHash: 'hash1',
      from: OTHER,
      to: ME,
      amount: '12.5000000',
      assetCode: 'USDC',
      txType: 'unknown',
    });
  });

  it('maps a debit with the crediting account as recipient', () => {
    const [p] = mapHistoryToPayments([change('DEBIT', USDC, { reason: 'CREDIT' })], ME, lookup);
    expect(p).toMatchObject({ from: ME, to: OTHER });
  });

  it('leaves the counterparty empty when none is indexed', () => {
    const [p] = mapHistoryToPayments([change('CREDIT', USDC)], ME, lookup);
    expect(p.from).toBe('');
    expect(p.to).toBe(ME);
  });

  it('ignores a counterparty on a different token', () => {
    const [p] = mapHistoryToPayments(
      [change('CREDIT', USDC, { reason: 'DEBIT', tokenId: 'CXLM' })],
      ME,
      lookup,
    );
    expect(p.from).toBe('');
  });

  it('ignores a counterparty that is the account itself', () => {
    const [p] = mapHistoryToPayments(
      [change('CREDIT', USDC, { reason: 'DEBIT', address: ME })],
      ME,
      lookup,
    );
    expect(p.from).toBe('');
  });

  it('skips non-balance changes and unknown reasons', () => {
    const out = mapHistoryToPayments(
      [
        change('CREDIT', USDC, undefined, { type: 'ACCOUNT' }),
        change('SOMETHING_ELSE', USDC),
      ],
      ME,
      lookup,
    );
    expect(out).toEqual([]);
  });

  it('is case-insensitive on type and reason', () => {
    const out = mapHistoryToPayments(
      [change('credit', USDC, { reason: 'debit' }, { type: 'balance' })],
      ME,
      lookup,
    );
    expect(out).toHaveLength(1);
  });

  it('falls back to the hash as id when there is no operation', () => {
    const [p] = mapHistoryToPayments(
      [change('CREDIT', USDC, undefined, { operation: null })],
      ME,
      lookup,
    );
    expect(p.id).toBe('hash1');
    expect(p.type).toBe('unknown');
  });
});
