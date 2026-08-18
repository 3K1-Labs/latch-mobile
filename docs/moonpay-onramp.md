# MoonPay On-Ramp Integration

> **⚠️ The memo model below is superseded.** Everything from "Solution" onward
> describes the original in-backend watcher, which used a *permanent per-user
> TEXT memo* (`LT` + 8 hex). What actually ships is **latch-relayer**
> (`reference/latch-relayer`, deployed at `https://latch-relayer.onrender.com`).
> Kept for historical context; do not implement against it.
>
> **Current model — per-session MEMO_ID with a TTL:**
>
> | | Superseded | Current (latch-relayer) |
> |---|---|---|
> | Memo type | `MEMO_TEXT` | **`MEMO_ID`** (numeric) — `memo.ParseID` rejects everything else |
> | Memo value | `LT` + 8 hex, 10 chars | random `uint64`, e.g. `6526693008473226183` |
> | Lifetime | permanent per user | **one funding session, default 1h TTL** |
> | Minted by | `GetOrCreateDepositInfo(userID)` | `POST /intents { c_address, expected_amt?, external_id?, expires_in? }` |
> | Status | `deposit_jobs` polling | `GET /deposit/status/{memo_id}` → intent + `forwards[]` |
> | Unknown/expired memo | job marked `failed`, manual recovery | **swept to the relayer's `RECOVERY_ADDRESS`** |
>
> Consequences the mobile app must honour, and where:
> - Never cache a memo across sessions or treat it as stable
>   (`useCreateDepositIntent` mints per Fund-flow open; `isDepositIntentExpired`
>   suppresses it once the TTL lapses).
> - Always present it as memo **type ID**. A TEXT memo carrying the right digits
>   is still swept to recovery — it is not credited to the user.
> - The relayer is a single deployment bound to one network. `EXPO_PUBLIC_RELAYER_NETWORK`
>   + `isDepositRelayerAvailable()` gate intent creation so a mainnet user is never
>   handed a testnet pool address.

## Problem

MoonPay can only send XLM to a **G-address** (a classic Stellar account). Latch users hold funds inside a **C-address** (a Soroban smart account). MoonPay has no concept of a Soroban smart account and cannot send directly to one.

---

## Solution: Pool G-Address Relayer

A single **pool G-address** receives all incoming MoonPay deposits. Each user is assigned a permanent **memo tag** (10 chars, format `LT` + 8 hex chars). When MoonPay sends XLM it includes this memo. The backend matches the memo to a user, then forwards the XLM to their smart account via a Soroban `transfer()` call on the native XLM SAC.

```
MoonPay → pool G-address (TEXT memo: "LTabcd1234")
              ↓
        Horizon SSE watcher detects payment
              ↓
        Fetch tx memo → look up user → insert deposit job
              ↓
        Worker polls jobs → build + sign InvokeHostFunction tx
              ↓
        XLM SAC transfer(pool, smartAccount, amount)
              ↓
        User's C-address receives XLM
```

---

## Backend

### Environment Variables

| Variable | Description |
|---|---|
| `POOL_SECRET_KEY` | Ed25519 secret key (S-address) of the pool account |
| `POOL_ADDRESS` | G-address corresponding to `POOL_SECRET_KEY` |
| `POOL_NETWORK` | `testnet` or `mainnet` (selects Horizon URL + RPC URL + SAC ID) |

If `POOL_SECRET_KEY` and `POOL_ADDRESS` are both unset the watcher and worker goroutines do not start; the deposit API endpoints still function (users can get their memo) but no forwarding occurs.

### Database Tables (`000014_deposit`)

**`deposit_memos`** — one permanent memo per user

| Column | Type | Notes |
|---|---|---|
| `user_id` | UUID PK → users | |
| `memo` | VARCHAR(28) UNIQUE | `LT` + 8 random hex chars |
| `created_at` | TIMESTAMPTZ | |

**`deposit_jobs`** — one row per detected incoming payment

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `stellar_op_id` | VARCHAR(64) UNIQUE | idempotency key — `ON CONFLICT DO NOTHING` |
| `user_id` | UUID nullable | null when memo is unrecognised |
| `smart_account` | VARCHAR(64) nullable | C-address to forward to |
| `amount_stroops` | BIGINT | |
| `status` | VARCHAR(20) | `pending` / `done` / `failed` |
| `attempts` | INT | incremented on each worker attempt |
| `last_error` | TEXT nullable | last failure reason |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |
| `processed_at` | TIMESTAMPTZ nullable | set on `done` |

**`deposit_watcher_cursor`** — single-row table holding the Horizon paging cursor

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK DEFAULT 1 | always row 1 |
| `cursor` | VARCHAR(64) | Horizon paging token; starts as `"now"` |
| `updated_at` | TIMESTAMPTZ | |

### Services

**`deposit_watcher.go`**

Streams `GET /accounts/{pool}/payments?cursor={cursor}&order=asc` via Horizon SSE. For each native XLM payment arriving at the pool:

