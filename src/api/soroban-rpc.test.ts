import { Keypair, xdr } from '@stellar/stellar-sdk';

import {
  accountLedgerKey,
  fetchRpcAccount,
  fetchRpcTransaction,
  loadRpcAccount,
  parseAccountEntry,
  submitAndConfirm,
  summarizeRpcTransaction,
  txResultCode,
} from './soroban-rpc';

const G_ADDRESS = Keypair.random().publicKey();

function accountEntryXdr(sequence: string, balance: string, subentries: number): string {
  const entry = new xdr.AccountEntry({
    accountId: Keypair.fromPublicKey(G_ADDRESS).xdrAccountId(),
    balance: xdr.Int64.fromString(balance),
    seqNum: xdr.Int64.fromString(sequence),
    numSubEntries: subentries,
    inflationDest: null,
    flags: 0,
    homeDomain: '',
    thresholds: Buffer.from([1, 0, 0, 0]),
    signers: [],
    ext: new xdr.AccountEntryExt(0),
  });
  return xdr.LedgerEntryData.account(entry).toXDR('base64');
}

function resultXdr(feeCharged: string): string {
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString(feeCharged),
    result: xdr.TransactionResultResult.txSuccess([]),
    ext: new xdr.TransactionResultExt(0),
  }).toXDR('base64');
}

function stubRpc(response: object | (() => never)) {
  class FakeXhr {
    status = 200;
    responseText = '';
    timeout = 0;
    onload: () => void = () => {};
    onerror: () => void = () => {};
    ontimeout: () => void = () => {};
    open() {}
    setRequestHeader() {}
    send() {
      if (typeof response === 'function') {
        this.onerror();
        return;
      }
      this.responseText = JSON.stringify(response);
      this.onload();
    }
  }
  (globalThis as any).XMLHttpRequest = FakeXhr;
}

afterEach(() => {
  delete (globalThis as any).XMLHttpRequest;
});

describe('accountLedgerKey', () => {
  it('encodes an account key for the given G-address', () => {
    const key = accountLedgerKey(G_ADDRESS);
    expect(key.switch().name).toBe('account');
    expect(key.account().accountId().ed25519().length).toBe(32);
  });

  it('rejects a malformed address', () => {
    expect(() => accountLedgerKey('not-an-address')).toThrow();
  });
});

describe('parseAccountEntry', () => {
  it('reads sequence, balance and subentry count', () => {
    const parsed = parseAccountEntry(accountEntryXdr('123456789012', '25000000000', 3));
    expect(parsed).toEqual({
      sequence: '123456789012',
      balanceStroops: 25_000_000_000n,
      subentryCount: 3,
    });
  });
});

describe('fetchRpcAccount', () => {
  it('returns the decoded account when the entry exists', async () => {
    stubRpc({
      jsonrpc: '2.0',
      id: 1,
      result: { entries: [{ xdr: accountEntryXdr('42', '10000000', 0) }] },
    });
    const account = await fetchRpcAccount('https://rpc.test', G_ADDRESS);
    expect(account?.sequence).toBe('42');
  });

  it('resolves null for an unfunded account', async () => {
    stubRpc({ jsonrpc: '2.0', id: 1, result: { entries: [] } });
    expect(await fetchRpcAccount('https://rpc.test', G_ADDRESS)).toBeNull();
  });

  it('rejects on an RPC error instead of reporting the account missing', async () => {
    stubRpc({ jsonrpc: '2.0', id: 1, error: { message: 'boom' } });
    await expect(fetchRpcAccount('https://rpc.test', G_ADDRESS)).rejects.toThrow('boom');
  });

  it('rejects on a transport failure', async () => {
    stubRpc(() => {
      throw new Error('unused');
    });
    await expect(fetchRpcAccount('https://rpc.test', G_ADDRESS)).rejects.toThrow('network error');
  });
});

describe('loadRpcAccount', () => {
  it('builds an Account at the on-ledger sequence', async () => {
    stubRpc({
      jsonrpc: '2.0',
      id: 1,
      result: { entries: [{ xdr: accountEntryXdr('777', '10000000', 0) }] },
    });
    const account = await loadRpcAccount('https://rpc.test', G_ADDRESS);
    expect(account.accountId()).toBe(G_ADDRESS);
    expect(account.sequenceNumber()).toBe('777');
  });

  it('throws when the account does not exist', async () => {
    stubRpc({ jsonrpc: '2.0', id: 1, result: { entries: [] } });
    await expect(loadRpcAccount('https://rpc.test', G_ADDRESS)).rejects.toThrow('not found');
  });
});

