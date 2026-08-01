---
type: Decision
title: TypeScript strict, buildless packages
description: Every workspace extends one strict base config, and packages ship TS sources directly.
status: stable
tags: [typescript, tooling]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
---

`tsconfig.base.json` turns on `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, and friends; every app and package extends it.
`packages/*` ship TS sources consumed directly across the workspace.

*Why not a bundler now:* a build step buys nothing when the only consumer is
Bun in the same repo. Add [tsdown](https://tsdown.dev/) when publishing to npm
or producing a single file becomes a requirement.
