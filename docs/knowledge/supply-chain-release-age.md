---
type: Decision
title: Supply-chain minimum release age, in three layers
description: Nothing published in the last 24 hours enters the tree.
status: stable
tags: [security, supply-chain, renovate, actions]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
---

Nothing published in the last 24 hours enters the tree, so a compromised
release has a window to be caught and yanked before it reaches a lockfile.

| Layer | Mechanism |
| --- | --- |
| npm packages | `bunfig.toml` → `minimumReleaseAge = 86400` (seconds) |
| GitHub Actions | `just pin` → `pinact run --min-age 1` (days) |
| Update PRs | `renovate.json` → `minimumReleaseAge: "1 day"` |

Actions are additionally pinned to 40-char SHAs by pinact, with the tag kept as
a trailing comment. Renovate's `helpers:pinGitHubActionDigests` follows those
pins on update.

*Why not trust tags:* a mutable tag can be repointed at malicious code after
review.
