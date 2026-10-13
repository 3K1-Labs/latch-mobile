import type { HistoryStateChange } from '../api/wallet-backend';
import type { StellarPayment } from '../hooks/use-stellar-transactions';

export type AssetInfo = { code?: string; assetType: string };
export type AssetInfoLookup = (tokenId: string | undefined) => AssetInfo;

/**
 * Wallet-backend state-change edges → unclassified payments. Only
 * balance-affecting changes are kept. The counterparty is the opposite balance
 * change on the same operation, for the same token, on a different account.
 */
export function mapHistoryToPayments(
  edges: { node: HistoryStateChange }[],
  cAddress: string,
  assetInfoFor: AssetInfoLookup,
): StellarPayment[] {
  const out: StellarPayment[] = [];

  for (const { node: change } of edges) {
    if (change.type.toUpperCase() !== 'BALANCE') continue;

    const reason = change.reason.toUpperCase();
    const isCredit = reason === 'CREDIT' || reason === 'MINT';
    const isDebit = reason === 'DEBIT' || reason === 'BURN';
    if (!isCredit && !isDebit) continue;

    const counter = change.operation?.stateChanges.edges.find(({ node: c }) => {
      const r = c.reason.toUpperCase();
      const opposite = isCredit ? r === 'DEBIT' || r === 'BURN' : r === 'CREDIT' || r === 'MINT';
      return (
        opposite &&
        c.account.address !== cAddress &&
        c.tokenId === change.tokenId &&
        c.type.toUpperCase() === 'BALANCE'
      );
    });
    const counterAddress = counter?.node.account.address ?? '';
    const info = assetInfoFor(change.tokenId);

    out.push({
      id: change.operation?.id?.toString() ?? change.transaction.hash,
      transactionHash: change.transaction.hash,
      type: change.operation?.operationType ?? 'unknown',
      txType: 'unknown',
      from: isCredit ? counterAddress : cAddress,
      to: isCredit ? cAddress : counterAddress,
      amount: change.amount ?? '0',
      assetType: info.assetType,
      assetCode: info.code,
      createdAt: change.ledgerCreatedAt,
    });
  }

  return out;
}

export function assetInfoFromSacMap(
  sacInfo: Map<string, { code: string; assetType: string }>,
): AssetInfoLookup {
  return (tokenId) => {
    if (!tokenId) return { assetType: 'native' };
    const info = sacInfo.get(tokenId);
    if (!info) return { assetType: 'credit_alphanum4' };
    return info.code === 'XLM' ? { assetType: 'native' } : { code: info.code, assetType: info.assetType };
  };
}
