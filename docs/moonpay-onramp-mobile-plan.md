# MoonPay On-Ramp — Mobile Plan

Scope: the latch-mobile changes for the MoonPay leg. Server counterparts are in
[moonpay-onramp-server-plan.md](./moonpay-onramp-server-plan.md) — **M2 and M3
are blocked on S2 and S1 respectively** and should not be started before those
land, or they will be untestable.

The direct Fund-sheet deposit path is already wired and verified end to end on
testnet; nothing below changes it.

---

## Already done (this branch, staged)

For context, so these aren't re-done:

- `createDepositIntent` takes optional `expectedAmt` / `externalId`
  (`src/api/latch-auth.ts`)
- `isDepositIntentExpired` + intent reuse — Home no longer mints a fresh intent
  per Fund press (`app/(tabs)/index.tsx:144-166`)
- `FundWalletSheet` hides the pool address + memo once the TTL lapses, including
  a timer for a sheet left open
- Memo labelled "Memo — type ID (Required)"
- Status polling stops at terminal states; sweep-as-failed handled in
  `deriveStatusProps`
- Network gate: `EXPO_PUBLIC_RELAYER_NETWORK` + `isDepositRelayerAvailable()`

---

## M1 — `expiresIn` on deposit intents — ✅ DONE

**Still gated on S3** for real effect: the field is sent, but has no consequence
until the backend forwards `expires_in` to the relayer. Harmless if ignored.

**As built**, the TTL split is applied at the moment the user commits to a
provider rather than at Fund-sheet open, because a single intent currently serves
both paths (Home mints once; `BuyXLMSheet` and `FundWalletSheet` share it):

- `ONRAMP_INTENT_TTL_SECONDS` = 7 days (`src/api/latch-auth.ts`)
- `prepareOnrampIntent()` in `app/(tabs)/index.tsx` re-mints at that TTL
- `BuyXLMSheet.openMoonPay` awaits it before building the URL, and falls back to
  the intent it was opened with if the re-mint fails — a short tag still works for
  a fast card purchase, whereas no tag is swept unconditionally

Read the TTL you got back off `expires_at`; never assume the one you asked for.
M2 supersedes this plumbing, since the signing endpoint will mint the intent
server-side.

**Original spec, for reference:**

**Why:** intents default to 1h. Bank-transfer settlement can take days, and an
expired `memo_id` is swept to recovery rather than credited. On-ramp intents need
a materially longer TTL than the ones minted when the user opens the Fund sheet.

**Change** — `src/api/latch-auth.ts`:

```ts
export interface DepositIntentOptions {
  expectedAmt?: string;
  externalId?: string;
  /** Seconds until the intent expires. Backend clamps; omit for its default (1h). */
  expiresIn?: number;
}
```

Add the `expires_in` pass-through alongside the existing two in the body builder.
`useCreateDepositIntent` already spreads `...options`, so the hook needs no change.

Call sites choose the TTL by origin:

| Origin | TTL | Why |
|---|---|---|
| Fund sheet (`ensureDepositIntent`) | default 1h | user is about to paste an address; short TTL limits a stale memo's blast radius |
| MoonPay / on-ramp | 7 days | must outlive ACH/SEPA settlement |

**Done when:** an on-ramp-originated intent comes back with an `expires_at` days
out, not an hour. Verify against the response, not the request — the clamp lives
server-side.

---

## M2 — Stop building the MoonPay URL in the app

**Blocked on:** S2 (the signing endpoint must exist).

**Why:** `BuyXLMSheet.tsx:27-39` assembles the widget URL client-side. MoonPay
requires a signed URL when `walletAddress` is pre-filled, and the signature needs
the secret key — which cannot ship in the bundle. Unsigned, the pre-filled
address and tag are rejected or dropped, and a dropped tag means the deposit is
swept to the relayer's recovery address.

**Change:** `openMoonPay` stops constructing the URL and asks the backend for a
signed one, then opens it.

- Delete the local `params` assembly and the `MOONPAY_API_KEY` constant — the API
  key moves server-side with the secret. `EXPO_PUBLIC_MOONPAY_API_KEY` can then
  come out of `env.js` and `.env`.
- Fetch via a `useMutation` in a new `src/hooks/use-moonpay.ts`, consistent with
  `use-deposit.ts`. Do not call `latchFetch` directly from the component.
- The `poolAddress` / `memo` props on `BuyXLMSheet` become unnecessary: the
  backend mints the intent as part of signing, so the component no longer needs
  them passed down from Home. Confirm before removing — it changes the component
  contract, and Home currently feeds both from `depositIntent`.

**Failure states to handle** (currently there are none — `openMoonPay` cannot
fail visibly):

- request fails / offline → toast, do not open the browser
- `isDepositRelayerAvailable()` false → MoonPay row should not be actionable at
  all; a signed URL pointing at a pool on the other network is worse than no URL
- user dismisses the browser → no state change; the intent stays live and the
  Fund sheet can still show its status

**Do not** open `buy.moonpay.com` with an unsigned URL as a fallback when the
signing call fails. That is the exact path that loses funds.

---

## M3 — Verification pass

**Blocked on:** S1 deployed.

Once the relayer accepts numeric TEXT memos, re-run the deposit path with
`Memo.text("<memo_id>")` instead of `Memo.id(...)` and confirm
`forwards[0].status === "done"`. Until that ships, a MoonPay purchase cannot be
safely trialled with real money on mainnet.

Then, against MoonPay sandbox:

1. Buy XLM through the signed widget with a test card.
2. Watch the deposit land on the pool address and confirm the memo type Horizon
   actually reports — this is the open question that S1 makes moot but which is
   still worth recording.
3. Confirm the status sheet transitions Awaiting Deposit → Pending → Completed.
4. Confirm the smart account balance moves.

---

## Out of scope, but adjacent

Things noticed while wiring this up. Not part of the MoonPay work — listed so
they aren't rediscovered.

- `FonbnkOnrampSheet` uses `useState` for form fields; house style is Formik +
  Yup. Untracked WIP, left alone.
- `FonbnkOrderStatusScreen` has 4 pre-existing type errors (`"success"` is not a
  theme colour — likely `success50`; two optional callbacks passed where required).
- `FonbnkOnrampFlow` is not mounted by any screen yet.
- Fonbnk needs none of S2/M2: its quote endpoint already returns `poolAddress` +
  `memo`, so the backend mints and consumes the intent server-to-server. MoonPay
  is the only provider where the memo round-trips through a URL we don't control.

---

## Ordering

```
S1 (relayer)  ──────────────► M3 (verify text memo)
S3 (proxy)    ──► M1 (expiresIn)
                     │
S2 (signing endpoint) ──► M2 (BuyXLMSheet)
```

M1 is the only item that can start immediately and independently.
