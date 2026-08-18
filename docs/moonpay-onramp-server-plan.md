# MoonPay On-Ramp — Server-Side Plan

Scope: the three blockers that prevent a MoonPay purchase from crediting a user's
smart account. This file covers the parts that live outside latch-mobile —
**latch-relayer** and **latch-backend**. The mobile counterparts are in
[moonpay-onramp-mobile-plan.md](./moonpay-onramp-mobile-plan.md).

Nothing here blocks the direct Fund-sheet deposit path, which is verified working
end to end on testnet (intent → `Memo.id()` payment → SAC `transfer` forward,
~6s). These are specific to the MoonPay leg.

---

## Status of each blocker

| # | Blocker | Owner | Mobile half? |
|---|---------|-------|--------------|
| S1 | Relayer rejects TEXT memos | latch-relayer | none — purely server |
| S2 | MoonPay widget URL is unsigned | latch-backend | yes — see M2 |
| S3 | Intent TTL too short for bank-transfer settlement | latch-backend | yes — see M1 |

---

## S1 — Accept a numeric MEMO_TEXT (highest value, smallest change)

### Why

`internal/memo/memo.go:27-36` hard-rejects any memo whose type is not `id`:

```go
func ParseID(memoType, memo string) (uint64, error) {
	if memoType != "id" { return 0, ErrNotMemoID }
	...
}
```

`internal/service/watcher/watcher.go:97-107` routes every parse failure to the
sweep branch, so the deposit goes to `RECOVERY_ADDRESS` and is never credited.

MoonPay does not document which Stellar memo type it emits. Their help centre
describes the XLM memo as "alpha-numeric", which is how MEMO_TEXT is described —
MEMO_ID is strictly a uint64. If they send TEXT, **every MoonPay deposit is swept.**

This is not hypothetical. The testnet pool already shows a 0.9481 XLM deposit on
2026-07-28 swept to recovery the following morning.

### Why fix it here rather than wait on MoonPay

Accepting numeric TEXT removes the dependency on *every* provider's memo-type
choice, not just MoonPay's — including a human who picks "Text" instead of "ID"
in their own wallet, which is the single most likely way a real user loses a
deposit. The memo space is random uint64, so digits-arriving-as-text collide with
nothing. A uint64 is at most 20 digits; MEMO_TEXT holds 28 bytes.

### Change

`internal/memo/memo.go` — accept both types, keep the uint64 contract:

```go
var (
	ErrUnsupportedMemoType = errors.New("memo type is not MEMO_ID or MEMO_TEXT")
	ErrInvalidMemoID       = errors.New("memo value is not a valid uint64")
)

// ParseID parses an intent memo from a Horizon payment event.
//
// Both MEMO_ID and MEMO_TEXT are accepted: some on-ramps (MoonPay) and wallet
// UIs send the tag as text even when the digits are a valid uint64, and a memo
// we refuse here is swept to the recovery address rather than credited. The
// value must still parse as a uint64 — memo IDs are random uint64s, so a text
// memo that happens to match an existing intent is not a realistic collision.
func ParseID(memoType, memo string) (uint64, error) {
	if memoType != "id" && memoType != "text" {
		return 0, ErrUnsupportedMemoType
	}
	id, err := strconv.ParseUint(strings.TrimSpace(memo), 10, 64)
	if err != nil {
		return 0, ErrInvalidMemoID
	}
	return id, nil
}
```

`TrimSpace` because a copy-pasted tag routinely carries a trailing space.

`ErrNotMemoID` is referenced by name in `memo_test.go`; rename both together or
keep the old identifier as an alias to avoid touching the watcher.

### Tests — `internal/memo/memo_test.go`

The existing table has a `"wrong memo type"` case asserting `text/"some text"`
→ `ErrNotMemoID`. Update it and add:

| case | memoType | memo | expect |
|---|---|---|---|
| numeric text memo accepted | `text` | `"3891273648291034"` | `3891273648291034` |
| non-numeric text rejected | `text` | `"some text"` | `ErrInvalidMemoID` |
| text memo with trailing space | `text` | `"3891273648291034 "` | `3891273648291034` |
| hash memo rejected | `hash` | `<base64>` | `ErrUnsupportedMemoType` |
| no memo rejected | `none` | `""` | `ErrUnsupportedMemoType` |
| uint64 max | `text` | `"18446744073709551615"` | max uint64 |
| overflow rejected | `text` | `"18446744073709551616"` | `ErrInvalidMemoID` |

### Verify before shipping

**Confirm how Horizon renders a TEXT memo on the SSE stream.** For MEMO_TEXT
Horizon is expected to return the UTF-8 string directly in `memo` (unlike
`hash`/`return`, which are base64). If it were base64 here, `ParseUint` would
fail and the fix would silently do nothing. Do not take this on trust — send a
testnet payment to the pool with `Memo.text("<memo_id>")` and read the watcher
log line at `watcher.go:99` (it already logs `memo_type` and `memo`).

Then re-run the full path with a text memo and assert `forwards[0].status ==
"done"` with a `forward_tx`, same as the `Memo.id()` run.

