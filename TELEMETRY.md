# Telemetry

What this app sends off the device, and what it does not. This describes the
code in this repository; the user-facing policy shown in the app lives in
`app/privacy-policy.tsx`.

Once this repository is public anyone can verify the claims below by reading the
source, which is the point of writing them down.

## What never leaves the device

Key material. Recovery phrases, private keys, seeds, and passkey private keys
are generated on device and stored in `expo-secure-store` — the iOS Keychain or
Android Keystore, biometric-gated for passkeys. Nothing in this codebase
transmits them, and the backend has no endpoint that would accept them.

The encrypted backup feature is the one thing that sends anything derived from a
recovery phrase, and it is **encrypted on the device before it is sent**
(Argon2id + AES-256-GCM). The server stores opaque ciphertext and cannot decrypt
it; the key is derived from a password only the user knows.

## Crash reporting (Sentry)

**Off unless `EXPO_PUBLIC_SENTRY_DSN` is set**, and disabled entirely in
development builds (`app/_layout.tsx`). A build without that variable sends
nothing to Sentry.

When enabled it sends what the Sentry React Native SDK collects by default:
stack traces, device model, OS version, app version, and breadcrumbs leading up
to an error. `sendDefaultPii` is not enabled, so the SDK does not attach IP
addresses or user identifiers of its own.

**Known gap, stated rather than glossed:** there is no `beforeSend` scrubber.
Error messages and breadcrumbs are forwarded as-is, so a value that appears in
an error string — a smart account address, a transaction hash, a URL with a
query parameter — can reach Sentry. Addresses and hashes are public ledger data,
but this is a gap worth closing, and it is tracked as outstanding work. Key
material is not at risk here: it does not appear in error paths, and `console`
output is stripped from release bundles entirely (`drop_console` in
`metro.config.js`).

Performance tracing is on for account deployment only. `tracesSampler` in
`app/_layout.tsx` keeps root spans named `deploy.*` and drops everything else,
so no screen-navigation or general HTTP timing is collected — only how long a
deployment and its passkey ceremony take, tagged with the network and whether
the credential is a platform or device-local key.

### Source maps

`eas build` uploads source maps through the `sentry-eas-build-*` hooks in
`package.json`. `eas update` does **not** — nothing in an OTA update uploads
anything on its own, so for a while every OTA-delivered error resolved against
the last *build's* maps and Sentry attributed frames to whatever happened to sit
at that offset. Two unrelated crashes were reported inside `react-native-svg`
and `@walletconnect/core`, neither of which was involved in either.

The `update:*` scripts therefore export, upload, and publish that same export:

```
eas env:exec <env> "npm run export:sourcemaps" && eas update … --skip-bundler
```

Three things are load-bearing. `env:exec` runs the export under the EAS
environment, because `expo export` on its own reads local `.env` and would ship
a developer's values. `--skip-bundler` republishes the `dist/` that was just
uploaded rather than re-bundling — a second bundle would have different hashes
and the maps would not match it. And the upload happens before the publish, so
a failed upload stops the release instead of shipping an untraceable one.

## The backend

`latch-api` sees what you would expect of a wallet backend: your email if you
use email recovery, the smart account addresses you register, encrypted backup
blobs it cannot read, and the transactions it submits on your behalf. It holds
the bundler key that pays fees, so it necessarily sees the transactions it pays
for — those are public on the Stellar ledger anyway.

## Third parties

Reached only when you use the relevant feature:

| Service | When | Sees |
| --- | --- | --- |
| Stellar Horizon / Soroban RPC | Balances, history, sending | Your addresses and transactions — public ledger data |
| Soroswap / Aquarius | Swap quotes and routing | The swap you are quoting |
| MoonPay | Buying crypto | Whatever their KYC flow collects, directly from you |
| WalletConnect (Reown) | Connecting to a dApp | Session metadata for the connection |
| Sentry | Crashes, if configured | See above |
| Supabase (hot-updater) | OTA update checks | App version and update channel |

## Turning it off

Leave `EXPO_PUBLIC_SENTRY_DSN` unset when building and no crash reporting is
compiled in. Features whose third parties you would rather not contact — swaps,
buying, dApp connections — are only reached when you use them.
