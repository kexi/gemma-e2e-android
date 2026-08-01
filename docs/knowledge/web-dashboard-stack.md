---
type: Decision
title: "Web dashboard: Vite + React + Hono + MUI"
description: The runner is operated from a browser from day one, not a CLI.
status: stable
tags: [dashboard, hono, react, mui]
sources:
  - id: dashboard
    resource: e0ca7be5d719ac7fbd82869150877868fcbe7dce
    title: Add the web dashboard so runs are driven and read from a browser
---

The runner is operated from a browser from day one — submitting prompts,
watching steps stream in, viewing screenshots. Hono co-locates with the agent
process and pushes progress over SSE/WebSocket. MUI plus MUI Icons covers dense,
data-heavy screens without bespoke design work.

*Why not a CLI first:* step logs and screenshots are the primary debugging
artifact, and a terminal renders neither well.
