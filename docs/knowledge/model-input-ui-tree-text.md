---
type: Decision
title: "Model input: UI tree text only"
description: Screenshots are stored and shown but never sent to the model.
status: stable
tags: [llm, prompt, screenshots]
sources:
  - id: packages
    resource: 9a605b48b22b69e5e465e86bb4aeca2b1e1aecc4
    title: Implement core, adb, agent, and store packages
---

Screenshots are captured, stored, and shown in the dashboard, but not sent to
the model. Text-only prompts are smaller and faster, and the UI tree already
carries the resource IDs and accessibility labels needed to act.

*Why not vision:* Gemma 4 accepts images, and that can be enabled if accuracy
demands it — at a real cost in tokens and latency.
