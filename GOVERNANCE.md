# Governance

Latch is a small project. This document says who decides what, so nobody has to
guess.

## Where things stand

Latch is maintained by the team that built it, with one maintainer holding merge
rights today. That is worth stating plainly rather than implying a broader
structure than exists: **the bus factor is one**, and reducing it is an explicit
goal, not an afterthought.

Because of that, expect review to be a queue. A PR sitting for a few days is
normal; a PR sitting for two weeks is worth a nudge.

## Who decides what

| Decision | Who |
| --- | --- |
| Merging a change | A maintainer, after one approval |
| Anything under `CODEOWNERS` paths | A maintainer, with a testnet demonstration |
| Adding a dependency | A maintainer — every package runs inside a wallet |
| Cutting a release, pushing an OTA update | A maintainer (see below) |
| Changing this document, the licence, or the security policy | A maintainer, announced in an issue first |

Disagreements are settled in the pull request or an issue, in public, on the
merits. If one cannot be settled, a maintainer decides and says why.

## Becoming a maintainer

There is no fixed threshold. In practice: a track record of merged changes,
reviews that catch real problems, and judgement on the security-sensitive paths.
An existing maintainer proposes it; the others agree.

We would rather grow this list than keep it exclusive. If you have been
contributing steadily and want more responsibility, ask.

## Releases and over-the-air updates

Two things ship to users, and they have different risk profiles.

**Store releases** go through the normal review of whichever platform.

**OTA updates** (`hot-updater`) push JavaScript straight to installed wallets
without review by anyone but us. That is the highest-leverage path into a
user's device in this entire project. Only a maintainer publishes one, only from
`master`, and only for a change that has already merged and shipped through CI.
An OTA update is not a place to try something.

## If maintenance stops

If the project becomes unmaintained, we would rather say so than let it look
alive. The commitment is: if there has been no maintainer activity for 90 days,
a notice goes at the top of the README, so anyone depending on it can make an
informed decision about a fork.

## Security

Security reports do not go through this process — see
[SECURITY.md](SECURITY.md). They are handled privately and take priority over
feature work.
