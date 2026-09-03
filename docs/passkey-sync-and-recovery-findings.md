# Passkey sync and recovery: what we know, and what to fix first

Written 2026-09-03 from a hands-on investigation of the mobile app, the web
app, the browser extension, `latch-api`, and the contracts. Plain language on
purpose. Technical detail is kept to the end of each section so the top can be
read by anyone.

## The one thing to do first

**Put every Latch client on one passkey domain that the company owns.**

Today a passkey created on a phone is permanently tied to `michaelesenwa.me`,
a personal domain. The browser extension ties its passkeys to its own Chrome
extension ID. The web app uses a third value. A passkey only ever works for
the exact domain it was created under, so right now a passkey made on a phone
can never be used on the web or in the extension, and vice versa, no matter
how well it syncs.

Nothing else in this document works across devices and clients until that is
fixed. It is the foundation, not one item among many.

Issue #77 covers half of this: moving mobile off the personal domain. The
other half, making the web app and the extension use that same domain, is
described in Discussion #32 but has no issue yet. Both halves should be one
project with one domain decision.

## How sync and recovery actually work (short version)

- **A passkey** is a private key kept by the phone or computer, plus a small
  ID the device made up for it (the "credential ID"). The private key never
  leaves the device's secure hardware.
- **Syncing** means Google Password Manager or iCloud Keychain copies that
  passkey to the same person's other devices. Sync is done by Apple and
  Google, not by us.
- **The domain (RP ID)** is baked into the passkey at creation. A device will
  only offer the passkey to an app or site that has proved it owns that
  domain. Proof is two small files hosted on the domain: one for Android, one
  for iOS.
- **The wallet address** is calculated from the passkey's public key plus its
  credential ID, through the account factory. Same inputs always give the
  same address. This is what makes recovery possible.
- **Recovery** on a new device means: the device already has the passkey
  (via sync), so it needs to work out which wallet address belongs to it.

## What each client uses today

| Client | Passkey domain today | Files hosted for it |
| --- | --- | --- |
| Android app | `michaelesenwa.me` | `assetlinks.json` served, valid, and matches the shipped Play signing certificate (verified on a real device 2026-09-03) |
| iOS app | `michaelesenwa.me` | `apple-app-site-association` served with the right Team ID and bundle IDs (not yet verified on a real iPhone) |
| Browser extension | its own Chrome extension ID | none needed, but this is why extension passkeys can never move to mobile |
| Web app | set by an environment variable (`localhost` in the example config) | to be confirmed for production |

The pairing screens also fall back to a fourth value (`latch.finance`) when
the environment variable is unset. Harmless today because nothing checks it,
but it is one more place that must change together with the rest.

## Where things stand on the Android bug (#75)

Resolved as far as we can tell. Verified on a real Oppo A9 2020 and, per the
team, on the Galaxy A12 that originally failed. The domain file was edited
today a few hours before verification, and nobody has yet said what changed.
Worth getting on record so the same mistake is not repeated on the new domain.

Still open and unrelated to the domain: the app silently falls back to a
device-only key on any failure. Decision taken in this session: remove that
fallback so passkey creation either succeeds or fails visibly, matching what
the extension already does. Known cost: a phone with no passkey provider at
all (no Google account, no screen lock) will not be able to create a wallet.

## Recovery: "I have a wallet" should not ask for an address

Today the mobile sign-in screen asks the user to paste their wallet address.
That is the only way the app can find the wallet, because nothing anywhere
records which passkey belongs to which mobile wallet.

The fix does not need a server. The address is calculated from the passkey's
public key and credential ID. On a fresh device the passkey sign-in returns
the credential ID and a signature but not the public key. The public key can
be recovered mathematically from that signature (standard P-256 ECDSA
recovery, two candidates), then each candidate is turned into an address and
checked on-chain. Only the real one exists and lists this passkey as a
signer, so the wrong candidate simply fails. This works for every wallet ever
created, on any client that adopts it.

Practical notes for whoever builds it:

- With today's backend it takes two biometric prompts: one to discover, one to
  sign in. Collapsing to one needs a small `latch-api` change (a sign-in
  challenge that is not tied to an address up front).
- Every extra account gets its own passkey. The first one is named
  "Latch Wallet" and later ones get the account name, so the system chooser
  can show confusing duplicates. Name them per account as part of this work.
- The maths library the app already uses provides the recovery primitive; no
  new dependency. It touches the most security-sensitive area of the app and
  needs a reviewed change with test vectors, not a quiet addition.
- A server-side index (credential ID to address) is the complementary approach
  and is what would let the extension find mobile wallets. Discussion #32
  already lists it as a workstream. Do the client-side derivation first; it
  works today for all existing accounts.

