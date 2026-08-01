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

## What a decision sees

The agent stays stateless: every prompt is rebuilt from the goal, what has
happened, and the current screen. Nothing carries over in the model's own
context, so anything a later step needs has to be in that prompt. Four pieces
make deep navigation survivable.

**A 30-step history window.** Raised from 10 once cases ran deeper than a login
form: at 10, an agent five screens in could no longer see how it got there and
would retrace a branch it had already ruled out. The window is still bounded —
an unbounded history would grow the prompt until latency collapsed.

**A `remember` action, held outside the window.** The model may record a fact it
will need later — a confirmation code, an order total — and those facts are
listed in a `# Remembered facts` section of every subsequent prompt. *Why not
just let history carry them:* history slides, and a fact is recorded precisely
because it must outlive the steps around it. A value read on step 2 is still in
the prompt on step 40. The action touches nothing on the device; the system
prompt tells the model to use it only for values it would otherwise lose.

**A screen signature on each history line.** Each line reads
`3. [.MainActivity] tap [2]`, from `adb shell dumpsys window displays`
(`mCurrentFocus`, falling back to `mFocusedApp` while a transition leaves the
first null). Without it, twenty taps across a stack are indistinguishable from
twenty taps on one screen. Best-effort: an unparseable dump yields the older
unlabelled format rather than failing the step. *Why `displays` and not a bare
`dumpsys window`:* both carry the focus lines, but the bare dump is the whole
window-manager state — ~55KB against ~20KB, pulled once per step.

**A loop guard.** When the pair (serialized screen, action description) repeats
twice in a row, the next prompt carries a warning line; at three, the repetition
is also written to the step's note. *Why not force the case to end:* a verdict is
the model's to give, and killing a run on a heuristic would turn a slow recovery
into a false failure. `maxSteps` remains the only hard stop.
