---
type: Decision
title: "Browser target: latest Chrome, Baseline Newly available, no polyfills"
description: A local development tool has one known browser, so newly available platform features are used directly with @supports and graceful degradation instead of polyfills.
status: stable
tags: [dashboard, browser-support, css, progressive-enhancement]
---

The dashboard is a local development tool: it runs on `localhost` next to an
emulator, an LM Studio server and a Firestore emulator, and it is opened by the
person who started those. That audience is one browser wide, so the target is
**the latest Chrome**, and features at Baseline **Newly available** — or even
Chrome-only, where the fallback is merely a less polished version of the same
UI — are adopted directly.

Two rules keep that from becoming fragility:

- Every feature that is not Baseline Widely available is either wrapped in
  `@supports`, guarded by a runtime feature check, or written so that an
  unsupporting browser silently ignores the declaration and still renders
  correct, usable output.
- **No polyfills.** Nothing that reimplements a platform API enters the
  dependency tree.

What this buys in the workbench UI: directional View Transitions on run
selection, `content-visibility: auto` with `contain-intrinsic-size` on the step
timeline and the run history, `contentvisibilityautostatechange` to close the
device frame socket while it is off-screen, `hidden="until-found"` so a step's
UI tree stays reachable by find-in-page while collapsed, and
`interpolate-size: allow-keywords` with `calc-size()` for the disclosure
animation. In Firefox or Safari each of these degrades to an instant, unanimated
but fully functional equivalent.

*Why not the usual "last two versions of every major browser":* it would cost
either polyfills or hand-written equivalents of things the platform already
does, for users this tool does not have. The dashboard is never deployed; there
is no analytics tail of unknown browsers to serve.

*Why not lock it down harder, to Chrome only with no fallbacks at all:* the
`@supports`/feature-check discipline is nearly free — the fallback is almost
always "do nothing and let the browser render it plainly" — and it keeps the
door open if the dashboard is ever pointed at a different machine.

*What is given up:* screenshots and demos recorded in Firefox or Safari look
flatter than the real thing, and a contributor on those browsers will not see
the transitions. Neither affects what the tool reports.
