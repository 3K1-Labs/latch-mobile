# CLAUDE.md

See **[AGENTS.md](AGENTS.md)**. It is the single source of truth for agents
working in this repository, and it is what other tools read by default.

This file used to carry its own copy of the same guidance. The two drifted —
one claimed Zustand was unused while it held all wallet state, and they
disagreed about how the splash screen decides where to route — which is worse
than having no guidance at all, because an agent follows the wrong one with
complete confidence. Keep the instructions in one place.

## Local reference checkouts

`reference/` is not checked in. If you keep local clones of related projects
there for context, they are yours alone: a fresh clone of this repository has no
such directory, so never write instructions that depend on those paths.

For Stellar and Soroban questions, prefer the official documentation and the
`@stellar/stellar-sdk` types over recalled knowledge.
