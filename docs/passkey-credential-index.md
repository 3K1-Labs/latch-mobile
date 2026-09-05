# Passkey credential index — what's new, and what it takes to use it from the extension

For whoever wires `latch-web-extension` up to this. It's live and proven
against mobile tonight (real deploys, real recovery, real database rows —
see the verification section below); it does **nothing for the extension
yet**, for two specific reasons this doc explains. Read those first — they're
not extension-side work, and building around them before they're fixed would
be wasted effort.

## What shipped

Two new endpoints on `latch-api`, no session required — the caller proves it
holds the key it's asking about, the same possession-is-authorization model
`/v1/smart-account/*` already uses for deploys:

**`POST /v1/passkey-credentials/challenge`** — body `{}`. Returns:
```json
{ "data": { "nonce": "<hex>", "expires_in": 60 } }
```
Not bound to any credential — nobody knows which one will answer yet.

**`POST /v1/passkey-credentials/lookup`** — after running a WebAuthn `get()`
with that nonce as the challenge and no `allowCredentials` (so the OS/browser
offers every synced passkey for the RP):
```json
{
  "nonce": "<hex, from challenge>",
  "credential_id": "<hex>",
  "authenticator_data": "<base64>",
  "client_data_json": "<base64>",
  "signature": "<base64, DER-encoded ECDSA>"
}
```
Returns:
```json
{ "data": { "smart_account_address": "C...", "label": "Savings (Latch 3)", "seq": 3 } }
```
or, on **any** failure — unknown credential, expired/replayed nonce, bad
signature — the same generic response:
```json
{ "error": { "code": "UNAUTHORIZED", "message": "no wallet found for this passkey" } }
```
That's deliberate: a credential ID isn't secret (it's readable on-chain from
the account's own signer record), so the failure modes are indistinguishable
on purpose — otherwise this endpoint could be used to test guessed IDs
against real wallets.

Separately, `POST /v1/smart-account/webauthn` (the deploy call) now accepts
two optional fields:
```json
{ "key_data_hex": "...", "network": "testnet", "label": "Savings (Latch 3)", "seq": 3, "proof": {...} }
```
`label`/`seq` are written to the index (keyed by the credential ID embedded
in `key_data_hex`) as part of the same deploy call — no separate request, no
extra ceremony.

### Verified tonight, for real

Three real deploys through the mobile app landed exactly this:

| credential_id | address | label | seq |
|---|---|---|---|
| `e7d5014d…` | `CAXXQ2QL…` | `Latch Wallet 1` | 1 |
| `05212c54…` | `CBRSYJXP…` | `Latch Wallet 2` | 2 |
| `fd064592…` | `CBBDBULM…` | `Savings (Latch 3)` | 3 |

— the third row from an account the user named "Savings" at creation,
confirming both the default-name and custom-label paths. Then two full
discovery cycles ran end to end: `challenge` → one WebAuthn ceremony →
`lookup` (200, found the wallet) → the existing wallet sign-in ceremony
(200). This is real request-log evidence, not a synthetic test:

```
POST /v1/smart-account/webauthn      200  (deploy, writes the index row)
POST /v1/passkey-credentials/challenge  200
POST /v1/passkey-credentials/lookup     200  ← found it
POST /v1/auth/challenge                 200
POST /v1/auth/sign-in                   200  ← signed in, no address typed
```

## Why this doesn't help the extension today — two blockers, not extension-side

**1. Different RP domains.** The index is keyed by credential ID, but a
credential ID only exists under the RP it was created for. Mobile passkeys
live under `michaelesenwa.me` (moving to `uselatch.app`); the extension's
passkeys live under its own Chrome extension ID. A `lookup` call from the
extension would run its WebAuthn ceremony under the extension's RP, discover
only the extension's own credentials, and never see a mobile-created wallet
— not because the index doesn't have it, but because the two clients aren't
even asking the same authenticator provider for the same thing. This needs
the domain-unification work already tracked (issue #77, Discussion #32).
Nothing described here is a substitute for that, and building an extension
integration before it lands will not surface mobile wallets no matter how
correctly it's wired.

**2. The extension's own deploy path doesn't write to the index.** Mobile's
deploy handler (`internal/handler/smart_account.go`, `DeployWebauthn`) is the
one that got the `label`/`seq` fields and the `PasskeyCredentialService.Register`
call. The extension deploys through a **different** handler —
`internal/handler/webapp/smartaccount.go`'s `Deploy` (`POST /api/smart-account/webauthn`,
the webapp/cookie-session surface, separate response envelope) — which has
neither. An extension-created wallet won't appear in the index until that
handler gets the same two additions. This is a `latch-api` change, not
something fixable from the extension repo, and I haven't made it — flagging
it here rather than doing it silently, since it's a design call (whether the
webapp path should compute its label the same way, and whether `Register`
should run inline there too) that deserves a look before it's built, the same
way the mobile side was.

## What to actually build, once both are unblocked

**At deploy time** (once the webapp handler accepts `label`/`seq`): compute
the name with `nextPasskeyRegistrationDisplayName` (already in
`apps/extension/src/ui/webauthn/passkey.ts` — see
`docs/passkey-naming-convention.md` for the naming-convention alignment work)
and send it as `label`, with whatever seq counter that doc recommends
persisting, alongside the existing deploy call.

**For recovery**, a client module mirroring latch-mobile's
`src/api/passkey-credential.ts`:
1. `POST /v1/passkey-credentials/challenge` → nonce.
2. Run the extension's own WebAuthn `get()` (it already has the P-256
   assertion-building code in `passkey.ts`) with that nonce as challenge and
   no `allowCredentials`.
3. `POST /v1/passkey-credentials/lookup` with the assertion parts, base64
   standard-encoded (not base64url) for `authenticator_data` /
   `client_data_json` / `signature` — the signature specifically must be
   **DER-encoded** ECDSA, not raw `r‖s`; see `compactSigToDER` in
   `src/lib/wallet-auth.ts` on the mobile side for the exact transform if the
   extension's own signing path produces raw compact signatures.

**Before any of this reaches production**: confirm the extension's origin
(`chrome-extension://…`) is in `API_CORS_ALLOWED_ORIGINS` on the `latch-api`
deployment — CORS is applied globally in `cmd/server/main.go`, ahead of route
registration, so it gates `/v1/passkey-credentials/*` exactly like every
other route, allowlist-based (not `*`). This is an infra/env change, not
code.

## Reference

- Server: `internal/service/passkey_credential_service.go`,
  `internal/handler/passkey_credential.go`, `internal/handler/smart_account.go`
  (the `label`/`seq` fields and the `Register` call inside `DeployWebauthn`).
- Mobile client: `src/api/passkey-credential.ts` (the two-call ceremony),
  `src/lib/provision-passkey.ts` (`storePasskeyLabel`/`getStoredPasskeyLabel` —
  how the label survives from provisioning to a separate deploy call),
  `app/(onboarding)/sign-in-passkey.tsx` (the "Find My Wallet" no-address flow).
- Background: `docs/passkey-sync-and-recovery-findings.md` (the original
  design, option (c)), `docs/passkey-naming-convention.md` (the naming
  alignment this label field depends on).
