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

追加アプリも計装サーバも端末側コードも不要で、シェルコマンドから XML が得られます。

*なぜ Appium UiAutomator2 や自作 Accessibility Service でないか:* 高速ですが、
インストール・起動・バージョン同期が必要なサーバが増えます。dump のレイテンシが
ボトルネックになった時点で再検討します。
