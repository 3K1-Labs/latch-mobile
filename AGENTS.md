# AGENTS.md

Guidance for AI coding agents working in this repository. This is the single
source of truth; `CLAUDE.md` points here.

Latch is a **non-custodial Stellar wallet**. The code here derives keys, signs
transactions, and moves real money. A mistake in the wrong file does not throw —
it produces a valid wallet at a different address, or a signature that should
not have been possible. Read the Security-sensitive areas section before
changing anything in it.

## Commands

```bash
bun install          # Bun, not npm or yarn
bun run ios          # or: bun run android
bun run lint         # eslint
bun run typecheck    # tsc --noEmit — must stay at zero errors
bun run test         # jest
```

`ios/` and `android/` are generated and not checked in; `bunx expo prebuild`
creates them.

## Architecture

Expo 55 + React Native 0.83, TypeScript, Expo Router file-based routing.

| Concern | Where |
| --- | --- |
| Wallet state | `useWalletStore` (Zustand) in `src/store/wallet.ts` |
| Server state | React Query |
| Ephemeral UI state | `useState` |
| Non-sensitive persistence | AsyncStorage (theme, network choice) |
| Secrets | `expo-secure-store`, keyed by `SECURE_KEYS` |
| Styling | `@shopify/restyle` — `Box` and `Text` |
| Forms | Formik + Yup |

**Entry flow:** `app/index.tsx` reads `SECURE_KEYS.SMART_ACCOUNT` from
SecureStore. Present → `/(auth)/biometric` in unlock mode. Absent →
`/onboarding`.

**Account model** (`WalletAccount` in `src/store/wallet.ts`): mnemonic accounts
use BIP-44 index ≥ 0 and carry `gAddress` and `publicKeyHex`; passkey accounts
use a negative index, have an empty `gAddress`, and are identified by
`credentialId`.

**The backend does the paying.** `latch-api` owns the bundler keypair that
sponsors fees. Account deployment goes through `src/api/smart-account-deploy.ts`
and transaction submission through `src/api/transaction-relay.ts`. The client
still builds, simulates, and signs its own Soroban auth entries — only the outer
envelope is server-side. Do not reintroduce a client-held bundler secret.

## Mandatory patterns

Each of these exists for a reason. Do not "clean them up".

- **Soroban RPC calls use raw `XMLHttpRequest`, never Axios.** The Stellar SDK's
  Axios transport bypasses the Android platform TLS stack and fails there.
  Follow the pattern in `src/api/smart-account.ts`.
- **Secrets go in `expo-secure-store` via `SECURE_KEYS`.** Never AsyncStorage.
- **Nothing secret gets an `EXPO_PUBLIC_` prefix.** Expo inlines those into the
  shipped bundle, readable by anyone who unzips the app.
- **Forms use Formik + Yup.** Not `useState` for field state.
- **Layout uses `Box`/`Text` from restyle**, not `View`/`Text` from react-native.
- **Key and signing code logs through `src/lib/logger.ts`**, never `console`.
  A `no-console` lint rule enforces this in `src/lib/passkey-webauthn.ts` and
  `src/services/send-token.ts`.

## Security-sensitive areas

Changes here need human sign-off, not just passing CI. Prefer proposing a diff
and explaining the reasoning over applying one.

| Path | Why it matters |
| --- | --- |
| `src/lib/seed-wallet.ts` | BIP-39 / SEP-0005 derivation. A subtle change silently generates a different wallet and the user's funds are elsewhere. Covered by spec vectors in `src/lib/__tests__`. |
| `src/lib/passkey-webauthn.ts` | Hand-rolled WebAuthn over P-256. Highest-risk file in the repo. |
| `src/lib/multisig-address.ts` | Salt and canonical signer ordering fix a shared wallet's address. Every member derives it independently and must agree. |
| `src/store/wallet.ts` | `SECURE_KEYS` inventory, rehydration, logout wipe. |
| `src/api/smart-account.ts`, `src/api/passkey.ts` | Deployment and address prediction. |
| `src/api/transaction-relay.ts` | What the bundler is asked to pay for. |
| `src/constants/config.ts` | `ACTIVE_NETWORK` moves the entire app between testnet and mainnet. |
| `env.js` | Anything added here with an `EXPO_PUBLIC_` prefix ships to every user. |
| Deep link and WalletConnect handlers | Untrusted input from outside the app. |

## Rules for agents

- **Never weaken a security control to make something work.** Do not disable a
  biometric prompt, skip a PIN check, loosen a validation, or bypass signature
  verification to get a build or a test passing. If a control is in the way,
  say so and stop.
- **Never invent cryptography.** No new key derivation, encryption scheme, or
  source of randomness. Use the SDK. If the SDK does not do it, ask.
- **Mainnet is off-limits** unless the human explicitly asks for it. Work on
  testnet.
- **No real recovery phrases in tests or fixtures.** Use published test vectors
  and label them as such.
- **Do not add dependencies unprompted.** Every package is code running inside a
  wallet.
- **Never commit without explicit permission**, and never add AI attribution to
  a commit message.
- **Do not log key material** — not a key, a mnemonic, a digest, a signature, or
  a truncated prefix or a length. A prefix narrows a search space; a length
  identifies a key format. Log the verdict, not the material.
- **Say when you are unsure.** A confidently wrong answer about signing or
  derivation is worse than no answer.

## Known gotchas

- **`ACTIVE_NETWORK` defaults to mainnet** in `src/constants/config.ts`.
  `hydrateActiveNetwork()` corrects it from the persisted choice during startup,
  and the app root gates rendering on that, but a first run before hydration is
  pointed at mainnet. Check which network you are on before testing anything
  that spends.
- **The network switch reassigns `let` bindings live.** Every reader must be
  inside a function body, never a module-level computation, or it captures a
  stale value. See `applyNetworkDetails`.
- **Jest runs as two projects** (`jest.config.js`). Pure-logic suites use the
  `node` environment: under the Expo environment the Stellar SDK's axios adapter
  probes `ReadableStream` at import and the stream polyfill throws, killing the
  run before any test executes.
- **Metro drops all `console.*` from release bundles** (`drop_console` in
  `metro.config.js`), including `warn` and `error`. Production error reporting
  is Sentry's job; do not rely on console surviving.
- **Package subpath imports need their `.js` suffix** where the export map
  demands it (e.g. `@scure/bip39/wordlists/english.js`). Metro resolves loosely;
  Node, tsc and Jest do not, so a missing suffix works in the app and breaks in
  tests.
- **`reference/` is not checked in.** It holds local read-only checkouts of
  other projects. Do not write instructions that depend on those paths existing.
- **`jail-monkey` (device-integrity warning) needs a fresh native prebuild.**
  It's a plain autolinked native module, not an Expo package, so it silently
  does nothing under Expo Go or a dev client built before it was added — run
  `bunx expo prebuild` and reinstall the dev client before expecting
  `useDeviceIntegrity` to fire on a jailbroken/rooted test device.

## Before you say you are done

```bash
bun run lint && bun run typecheck && bun run test
```

All three must pass. For anything touching the security-sensitive paths above,
also say plainly what you did *not* verify — running against a live network is
usually the gap, and claiming otherwise is worse than leaving it open.
