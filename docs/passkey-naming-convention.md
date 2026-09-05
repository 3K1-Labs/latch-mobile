# Passkey naming convention

For whoever implements this in `latch-web-extension`. Mobile already ships it
(`src/lib/provision-passkey.ts`); this is the same convention, written up so
the extension's passkeys look like they came from the same product instead of
a different one glued on.

## Why this matters

Every personal wallet gets its own passkey (mobile: `provision-passkey.ts`;
extension: `passkey.ts`'s `nextPasskeyAccountDisplayName`). A device with more
than one ends up with more than one passkey in the OS/browser credential
manager, and right now mobile and the extension name them differently.
That's already confusing today, and it becomes a real problem once mobile,
web, and the extension share one RP domain (issue #77 / Discussion #32) —
at that point a user's mobile and extension passkeys can show up filed under
the *same* domain heading, and inconsistent naming reads as broken, not just
inconsistent.

## What the credential manager actually shows

Checked against a real iCloud Keychain entry (see
`docs/passkey-sync-and-recovery-findings.md`). Two screens, two different
fields:

- **The sign-in picker** (the sheet that pops up during a WebAuthn ceremony)
  shows `user.displayName`.
- **The saved-passwords / passkey management screen** (iOS Settings →
  Passwords, Chrome's own passkey manager, Android Password Manager) shows
  `user.name` — **not** `displayName`. This is the screen people actually use
  to look their passkeys over later, and it's the only place per-credential
  text appears there at all.

Consequence: if `user.name` is a hardcoded constant (mobile's bug, fixed in
the change referenced below) or an opaque slug, every passkey looks identical
or unreadable on that second screen, even though the sign-in picker looked
fine. **Both fields need the human-readable name**, not just `displayName`.

## The convention

```
name = accountLabel
  ? `${accountLabel} (Latch ${seq})`
  : `Latch Wallet ${seq}`
```

- `seq` is a **monotonically increasing counter**, never derived from the
  account list's length or index. If it were, deleting account 2 and adding a
  new one would mint a second passkey also numbered 2 — two entries with the
  identical name in the picker, indistinguishable to the user. Increment it
  once per passkey created and never reuse a value.
- `accountLabel` is whatever the user named the wallet in-app, if anything.
- Set **both** `user.name` and `user.displayName` to this same string. Do not
  put a slug in one and the label in the other — see above for why.
- Use `Latch Wallet` as the base string, not `Latch account` (the extension's
  current wording) — pick one product name and use it everywhere a passkey is
  named, so a user who has both a mobile and an extension passkey sees one
  vocabulary, not two.

### What it looks like

No label given:

```
Username    Latch Wallet 1
```

Labeled "Savings":

```
Username    Savings (Latch 2)
```

Three passkeys, one device, credential manager list view:

```
Latch Wallet 1
Savings (Latch 2)
Trading (Latch 3)
```

## What to change in `latch-web-extension`

`apps/extension/src/ui/webauthn/passkey.ts` currently has:

```ts
export function nextPasskeyAccountDisplayName(accounts: StoredAccount[]): string {
  const passkeyCount = accounts.reduce((n, a) => n + (a.mode === 'passkey' ? 1 : 0), 0)
  return `Latch account ${passkeyCount + 1}`
}
```

Two things to fix here, matching mobile:

1. **The counter is derived from the current account list, not stored.**
   Same class of bug mobile just fixed: delete an account, add another, and
   the count recomputes to a number already used by a still-existing passkey.
   Persist a counter instead — `chrome.storage.local` under its own
   `STORAGE_KEYS` entry (same pattern already used elsewhere in the
   background script, e.g. `STORAGE_KEYS.accountPublicKey`), read-increment-
   write once per passkey created.

2. **The base string.** `Latch account ${n}` → `Latch Wallet ${n}`, and fold
   in the account label the same way mobile does, so `displayName` and
   `name` (wherever this value is currently only fed into one of them) both
   get the same string:

```ts
async function nextPasskeySeq(): Promise<number> {
  const { passkeySeq = 0 } = await chrome.storage.local.get(STORAGE_KEYS.passkeySeq)
  const next = passkeySeq + 1
  await chrome.storage.local.set({ [STORAGE_KEYS.passkeySeq]: next })
  return next
}

export async function nextPasskeyAccountName(accountLabel?: string): Promise<string> {
  const seq = await nextPasskeySeq()
  const label = accountLabel?.trim()
  return label ? `${label} (Latch ${seq})` : `Latch Wallet ${seq}`
}
```

`nextPasskeyRegistrationDisplayName`'s `context` suffix (`· multisig join`)
is extension-only and fine to keep — just build it on top of the name above
rather than the old `Latch account N` base:

```ts
export async function nextPasskeyRegistrationName(
  accountLabel?: string,
  context?: string,
): Promise<string> {
  const base = await nextPasskeyAccountName(accountLabel)
  const ctx = context?.trim()
  return ctx ? `${base} · ${ctx}` : base
}
```

Wherever the registration options are built (`prepareRegistrationOptionsForCreate`
and callers in `LatchRoot.tsx`, `AddAccountFlow.tsx`, `MultisigJoinFlow.tsx`,
`MultisigRouteViews.tsx`, `multisigPasskey.ts`), set **both** `user.name` and
`user.displayName` to the returned string — check `prepareRegistrationOptionsForCreate`
isn't currently writing a different, constant value into `user.name` while
only `displayName` gets the computed one (this is the exact mistake mobile
made and the reason this doc exists).

## Reference

- Mobile implementation: `src/lib/provision-passkey.ts` (`buildPasskeyName`,
  `nextPasskeySeq`), tested in `src/lib/__tests__/provision-passkey.test.ts`.
- Why this was investigated: `docs/passkey-sync-and-recovery-findings.md`,
  "Name each passkey after its account" and the iCloud Keychain screen it's
  based on.
- Cross-client domain plan this feeds into: issue #77, Discussion #32.
