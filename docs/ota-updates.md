# OTA Updates — EAS Update

Latch ships JS/asset hotfixes via **EAS Update** (Expo's first-party OTA).
No App Store / TestFlight review needed for JS-only changes.

> `hot-updater` and `@hot-updater/*` packages are also installed but **inert**
> — plugin commented out at `app.config.js:107-112`. EAS Update is the
> active path. Don't enable both simultaneously.

---

## Mental model

```
┌─────────────────┐    points to    ┌──────────┐    contains    ┌─────────┐
│  Installed app  │ ──────────────► │ Channel  │ ──────────────►│ Branch  │
│ (.ipa / .apk)   │   baked in at   │ (label)  │  configurable  │(updates)│
│                 │   build time    │          │   any time     │         │
└─────────────────┘                 └──────────┘                └─────────┘
```

- **Installed app**: channel name is baked into the binary at build time. Can
  only change by rebuilding.
- **Channel** (e.g. `production`): a label that maps to a branch. Re-mappable
  anytime via `eas channel:edit`.
- **Branch** (e.g. `production`): an ordered list of updates. Publishing =
  appending to a branch.

At cold launch, the app asks Expo: *"I'm on channel X — what's the latest
update for runtime version Y?"* It downloads in the background and applies
on the **next** cold launch (see [two-launch quirk](#two-launch-quirk)).

---

## Configuration

| Setting | Value | Location |
|---|---|---|
| Update URL | `https://u.expo.dev/8b122713-0d94-4940-a71c-58da86f923ad` | `app.config.js:127-129` |
| Runtime version policy | `appVersion` | `app.config.js:130-132` |
| EAS project ID | `8b122713-0d94-4940-a71c-58da86f923ad` | `app.config.js:138-140` |
| Production channel | `production` → branch `production` | `eas.json` (build.production) |

### Channels currently wired

| Channel | Branch | Builds listening | Use |
|---|---|---|---|
| `production` | `production` | TestFlight + App Store builds | All shipped updates for end users |
| _(none)_ | `preview` | — | Spare branch for ad-hoc testing in Expo Go / dev client |
| _(none)_ | `wallet-backend` | — | Branch used while testing the wallet-backend feature; no build listens unless you wire one |

To create a new channel for a feature branch, see
[Test a feature branch on a dedicated build](#test-a-feature-branch-on-a-dedicated-build).

---

## Daily workflow — ship a fix to production users

```bash
bun run update:production -- --message "fix: bug X"
```

That's the whole flow. Users get the update on their next cold launch.

### Available scripts (`package.json`)

| Script | Effect |
|---|---|
| `update:production` | Publishes to `production` branch (reaches all live users) |
| `update:preview` | Publishes to `preview` branch (no listener wired by default) |
| `update:wallet-backend` | Publishes to `wallet-backend` branch (no listener wired by default) |
| `update:list` | Lists recent updates |
| `update:rollback:production` | Republishes previous production update as latest |

All scripts pass extra flags through `--`, e.g.:

```bash
bun run update:production -- --message "..." --platform ios
```

### Verify the update landed

- Dashboard: <https://expo.dev/accounts/frankiepower/projects/latch-mobile/updates>
- Terminal: `bun run update:list`

The update page shows install/check counts. Non-zero checks = devices are
pinging successfully; the bundle will swap in on their next cold launch.

---

## Two-launch quirk

The single most confusing thing about OTA. **The first launch after
publishing shows no change.**

```
Launch #1 (after publish):
  1. App opens with OLD bundle (instant — no waiting on network)
  2. Background fetch: "anything new on channel production / runtime 1.0.0?"
  3. Downloads new bundle silently
  → User sees no change this launch.

Launch #2 (true cold launch — force-quit, then reopen):
  → Runs new bundle.
```

This is intentional: never block app startup on a network call. The
trade-off is the two-launch delay.

**Force-quit means swiping the app card out of the iOS app switcher** — not
pressing home, not locking the phone, not closing TestFlight. Those leave
the app suspended in memory; the next "open" is a warm resume, not a cold
launch.

**Silent by default; prompt only for critical updates.** `useOtaUpdate`
(`src/hooks/use-ota-update.ts`, wired in `app/_layout.tsx`) runs
`Updates.checkForUpdateAsync()` on cold launch and on every foreground.

- **Normal update** → nothing happens in-session. expo-updates' automatic
  background fetch downloads it and it applies on the **next cold launch**.
  No UI — same as every major consumer app.
- **Critical update** → the hook fetches it and shows a non-blocking Toast
  ("Update available — Restart"). `Updates.reloadAsync()` runs only when the
  user taps **Restart**; never force-reloaded mid-session.

Disabled in `__DEV__` / Expo Go (where `Updates.isEnabled` is false); errors
are swallowed and fall back to the default next-cold-launch behavior.

### Flagging an update critical

The hook reads `extra.otaCritical` from the incoming update's manifest. To
push a must-have fix that prompts users immediately:

1. Set `extra: { otaCritical: true }` in `app.config.js`.
2. `bun run update:production -- --message "fix: critical X"`.
3. **Revert the flag** to `false`/remove it before the next normal publish,
   or every subsequent update keeps prompting.

---

## Rollback

```bash
bun run update:rollback:production
```

Republishes the previous update as the latest entry on the branch. Users
revert on next cold launch. No App Store review. This is the OTA
superpower — use it freely when something looks wrong.

---

## What CAN and CAN'T go through OTA

### OTA-able (no rebuild needed)

- JS / TypeScript / React component changes
- Style / theme changes
- Static assets bundled with the JS (images in `src/assets/`, fonts already loaded by `expo-font`)
- Env vars set in EAS environments (since they're baked into the JS bundle at publish time, not at native build time)
- Any pure-JS dependency upgrade

### Needs a fresh `eas build` (App Store review for store-distributed builds)

- Adding/removing any package with native code (anything with iOS/Android sources)
- `app.config.js` changes to: permissions, plugins, bundleId, app icons, splash, scheme
- Bumping `version` in `app.config.js` — this is your `runtimeVersion`. Bumping
  it intentionally **cuts off old builds from new OTAs**, so don't bump
  until you're shipping a new native binary.
- Changes to `expo-build-properties`, native deps in podfile, gradle config

When in doubt: if it touches anything outside `src/`, `app/`, `assets/`, or
pure JS in `package.json`, assume a rebuild is needed.

---

## Runtime version semantics

`runtimeVersion: { policy: 'appVersion' }` means: the binary is tagged with
its `expo.version` (e.g. `1.0.0`). An OTA published while you're on
`1.0.0` only reaches binaries also at `1.0.0`.

**Workflow when shipping a new native version:**

1. Bump `version` in `app.config.js` (e.g. `1.0.0` → `1.1.0`)
2. `eas build --profile production` — new binary tagged runtime `1.1.0`
3. Submit to App Store; wait for review
4. Once users update to `1.1.0`, future OTAs publish at runtime `1.1.0`
5. Users still on `1.0.0` keep getting `1.0.0` OTAs (until they update from
   the store) — useful if you need to hotfix the old version too

---

## Test a feature branch on a dedicated build

If you want to test JS changes for a branch (e.g. `wallet-backend`)
without affecting production users, you need a build whose channel points
at that branch.

One-time setup:

1. Add channel to `eas.json`:
   ```json
   "build": {
     "preview": {
       "distribution": "internal",
       "environment": "preview",
       "channel": "wallet-backend"
     }
   }
   ```
2. Build a preview client and install on test devices:
   ```bash
   bunx eas-cli build --profile preview --platform ios
   ```
3. Link channel → branch (only needed if they have different names):
   ```bash
   bunx eas-cli channel:edit wallet-backend --branch wallet-backend
   ```

After that, every `bun run update:wallet-backend -- --message "..."` reaches
those test devices in seconds. Production users untouched.

---

## Common gotchas

| Symptom | Likely cause |
|---|---|
| "Nothing happened after I opened the app" | [Two-launch quirk](#two-launch-quirk) — open twice, with a true force-quit between |
| "Update published but no device picked it up" | No build is listening to that branch's channel. Check `eas.json` `channel` field and the build's profile |
| "Update published but only some users got it" | Runtime version mismatch — those users are on a different app version |
| "I added a new package and the OTA broke the app" | Native packages can't ship via OTA. Rebuild + resubmit to store |
| "I changed permissions in `app.config.js` and OTA'd it; nothing changed" | Same as above — `app.config.js` is baked into the native build |

---

## Trust — who can push code straight to installed wallets

OTA is the highest-leverage path into every user's device: it skips App Store
/ Play Store review entirely, and `useOtaUpdate` (`src/hooks/use-ota-update.ts`)
applies whatever it downloads with no on-device verification of *content*,
only of update-manifest validity. What follows is the actual trust boundary
today, not the aspirational one.

**Who can publish today:** anyone with `eas login` access to the
`frankiepower` Expo account and permission on this project. Publishing is a
local, human-run command (`bun run update:production`, see
[Daily workflow](#daily-workflow--ship-a-fix-to-production-users)) — there is
no CI job, no required review, and no branch protection gating it. Treat EAS
account credentials (and anyone's laptop with a cached `eas login` session)
with the same seriousness as prod deploy access, because that is what it is.

**Code signing is not configured.** `expo-updates` supports signing published
updates with a key pair the app verifies before applying a bundle
(`npx expo-updates codesigning:generate`, then `codeSigningCertificate` /
`codeSigningMetadata` in `app.config.js`). Without it, anyone who can publish
to the `production` branch — or anyone who compromises the Expo account —
can push arbitrary JS to every installed wallet with nothing on-device to
reject it. This is the single highest-value hardening item in this file;
enabling it doesn't change the daily workflow above, only what an attacker
with publish access (or a stolen EAS token) can do with it.

**`hot-updater` is inert, but its dead config still shipped a live secret.**
The `@hot-updater/react-native` config plugin is commented out
(`app.config.js`), so it never runs — EAS Update is the only active OTA
path, as noted at the top of this doc. That did not stop `env.js` from
unconditionally inlining `EXPO_PUBLIC_HOT_UPDATER_SUPABASE_ANON_KEY` into
every shipped bundle: any `EXPO_PUBLIC_*` value gets compiled in as soon as
it's referenced, whether or not the feature reading it ever runs. Worse, the
value in `.env` decodes as a Supabase **`service_role`** key — full,
RLS-bypassing database access — mislabeled as an anon key. That's now
removed from `env.js` and `.env.example` (dead code — the same class of gap
as the mainnet bundler secret, just an unused path instead of a live one).
**Two things only you can do:** rotate/revoke that key in the Supabase
project dashboard, and delete the three `EXPO_PUBLIC_HOT_UPDATER_SUPABASE_*`
lines from your local `.env` — it's gitignored, so it was never in the repo,
but the key itself is still live until you rotate it.

## Reference

- EAS Update docs: <https://docs.expo.dev/eas-update/introduction/>
- Code signing: <https://docs.expo.dev/eas-update/code-signing/>
- Latch dashboard: <https://expo.dev/accounts/frankiepower/projects/latch-mobile/updates>
- Project ID: `8b122713-0d94-4940-a71c-58da86f923ad`
- Owner: `frankiepower`
