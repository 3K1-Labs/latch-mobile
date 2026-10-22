# Debugging Android Passkey Failures

How to chase down `RP ID cannot be validated` and the other Credential Manager
failures that push `provisionPasskeyAtIndex` onto its device-only fallback.

Context: [#75](https://github.com/3K1-Labs/latch-mobile/issues/75). The symptom a
user sees is the alert **"Passkey saved to this device only"**. The symptom in
Sentry is a handled exception tagged `scope: platform-passkey-fallback`.

---

## Rule zero: use a real phone

**Emulators do not work for this.** Don't spend an afternoon proving it again.

- Passkey creation needs a credential provider. A plain AOSP image has none, and
  even a Play-enabled image ships a Google Password Manager that behaves
  differently from a retail device's.
- The Digital Asset Links check is a live HTTPS fetch made by Play Services. An
  emulator with a skewed clock or a proxied network fails that fetch and reports
  it as a validation failure — indistinguishable, from the app's side, from a
  genuinely wrong certificate.
- Both failures in #75 look alike in Sentry, but only the Samsung one is
  trustworthy evidence.

Plug in a real phone over USB. Everything below assumes that.

---

## Step 1 — Get the phone talking to your laptop

On the phone: Settings → About phone → tap **Build number** seven times, then
Settings → Developer options → **USB debugging** on. Plug it in and accept the
"Allow USB debugging?" prompt.

```bash
adb devices
```

You want a line ending in `device`. `unauthorized` means you haven't accepted the
prompt; `no permissions` usually means a cable that's charge-only.

`adb` lives at `~/Library/Android/sdk/platform-tools/adb` and is already on PATH
on this machine.

Two things worth confirming while you're here, because both cause this exact
failure and neither is the app's fault:

```bash
adb shell date                              # clock sane?
adb shell settings get global auto_time     # 1 = network time, good
```

The phone also needs a screen lock set and a Google account signed in. Without
either, Google Password Manager won't create a passkey at all.

---

## Step 2 — Find out what's actually installed

```bash
adb shell pm list packages | grep getlatch
adb shell dumpsys package app.getlatch.app | grep -E "versionCode|versionName"
```

`app.getlatch.app` is production, `qa.getlatch.app` is the QA flavour. They are
separate entries in `assetlinks.json` — make sure you're debugging the one you
think you are.

Note the `versionCode`. Ours is an epoch timestamp, so it tells you when the
native binary was built:

```bash
python3 -c "import datetime; print(datetime.datetime.fromtimestamp(1777375825, datetime.UTC))"
```

This matters because OTA updates change the JS but never the native binary or its
signature. A phone can be running this week's bundle inside an April build.

---

## Step 3 — Get the signing certificate off the phone

This is the decisive check, and the one people skip. Android compares the
certificate of the **installed** APK against `assetlinks.json`. Not the keystore
in the repo, not what EAS says it used — what's on the device.

```bash
adb shell pm path app.getlatch.app          # prints one or more APK paths
adb pull /data/app/.../base.apk /tmp/latch.apk
~/Library/Android/sdk/build-tools/36.0.0/apksigner verify --print-certs /tmp/latch.apk
```

`apksigner` isn't on PATH; the build-tools path above is where it lives. Read the
`Signer #1 certificate SHA-256 digest` line and normalise it for comparison:

```bash
~/Library/Android/sdk/build-tools/36.0.0/apksigner verify --print-certs /tmp/latch.apk \
  | grep -i "SHA-256 digest" \
  | awk '{print toupper($NF)}' \
  | sed 's/../&:/g;s/:$//'
```

That gives you `AA:BB:CC:…` in the same shape `assetlinks.json` uses.

---

## Step 4 — Check the domain side

```bash
curl -sSI https://uselatch.app/.well-known/assetlinks.json
curl -sS  https://uselatch.app/.well-known/assetlinks.json | python3 -m json.tool
```

All of these must hold, and Android is unforgiving about every one:

- HTTP **200**, no redirects (not even http→https or apex→www)
- `content-type: application/json`
- valid JSON
- an entry whose `package_name` matches, whose `relation` includes
  `delegate_permission/common.get_login_creds`, and whose
  `sha256_cert_fingerprints` contains the digest from step 3

Then ask Google, since Google's copy is what Play Services actually consults:

```bash
curl -sS "https://digitalassetlinks.googleapis.com/v1/statements:list?\
source.web.site=https://uselatch.app&\
relation=delegate_permission/common.get_login_creds" | python3 -m json.tool
```

If the file looks right but this returns nothing or something stale, you're
looking at a caching lag rather than a bad file.

**If the app ships through Play, also add the Play App Signing certificate**
(Play Console → Setup → App signing). Google re-signs uploads, so the certificate
the phone sees is not your upload certificate. Forgetting this is the single most
common cause of this bug.

---

## Step 5 — Watch the ceremony live

Clear the buffer, start streaming, then drive the app:

```bash
adb logcat -c
adb logcat -v time | grep -Ei "passkey|credential|credman|fido|assetlink|getlatch|ReactNativeJS"
```

Now on the phone: **Create a New Wallet → Enable Biometrics → Allow**.

What you should see, in order:

1. Credential Manager's `HiddenActivity` starting — the system sheet is up.
2. Play Services doing the association check. It surfaces under tags that vary by
   version; `CredMan*`, `Fido*`, `GmsCore` and anything mentioning asset links or
   statements are the ones to read.
3. Either a created credential, or our own fallback line:

```
ReactNativeJS: [passkey] platform ceremony failed, using a device-only key: <reason>
```

That last line comes from `src/lib/provision-passkey.ts` and is the fastest read
in the whole log — `describePasskeyFailure` has already turned the raw Android
error into a sentence. If it never appears, check that `console` isn't being
stripped from the build you're running.

To capture instead of watch:

```bash
adb logcat -c && adb logcat -v time > /tmp/passkey.log   # Ctrl-C when done
```

---

## Step 6 — Read the result

| What the log says | What it means |
|---|---|
| `RP ID cannot be validated`, `not associated with domain`, `cannot be validated` | The asset-links check failed. Step 3 vs step 4 — certificate mismatch, or Play Services couldn't fetch the file (clock, network, DNS). |
| `User canceled the selector`, `activity is cancelled` | Ambiguous by design: either the user dismissed the sheet, or the sheet had nothing to offer. On a *create* flow this is usually a genuine dismissal. |
| `NoCreateOption` | No passkey provider configured — no Google account, or no screen lock. |
| `NotSupported` | Play Services too old for Credential Manager. |
| Sheet never opens, no `HiddenActivity` | Never got as far as the ceremony. Look upstream in the JS. |

---

## Step 7 — Isolate with a locally-signed build

If steps 3 and 4 disagree and you want to prove it's the certificate and nothing
else, build and install from source:

```bash
npx expo run:android --device
```

This signs with `android/app/debug.keystore`, whose fingerprint
(`FA:C6:17:45:DC:09:…:3B:9C`) is already listed in `assetlinks.json`. If the
passkey ceremony succeeds on this build and fails on the shipped one, the
certificate is your answer and nothing else needs investigating.

> `android/app/build.gradle` also uses that debug keystore for the `release`
> build type. EAS overrides it with its own credentials, but check
> `eas credentials -p android` rather than assuming.

Play Services caches association results. After you change `assetlinks.json`,
reinstall the app to force a re-check rather than trusting the old answer.

---

## Handing this to an agent

The logs are long, noisy, and mostly irrelevant — which is exactly what an agent
is good at. Capture, then ask:

```bash
adb logcat -c
# drive the passkey flow on the phone, then Ctrl-C:
adb logcat -v time > /tmp/passkey.log
```

Then point Claude Code at it:

> Read `/tmp/passkey.log`. I ran the Create-a-New-Wallet flow on a physical
> Android phone and the passkey ceremony failed. Find the Credential Manager
> and Play Services lines around the failure, tell me whether the asset-links
> check failed and why, and compare the installed APK's signing certificate
> against `https://uselatch.app/.well-known/assetlinks.json`.

It can run steps 2 through 4 itself. Give it the log and the phone, and it will
do the fingerprint comparison faster than you'll read the first screenful.

---

## Confirming the fix

You're done when, on a real phone with a fresh install:

1. Creating a wallet shows the system passkey sheet and completes it.
2. **No** "Passkey saved to this device only" alert appears.
3. No new `platform-passkey-fallback` events land in Sentry for that build.
4. The passkey is visible in Google Password Manager
   (passwords.google.com → the entry for the passkey domain).
5. Signing in on a *second* device finds it — the whole point of the platform
   path, and the only check that proves the credential actually synced.

Step 5 is the one that matters. The first four can all pass on a credential that
never left the phone.
