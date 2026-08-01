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

Continuous Native Generation regenerates `android/` and `ios/` from app config,
so the native projects stay disposable and are gitignored. This is what forces
the Android SDK and Azul Zulu JDK 17 (the JDK Expo recommends) into the
devshell — a managed-workflow-only setup would not need them.

*Why `zulu17` and not `jdk17`:* nixpkgs' `jdk17` already resolves to Zulu on
darwin but to plain OpenJDK on Linux. Naming `zulu17` outright states the
intent and keeps every platform on the same JVM.

*Why two JVMs in one devshell:* AGP still requires JDK 17, while firebase-tools
15 refuses to start the Firestore emulator on anything older than 21. Both ship;
17 stays first on `PATH` and in `JAVA_HOME` so Gradle is untouched, and the
emulator recipes prepend `$FIREBASE_JAVA_HOME/bin` instead. It has to be `PATH`
rather than `JAVA_HOME` because firebase-tools resolves `java` from `PATH`.

*Why not Expo Go:* the agent needs a real dev build to exercise native modules
and realistic UI, and Go cannot host custom native code.