## Multiple accounts and shared wallets

- One passkey backs exactly one personal wallet. A second personal wallet
  always gets a new passkey. Making one passkey back several personal wallets
  is possible but is a deploy-API change and would only apply going forward.
- A passkey can also be a signer on shared (multisig) wallets. Those are
  announced to the backend when created and rediscovered automatically after
  the personal wallet is signed in. Their addresses cannot be calculated
  directly.
- A wallet a device was *paired into* is not announced anywhere, so a third
  device cannot find it. Gap; needs its own issue.
- A wallet recovered through passkey sign-in cannot currently pair a second
  device, because the pairing flow only works with the older device-only key
  type. Gap; needs its own issue.

## What a credential ID is

Not a number. An opaque string of bytes chosen by the phone when the passkey
is created (usually 16 to 32 bytes); the older device-only keys use 16 random
bytes. The app writes it as hex. It is stored on the device, inside the
wallet's on-chain signer record, in Google or Apple's password manager, and
(for web-created wallets only) in `latch-api`'s database. Nothing indexes
mobile wallets by it, which is why recovery derives the address instead of
looking it up.

## Open issues and gaps, in one place

| Item | Status |
| --- | --- |
| #75 Android passkey domain verification | Verified working on two real devices; keep the Sentry check running |
| #77 Move passkeys to a company-owned domain | Open; needs the domain decision first (see the `latch.ooo` ownership question in the issue) |
| Same domain for web app and extension | No issue yet; described in Discussion #32; should be scoped with #77 |
| Remove the silent device-only fallback | Decided; not yet built |
| Recover the wallet address from the passkey (no pasting) | Designed above; not yet built |
| Name each passkey after its account | Small; do with the recovery work |
| Paired-into wallets not discoverable on a third device | Gap; no issue yet |
| Recovered passkey wallets cannot pair a new device | Gap; no issue yet |
| #76 Two commits stranded on the old branch | Open; revisit after the passkey work |
| Pairing screens default to a different domain | Cosmetic today; fix with #77 |

## The domain: `uselatch.app`

Purchased for the landing page, to be hosted on Vercel. It can serve both the
landing page and the passkey proof files; no second domain is needed. Checked
2026-09-03: still parked at Namecheap, not yet pointed at Vercel, so nothing
existing has to be preserved.

Rules that must hold, in the order they usually go wrong:

1. The passkey domain (RP ID) is the bare `uselatch.app`, not `www`.
2. The two proof files must be reachable at
   `https://uselatch.app/.well-known/assetlinks.json` and
   `https://uselatch.app/.well-known/apple-app-site-association`, answering
   200 directly, never a redirect. On Vercel this means the bare domain is the
   primary domain and `www` redirects to it, not the other way round.
3. Both files served as `application/json` (the Apple one has no file
   extension, so it needs an explicit header rule).
4. Production deployment protection off; the files must be public.
5. The landing-page repo must treat `public/.well-known/` as owned by the
   wallet team. A deploy that drops it breaks passkey sign-in for everyone.

Ready-to-use copies of both files, taken verbatim from the current live
domain, plus the Vercel header rule, were prepared during this session and
should be committed into the landing-page repo when it exists.

The web app should live on a subdomain (for example `app.uselatch.app`) and
use `uselatch.app` as its RP ID too; that is what lets one passkey serve
phone and web. The browser extension cannot use a web domain as its RP from
an extension page; how it joins is the design question in Discussion #32.

## Suggested order

1. Decide the domain (the open question in #77) and confirm who deploys to it.
2. Host both `.well-known` files there, copied from the current ones.
3. Move mobile, web, and the extension to it, in one coordinated change, with
   the old domain kept alive for existing users (sequencing in #77).
4. Verify on real devices, both platforms, the same way #75 was verified.
5. Then build address recovery from the passkey, so "I have a wallet" never
   asks for an address again.
6. Then the fallback removal and the pairing gaps.

## Where the technical evidence lives

- Device verification log and certificate comparison: comment on #75 dated
  2026-09-03.
- Debugging runbook: `docs/debugging-android-passkeys.md`.
- Mobile passkey creation and fallback: `src/lib/provision-passkey.ts`.
- Mobile sign-in that asks for the address: `app/(onboarding)/sign-in-passkey.tsx`.
- Address derivation: the account factory contract and `latch-api`'s
  `DeployByKeyData`; both use the same salt rule.
- Extension domain logic: `apps/extension/src/ui/webauthn/passkey.ts` in
  `latch-web-extension`.
- Cross-client design discussion: 3K1-Labs Discussion #32.
