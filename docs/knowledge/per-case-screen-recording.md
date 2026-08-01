---
type: Decision
title: "Per-case screen recording: scrcpy --no-playback --record"
description: Every case is filmed end to end so a failure nobody watched live can be replayed.
status: stable
tags: [scrcpy, recording, dashboard, adb]
sources:
  - id: recording
    resource: b9a357ce01eed01b4e792a5ffe3341ed65012b51
    title: Record each test case to video so failures can be replayed
  - id: scrcpy-devshell
    resource: 2a289956364f5fdff21410382dfde8056a932b07
    title: Add scrcpy and a mirror task for watching the headless emulator
verified:
  by: human:kexi
  at: 2026-08-01T15:12:00Z
---

Every case is filmed end to end. The runner spawns one scrcpy per case just
before the app reset and, once the verdict is in, ends the device-side capture
so scrcpy finalises `var/videos/{runId}/{caseId}.mp4` and exits. The path lands
on the `CaseRun` and the dashboard plays it back inside the finished case's
accordion. `RECORD_RUNS=0` turns the whole thing off.

*Why one file per case rather than per run:* a case is the unit that gets a
verdict, so "watch the case that failed" should not mean scrubbing through the
ones that passed. It also matches how screenshots are already filed.

*Why not `adb shell screenrecord`:* it stops at three minutes, and a case with a
20-step budget against a local model routinely runs longer. Its output would
also have to be pulled off the device afterwards.

*Why not `adb emu screenrecord`:* emulator only, so physical devices would need
a second implementation of the same feature. scrcpy pulls the device's H.264
stream over adb and muxes it on the host, which covers both with one code path
and no duration cap.

*Why `--no-playback`:* the recording is the artifact; a mirroring window would
demand a display, which a headless CI machine does not have. The dashboard's
live view is a separate path (gRPC frames) and is unaffected.

*Why stopping means `adb shell pkill` on the device, not a signal to scrcpy:*
this was found the hard way. scrcpy 4.1 routes its interrupt handling through
SDL's event loop, which under `--no-playback` from a server process never runs —
so it ignores both `SIGINT` and `SIGTERM` outright. The obvious implementation
(send `SIGINT`, fall back to `SIGKILL` on a timeout) therefore produced files
with no `moov` atom every single time: `ffprobe` reports "moov atom not found"
and no player will open them. Ending the device-side capture instead reaches
scrcpy through the one path it does watch — the video stream closes, it writes
the index and exits by itself. `stop()` awaits that exit, so the file is
complete before the path is handed to anyone. The `SIGKILL` timeout survives
only to stop a wedged scrcpy holding the device, and it reports the recording as
failed rather than returning a path to an unplayable file.

*Why only this recording's server PIDs are killed:* matching the server by name
would also end the capture belonging to any other recording on the same device,
truncating its file. The PIDs present before the spawn are sampled so only the
ones this recording created are fair game.

*Why the first moment of each case can be missing:* scrcpy needs a beat to
negotiate its video socket, and polling for the first frame would add that delay
to every case. What is lost is the app-reset screen, which no verdict depends on.

*Why recording is best effort:* scrcpy that is absent, or a device that refuses
the encoder, warns `record.failed` and leaves `videoPath` null rather than
failing the case. The verdict comes from the step log; the video is a debugging
aid, exactly like the screenshots. A case that *errored* still keeps its
recording, since that is the one most worth watching.
