---
type: Decision
title: "Live device view: gRPC streamScreenshot relayed over a WebSocket"
description: The Hono server relays the emulator's gRPC PNG frames to the browser itself, with no proxy.
status: stable
tags: [emulator, grpc, websocket, dashboard]
sources:
  - id: live-view
    resource: e177478ad218d56a4743668b57dde97fae064c51
    title: Show the emulator screen live while a run is in progress
---

The dashboard shows the emulator screen live — on its own Device page, and
beside the step timeline while a run is in progress. The Hono server dials the
emulator's gRPC bridge (`emulator -grpc 8554`), calls the `EmulatorController`
service's server-streaming `streamScreenshot`, and forwards each PNG to the
browser as a binary WebSocket frame; the client renders it through an object
URL. `apps/web/server/proto/emulator_controller.proto` is vendored from the
emulator's own `lib/` directory, and `@grpc/proto-loader` reads it at runtime,
so no codegen step enters the otherwise buildless workspace.

*Why not WebRTC via `android-emulator-webrtc`:* that is Google's own React
component and was the first choice, but it cannot work against a desktop
emulator. Its current release (2.0.1) talks REST plus WebSocket JSEP to an
"Emulator Gateway", and the gateway's job is to relay JSEP into the emulator's
`Rtc` gRPC service. That service does not exist in this build: emulator 37.2.2
for darwin-aarch64 ships no `rtc_service.proto`, and the only
`android.emulation.control.*` services registered in the binary are
`EmulatorController`, `SnapshotService`, `UiController`, and `Adb` — no `Rtc`,
and no `requestRtcStream`/`sendJsepMessage` symbols anywhere. The RTC service
is built only into Google's Linux container `emulator-webrtc` images. The older
1.0.18 release does not help either: its PNG fallback issues `getScreenshot`
over grpc-web, which the bridge also does not speak, so it would still need an
Envoy or grpcwebproxy hop. Relaying `streamScreenshot` ourselves reaches the
same screen with one process fewer and no proxy at all.

*What is given up:* no audio, no input forwarding, and frame-rate rather than
video-codec efficiency. None of it is missed — the view exists to watch the
agent work, and the agent acts through adb.

*Why frames feel "stuck":* `streamScreenshot` emits only when the screen
changes, so an idle device legitimately produces no frames. The relay caps
delivery at ~20 fps so an animation cannot flood the socket.

*Why insecure gRPC:* the bridge binds to localhost and is started without
`-grpc-use-token`, so there is no credential to present. Nothing else in the
repo depends on the flag; dropping it costs only the live view.

*Why the browser reuses the same relay:* the relay was written against gRPC's
server-streaming call -- an emitter with `data`/`error`/`end` and a `cancel` --
so the CDP screencast is presented in that shape rather than the relay learning
a second protocol. Both platforms then share one throttle and one teardown
path, and the WebSocket endpoint and the frontend are unchanged.

*Why the live view is chosen rather than derived:* there is one Device page and
one socket, so it can show one platform at a time. Deriving it from the running
scenario would make the page flip mid-run on a scenario that spans both, and
leave it showing nothing at all when no run is in flight. `LIVE_VIEW` picks it;
android stays the default because it is what the page was built for.

*Why the browser view opens a page of its own:* the pages a run creates are
disposed with their browser contexts at the end of each case, which is what
isolates one case from the next. Sharing one would blank the view between cases
and hold a context open past the case it belonged to.