```bash
make test && make vet
```

Deploy: relayer is a separate service on Render; S1 has no effect until it ships.

---

## S2 — Signed MoonPay widget URL

### Why

MoonPay requires a signed URL whenever `walletAddress` is pre-filled. Today
`BuyXLMSheet.tsx:27-39` assembles the URL in the app. Unsigned, MoonPay rejects
or drops the pre-filled address and tag — and a dropped tag is the same sweep as
S1.

The signature is HMAC-SHA256 over the query string using the MoonPay **secret**
key (`sk_live_…`). That key cannot ship in the bundle next to
`EXPO_PUBLIC_MOONPAY_API_KEY`, so the endpoint has to exist server-side.

### Endpoint

`POST /v1/onramp/moonpay/widget-url` (authenticated, same session as the other
`/v1/accounts/*` routes).

Request — deliberately **not** a free-form URL, so a caller cannot have the
server sign arbitrary parameters:

```json
{ "smart_account_address": "C...", "currency_code": "xlm", "base_currency_amount": "50" }
```

Response:

```json
{ "url": "https://buy.moonpay.com?apiKey=…&signature=…", "memo_id": "…", "expires_at": "…" }
```

### Handler outline

1. Resolve the caller's smart account from the session; **ignore any C-address in
   the body** — the whole point of signing is that the client cannot swap the
   destination.
2. Mint the funding intent (see S3 for the TTL) → `memo_id`, `pool_address`.
3. Build the query string: `apiKey`, `currencyCode`, `walletAddress=<pool_address>`,
   `walletAddressTag=<memo_id>`, plus any amount/redirect params.
4. URL-encode each parameter **value** before signing — MoonPay validates against
   the encoded form.
5. Sign the query string **including its leading `?`**, HMAC-SHA256, base64.
6. Append as `&signature=<urlencoded base64>`.

Reference (MoonPay's own Node sample, for the shape — port to Go):

```js
crypto.createHmac('sha256', 'sk_live_key')
      .update(new URL(url).search)   // query string WITH the leading '?'
      .digest('base64');
```

### Notes

- Sign with `sk_test_` against MoonPay's sandbox first; the test and live keys
  produce different signatures and the widget rejects a mismatch.
- Never log the signed URL at info level — it embeds the pool address and the
  memo, which together identify the user's funding session.
- `walletAddressTag` is documented as applying to EOS, XLM, XRP and XMR, and is
  ignored unless `walletAddress` and `currencyCode` are both present.

---

## S3 — Intent TTL and field pass-through

### Why

Intents default to 1 hour (`handler.go:110-114`). Card purchases usually settle
inside that; ACH/SEPA bank transfers can take **days**. An expired `memo_id` is
swept exactly like an unknown one, so a slow MoonPay settlement silently loses
the deposit.

The relayer already accepts `expires_in` per intent — it is simply never sent.

### Unverified, check first

`reference/latch-api` and `reference/wallet-backend` are both **stale**: neither
local copy contains any deposit code, yet the deployed backend clearly implements
the routes (401 on `/v1/accounts/deposit-intent` and
`/v1/accounts/deposit/status/{memo_id}`, 404 on bogus paths under the same
prefix). So the proxy's request shape cannot be read from this repo.

Before implementing, confirm against the deployed handler whether it forwards
`expires_in`, `external_id` and `expected_amt` to the relayer, or drops them.
The mobile side already sends `expected_amt`/`external_id` optimistically; they
are harmless if ignored, but they do nothing until the proxy passes them on.

### Change

1. Accept `expires_in`, `external_id`, `expected_amt` on
   `POST /v1/accounts/deposit-intent` and forward to the relayer's `POST /intents`.
2. Clamp `expires_in` server-side — a client-chosen TTL should not be unbounded.
   Suggested: default 3600, max 604800 (7 days) to cover bank settlement.
3. For the S2 widget-URL endpoint, mint with the long TTL by default, since every
   intent it creates is by definition on-ramp-originated.

### Coverage gate

latch-api enforces a hard ≥80% total test coverage. Budget for handler + service
tests on both the widget-URL endpoint and the pass-through fields, not just the
happy path — the signing helper in particular deserves a fixed-key/fixed-input
vector test so a refactor cannot silently change the signature.

---

## Suggested order

1. **S1** — cheapest, highest value, independent of MoonPay's timeline, and
   hardens the manual-send path too. Ship this even if MoonPay slips.
2. **S3** — small, and S2 depends on it for the long-TTL mint.
3. **S2** — largest piece; only worth starting when MoonPay is actually being wired.

---

## Sources

- [MoonPay on-ramp widget parameters](https://dev.moonpay.com/docs/ramps-sdk-buy-params)
- [MoonPay URL signing](https://dev.moonpay.com/docs/on-ramp-enhance-security-using-signed-urls)
- [MoonPay: About destination tags and memos](https://support.moonpay.com/en/articles/384513-about-destination-tags-and-memos)
- [Stellar memo types](https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/memos)
