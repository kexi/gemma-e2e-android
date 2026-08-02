---
type: Decision
title: "Web driver: raw Chrome DevTools Protocol, no Puppeteer"
description: A browser is driven through a hand-rolled CDP client, and a page is reported as the same UiNode tree a device produces.
status: stable
tags: [cdp, chrome, driver, dom, adapter]
sources:
  - id: target-schema
    resource: 4e1fe70c89e38f9e04fd1c673e537edb41ecbdb3
    title: Let a scenario say which platform it drives
  - id: driver-interface
    resource: 9d08d8fddd4826c7c0b55f5b1640396cd411f83f
    title: Give the loop a driver instead of an adb client
  - id: dom-walker
    resource: ac6a3f70e8a965a51d0af723ebcee18655712a21
    title: Map a page onto the tree the model already reads
  - id: cdp-client
    resource: fb75692d84a232c8d2d2bb17c34f4c50ccf744b5
    title: Drive Chrome over the DevTools Protocol
verified:
  by: human:kexi
  at: 2026-08-02T21:40:00Z
---

A case names a `target`, and the resolver opens a driver for it. Android goes
through `adb` as before; `web` opens a Chrome page over CDP. The agent loop is
unchanged either way: it reads a `UiNode` tree, asks the model for one action,
and executes it.

*Why the loop did not have to learn about browsers:* a page is reported as the
same `UiNode` tree uiautomator produces. `className` carries a tag name where
Android carries a widget class, `resourceId` an `id` attribute where Android
carries `pkg:id/leaf`. Both of the serializer's shorteners are already the
identity on the web spellings, so `serializeForLlm`, the ref numbering, the
`Action` vocabulary and the system prompt stayed single implementations. That
was the deciding constraint: had the mapping needed a second serializer, it
would have needed a second prompt and a second action set behind it, and the
two platforms would have shared only the shape of the loop.

*Why not Puppeteer or Playwright:* what is needed is a dump, a click, a
keystroke and a screenshot. Their value is browser management, auto-waiting and
selector engines -- all three duplicate something the loop already owns, since
the loop decides what to wait for and the model picks targets by ref rather
than by selector. The same reasoning kept Appium out on the Android side
([ui-capture-uiautomator-dump.md](ui-capture-uiautomator-dump.md)). CDP is
plain JSON-RPC, so the client is an id counter, a map of pending replies and an
event dispatcher over one WebSocket.

*Why one socket for every page:* attaching with `flatten: true` tags each
message with its `sessionId`, so the browser and all its pages share one
connection. The alternative wraps every message in a deprecated
`Target.sendMessageToTarget` envelope.

*Why a browser context per case:* disposing it drops cookies, localStorage,
IndexedDB, cache and permissions together. Clearing them piecemeal leaves
origins to enumerate and miss, and a case inheriting the previous one's session
is exactly what the Android reset exists to prevent. It also means the web
`reset()` only navigates -- the context it runs in was created moments earlier
and has nothing to clear.

*Why `Runtime.evaluate` rather than `Accessibility.getFullAXTree`:* the AX tree
carries no geometry, so every node would need a `DOM.getBoxModel` round trip or
a second `DOMSnapshot.captureSnapshot` joined on `backendDOMNodeId`. Both are
experimental and the join is fiddly, while `getBoundingClientRect` hands over
coordinates alongside semantics in one evaluation.

*Why the collector is split from the mapping:* the collector runs inside the
page, so nothing typechecks it and no unit test reaches it. Everything it could
interpret is therefore done afterwards, in a pure function over what it
reported, which is tested exhaustively. happy-dom cannot stand in for the other
half -- it has no layout engine, so every `getBoundingClientRect` returns zeroes
and the serializer would drop the whole page as off-screen. A test built on
stubbed rects would assert a browser that does not exist, so the collector is
covered by `just cdp-check` against a real Chrome instead.

*Things that fail silently, each now pinned by a test:*

- Mouse input needs a press **and** a release, with `clickCount` set. Without
  it the events fire and the browser synthesises no click at all, so focus and
  selection misbehave for reasons nothing reports.
- `Input.dispatchKeyEvent` for Enter needs `text: "\r"`. Without it the key
  event arrives and no character is produced, so a form does not submit.
- Navigation waits for `networkIdle`, not `load`: a single-page app reaches
  `load` with an empty shell, and a dump taken then shows nothing actionable.
- A field's value is a property, not a child text node. A collector reading
  only text nodes reports every `<input>` as empty however much has been typed,
  leaving the model unable to see its own work.
- `cursor: pointer` inherits, so every `<span>` inside a button computes to
  pointer and becomes a ref of its own. Only an element that is its own nearest
  clickable ancestor is a target.
- The collector is a `String.raw` literal, so a single backtick anywhere in it
  -- a comment included -- closes the string and Chrome receives half a
  program.

*Why `Input.insertText` rather than a keystroke per character:* one round trip,
unicode-safe, and it fires the `input` event frameworks listen for. It fires no
key events, so a field that filters keystrokes needs `key_event` as well --
which is already how the loop spells "press enter".

*Why a wheel event rather than `Input.synthesizeScrollGesture`:* the gesture
pipeline animates in real time, so every scroll would cost the run a second,
and it is flaky headless. The wheel is instant and deterministic.

*Why Chrome connects lazily:* a machine with no browser running still boots the
dashboard, and a web case then fails with a message naming the flag to start
one. This matches how `adb` and the emulator's gRPC endpoint are treated.