1. Fetch the transaction to read the TEXT memo.
2. Look up the user by memo (`deposit_memos`).
3. In a single DB transaction: insert the deposit job + advance the cursor.

The atomic job+cursor write ensures a crash between the two steps cannot create a silent gap or a double-processed payment.

**`deposit_worker.go`**

Polls `deposit_jobs WHERE status = 'pending'` every 5 seconds. For each job:

- If `smart_account` is null (unknown memo): mark `failed` with reason `unknown_memo`.
- Otherwise: build and submit an `InvokeHostFunction` transaction calling `transfer(pool, smartAccount, amount)` on the native XLM SAC.
- On success: mark `done`, set `processed_at`.
- On failure: increment `attempts`; mark `failed` after 3 attempts.

Signing: `SHA256(networkPassphraseHash || ENVELOPE_TYPE_TX || rawTxXDR)`. XDR bytes are obtained via `xdr.MarshalBase64(tx)` then `base64.StdEncoding.DecodeString()` (no `MarshalBinary` in go-stellar-sdk v0.5.0).

Soroban RPC submission uses `submitAndWait` with a 60-second deadline and 2-second polling interval.

**`deposit_service.go`**

- `GetOrCreateDepositInfo(userID)` — upserts the user's memo, returns `{ pool_address, memo }`.
- `GetDepositStatus(userID)` — returns up to 10 jobs ordered newest first.

### API Endpoints

Both endpoints require `Bearer` JWT auth.

#### `GET /v1/deposit`

Returns the pool G-address and the caller's permanent memo.

```json
{
  "data": {
    "pool_address": "GABCDE...",
    "memo": "LTa1b2c3d4"
  }
}
```

The mobile calls this once on the home screen. Pass `pool_address` as MoonPay's `walletAddress` and `memo` as `walletAddressTag`.

#### `GET /v1/deposit/status`

Returns up to 10 recent deposit jobs, newest first.

```json
{
  "data": {
    "jobs": [
      {
        "id": 1,
        "stellar_op_id": "215569040068608001",
        "amount_stroops": 100000000,
        "status": "done",
        "created_at": "2026-06-25T12:00:00Z",
        "processed_at": "2026-06-25T12:00:05Z"
      }
    ]
  }
}
```

Job `status` values: `pending`, `done`, `failed`.

---

## Mobile

### API Layer (`src/api/latch-auth.ts`)

```typescript
fetchDepositInfo()   → Promise<{ pool_address: string; memo: string }>
fetchDepositStatus() → Promise<{ jobs: DepositJob[] }>
```

Both use the existing `latchFetch` XHR pattern (401 → silent refresh → retry). `fetchDepositStatus` returns `{ jobs: [] }` when unauthenticated rather than throwing, so the status sheet degrades gracefully.

### Hooks (`src/hooks/use-deposit.ts`)

```typescript
useDepositInfo()           // staleTime: Infinity — pool address and memo never change per user
useDepositStatus(enabled)  // refetchInterval: 15 000 ms when enabled=true, disabled otherwise
```

`useDepositStatus` is gated on `enabled` so it only fetches (and polls) while the Funding Status sub-sheet is open.

### Home Screen (`app/(tabs)/index.tsx`)

`useDepositInfo()` is called once. The `pool_address` and `memo` it returns replace the user's own G-address in both funding sheets. Before the query resolves, both sheets receive empty strings and degrade gracefully (MoonPay opens without a wallet address pre-filled; the QR code is blank).

### `BuyXLMSheet`

Opens MoonPay via `expo-web-browser`:

```
https://buy.moonpay.com
  ?apiKey=...
  &currencyCode=xlm
  &showOnlyCurrencies=xlm
  &walletAddress={pool_address}
  &walletAddressTag={memo}
```

### `FundWalletSheet`

Displays the pool G-address (not the user's C-address) in the "Proxy G-Address" field and the memo in the "Memo (Required)" field. The QR code also encodes the pool address.

Calls `useDepositStatus(statusVisible)` and maps the most recent job to the `FundingStatusSheet` stepper:

| Job status | Step 3 (Forward) | Step 4 (Complete) | Label |
|---|---|---|---|
| `pending` | inactive | inactive | Pending |
| `done` | success | success | Completed |
| `failed` | error | inactive | Failed |

---

## Limitations

- **One pool account for all users.** A compromised `POOL_SECRET_KEY` exposes all in-flight deposits. Move to per-user escrow accounts or a server-side signing service before high-volume production use.
- **`POOL_SECRET_KEY` is a server secret**, not embedded in the mobile app. Keep it in the backend environment only.
- **No off-ramp.** MoonPay sell flows require sending XLM from the user's address; the current architecture supports on-ramp only.
- **`unknown_memo` jobs are marked failed after 3 attempts.** XLM sent to the pool without a valid memo is not recoverable automatically — requires manual intervention.
- **Testnet only until audited.** The worker's signing and SAC transfer logic needs an independent audit before mainnet use.
