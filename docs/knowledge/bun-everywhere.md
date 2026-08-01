---
type: Decision
title: "Bun everywhere: package manager, runtime, test runner"
description: One tool covers installs, TypeScript execution, and the test runner.
status: stable
tags: [bun, typescript, tooling]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
---

One tool for installs, TypeScript execution, and `bun test`. Bun runs TS
natively, which is what makes the buildless `packages/*` layout viable.
Workspaces come from Bun's `workspaces` field.

*Why not pnpm + Node + Vitest:* three tools with three configs to keep in sync;
Bun collapses them. *Risk accepted:* Genkit does not officially support Bun.
Node 22 stays in the devshell as the escape hatch — if Genkit misbehaves, the
agent alone runs on Node.
