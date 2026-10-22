import { fetchRpcTransaction } from '@/src/api/soroban-rpc';
import { HORIZON_URL, STELLAR_RPC_URL } from '@/src/constants/config';

export interface TxDetails {
  fee: string;
  ledger: string;
  date: string;
}

const UNKNOWN: TxDetails = { fee: '—', ledger: '—', date: '' };

export function formatFeeXlm(stroops: string | number): string {
  const n = typeof stroops === 'number' ? stroops : parseInt(stroops, 10);
  return `${parseFloat((n / 10_000_000).toFixed(7))} XLM`;
}

// RPC only keeps a short ledger window, so a hash from older history is
// NOT_FOUND there even though it exists. Horizon is the fallback for those.
function fetchHorizonTxDetails(hash: string): Promise<TxDetails> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${HORIZON_URL}/transactions/${encodeURIComponent(hash)}`, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.timeout = 12000;
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        resolve({
          fee: formatFeeXlm(data.fee_charged ?? '0'),
          ledger: String(data.ledger ?? '—'),
          date: data.created_at ?? '',
        });
      } catch {
        resolve(UNKNOWN);
      }
    };
    xhr.onerror = () => resolve(UNKNOWN);
    xhr.ontimeout = () => resolve(UNKNOWN);
    xhr.send();
  });
}

export async function fetchTxDetails(hash: string): Promise<TxDetails> {
  try {
    const summary = await fetchRpcTransaction(STELLAR_RPC_URL, hash);
    if (summary) {
      return {
        fee: formatFeeXlm(summary.feeCharged),
        ledger: String(summary.ledger),
        date: summary.createdAt,
      };
    }
  } catch {}
  return fetchHorizonTxDetails(hash);
}
