---
type: Decision
title: "UI capture: adb shell uiautomator dump"
description: The UI tree comes from a shell command, with no code installed on the device.
status: stable
tags: [adb, uiautomator, android]
sources:
  - id: packages
    resource: 9a605b48b22b69e5e465e86bb4aeca2b1e1aecc4
    title: Implement core, adb, agent, and store packages
---

No extra app, no instrumentation server, no code on the device — just XML from
a shell command.

*Why not Appium UiAutomator2 or a custom Accessibility Service:* both are
faster but add a server to install, launch, and keep in sync. Revisit if dump
latency becomes the bottleneck.
