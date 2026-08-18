# Open-Source Readiness Checklist

Adapted from `latch-contracts`'s repo-agnostic checklist for getting a Latch repo ready for
outside contributors. The shape (4 sections, 🔧/⚠️ markers) is theirs; the checkboxes below
reflect **this repo's** (`latch-mobile`) actual current status, verified against the live repo
and GitHub settings, not aspirational.

**How to use this**: work through it top to bottom. Items marked 🔧 need adapting to your repo's
stack (the concept is universal, the tool isn't). Items marked ⚠️ are things we got wrong on the
first pass here — read the note before you repeat the mistake, including the ones that are exact
repeats of mistakes `latch-contracts` already documented about itself.

---

## 1. Legal & Governance

- [x] **`LICENSE`** — Apache-2.0, `NOTICE` alongside it, `"license": "Apache-2.0"` in
      `package.json`. Chosen over MIT specifically for the patent grant — this repo derives keys
      and signs Soroban transactions, and Apache-2.0's explicit grant matters more for
      cryptographic/smart-account code than for most projects.
- [x] **`CODE_OF_CONDUCT.md`** — present, but written custom ("Adapted from the Contributor
      Covenant") rather than the verbatim template `latch-contracts` recommends. Not wrong, just a
      deliberate deviation — worth a second look if the repo ever needs to point at a
      widely-recognized standard rather than its own paraphrase.
- [x] **`CONTRIBUTING.md`** — documents the actual workflow: branch from `master`, open/link an
      issue before non-trivial work, one topic per branch, squash merges, a per-path review table
      (`CODEOWNERS`-backed), and an explicit AI-assisted-contribution policy (own what you submit,
      security reports need a proof of concept).
- [x] **`SECURITY.md`** — private reporting via GitHub Security Advisories, 72-hour
      acknowledgement window, explicit scope (real PoC required for AI-generated reports, or the
      report is closed without analysis).

## 2. GitHub Repo Configuration

- [x] **`.github/pull_request_template.md`** — Summary / Linked Issue / What Changed / Testing
      checklist / AI-assistance checkbox / **Risk Check** (secrets, `EXPO_PUBLIC_` prefix misuse,
      secure-storage review, network/API breaking-change review). More sections than
      `latch-contracts`'s — proportionate to this being a wallet, not a contracts library.
- [x] **`.github/ISSUE_TEMPLATE/`** — `bug_report.yml` + `feature_request.yml`.
      ⚠️ **A stale `feature_request.md` sits alongside `feature_request.yml`** — a leftover from
      before the YAML-forms migration that nobody deleted. GitHub will show both to a reporter.
      Delete the `.md`.
- [x] **`CODEOWNERS`** — kept, unlike `latch-contracts`'s deliberate deferral, even though
      `GOVERNANCE.md` says the same thing they'd say ("bus factor is one"). With one maintainer
      it just auto-requests review from that same person, which is a no-op today — but it
      documents *which paths* deserve closer review before a second maintainer exists to enforce
      it, so it costs nothing to have early.
- [x] **Branch protection via Rulesets** — "Protect master" (`enforcement: active`): PR required
      (1 approval, stale reviews dismissed on push, threads must resolve), squash-merge only, no
      force-push, no deletion, linear history required, Copilot auto-review wired in, and now
      `lint · typecheck · test`, `secret scan`, and `dependency review` as required status checks
      (`strict_required_status_checks_policy: false` — deliberately not requiring branches to be
      up to date first, matching `latch-contracts`'s own stated reasoning that "strict" fights you
      once multiple contributors have PRs open at once).
      ⚠️ **This was found broken, then fixed.** The ruleset had a `pull_request` rule and a
      `copilot_code_review` rule but no `required_status_checks` rule at all — none of the three
      CI jobs were actually required to merge, so a PR could be approved and squash-merged with CI
      red. This is precisely the "verify it actually enforces what you configured" trap
      `latch-contracts` flagged about *itself* — found here independently, same class of gap, now
      closed. Unverified against a live run yet (CI doesn't trigger on pushes to feature branches,
      only `pull_request` and pushes to `master`) — the context strings were copied verbatim from
      each job's `name:` in `ci.yml`, but confirm they register on the next real PR.
      Also present but inert: a second ruleset, "Code Quality Copilot review for default branch",
      sits at `enforcement: disabled`. Decide whether to turn it on or delete it — a disabled
      ruleset nobody remembers exists is its own small hazard.

## 3. CI/CD

- [x] **Build + test on every PR** — `check` job: install → lint → typecheck → test.
- [x] 🔧 **Lint/format enforced in CI, as a required check** — `bun run lint` (ESLint via
      `eslint-config-expo`) runs as the first step of the `check` job, and that job is now wired
      as a required status check on the branch ruleset (see the ⚠️ in Section 2 — this was the
      fix). Not yet confirmed against a live run; verify on the next real PR.
- [x] **Typo-checking** — `crate-ci/typos` added as its own `typo check` job, always on (not
      gated by the path-filter below — docs are exactly where a typo earns its keep). Config in
      `_typos.toml`, and every entry in it is there because a real `typos` run over this repo
      flagged it, not preemptively: a ~3,300-line token registry (`src/constants/tokens.ts`) is
      excluded entirely since it's asset-ticker data, not prose (`TRU`, `ALLO`, `StablR Euro`, "The
      Virtua Kolect" are real token names that happen to collide with English near-misses, and
      will keep doing so as tokens are added), plus a handful of tokenizer false-positives
      (`unparseable` vs. the dictionary's preferred `unparsable`; `mis` split off hyphenated
      compounds like `mis-cleared`; `OT`/`PN` split off pluralized abbreviations like `OTPs`/
      `PNGs`). Verified clean (`typos`, zero flags, exit 0) with the exact invocation CI runs —
      the "reformat everything first, *then* turn on enforcement" step from the reference
      checklist, done before this became a required check, not after.
- [x] **Path-filtering so docs-only PRs report fast** — a `changes` job computes a `code` boolean
      via plain `git diff --name-only` (not a path-filter action — their negation-pattern
      semantics are an easy way to get exactly the failure mode below by accident) and gates the
      **steps** inside `check` and `dependency-review` on it. Deliberately does not gate the
      **jobs** themselves: a job skipped via `if:` still reports a passing check run, while a
      workflow that never runs at all for certain paths (e.g. `paths-ignore` on the trigger)
      leaves a required check stuck at "Expected" forever — which is the specific trap the
      reference checklist warns about, and now the thing this implementation is built around
      avoiding rather than something to get right later.
- [x] **CI actually covers what exists to test, not just what existed when CI was written** —
      no direct equivalent here (this is a single-package Expo app, not a multi-crate workspace),
      but the mobile-shaped version of the same risk is real and *not yet covered*: `bun run test`
      is Jest-only pure-JS logic (26 tests, 2 files) and never exercises native-module behavior on
      either platform — including `jail-monkey`, `expo-screen-capture`, or the passkey/WebAuthn
      path, all of which only run on-device. CI silently has zero signal on any of them; nothing
      announces this the way a missing crate in a workspace glob would. Marking this unchecked in
      spirit even though it's not a literal box `latch-contracts`'s checklist has for a mobile
      repo — the underlying warning ("audit your CI matrix against what actually needs testing,
      don't assume it grew automatically") transfers directly.
- [ ] **New CI jobs added to the branch ruleset's required checks** — same finding as the
      Section 2 ⚠️: `secrets` and `dependency-review` were both added to `ci.yml` this repo's own
      open-source-readiness pass and neither was added to the ruleset's required checks either.
      Exactly the mistake `latch-contracts` names about itself, repeated here on schedule.

## 4. Contributor Experience

- [x] **A written conventions/style doc** — `AGENTS.md` (not a linter config): mandatory patterns
      derived from reading the real code (raw `XMLHttpRequest` for Soroban RPC because Axios
      breaks Android TLS, `expo-secure-store` never `AsyncStorage` for secrets, Formik+Yup not
      bare `useState`, `Box`/`Text` from restyle not React Native's), a security-sensitive-paths
      table, and a known-gotchas list (network-switch `let`-rebinding, Jest's two-project split,
      Metro's `drop_console`). `CLAUDE.md` is a one-line pointer at it, not a second copy — the
      two used to drift and disagree with each other, which is worse than either alone.
- [x] **Explicit AI-assisted contribution policy** — in `CONTRIBUTING.md` (own what you submit,
      unreviewable bulk-agent PRs get closed) and mirrored as a checkbox in the PR template;
      `SECURITY.md` additionally requires a working PoC for any AI-generated vulnerability report.
- [x] **README readable by a stranger with zero context** — rewritten from the untouched
      `create-expo-app` boilerplate (which told readers to `npm install` in a Bun project and
      offered a `reset-project` script that would delete the app). Now explains what Latch is,
      setup via Bun → `expo prebuild` → run, and links to CONTRIBUTING/SECURITY/LICENSE.

## 5. Mobile-specific (not in the generic checklist)

Things that don't have a `latch-contracts` analog but matter as much for a repo whose product is
a shipped binary, not a library.

- [x] **Nothing secret carries an `EXPO_PUBLIC_` prefix.** Expo inlines every such variable into
      the JS bundle at build time — the mobile equivalent of committing a secret to git, except it
      ships to every user instead of every reader. Enforced as a named rule in `AGENTS.md`, the PR
      template's Risk Check, and `CONTRIBUTING.md`. Found and fixed one live violation this
      session: a Supabase **service_role** key (mislabeled as an anon key) was being inlined via a
      dead `EXPO_PUBLIC_HOT_UPDATER_SUPABASE_ANON_KEY` left over from a retired OTA config path
      that no longer runs. Removed from `env.js`/`.env.example`; the key itself still needs
      rotating in the Supabase dashboard — code can't do that part.
- [x] **OTA update trust is documented**, not assumed. `docs/ota-updates.md` now states who can
      actually publish today (any human with `eas login` on the account, no CI gate, no required
      review) and that EAS Update has no code signing configured — the single highest-leverage
      unaddressed item in that doc, since OTA skips app-store review entirely.
- [ ] **EAS Update code signing** — not enabled. Named as the top follow-up in
      `docs/ota-updates.md` rather than done, since enabling it doesn't fit inside a docs/CI pass.
- [ ] **Pre-sign transaction scanning** (Blockaid-equivalent) — not implemented. Vendor selection
      and an API key are a product decision, not something to fake with a stub.
- [x] **Internal roadmap docs kept out of the public tree.** 13 files (sprint plans, decision
      logs, vendor evaluations, a cross-repo migration guide naming internal endpoints) moved to
      a gitignored `docs/internal/`, kept locally rather than deleted. Two docs that looked
      equally internal by name stayed public because live source comments across 6 files point
      contributors at them as the architecture rationale for what's actually shipped — moving
      those would have broken real references for no privacy gain.

---

## Open items, in priority order

1. ~~Wire the three CI jobs as required status checks on the "Protect master" ruleset.~~ **Done**
   — fixed via the GitHub API (repo-settings change, no code). Confirm the context strings
   register correctly on the next real PR, since CI has never actually run against this exact
   ruleset config yet.
2. **Delete the stale `feature_request.md`** issue template.
3. **Merge `feat/open-source-parity` into `master`.** Everything above describes the working
   branch, not the public default branch — `master` is still pre-license, pre-tests, and still
   ships the mainnet bundler secret path. This checklist is honest about the branch; it says
   nothing about what a stranger cloning the repo today actually gets.
4. ~~Add typo-checking and docs-only path-filtering to CI.~~ **Done** — `typo check` job added
   and wired as a fourth required status check; path-filtering gates steps, not jobs, so required
   checks can't get stuck. Same live-run caveat as item 1: nothing has actually triggered this
   workflow yet since CI doesn't run on pushes to feature branches.
5. Enable EAS Update code signing.
6. Decide on the disabled "Code Quality Copilot review" ruleset — enable or delete it.
