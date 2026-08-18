# Latch

A non-custodial Stellar wallet for iOS and Android, built on Soroban smart
accounts.

Latch keeps your keys on your device. A wallet is a Soroban smart account whose
signers are keys you hold — a BIP-39 recovery phrase, a device passkey, or
both — so you can add a second device, share a wallet with other people behind
a signing threshold, and recover access without anyone custodying your funds.

- **Smart accounts.** Every wallet is a contract account deployed from an
  on-chain factory, at an address derived deterministically from its signer set.
- **Passkeys or a recovery phrase.** Sign with Face ID / Touch ID via a P-256
  passkey held in the secure enclave, or with a standard SEP-0005 seed wallet.
- **Shared wallets.** Multiple people, an on-chain threshold, and an approval
  flow that passes unsigned transactions between devices.
- **Sends, swaps, and dApps.** Native and custom assets, swaps via aggregators,
  and WalletConnect v2 for connecting to dApps.

> **Status:** pre-1.0 and under active development. Mainnet support exists but
> testnet is where day-to-day work happens. Treat this as software you should
> read before trusting.

## Getting started

You need [Bun](https://bun.sh) (not npm or yarn), Xcode for iOS, and Android
Studio for Android.

```bash
bun install
cp .env.example .env      # then fill in the "Required" section
bun run ios               # or: bun run android
```

`ios/` and `android/` are generated and not checked in, so the first run will
prompt Expo to create them. To do that explicitly:

```bash
bunx expo prebuild
```

`env.js` validates your `.env` at build time and fails with the name of anything
required that is missing. The required set is scoped to running against Stellar
testnet — mainnet addresses, third-party API keys, and OTA configuration are all
optional and only fail if you use the feature that needs them.

Latch talks to `latch-api` for account deployment, transaction submission, and
encrypted backup. Point `EXPO_PUBLIC_API_BASE_URL` at a local instance or a
shared deployment.

## Architecture

| Area | Choice |
| --- | --- |
| Framework | Expo 55, React Native 0.83, Expo Router |
| Language | TypeScript |
| State | Zustand for wallet state, React Query for server state |
| Styling | `@shopify/restyle` — `Box` and `Text` are the layout primitives |
| Stellar | `@stellar/stellar-sdk` 15, Soroban RPC + Horizon |
| Forms | Formik + Yup |

```
app/                 file-based routes (Expo Router)
  (onboarding)/      wallet creation, import, recovery
  (auth)/            biometric unlock
  (tabs)/            the authenticated app
src/
  api/               latch-api and Soroban RPC clients
  lib/               key derivation, WebAuthn, signing, multisig
  services/          sends and swaps
  store/wallet.ts    Zustand store; SECURE_KEYS is the secret inventory
  constants/config.ts  ACTIVE_NETWORK — the single network switch
```

A few conventions worth knowing before you change anything:

- **Soroban RPC calls use raw `XMLHttpRequest`, never Axios.** The SDK's Axios
  transport bypasses the Android platform TLS stack and fails there.
- **Secrets live in `expo-secure-store`**, keyed by `SECURE_KEYS` in
  `src/store/wallet.ts`. Never AsyncStorage.
- **`EXPO_PUBLIC_*` values are inlined into the shipped bundle.** Anything
  secret must not carry that prefix — it would ship to every user.

## Security

Latch handles private keys and real funds. Signing and key derivation happen on
device; the backend holds no user keys.

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Do not
open a public issue for a security problem, and never include a recovery phrase,
private key, or access token in an issue, pull request, or screenshot.

[TELEMETRY.md](TELEMETRY.md) documents what the app sends off the device, and
what it never does.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). [GOVERNANCE.md](GOVERNANCE.md) says
who decides what. If you point an AI agent at this repository,
[AGENTS.md](AGENTS.md) is written for it.

Because this is a wallet, changes to key derivation, signing, secure storage, or
the network switch get closer review than the rest of the codebase, and
generally need a testnet demonstration rather than only a passing build.

## Licence

[Apache 2.0](LICENSE). The Latch name and logo are trademarks and are not
covered by that licence — see [NOTICE](NOTICE). You may fork and ship this code;
please don't ship it as Latch.
