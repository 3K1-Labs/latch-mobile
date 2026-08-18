# Security Policy

Latch is a non-custodial wallet. A vulnerability here can cost someone their
funds, so we would rather hear about it early and awkwardly than late and
publicly.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting on
this repository: **Security → Advisories → Report a vulnerability**.

If that is unavailable to you, contact a maintainer directly and say only that
you have a security report — save the details for the private channel.

Please include:

- what an attacker can do, concretely
- the steps to reproduce it
- the affected version, network (testnet or mainnet), and platform
- a proof of concept, if you have one

**Never include a real recovery phrase, private key, or access token in a
report.** If reproducing it requires a wallet, generate a fresh testnet one.

### What to expect

| | |
| --- | --- |
| Acknowledgement | within 72 hours |
| Initial assessment | within 7 days |
| Fix or mitigation plan | communicated with the assessment |

If you have not heard back within 72 hours, assume the report was missed and
ping a maintainer — that is not a nuisance, it is a favour.

We will tell you when a fix ships and credit you in the advisory unless you
would rather stay anonymous. Please hold public disclosure until a fix is
released, or 90 days from your report, whichever comes first.

**There is no bug bounty at this time.** We would rather say that plainly than
leave you guessing.

## AI-generated reports

Reports produced by an AI tool are welcome, on one condition: **include a
working proof of concept.** A report without one will be closed without
analysis.

This is not scepticism about the tooling. It is that a plausible-sounding report
which dissolves under inspection costs a small team hours it does not have, and
that time comes out of fixing real issues.

## Scope

In scope: this repository — key generation and derivation, secure storage, PIN
and biometric flows, transaction construction and signing, deep link and
WalletConnect handling, and anything that leaks key material.

Also in scope, and worth reporting: any secret found committed to this
repository, or any value carrying an `EXPO_PUBLIC_` prefix that should not be
readable by users, since those are compiled into the shipped app.

Out of scope: third-party services we integrate with (report to them),
vulnerabilities requiring a physical device the attacker already controls and
has unlocked, and social engineering of users or maintainers.

## Handling

Security work takes priority over feature work, particularly where it affects
wallet generation or recovery, local secret storage, authentication, transaction
signing, or dependency supply chain.

Fixes land on the latest active branch. There is no long-term support branch
before 1.0.
