---
type: Decision
title: "Web recording: Page.startScreencast muxed through ffmpeg"
description: A browser case is filmed by wrapping its screencast frames in timestamped Matroska so ffmpeg can fill the gaps a still page leaves.
status: stable
tags: [cdp, recording, ffmpeg, matroska, dashboard]
sources:
  - id: cdp-recorder
    resource: a84ba7d28e168fb1b310cd5f7fae69e14d0d2d97
    title: Record a browser case by muxing its screencast
  - id: android-recording
    resource: b9a357ce01eed01b4e792a5ffe3341ed65012b51
    title: Record each test case to video so failures can be replayed
verified:
  by: human:kexi
  at: 2026-08-02T21:42:00Z
---

A web case is filmed the same way an Android one is: one file per case at
`var/videos/{runId}/{caseId}.mp4`, the path on the `CaseRun`, played back in the
dashboard, off under `RECORD_RUNS=0`. Only the mechanism differs, because CDP
has no video capture. `Page.startScreencast` is the one stream a page offers,
and it delivers base64 JPEG frames over the protocol; those are wrapped in
Matroska and piped to ffmpeg, which encodes the MP4.

ffmpeg is declared in `flake.nix` alongside scrcpy, so it arrives with the
devshell and there is nothing to install -- and, by the same token, recording
only works from inside it.

*Why not something better:* there is nothing better to reach for. Playwright
records Chromium through exactly this API, so no private path is being missed.
`HeadlessExperimental.beginFrame` would give deterministic frames but is
effectively gone from modern headless, and `getDisplayMedia` is a page-facing
API needing permission grants and an OS-level capture.

*How it compares to scrcpy:* worse, and knowingly. scrcpy pulls a
hardware-encoded H.264 stream off the device; this is a lossy JPEG per frame,
capped near 30fps by encode-and-transport overhead, with base64 inflating every
payload by a third. Fast scrolling visibly drops frames. For an artifact that
explains what the agent did, that is enough; for a smooth demo it is not.

*Why the frames are wrapped in Matroska at all:* **the screencast emits only on
visual change.** A case sitting on one screen for ten seconds sends nothing for
those ten seconds. Piped as raw MJPEG the pause vanishes, and the recording
runs faster than the run it documents -- which makes it useless for the one
thing it exists for, namely watching what happened when. Each frame therefore
carries its own timestamp in a Matroska block, and ffmpeg with a constant `-r`
duplicates frames to fill the gaps.

*Why not re-emit the last frame on a timer instead:* that is reimplementing
frame duplication in userland, with a clock that drifts against the one the
timestamps already state. Playwright reached the same conclusion; its comment
is explicit that ffmpeg does the duplicating.

*Why one cluster per frame:* a block's timecode is a 16-bit signed offset from
its cluster's, so batching frames would overflow across exactly the long still
stretch this design exists to represent. One cluster each keeps every offset at
zero and costs a few bytes beside the JPEG.

*Why the segment is left unsized:* its length is unknowable while recording.
`0x01` followed by all-ones is EBML for "until the stream ends", which is the
situation.

*Why every frame is acknowledged:* Chromium caps how many frames may be
outstanding and simply stops sending at the cap. A missed `screencastFrameAck`
does not slow the stream down, it ends it -- silently, mid-case. Frames are
acked before the handlers run, so a slow consumer cannot stall the stream for
the others.

*Why the stream is started once and fanned out in userland:* Chromium allows
one screencast per page. A second `startScreencast` reconfigures the first
rather than adding to it, and either consumer calling `stopScreencast` ends it
for both. So the client keeps a subscriber set per page, starts on the first
and stops on the last -- which is what lets the live view watch a case while it
is being recorded.

*Why a blank frame is written when a case produced none:* ffmpeg produces no
file at all from an empty stream, which would leave `videoPath` pointing at
nothing. One frame is a valid, if dull, recording of a case whose page never
drew.

*Why the last frame is held for a second:* otherwise the closing screen -- the
one showing the verdict -- flashes past in a single frame.

*Why dimensions are rounded to even:* most encoders reject odd ones outright.
The viewport is stated once in the server wiring and passed to both the page
and the container, because a container declaring one size while the frames are
another produces a video that plays stretched or not at all.

*Why a failure to finalise is reported rather than swallowed:* a file ffmpeg
never closed has no `moov` atom and opens in no player, so the caller must
report no video rather than a path to something unplayable. This is the same
conclusion the scrcpy recorder reached
([per-case-screen-recording.md](per-case-screen-recording.md)), by the same
route.
