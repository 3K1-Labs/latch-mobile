# Design synced-passkey wallet discovery, reconnection, and cross-profile recovery

> Source: [3K1-Labs/discussions#32](https://github.com/orgs/3K1-Labs/discussions/32)
> Author: **FrankiePower** · Category: 💡 Ideas · Posted 2026-08-21
> This file is a plain-text replica of the discussion and its two replies, kept
> for offline reference. See [`passkey-sync-and-recovery-findings.md`](passkey-sync-and-recovery-findings.md)
> for the follow-up investigation this discussion led to.

## Main post

### Problem

Latch requires a mechanism for users to recover and reconnect to existing
passkey-controlled smart accounts across devices, Chrome profiles, extension
reinstallations, and various credential providers (Apple Passwords/iCloud
Keychain, Google Password Manager, local Chrome storage).

**Concrete motivating case:** A wallet created via Chrome extension on macOS
with a passkey in Apple Passwords should be recoverable on another Mac or
Apple device, across Chrome profiles, and when the extension is reinstalled.

**Key questions addressed:**

- [ ] Can Apple-synced passkeys restore wallets on different Apple devices?
- [ ] How do Chrome profile changes affect recovery?
- [ ] What distinguishes Google Password Manager from local Chrome passkeys?
- [ ] How to prevent accidental duplicate wallets?
- [ ] What wallet state requires rediscovery post-authentication?

### Important distinction

"Sign in with Apple" and "Sign in with Google" function as federated
identity/recovery mechanisms, not passkey access tools. These OAuth flows do
not enumerate or unlock passkeys stored by credential providers. The
browser/OS selects the credential provider during WebAuthn ceremonies; the
relying party remains intentionally unaware of provider identity.

### Proposed primary UX

**Two explicit paths:**

**Use a passkey / Restore with an existing passkey:**

1. Initiate WebAuthn authentication for stable Latch RP ID with empty
   `allowCredentials`
2. Browser/OS displays eligible discoverable credentials from enabled
   providers
3. Receive selected credential ID after successful verification
4. Normalize credential ID and query indexer for smart-account contracts
5. Single matching account triggers reconnection; multiple matches show
   account selector
6. Fetch signer/context rules and complete authorization check
7. Save only replaceable local connection metadata

**Create a new wallet:**

- [x] Warn that this creates new smart-account address and passkey
- [ ] Offer pre-creation check for existing wallets
- [ ] Prevent registration if credential's public key or ID already associates
      with account

### Expected behavior by storage provider

| Provider                            | New profile (same Mac)                                             | Another Mac                                                  | iPhone/iPad                                                                                 | Windows/Android                                                    |
| ----------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Apple Passwords/iCloud Keychain** | Likely offered if enabled; extension state empty                   | Available with same Apple Account + iCloud Passwords enabled | Credential syncs; desktop extension unavailable—use web/native app or cross-device approval | Use cross-device auth/QR or Apple credential provider if available |
| **Google Password Manager**         | Available with same Google PMG account access; state profile-local | Synced through same Google Account and unlock                | Enabled on supported iOS/iPadOS versions                                                    | Synced across supported Chrome/Android environments                |
| **Local Chrome-profile passkey**    | Only originating profile                                           | Not synchronized                                             | Not synchronized                                                                            | Not synchronized                                                   |

### Chrome extension identity requirement

WebAuthn credentials scope to RP ID permanently. Chrome extensions receive an
extension-specific default RP ID if `rpId` remains blank. Latch must decide:

1. **Extension-specific RP ID:** maintain stable published extension ID
   across installations
2. **Latch web-domain RP ID:** configure extension permissions around stable
   HTTPS domain

Development extensions with changing IDs cannot be mistaken for production
recovery tests.

### Relationship to current smart account kit

The reference implementation sketches an account-discovery flow:

1. Authenticate without specifying credential
2. Receive selected credential ID
3. Use indexer to find associated contracts
4. Connect using selected contract and credential ID

OpenZeppelin's WebAuthn signer stores "65-byte P-256 public key || credential
ID" because public keys are exposed during registration; later ceremonies
reference credentials by ID. The chain serves as the durable registry;
extension local storage functions as a cache only.

### Product terminology

Maintain distinct terms:

- [x] **Reconnect/restore with passkey:** valid credential exists; local wallet
      state missing
- [ ] **Cross-device authentication:** credential use via QR/proximity without
      copying to the current device
- [ ] **Recover lost wallet credential:** no valid account signer accessible;
      requires a separate recovery policy
- [x] **Create another wallet:** intentionally create a new smart-account address
      and passkey

Avoid labeling synced-passkey reconnection as social/account recovery.

### Required investigation matrix

Test a production-equivalent extension/RP ID with real devices across 14
scenarios including:

- [x] Same macOS user, same/different Chrome profiles, extension reinstalled
- [ ] Different Mac with same Apple Account and iCloud Keychain
- [ ] iPhone approving desktop requests
- [ ] Chrome with same/different Google Accounts
- [ ] Passkey deliberately saved to local Chrome storage
- [x] Multiple Latch passkeys for same RP ID
- [ ] One credential controlling multiple accounts
- [ ] Indexer unavailability/staleness
- [ ] Signer removed on-chain but credential exists
- [ ] On-chain signer exists but credential deleted
- [ ] Development vs. production extension ID differences

### Open design questions

1. Exact current extension RP ID and origin during registration/authentication?
2. Does registration require a discoverable credential, or just prefer it?
3. Should `residentKey` and `userVerification` be `required` for durable
   owner passkeys?
4. Is credential-ID-to-contract discovery sufficiently reliable and
   privacy-preserving?
5. Is there a bounded on-chain fallback if the indexer is unavailable?
6. How should multiple accounts from one credential be presented?
7. Can the client determine/display credential provenance
   (Apple/Google/local)?
8. What signed challenge proves control before saving a restored session?
9. What UI distinguishes "no eligible passkey," "rejected," "unauthorized,"
   and "indexer failure"?
10. Should Sign in with Apple/Google exist only as an optional
    lost-credential recovery path?

### Proposed implementation breakdown

Seven bounded tasks after design agreement:

1. Audit and document production RP ID/origin strategy (Medium)
2. Require and test discoverable durable-owner credentials (Medium/High)
3. Implement provider-neutral existing-passkey discovery (High)
4. Add multiple-account selection and stale-indexer fallback (High)
5. Create a real-device/profile/provider test harness (Medium)
6. Write user-facing passkey location/sync/recovery documentation (Medium)
7. Design a separate lost-credential recovery flow (discussion first)

---

## Reply 1 — FrankiePower (2026-08-21)

### Addendum: native mobile ↔ web compatibility and mobile-first restoration

The target product journey includes a wallet created in the native mobile
app, synced via Apple Passwords or Google Password Manager, then opened in
the Latch web app or browser extension for authentication and account
reconnection.

### Is one WebAuthn credential valid in a website and a native mobile app?

**Yes, when deliberately configured.** Syncing private credentials is
necessary but insufficient; WebAuthn still enforces relying-party scope.

For a canonical RP (`wallet.example.com`):

- [ ] Web app creates/authenticates with that RP ID
- [x] iOS app declares the domain under Associated Domains with a `webcredentials`
      service; the domain hosts a matching `apple-app-site-association` file
- [x] Android app is linked through Digital Asset Links and a hosted
      `/.well-known/assetlinks.json` with an app/package/signing-certificate
      relationship
- [ ] Every client uses the same credential-ID-to-smart-account mapping

This permits credentials created in native apps to authenticate in web
clients (and vice versa) when credential providers synchronize or the user
selects cross-device authentication.

### Chrome extension consequence

Chrome provides extension-specific WebAuthn support. When an extension uses
the extension-specific default RP identity, that credential scopes to the
extension, not automatically to a future Latch website/iOS/Android app.

**Must inspect the current extension RP ID before assuming existing passkeys
port to native mobile:**

- [ ] If the extension already uses a stable Latch HTTPS domain as RP ID, that
      domain becomes a shared service identity (subject to extension permissions
      and native-app association files)
- [ ] If it uses an extension-specific RP identity, the credential continues
      working across that same stable extension installation, but native apps
      cannot claim it; migration likely requires adding a new domain-scoped
      passkey/signer to the same account

Extension-specific passkeys must never be silently treated as equivalent to
domain-scoped passkeys merely because they share the same credential
provider.

### Required mobile-first scenarios

- [x] Create wallet in iOS app using iCloud Keychain; reconnect on HTTPS web
      client
- [x] Create in Android app with Google Password Manager; reconnect on Chrome
      desktop
- [ ] Create on iOS; approve web authentication from phone via QR without
      syncing credential to desktop
- [ ] Create on Android; approve via cross-device QR
- [ ] Create mobile; reconnect from clean browser profile with no Latch state
- [ ] Create mobile; reconnect when credential ID maps to multiple accounts
- [x] Confirm mobile credential not offered to web/extension origin using a
      different RP ID
- [x] Confirm expected behavior when Apple Passwords and Google Password Manager
      both contain eligible credentials
- [x] Verify iOS `apple-app-site-association` and Android `assetlinks.json` in
      production-like signed builds
- [ ] Document all results comprehensively

### Recommended architecture decision

To move one wallet/passkey naturally between native mobile, web, and
extension clients, prefer a stable HTTPS domain as the canonical RP identity
and associate every first-party native app with it.

The extension still requires compatibility proof: confirm WebAuthn requests
can securely use the chosen domain RP ID, or perform the ceremony in a
first-party HTTPS surface owned by that domain. Origin validation must be
explicit; the current verifier's omission of on-chain origin/RP-ID-hash
validation increases the importance of correct client/RP architecture.

### Sign in with Apple/Google remains separate

Native/web credential association requires no OAuth Sign in with Apple or
Sign in with Google. Those may remain optional lost-credential
recovery/contact mechanisms. The shared passkey flow is driven by WebAuthn RP
association plus the credential provider's sync/cross-device capabilities.

---

## Reply 2 — FrankiePower (2026-08-21)

### Implementation audit: what Latch supports today

The current extension does **not** create a passkey for the HTTPS Latch
domain. It sends `chrome.runtime.id` as `chromeExtensionId`; the backend uses
the extension ID as the WebAuthn RP ID and verifies the origin as
`chrome-extension://<extension-id>`. Transaction assertions use the same
extension RP ID.

The existing-passkey flow conducts genuine local-state reconstruction:

- [x] A clean profile may start discoverable WebAuthn authentication without
      local wallet records
- [x] After a successful assertion, the backend maps the credential to
      smart-account address(es)
- [ ] The extension recreates local `latch.accounts`, active-account, and
      setup-state records

**Important consequence:** a credential visible in Apple Passwords may be
synced, but it remains scoped to the extension RP. Sync doesn't make it valid
for a future HTTPS web app or native iOS/Android app. Another installation
uses it only if running the same stable extension identity with the
credential provider making the credential available.

There is currently no fixed manifest `key` in the repository. The published
Chrome Web Store build has a stable extension ID; unpacked/development
builds may have different IDs. Different IDs are different WebAuthn RPs.

### Outcome key

- [ ] **Direct:** same credential authenticates directly after normal
      verification
- [ ] **Provider/configuration test:** RP compatible; availability depends on
      password-manager selection, sync state, browser/OS support, extension
      identity
- [ ] **Hybrid/QR:** passkey use on phone approves ceremony on another device;
      target surface still requires same RP ID
- [ ] **Signer migration:** existing credential cannot sign for target RP; use
      it once on a compatible surface to add a new target-compatible signer to
      the same account
- [ ] **Lost-passkey recovery:** no usable authorized credential remains; use a
      separate recovery policy (not synced-passkey reconnection)

### A. Current extension RP: profile, browser, desktop combinations

Verify onboarding "Use Existing Passkey" and a real transaction signature
post-restoration across scenarios:

**Same installation / local-state loss:**

- [ ] Create in Chrome profile A → clear only Latch local storage → restore in
      same installation (Direct; proves backend discovery)
- [ ] Create in profile A → remove/reinstall published extension in profile A →
      restore with Apple Passwords
- [ ] Create in profile A → remove/reinstall with GPM
- [ ] Create in profile A → backend cookie/session cleared → restore
- [ ] Create in profile A → local extension state and backend session cleared →
      restore using discoverable authentication
- [ ] Restore with one credential controlling one account
- [ ] Restore with one credential associated with multiple accounts; confirm
      all reconstructed, active account deterministic
- [ ] Restore with multiple credentials controlling one account; confirm chosen
      credential and stored `passkeyCredentialId` correct

**Chrome profile A → Chrome profile B (same Mac):**

- [ ] Apple Passwords credential → profile B, same published extension ID
      (Provider/configuration test)
- [ ] GPM credential → profile B signed into same Google account
      (Provider/configuration test)
- [ ] Chrome-profile-local/device-bound credential → profile B (not direct
      unless Chrome exposes; expect migration/recovery)
- [ ] Profile B different Google account while Apple Passwords contains
      credential
- [ ] Profile B same Google account while credential saved to Apple Passwords,
      not GPM
- [ ] Incognito/private extension context; verify WebAuthn and storage behavior
- [ ] Managed/work Chrome profile with password-manager restrictions

**Chrome profile A → another browser (same desktop):**

- [ ] Chrome → Chromium/Chrome Beta with same store extension identity (usually
      different IDs; verify, else Signer migration)
- [ ] Chrome → Edge with separately published extension (Signer migration
      unless exact RP ID intentionally preserved)
- [ ] Chrome → Brave with separately installed extension (Signer migration
      unless exact RP preserved)
- [ ] Chrome extension → Safari extension (Signer migration; Safari extension
      identity/origin differs)
- [ ] Chrome extension → Firefox extension (Signer migration; extension
      origin/RP differs)
- [ ] Published extension → unpacked development build (Signer migration when
      IDs differ)
- [ ] Unpacked build A → unpacked build B/reloaded; record whether ID remained
      stable

**Desktop → desktop:**

- [ ] macOS Chrome + Apple Passwords → another Mac, same Apple Account, same
      published extension ID (Provider/configuration test)
- [ ] macOS Chrome + GPM → another Mac, same Google account, same published
      extension ID
- [ ] macOS Chrome + GPM → Windows Chrome, same Google account, same published
      extension ID
- [ ] Windows Chrome + GPM → macOS Chrome, same Google account, same published
      extension ID
- [ ] Windows Hello/device-bound passkey → another Windows (not synced unless
      credential provider synced)
- [ ] Windows Chrome + GPM → another Windows, same Google account
- [ ] Linux Chrome + GPM → macOS/Windows Chrome, same Google account
- [ ] macOS Apple Passwords → Windows/Linux extension (Hybrid/QR possible if
      Chrome offers phone with same RP; Apple sync unavailable)
- [ ] Any desktop → new desktop with hardware security key (Direct; same RP
      required)

### B. Current extension RP ↔ mobile/native/web

Deliberately directional; the extension passkey is extension-scoped.

**Extension-created credential → mobile:**

- [ ] macOS extension + Apple Passwords → iOS native Latch app (Signer
      migration; not direct)
- [x] macOS extension + Apple Passwords → Android native app (Signer migration)
- [ ] Desktop extension + GPM → Android native app (Signer migration)
- [ ] Desktop extension + GPM → iOS native with GPM enabled (Signer migration)
- [ ] Desktop extension → mobile HTTPS Latch web app (Signer migration)
- [ ] Desktop extension → desktop HTTPS Latch web app (Signer migration)
- [ ] Desktop extension → Chrome on Android (no desktop extension surface;
      future HTTPS/native signer migration)
- [ ] Desktop extension → Safari on iOS (Signer migration)
- [ ] Try phone QR approval from extension on another desktop (Hybrid/QR works
      only for extension RP and supported browser flow; doesn't convert
      credential to mobile-app credential)

**Mobile/domain credential → current extension:**

- [ ] iOS-native domain credential → current Chrome extension (Signer
      migration; extension requests extension ID)
- [ ] Android-native domain credential → current Chrome extension (Signer
      migration)
- [ ] HTTPS-web domain credential → current Chrome extension (Signer migration)
- [ ] Mobile domain credential → extension via phone QR (insufficient while
      extension requests extension RP; RP mismatch)

### C. Required future shared-domain design matrix

Direct/QR-assisted only after Latch chooses a canonical HTTPS RP ID
(`wallet.example`) and configures native credential sharing:

- [x] iOS: Associated Domains `webcredentials:<rp-domain>` and a valid AASA file
- [x] Android: Digital Asset Links and a valid `/.well-known/assetlinks.json`
      linking app/signing certificate
- [ ] Web: every ceremony uses a compatible RP ID; subdomain rules
      documented/tested

**iOS ↔ Android:**

- [ ] Create iOS native with Apple Passwords → recover Android native using
      direct provider availability
- [ ] Create iOS native with Apple Passwords → recover Android native using QR
      when direct Apple availability absent
- [ ] Create iOS native with GPM → recover Android native with same Google
      account
- [ ] Create Android native with GPM → recover iOS native with GPM enabled as
      iOS credential provider
- [ ] Create Android native with GPM → recover iOS native using QR when GPM not
      enabled on iOS
- [ ] Create Android with Samsung Pass → recover iOS (use that provider if
      supported; else QR or add signer)
- [ ] Create iOS device-bound credential → Android (QR if source available;
      else add signer before loss or recovery)
- [ ] Create Android device-bound credential → iOS (same distinction)

**iOS native ↔ HTTPS web:**

- [ ] iOS native + Apple Passwords → Safari web on same iPhone
- [x] iOS native + Apple Passwords → Safari/Chrome web on same Mac with same
      Apple Account (confirmed working 2026-09-15)
- [ ] iOS native + Apple Passwords → Chrome/Edge web on Windows via QR
- [ ] iOS native + GPM → Chrome web on macOS/Windows with same Google account
- [ ] Web Safari on iPhone → iOS native
- [ ] Web Safari/Chrome on Mac → iOS native
- [ ] Web Chrome on Windows → iOS native using GPM credential
- [ ] Web-created Apple Passwords credential → iOS native after app/domain
      association installed
- [ ] Repeat each direction after deleting only app/web local state while
      retaining the passkey

**Android native ↔ HTTPS web:**

- [ ] Android native + GPM → Chrome web on same Android phone
- [ ] Android native + GPM → Chrome web on macOS/Windows/Linux with same Google
      account
- [ ] Android native + GPM → Safari web on Mac/iPhone with GPM enabled (where
      supported)
- [ ] Android native device-bound credential → desktop web via phone QR
- [ ] Chrome web on Android → Android native
- [ ] Desktop Chrome web + GPM → Android native
- [ ] Desktop web credential from another provider → Android native via
      provider, QR, or signer addition
- [ ] Repeat each direction after deleting app/web local state only, retaining
      the passkey

**Web ↔ web, profile ↔ profile:**

- [ ] Chrome profile A on macOS → Chrome profile B on same Mac using Apple
      Passwords
- [ ] Chrome profile A → profile B using same GPM account
- [ ] Chrome profile A → profile B with different Google account but same OS
      credential provider
- [ ] Chrome on macOS → Safari on macOS with Apple Passwords
- [ ] Safari on macOS → Chrome on macOS with Apple Passwords
- [ ] Chrome on Windows → Edge on Windows using same available provider
- [ ] Chrome desktop → Firefox desktop using shared provider or QR
- [ ] Desktop web → mobile browser on iOS
- [ ] Desktop web → mobile browser on Android
- [ ] iOS browser → Android browser
- [ ] Android browser → iOS browser
- [ ] Same RP across `wallet.example`, `app.wallet.example`, other subdomains;
      verify chosen RP is legal/consistent

### D. Migration checklist for existing extension wallets

- [ ] Choose one canonical HTTPS RP domain for future web+iOS+Android
      credentials
- [ ] Add an account operation allowing an authorized existing signer to add a
      new verifier/public-key pair
- [ ] In the current extension, authenticate/sign with the existing extension
      passkey
- [ ] In the same guided flow, register a new domain-scoped passkey for
      web/native use
- [ ] Add the new P-256/WebAuthn signer to the **same** Stellar smart account;
      don't move assets or create a replacement
- [ ] Confirm both the old extension credential and the new domain credential
      can sign during the transition window
- [ ] Offer explicit old-signer removal only after the new signer completes a
      real assertion and transaction test
- [ ] Support adding both an Apple-provider and a Google-provider passkey as
      separate signers for resilience
- [ ] Explain that "Sign in with Apple/Google" OAuth does not expose or
      transfer WebAuthn private keys
- [ ] Preserve credential ID → public key → verifier → smart-account mappings
      independently of browser storage
- [ ] Decide whether the backend session mapping or the chain-derived/indexed
      mapping is authoritative; specify a stale-indexer fallback

### E. Negative, deletion, and real recovery cases

- [x] Credential deleted from Apple Passwords but present on another Apple
      device; test sync before relying on it
- [x] Credential deleted from GPM but cached on another device
- [] Credential provider signed out/disabled while local extension state
  remains
- [] Provider switched (Apple Passwords ↔ GPM ↔ third-party) post-account
  creation
- [ ] Source phone offline during QR/hybrid authentication
- [ ] Source phone Bluetooth disabled or not near target device
- [ ] Phone number/account changed but passkey provider account remains
- [ ] Apple Account or Google account inaccessible but local passkey remains
- [ ] All copies of the only authorized passkey deleted (Lost-passkey recovery)
- [ ] Device lost while another synced copy exists (Synced-passkey
      reconnection)
- [ ] Device lost and only a second independent signer exists; use signer
      rotation
- [ ] Credential succeeds but backend mapping missing
- [ ] Backend mapping exists but on-chain signer removed/revoked
- [ ] Credential ID known locally but credential provider cannot produce an
      assertion
- [ ] Testnet credential/account in mainnet mode and vice versa; never silently
      cross networks
- [ ] Published extension ID changes due to store migration; provide
      old-RP-authorized migration before cutover
- [ ] Domain changes (`old.example` → `new.example`); RP migration must be
      planned before retiring the old domain

### Acceptance evidence for every supported row

- [ ] Record source OS/app/browser/profile, credential provider, RP ID,
      extension/app version, network
- [ ] Capture whether the flow was direct, account chooser, QR/hybrid, or
      signer migration
- [ ] Start with target local state empty
- [ ] Prove the correct existing smart-account address is reconstructed; no
      duplicate wallet deployed
- [ ] Prove balances/history/labels are restored, or explicitly document which
      metadata is local-only
- [ ] Complete a real transaction assertion, not only a backend login
- [ ] Verify cancellation, wrong-provider, unavailable-credential, and
      stale-session errors are understandable
- [ ] Document the result as supported, conditionally supported, unsupported,
      or blocked by an upstream limitation

### Proposed implementation split for contributors

Eight tasks:

1. Investigation: automated RP-ID/extension-ID diagnostics and manual
   compatibility harness (Medium)
2. Investigation: execute and document current extension profile/desktop
   matrix (Medium)
3. Design: canonical domain RP plus iOS AASA and Android DAL
   proof-of-concept (High)
4. Backend/indexing: credential-to-smart-account discovery with no target-
   device local state (High)
5. Contract/product: authorize adding a domain-scoped signer using the
   existing extension signer (High)
6. Extension UX: guided extension-RP → domain-RP signer migration with
   rollback-safe confirmation (High)
7. Mobile/web prototypes: directional iOS ↔ Android ↔ web matrix
   validation (High; split by platform)
8. Documentation: provider-neutral reconnect vs. lost-passkey copy and
   support matrix (Medium)

The checklist should be treated as an evidence program. A checked box means
the exact direction was reproduced and documented — not merely inferred from
vendor documentation.

---

## References cited

- [ ] Google: passkey support across Android and Chrome
- [ ] Google: server-side passkey authentication and discoverable credentials
- [ ] Google: passkey user journeys
- [ ] Apple: iCloud Keychain sync
- [ ] Apple: passkeys overview
- [ ] Apple: connecting a native app to a passkey service
- [ ] Apple: supporting associated domains
- [ ] Chromium: origins that support WebAuthn
- [ ] Google: sharing passkeys between websites and Android apps
- [ ] Google: credential sharing setup
- [ ] Google: passkey and cross-device environment support
- [ ] WebAuthn Level 3: discoverable credentials and RP ID
- [ ] OpenZeppelin credential-ID rationale