describe('summarizeRpcTransaction', () => {
  it('returns null for NOT_FOUND', () => {
    expect(summarizeRpcTransaction({ status: 'NOT_FOUND' })).toBeNull();
  });

  it('extracts ledger, timestamp and fee', () => {
    const summary = summarizeRpcTransaction({
      status: 'SUCCESS',
      ledger: 5000,
      createdAt: '1700000000',
      resultXdr: resultXdr('12345'),
    });
    expect(summary).toEqual({
      ledger: 5000,
      createdAt: '2023-11-14T22:13:20.000Z',
      feeCharged: '12345',
    });
  });
});

describe('fetchRpcTransaction', () => {
  it('resolves null when the node does not have the transaction', async () => {
    stubRpc({ jsonrpc: '2.0', id: 1, result: { status: 'NOT_FOUND' } });
    expect(await fetchRpcTransaction('https://rpc.test', 'abc')).toBeNull();
  });
});

function failedResultXdr(code: 'txBadSeq' | 'txInsufficientBalance'): string {
  return new xdr.TransactionResult({
    feeCharged: xdr.Int64.fromString('100'),
    result: xdr.TransactionResultResult[code](),
    ext: new xdr.TransactionResultExt(0),
  }).toXDR('base64');
}

function stubRpcByMethod(handlers: Record<string, () => object>) {
  class FakeXhr {
    status = 200;
    responseText = '';
    timeout = 0;
    onload: () => void = () => {};
    onerror: () => void = () => {};
    ontimeout: () => void = () => {};
    open() {}
    setRequestHeader() {}
    send(body: string) {
      const { method } = JSON.parse(body);
      this.responseText = JSON.stringify({ jsonrpc: '2.0', id: 1, result: handlers[method]() });
      this.onload();
    }
  }
  (globalThis as any).XMLHttpRequest = FakeXhr;
}

describe('txResultCode', () => {
  it('maps SDK result names to Horizon-style codes', () => {
    expect(txResultCode(failedResultXdr('txBadSeq'))).toBe('tx_bad_seq');
    expect(txResultCode(failedResultXdr('txInsufficientBalance'))).toBe('tx_insufficient_balance');
  });
});

describe('submitAndConfirm', () => {
  const fast = { intervalMs: 1, timeoutMs: 200 };

  it('resolves the hash once getTransaction reports SUCCESS', async () => {
    let polls = 0;
    stubRpcByMethod({
      sendTransaction: () => ({ status: 'PENDING', hash: 'h1' }),
      getTransaction: () => ({ status: ++polls < 3 ? 'NOT_FOUND' : 'SUCCESS' }),
    });
    await expect(submitAndConfirm('https://rpc.test', 'xdr', fast)).resolves.toBe('h1');
    expect(polls).toBe(3);
  });

  it('treats DUPLICATE as in flight and keeps polling', async () => {
    stubRpcByMethod({
      sendTransaction: () => ({ status: 'DUPLICATE', hash: 'h2' }),
      getTransaction: () => ({ status: 'SUCCESS' }),
    });
    await expect(submitAndConfirm('https://rpc.test', 'xdr', fast)).resolves.toBe('h2');
  });

  it('rejects with the result code when sendTransaction returns ERROR', async () => {
    stubRpcByMethod({
      sendTransaction: () => ({ status: 'ERROR', errorResultXdr: failedResultXdr('txBadSeq') }),
      getTransaction: () => {
        throw new Error('must not poll after ERROR');
      },
    });
    await expect(submitAndConfirm('https://rpc.test', 'xdr', fast)).rejects.toThrow('tx_bad_seq');
  });

  it('rejects on TRY_AGAIN_LATER', async () => {
    stubRpcByMethod({
      sendTransaction: () => ({ status: 'TRY_AGAIN_LATER' }),
      getTransaction: () => ({}),
    });
    await expect(submitAndConfirm('https://rpc.test', 'xdr', fast)).rejects.toThrow(
      'try_again_later',
    );
  });

  it('rejects with the result code when the transaction lands FAILED', async () => {
    stubRpcByMethod({
      sendTransaction: () => ({ status: 'PENDING', hash: 'h3' }),
      getTransaction: () => ({
        status: 'FAILED',
        resultXdr: failedResultXdr('txInsufficientBalance'),
      }),
    });
    await expect(submitAndConfirm('https://rpc.test', 'xdr', fast)).rejects.toThrow(
      'tx_insufficient_balance',
    );
  });

  it('gives up with a timeout error if it never lands', async () => {
    stubRpcByMethod({
      sendTransaction: () => ({ status: 'PENDING', hash: 'h4' }),
      getTransaction: () => ({ status: 'NOT_FOUND' }),
    });
    await expect(
      submitAndConfirm('https://rpc.test', 'xdr', { intervalMs: 1, timeoutMs: 20 }),
    ).rejects.toThrow('Timed out');
  });
});
