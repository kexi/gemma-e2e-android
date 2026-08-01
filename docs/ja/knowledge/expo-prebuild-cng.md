---
type: Decision
title: Expo with prebuild (CNG)
description: Native android/ and ios/ are regenerated from app config rather than committed.
status: stable
tags: [expo, android, jdk, devshell]
sources:
  - id: bootstrap
    resource: 4682268c1b8b079b6cfec4b6596d8b9c2b7a0029
    title: Bootstrap reproducible dev environment and supply-chain guards
  - id: firestore
    resource: 1b7eb616f74a32eab55cc6f464bce14e3f83666e
    title: Model scenarios as bundles of cases, and persist runs in Firestore
---

CNG は app config から `android/` / `ios/` を再生成するため、ネイティブ
プロジェクトは使い捨てにでき、gitignore しています。Android SDK と
Azul Zulu JDK 17(Expo 推奨の JDK)を devshell に入れる根拠がこれです
(managed workflow だけなら不要でした)。

*なぜ `jdk17` でなく `zulu17` か:* nixpkgs の `jdk17` は darwin では既に Zulu の
実体ですが、Linux では素の OpenJDK になります。`zulu17` と明示することで意図を
示し、全プラットフォームで同じ JVM に揃えます。

*なぜ devshell に JVM が 2 つあるか:* AGP は依然 JDK 17 を要求する一方、
firebase-tools 15 は JDK 21 未満では Firestore エミュレータを起動しません。両方を
同梱し、`PATH` と `JAVA_HOME` の先頭は 17 のままにして Gradle に影響を与えず、
エミュレータ用レシピだけが `$FIREBASE_JAVA_HOME/bin` を前置します。`JAVA_HOME` では
なく `PATH` なのは、firebase-tools が `java` を `PATH` から解決するためです。

*なぜ Expo Go でないか:* エージェントはネイティブモジュールを含む現実的な UI を
操作する必要があり、Go はカスタムネイティブコードを載せられません。
