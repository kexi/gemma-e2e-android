---
type: Decision
title: LM Studio + Gemma 4, called through Genkit with Zod
description: Decisions come back as Zod-validated structured output rather than native tool calls.
status: stable
tags: [llm, genkit, zod, lm-studio]
sources:
  - id: packages
    resource: 9a605b48b22b69e5e465e86bb4aeca2b1e1aecc4
    title: Implement core, adb, agent, and store packages
---

The model runs locally on the MLX engine (`gemma-4-12b`, or E4B when memory is
tight). Genkit's OpenAI-compatible plugin points at `http://localhost:1234/v1`,
and every decision comes back as a Zod-validated structured output.

*Why not native tool calls:* the tool-call parsers in MLX-family Gemma 4 builds
are unreliable; structured output sidesteps them entirely. Genkit also gives a
Dev UI trace per decision ("why did it tap that?") and a path to `genkit eval`
for regression-testing judgment quality later. LM Studio is a GUI app, so it is
installed manually rather than through Nix.
