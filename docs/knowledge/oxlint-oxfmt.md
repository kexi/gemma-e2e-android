---
type: Decision
title: oxlint and oxfmt
description: Rust-based lint and format, fast enough for a pre-commit hook.
status: stable
tags: [tooling, lint, format]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
---

Rust-based, natively aware of TS/TSX, and fast enough to run in a pre-commit
hook on staged files. They live in `devDependencies` rather than the devshell so
their versions are managed alongside the rest of the JS toolchain, which the
Expo ecosystem expects.

*Why not ESLint + Prettier:* slower, and a much larger plugin surface to audit.
*Caveat:* oxfmt is pre-1.0; if it proves unstable the `fmt` tasks can be pulled
out without touching anything else.
