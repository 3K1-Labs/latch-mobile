# Contributing to Latch

Thanks for considering it. Latch is a non-custodial wallet, so a few things here
are stricter than they would be on an ordinary app — a bug in the wrong file
costs someone their funds rather than their afternoon.

## Getting set up

```bash
bun install                 # Bun, not npm or yarn
cp .env.example .env        # fill in the "Required" section
bunx expo prebuild          # ios/ and android/ are generated, not checked in
bun run ios                 # or: bun run android
```

`env.js` validates `.env` at build time and names anything required that is
missing. The required set only covers running against **testnet**, which is
where contributions should be developed and demonstrated.

## Before you open a pull request

```bash
bun run lint && bun run typecheck && bun run test
```

CI runs the same three, plus a secret scan. Typecheck is at zero errors — please
keep it there rather than adding a suppression.

`bun install` wires up a Husky pre-commit hook that runs typecheck + test on
every commit, so a broken build or a failing crypto-surface test is caught
locally instead of in CI. It does not run lint — that stays a pre-PR check,
not a pre-commit one, since the pre-existing React Compiler warnings would
otherwise slow down every commit.

## Workflow

1. Open or link an issue before starting non-trivial work, so nobody duplicates
   it.
2. Branch from `master`, one topic per branch.
3. Open a draft PR early if the work will take more than a sitting.
4. Prefer squash merges.

Branch names: `feat/import-wallet`, `fix/biometric-unlock`, `chore/ci-setup`.

Every PR should say what changes for the user, link its issue, describe how it
was tested, and call out any effect on keys, auth, storage, signing, or the
network switch.

## Review

One approval is required. Changes under these paths get closer review, and
`CODEOWNERS` requests it automatically:

- `src/lib/` — key derivation, WebAuthn, signing, multisig addressing
- `src/api/` — deployment and everything that talks to latch-api
- `src/store/wallet.ts` — the `SECURE_KEYS` inventory
- `src/constants/config.ts` — `ACTIVE_NETWORK`
- `env.js` — anything `EXPO_PUBLIC_*` is inlined into the shipped bundle

For those paths a green build is not sufficient evidence. Show it working
against testnet — a transaction hash, a deployed address, a screenshot of the
flow.

## Security expectations

- Never commit a mnemonic, private key, seed, token, or API secret. Not in code,
  not in a test fixture, not in a screenshot, not in a PR description.
- Never put a secret behind an `EXPO_PUBLIC_` prefix. Those are compiled into
  the app that ships to users.
- Never log key material — including a truncated prefix or a length. A prefix
  narrows a search space; a length identifies a key format.
- Do not weaken a security control to make something pass. If a control is in
  the way, say so in the PR and let a maintainer decide.

Vulnerabilities go through [SECURITY.md](SECURITY.md), never a public issue.

## Using AI assistance

Most of us use AI tooling and you are welcome to. Two things make it work here.

**Say so.** There is a checkbox in the pull request template. It is a triage
signal, not a judgement — it tells a reviewer which parts to read most closely.

**Own what you submit.** You are the author of every line in your PR regardless
of what wrote it, and you should be able to explain why any of it is there. If a
reviewer asks about a function and the answer is "the model produced it", that
is the wrong answer, and the PR is not ready.

In practice that means:

- Read the diff before you open it. Generated code is confident about APIs that
  do not exist and invariants that are not true.
- Large mechanical refactors nobody can meaningfully review will be closed
  regardless of correctness. Split them, or explain why the change has to be
  atomic.
- **Security reports need a proof of concept.** A model-written vulnerability
  report without a reproducible exploit will be closed without analysis.
  Plausible-sounding reports that dissolve on inspection are a real drain on
  maintainers, and this project is small.

If you point an agent at this repository, [AGENTS.md](AGENTS.md) is written for
exactly that — it carries the security-sensitive paths and the invariants that
are not obvious from the code.

## Code style

Prettier config is in `.prettierrc`: single quotes, trailing commas, 100-char
width, 2-space indent. `bun run lint` covers the rest.

Comments should explain *why*, not restate *what*. The unusual constraints in
this codebase — XHR instead of Axios for Soroban, live-rebound network config —
are exactly the kind of thing worth a sentence.
