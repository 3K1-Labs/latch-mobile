/**
 * wallet-backend.ts — typed GraphQL client for the wallet-backend.
 *
 * Targets POST /graphql/query with a wallet-scope JWT (see
 * src/lib/wallet-auth.ts for how the token is acquired). The transport is
 * a raw XHR for the same reason latch-auth.ts uses XHR: Soroban/wallet-backend
 * calls from Android need to go through the platform TLS stack via OkHttp,
 * which Axios bypasses.
 */

import { apiBaseUrl } from '../constants/api-host';

const GRAPHQL_PATH = '/graphql/query';

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

export class GraphQLError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

function xhr<T>(
  url: string,
  body: string,
  accessToken: string,
): Promise<{ status: number; body: GraphQLResponse<T> | null }> {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open('POST', url, true);
    req.setRequestHeader('Content-Type', 'application/json');
    req.setRequestHeader('Accept', 'application/json');
    req.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    req.timeout = 30000;
    req.onload = () => {
      try {
        resolve({ status: req.status, body: JSON.parse(req.responseText) });
      } catch {
        resolve({ status: req.status, body: null });
      }
    };
    req.onerror = () => reject(new Error('Network error'));
    req.ontimeout = () => reject(new Error('Request timed out'));
    req.send(body);
  });
}

/**
 * Send a GraphQL query and return the typed `data` field. Throws
 * GraphQLError when the server returns a `errors[]` payload or the HTTP
 * status is non-2xx. The caller is responsible for token refresh on 401 —
 * see ensureWalletSession in src/lib/wallet-auth.ts.
 */
export async function gqlFetch<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string,
): Promise<T> {
  const body = JSON.stringify({ query, variables });
  const { status, body: resp } = await xhr<T>(`${apiBaseUrl()}${GRAPHQL_PATH}`, body, accessToken);

  if (__DEV__) console.log('[wb-graphql] status=', status, 'resp=', JSON.stringify(resp));

  if (status === 401) throw new GraphQLError('unauthorized', 'UNAUTHORIZED');
  if (status >= 400) throw new GraphQLError(`request failed (${status})`);
  if (!resp) throw new GraphQLError('invalid response body');
  if (resp.errors?.length) {
    const first = resp.errors[0];
    throw new GraphQLError(first.message, first.extensions?.code);
  }
  if (!resp.data) throw new GraphQLError('response missing data');
  return resp.data;
}

// ─── Connection shapes ───────────────────────────────────────────────────────

export interface PageInfo {
  startCursor: string | null;
  endCursor: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Edge<T> {
  node: T;
  cursor: string;
}

export interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
}

// ─── Entity shapes (subset the mobile UI actually consumes) ──────────────────

export interface Transaction {
  hash: string;
  feeCharged: number;
  resultCode: string;
  ledgerNumber: number;
  ledgerCreatedAt: string;
  isFeeBump: boolean;
}

export interface Operation {
  id: number;
  operationType: string;
  operationXdr: string;
  resultCode: string;
  successful: boolean;
  ledgerNumber: number;
  ledgerCreatedAt: string;
}

export interface StateChange {
  type: string;
  reason: string;
  ledgerNumber: number;
  ledgerCreatedAt: string;
  tokenId?: string;
  amount?: string;
}

// ─── Query helpers ───────────────────────────────────────────────────────────

const ACCOUNT_TRANSACTIONS = `
  query AccountTransactions($address: String!, $first: Int, $after: String) {
    accountByAddress(address: $address) {
      transactions(first: $first, after: $after) {
        edges {
          node {
            hash
            feeCharged
            resultCode
            ledgerNumber
            ledgerCreatedAt
            isFeeBump
          }
          cursor
        }
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      }
    }
  }
`;

const ACCOUNT_OPERATIONS = `
  query AccountOperations($address: String!, $first: Int, $after: String) {
    accountByAddress(address: $address) {
      operations(first: $first, after: $after) {
        edges {
          node {
            id
            operationType
            operationXdr
            resultCode
            successful
            ledgerNumber
            ledgerCreatedAt
          }
          cursor
        }
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      }
    }
  }
`;

const ACCOUNT_STATE_CHANGES = `
  query AccountStateChanges($address: String!, $first: Int, $after: String) {
    accountByAddress(address: $address) {
      stateChanges(first: $first, after: $after) {
        edges {
          node {
            type
            reason
            ledgerNumber
            ledgerCreatedAt
            ... on StandardBalanceChange { tokenId amount }
          }
          cursor
        }
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      }
    }
  }
`;

