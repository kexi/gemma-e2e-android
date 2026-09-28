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

日本語版: [../ja/knowledge/model-input-ui-tree-text.md](../ja/knowledge/model-input-ui-tree-text.md)

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

## Switch: the screen as XML

The compact text above is a reading of the tree, not the tree: it drops
zero-area nodes, collapses single-child wrappers, and numbers only what it
judges actionable. To measure what that compaction costs or gains, a case can
instead hand the model the parsed tree as XML.

**Where it is set.** `uiFormat: text | xml`, resolved like the model:
`case.uiFormat ?? scenario.uiFormat ?? UI_FORMAT`, with an unset or unknown
`UI_FORMAT` meaning `text`. The resolved value is stored on the `CaseRun` next
to its model and shown as a chip on the run page; runs recorded before the
switch have none and ran on `text`. The scenario editor offers it at both
levels ("Screen input").

**What the model sees.** Every node of the `UiNode` tree, nested, with nothing
pruned — the zero-area spacer and the layout wrappers included. Attributes use
uiautomator's names and order (`text`, `resource-id`, `class`, `package`,
`content-desc`, `checkable`, `checked`, `clickable`, `enabled`, `focusable`,
`focused`, `scrollable`, `long-clickable`, `password`, `selected`, `bounds`), so
on Android the rendering is the dump itself plus our `ref`. `checked` appears
only on checkable nodes, as in the text format. A web page fills only the
attributes it has a faithful equivalent for — `password` on inputs, `selected`
from `aria-selected` or an `<option>`, `checkable` wherever a checked state
exists, `scrollable` from its own overflow — and omits `package`,
`focusable` and `long-clickable` rather than guess them.

**How a node is named.** Each node's `ref` attribute is its position in
document (pre-order) order over all nodes, so it is unique on the screen and
every node is addressable: `tap {ref: 12}` taps the centre of node 12. The
action schema is unchanged; only the wording differs. The system prompt says the
screen is an XML tree and that an element is named by passing its `ref`
attribute as `"ref"`, never a ref not on the screen. The text-format prompt and
tool descriptions are unchanged byte for byte — benchmarks were recorded against
them, and a test pins them by hash. Checked on the wire as well: against a stub
OpenAI-compatible server, a text-format request is identical to one sent before
the switch. That check also showed the compat-oai plugin sends each tool's name
and parameters but not its description, so in practice the system prompt is
where the per-format wording reaches the model.

*Why not uiautomator's own XML:* a web page has none, and one serializer over
the shared `UiNode` tree keeps the two platforms comparable. Its `index`
attribute cannot name a node either: it is the position among siblings, and on
a real Kexi Coffee sign-in dump 9 of 14 nodes carried `index="0"`. So no
`index` is written, and `ref` takes its place.

*Why the launch wait still counts text-format refs:* before the first step the
loop polls until something actionable is drawn. The XML format numbers every
node, so a bare launch window would look ready at once; the wait keeps asking
the text format's question, and nothing acts on those refs.

### Why text stays the default

Measured 2026-09-28 with Gemma 4 26B-A4B QAT (MLX), one run per format.
With every committed scenario on XML, seven of eight passed; the Android
accessibility lab (one persona per case) failed two of four cases. On its
crowded "Quick actions" screen -- 24 icon buttons, about 20,000 characters of
XML -- the model kept tapping icons instead of "Next" until the 13-step budget
ran out, and one case pressed back out of the app. The same scenario on text
passed four of four (8, 8, 8 and 12 steps). Elsewhere XML matched text: login,
shop, the web lab and the all-personas labs all passed.

So XML is opt-in per scenario or case, and the server default stays `text`.
*Why not trim the XML first:* dropping default-valued attributes would shrink
it, but that is a new format to measure; until it is, the benchmarks' text
input remains the baseline.
