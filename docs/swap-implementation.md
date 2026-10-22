# Swap Implementation Plan

Status: **Implemented (single-signer v1)** — lint + typecheck clean; Soroswap
provider verified live via `scripts/verify-swap.js` (read-only mainnet PASS:
quote → build → invokeHostFunction extraction).
Network: testnet (`ACTIVE_NETWORK = TESTNET_NETWORK`)
Scope: single-signer v1; multisig deferred

## Verification results (`node scripts/verify-swap.js`, 2026-06-16)

PASS on mainnet (read-only — quote/build cost nothing): `/quote` returns the
exact fields the provider reads (`amountOut`, `otherAmountThreshold`,
`priceImpactPct`); `/quote/build` returns an `xdr`; parsing it yields
`operations[0].type === 'invokeHostFunction'` — the op `buildSwapOperation`
extracts. Auth (`Bearer`), the `?network=` query param, and the request body are
all confirmed against the live API.

### Findings
0. **`POST /quote/build` stopped working for smart accounts — RESOLVED (build
   locally).** That endpoint expects `from` to be a classic G wallet; handed
   our smart account's C-address it either 400s or returns an operation that
   doesn't match what we simulate and sign, so mainnet swaps stopped
   completing. `buildSwapOperation` now encodes the aggregator's
   `swap_exact_tokens_for_tokens` DexDistribution locally from the raw
   `/quote`'s `rawTrade.distribution` (`providers/soroswap-distribution.ts`),
   the same fix latch-web-extension shipped in `providers/soroswap.ts`
   (commit 15d60ea) — no `/quote/build` call left in the provider. Because
   Soroswap's `/quote` `amountOut` can disagree with on-chain execution, the
   build probe-simulates with `amountOutMin=0` first, reads the real output,
   and rebuilds with a slippage-calibrated minimum (stricter of that and the
   quote's own threshold) before returning the operation — ported from the
   same extension commit. The local `DexDistribution` encoder has no case for
   `sdex` (the classic order book isn't a leg it can name); `getQuote` keeps
   requesting it for price discovery, and `buildSwapOperation` falls back to
   the existing single-AMM route (finding 1) if the winning route picks it.
1. **Aggregator route with an unbuildable leg (bad poolHashes, or `sdex` —
   see finding 0) — RESOLVED (single-AMM fallback).** `getQuote` uses
   `['soroswap','phoenix','sdex']` for best price (`aqua` stays blocklisted at
   the symbol level — see the `PROTOCOLS` comment in `providers/soroswap.ts`
   for the mispriced-pool finding). If the winning route names a leg
   `soroswap-distribution.ts` can't encode, `buildSwapOperation` re-quotes with
   `['soroswap']` and builds that route instead. Because the fallback route is
   built from its **own fresh quote**, its on-chain `amountOutMin` (slippage
   guard) is correct for what actually executes. `buildSwapOperation` returns a
   `SwapBuildResult { operation, effectiveQuote }`; `confirm.tsx` reports
   `effectiveQuote.amountOut`, so the success copy reflects the route that ran,
   not the (possibly higher) aggregator estimate the user saw pre-confirm.
   Verified live on mainnet (pre-finding-0, against the old `/quote/build`
   flow) that this fallback builds an `invokeHostFunction` op when the
   aggregator route rejects. **Remaining UX gap:** the pre-confirm screen still
   shows the aggregator estimate; if the fallback fires the executed amount can
   be lower (still ≥ the fallback route's min-out). A pre-confirm re-quote /
   re-confirm is a possible future polish, not done here.
2. **Testnet liquidity — RESOLVED via Aquarius.** Soroswap has **0 testnet
   pools** (`GET /pools?network=testnet`), so real swaps can't route there. But
   **Aquarius** has real testnet liquidity (~80 pools incl. XLM↔USDC with the
   app's own `GBBD47IF` USDC). Added `src/services/swap/providers/aquarius.ts`,
   used on testnet by the registry; Soroswap stays for mainnet; the mock is now
   opt-in via `EXPO_PUBLIC_SWAP_USE_MOCK=true`.
   - Discovery: Aquarius AMM API `amm-api-testnet.aqua.network/.../pools/`
     (gives canonical `tokens_addresses` + `index` per pool).
   - Quote: router `estimate_swap(tokens, token_in, token_out, pool_index, in_amount)`
     via read-only Soroban simulation (XHR; throwaway source key — no bundler dep).
   - Execute: router `swap(user=smartAccount, tokens, token_in, token_out,
     pool_index, in_amount, out_min)` — authorized by the smart account exactly
     like a SAC transfer (reuses executeSwapFromSmartAccount/...Passkey).
   - Router (testnet): `CBCFTQSPDBAIZ6R6PJQKSQWKNKWH2QIV3I4J72SHWBIK3ADRRAM5A6GD`
     (ABI confirmed on-chain; overridable via `EXPO_PUBLIC_AQUARIUS_ROUTER` since
     Aquarius resets testnet quarterly). Assumes 7-dp tokens (XLM + classic SACs).
   - Verified live: `estimate_swap` for XLM→USDC returned 1 XLM ≈ 0.786 USDC.
   - Not yet done: an actual on-chain `swap` submit from a funded smart account
     (the execute path is identical to the proven send flow).

Still pending: an actual on-chain testnet swap submit from a funded smart
account (blocked on finding #2).

## Implemented files

- `src/services/swap/types.ts` — `SwapProvider` interface + quote types
- `src/services/swap/providers/soroswap.ts` — Soroswap Aggregator API
  (`POST /quote?network=...`, `Authorization: Bearer`); `buildSwapOperation`
  encodes the aggregator's `swap_exact_tokens_for_tokens` invocation locally
  from the quote's `rawTrade.distribution` (see finding 0) rather than calling
  `POST /quote/build`, so it never carries any auth to strip — the
  smart-account auth is derived from scratch during execute-swap.ts's own
  simulate pass, exactly like `providers/aquarius.ts`
- `src/services/swap/providers/soroswap-distribution.ts` — pure
  `DexDistribution` encode/decode helpers `buildOpFromRawQuote` uses
- `src/services/swap/registry.ts` — provider registry
- `src/services/swap/execute-swap.ts` — `executeSwapFromSmartAccount` /
  `executeSwapFromPasskeyAccount`, parallel to `sendTokenFromSmartAccount`
  (reuses exported `signSmartAccountAuthEntry`, `signPasskeyAuthEntry`,
  `resolveRegisteredWebAuthnVerifier`, `loadAccount`, `toBaseUnits`)
- `src/hooks/use-swap-quote.ts` — debounced React Query quote hook
- `src/components/swap/SwapTokenPickerSheet.tsx` — new bottom-sheet token picker
- `src/components/swap/token-image.ts` — local-asset icon map for `SwapCard`
- Wired `app/(tabs)/swap.tsx` (real tokens/balances/quote + picker → confirm) and
  `app/swap/confirm.tsx` (re-quote, `TxAuthModal`, execute → thank-you)
- `env.js` + `src/constants/config.ts` — `EXPO_PUBLIC_SOROSWAP_API_URL` /
  `EXPO_PUBLIC_SOROSWAP_API_KEY`, `SOROSWAP_NETWORK`

Notes: `resolveRegisteredWebAuthnVerifier` was changed from private to `export`
in `send-token.ts` (additive). Token icons reuse the existing `LiquidMesh.png`
asset for the Soroswap route row (no Soroswap brand asset bundled yet). The MEV
toggle is UI-only.

---

## 1. Context & constraints

Verified against the current codebase before planning:

- **The swap UI already exists and is entirely mock-driven.**
  - `app/(tabs)/swap.tsx` — hardcoded `TOKENS` array, mock "LiquidMesh" route,
    fixed rate / slippage / min-received strings.
  - `app/swap/confirm.tsx` — hardcoded spend/receive amounts, provider, network
    fee; "Confirm Swap" navigates straight to `/(auth)/thank-you`.
  - `src/components/swap/SwapCard.tsx` — the reusable from/to card.
  - Nothing is wired to chain.
  - **Implication:** we wire data into these existing components — we do **not**
    rewrite the JSX. Any genuinely-new sub-component is confirmed before adding.

- **Latch is a Soroban smart-account wallet.** Funds live in the smart account
  contract's SAC balances and all spends pass through the contract's
  `__check_auth`. A swap must therefore be a **Soroban contract invocation
  authorized by the smart account**, mirroring `sendTokenFromSmartAccount`
  (bundler is the outer tx source / fee-payer; the user keypair signs only the
  Soroban auth entry). It is **not** a classic Stellar path-payment — the smart
  account holds no classic G-address signatures over its SAC balances.

- **Soroswap is already the de-facto ecosystem partner.** `src/api/token-list.ts`
  already fetches the Soroswap token list. Soroswap's **Aggregator API**
  (best-price routing across Soroswap / Phoenix / Aqua AMMs) is the "liquidity
  aggregation partner" the mock UI gestures at, and becomes our first provider.

- **No swap service or aggregator config exists yet.**

## 2. Decisions

| Decision | Choice |
|---|---|
| Routing/liquidity source | **Pluggable `SwapProvider` abstraction**, with the **Soroswap Aggregator API** as the first concrete implementation |
| Signing scope (v1) | **Single-signer** — mirror `sendTokenFromSmartAccount`. Multisig cosign swap deferred (will reuse `multisig-send.ts` aggregation) |

## 3. Architecture

```
src/services/swap/
  types.ts              SwapProvider interface, SwapQuote, SwapQuoteParams, SwapToken
  providers/
    soroswap.ts         Soroswap Aggregator API impl (getQuote + buildSwapOperation)
  registry.ts           getActiveSwapProvider() / listSwapProviders()
  execute-swap.ts       executeSwapFromSmartAccount / executeSwapFromPasskeyAccount
src/hooks/
  use-swap-quote.ts     React Query, debounced; drives Route/Rate/Slippage/Min.Received
```

### 3.1 `SwapProvider` interface (`src/services/swap/types.ts`)

```ts
interface SwapProvider {
  id: string;            // 'soroswap'
  name: string;          // display name for the Route row
  iconAsset: number;     // require(...) for the Route UI
  getQuote(p: SwapQuoteParams): Promise<SwapQuote>;
  // Returns the assembled Soroban operation to plug into the bundler-sourced tx.
  buildSwapOperation(quote: SwapQuote, smartAccountAddress: string): Promise<xdr.Operation>;
}
```

`SwapQuote` carries `amountOut`, `rate`, `priceImpactPct`, `minReceived`
(derived from `slippageBps`), the route path, and a provider-opaque `raw`
payload reused by `buildSwapOperation`.

### 3.2 Soroswap provider (`providers/soroswap.ts`)

- **`getQuote`** — resolves both legs to **SAC contract addresses** (reuse the
  `Asset(code, issuer).contractId()` / direct `sacContractId` logic already in
  `known-tokens.ts` / `use-portfolio.ts`), POSTs the Soroswap Aggregator
  `/quote` endpoint (`assetIn`, `assetOut`, `amount`, `tradeType: EXACT_IN`,
  `slippageBps`), and maps the response to a `SwapQuote`.
- **`buildSwapOperation`** — POSTs `/build` with `from = smartAccountAddress`,
  parses the returned XDR, and **extracts the single `invokeHostFunction`
  operation** (the aggregator router call). This keeps multi-hop routing
  encapsulated and provider-agnostic, while we keep our own bundler-source +
  smart-account-auth transaction envelope.
- **RPC discipline:** Soroban RPC stays on `sorobanCall` (XHR). The Soroswap
  REST endpoints use `fetch`/Axios — REST is not Soroban RPC, so the XHR rule
  does not apply.

### 3.3 `execute-swap.ts` — single-signer execution

`executeSwapFromSmartAccount({ smartAccountAddress, keypair, operation, ... })`
mirrors `sendTokenFromSmartAccount` step-for-step, **reusing the already-exported
helpers** (`signSmartAccountAuthEntry`, `loadAccount`, `parseSimResult`,
`sorobanCall`, `txToBase64`):

1. bundler loads as source / fee-payer
2. build tx with the provider's swap operation
3. simulate (auth-record pass)
4. sign the smart-account auth entry the sim surfaces for the input-token transfer
5. re-simulate with signed auth injected (accurate resource fee)
6. assemble
7. bundler signs the outer tx
8. submit
9. poll for confirmation

The passkey variant reuses `signPasskeyAuthEntry` +
`resolveRegisteredWebAuthnVerifier`.

> **Optional (flagged):** extract the shared
> "build → sign-auth → resimulate → submit → poll" engine out of `send-token.ts`
> into one helper both flows call. Default is to keep the parallel structure to
> honor minimal-change, unless the refactor is explicitly wanted.

### 3.4 Hook (`use-swap-quote.ts`)

React Query keyed on `[from, to, amount, slippageBps, providerId]`, debounced,
with `placeholderData` to avoid flicker. Returns the quote that feeds the
existing UI text nodes.

### 3.5 Wiring the existing UI (data only — no JSX rewrite)

- **`app/(tabs)/swap.tsx`** — replace mock `TOKENS` with tokens from
  `useTrackedTokens` + balances from `usePortfolio` (already used by send-token);
  feed `SwapCard` props and the Route / Rate / Slippage / Min.Received `<Text>`
  nodes from `useSwapQuote`. Wire "Approve Swap" to pass the live quote to
  `/swap/confirm` (router params or a small shared store). Slippage defaults to
  50 bps (0.5%).
- **`app/swap/confirm.tsx`** — feed real spend / receive / provider /
  min-received from the passed quote; wire "Confirm Swap" through the existing
  **`TxAuthModal`** biometric gate (same pattern as send) →
  `executeSwapFromSmartAccount` → on success
  `router.dismissTo('/(auth)/thank-you')`, on failure `friendlyTxError`.
- **Token picker** — the cards have a dropdown affordance but no swap picker
  sheet exists. Plan is to **reuse send-token's `TokenSelectionStep` pattern**;
  if that requires a new sheet component, confirm before adding (per the
  "no UI changes without asking" rule).
- **MEV Protection toggle** — has no real meaning for atomic Soroban swaps;
  left UI-only and flagged.

### 3.6 Config / env

- Add to `env.js` Zod schema (+ `app.config.js`):
  `EXPO_PUBLIC_SOROSWAP_API_URL`, `EXPO_PUBLIC_SOROSWAP_API_KEY` (testnet
  defaults).
- Add a network-aware aggregator/router contract address in
  `src/constants/config.ts`.
- Document the new vars in `CLAUDE.md`.
- **Risk note:** the Soroswap API key and the existing bundler secret are baked
  into the bundle — testnet only; both must move server-side for production
  (same caveat already documented for the bundler in `smart-account.ts`).

## 4. Verification

- New `scripts/verify-swap.js` (mirrors `scripts/verify-multisig-transfer.js`):
  quote + execute a small testnet swap through a smart account and assert an
  on-chain SUCCESS — the established proof pattern in this repo.
- `bun run lint` before reporting done.

## 5. Out of scope for v1 (flagged)

- Multisig / cosign swaps (deferred; will reuse `multisig-send.ts`).
- Additional providers beyond Soroswap (the interface leaves room).
- MEV-protection semantics; any new visual design.

## 6. Success criteria

A single-signer user selects two tracked tokens, sees a **live**
Soroswap-aggregated quote (rate, price impact, min-received, route), confirms
with biometric auth, and the swap executes through the smart account on testnet
with an on-chain SUCCESS — all reusing the existing UI components and the proven
auth / bundler plumbing.

## 7. Open questions

1. Take the optional shared-engine refactor between send and swap, or keep the
   two flows parallel?
2. Is reusing `TokenSelectionStep` for the swap token picker an acceptable UI
   addition, or should the swap cards' existing dropdown be wired differently?