// AccountHistory pulls the users balance-affecting state changes plus the
// counterparty side of each transfer in a single query. Used by
// use-stellar-transactions.ts to render the activity feed.
const ACCOUNT_HISTORY = `
  query AccountHistory($address: String!, $first: Int, $after: String) {
    accountByAddress(address: $address) {
      stateChanges(first: $first, after: $after) {
        edges {
          node {
            type
            reason
            ledgerNumber
            ledgerCreatedAt
            transaction { hash }
            operation {
              id
              operationType
              stateChanges(first: 10) {
                edges {
                  node {
                    type
                    reason
                    account { address }
                    ... on StandardBalanceChange { tokenId amount }
                  }
                }
              }
            }
            ... on StandardBalanceChange { tokenId amount }
          }
          cursor
        }
        pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
      }
    }
  }
`;

interface AccountWrap<K extends string, V> {
  accountByAddress: { [P in K]: V } | null;
}

async function paginate<T>(
  query: string,
  field: 'transactions' | 'operations' | 'stateChanges',
  address: string,
  first: number,
  after: string | undefined,
  accessToken: string,
): Promise<Connection<T>> {
  const data = await gqlFetch<AccountWrap<typeof field, Connection<T> | null>>(
    query,
    { address, first, after: after ?? null },
    accessToken,
  );
  return data.accountByAddress?.[field] ?? emptyConnection<T>();
}

function emptyConnection<T>(): Connection<T> {
  return {
    edges: [],
    pageInfo: { startCursor: null, endCursor: null, hasNextPage: false, hasPreviousPage: false },
  };
}

export function fetchAccountTransactions(
  address: string,
  first: number,
  after: string | undefined,
  accessToken: string,
): Promise<Connection<Transaction>> {
  return paginate<Transaction>(
    ACCOUNT_TRANSACTIONS,
    'transactions',
    address,
    first,
    after,
    accessToken,
  );
}

export function fetchAccountOperations(
  address: string,
  first: number,
  after: string | undefined,
  accessToken: string,
): Promise<Connection<Operation>> {
  return paginate<Operation>(ACCOUNT_OPERATIONS, 'operations', address, first, after, accessToken);
}

export function fetchAccountStateChanges(
  address: string,
  first: number,
  after: string | undefined,
  accessToken: string,
): Promise<Connection<StateChange>> {
  return paginate<StateChange>(
    ACCOUNT_STATE_CHANGES,
    'stateChanges',
    address,
    first,
    after,
    accessToken,
  );
}

// ─── Balances ────────────────────────────────────────────────────────────────

export interface WalletBackendBalance {
  tokenId: string;
  balance: string; // already human-readable, 7 decimals
  tokenType: 'NATIVE' | 'CLASSIC' | 'SAC';
  code?: string;
  issuer?: string;
}

const ACCOUNT_BALANCES = `
  query AccountBalances($address: String!, $first: Int) {
    accountByAddress(address: $address) {
      balances(first: $first) {
        edges {
          node {
            tokenId
            balance
            tokenType
            ... on SACBalance { code issuer }
            ... on TrustlineBalance { code issuer }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

export async function fetchAccountBalances(
  address: string,
  accessToken: string,
): Promise<WalletBackendBalance[]> {
  const data = await gqlFetch<AccountWrap<'balances', Connection<WalletBackendBalance> | null>>(
    ACCOUNT_BALANCES,
    { address, first: 50 },
    accessToken,
  );
  const edges = data.accountByAddress?.balances?.edges ?? [];
  return edges.map((e) => e.node);
}

// ─── History (state changes + counterparty side) ─────────────────────────────

export interface HistoryStateChange {
  type: string; // BALANCE | ACCOUNT | ...
  reason: string; // DEBIT | CREDIT | MINT | BURN | ...
  ledgerNumber: number;
  ledgerCreatedAt: string;
  transaction: { hash: string };
  operation: {
    id: number;
    operationType: string;
    stateChanges: Connection<{
      type: string;
      reason: string;
      account: { address: string };
      tokenId?: string;
      amount?: string;
    }>;
  } | null;
  tokenId?: string;
  amount?: string;
}

export function fetchAccountHistory(
  address: string,
  first: number,
  after: string | undefined,
  accessToken: string,
): Promise<Connection<HistoryStateChange>> {
  return paginate<HistoryStateChange>(
    ACCOUNT_HISTORY,
    'stateChanges',
    address,
    first,
    after,
    accessToken,
  );
}
