{
  description = "gemma-e2e-android: natural-language Android E2E testing agent powered by Gemma";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    android-nixpkgs = {
      url = "github:tadfisher/android-nixpkgs";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, android-nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
    in
    {
      devShells = forAllSystems (
        system:
        let
          # Android SDK components ship under Google's non-free license, so the
          # nixpkgs instance used here must opt in explicitly.
          pkgs = import nixpkgs {
            inherit system;
            config.allowUnfree = true;
          };

          isDarwin = nixpkgs.lib.hasSuffix "-darwin" system;

          androidSdk = android-nixpkgs.sdk.${system} (
            sdkPkgs:
            with sdkPkgs;
            [
              cmdline-tools-latest
              platform-tools
              # 35 is what the emulator image runs; 36 is what Expo SDK 57's
              # Gradle toolchain compiles against. Both must be present because
              # Gradle cannot auto-install into the read-only nix store.
              build-tools-35-0-0
              build-tools-36-0-0
              platforms-android-35
              platforms-android-36
              emulator
              # React Native pins this exact NDK and CMake; Gradle cannot
              # auto-install into the read-only nix store, so both must ship
              # with the SDK.
              ndk-27-1-12297006
              cmake-3-22-1
            ]
            # Emulator system images are multi-GB. Only the Apple Silicon dev
            # machines actually boot an emulator; Linux CI only evaluates the
            # flake, so shipping an image there would be dead weight.
            ++ nixpkgs.lib.optionals isDarwin [
              system-images-android-35-google-apis-arm64-v8a
            ]
          );
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.just
              pkgs.lefthook
              pkgs.gitleaks
              pkgs.pinact
              pkgs.bun
              # NDJSON logs and API responses get inspected constantly; keep
              # the JSON tooling declared instead of leaning on system python.
              pkgs.jq
              # Mirrors the (headless) emulator or a physical device screen;
              # watching the agent drive the app beats reading step logs.
              pkgs.scrcpy
              # Kept as a fallback: `#!/usr/bin/env node` shebang CLIs (Expo CLI)
              # resolve node, and Genkit is not officially supported on Bun yet.
              pkgs.nodejs_22
              # Firestore emulator (`just db`, `just test`). The emulator is a
              # JAR firebase-tools downloads on first run, so it needs a JVM of
              # its own -- see zulu21 below.
              pkgs.firebase-tools
              # AGP 8.x (Expo prebuild output) requires JDK 17, and Expo
              # recommends Azul Zulu. `jdk17` already resolves to Zulu on
              # darwin but to plain OpenJDK on Linux, so name zulu17 outright
              # to keep every platform on the same JVM.
              pkgs.zulu17
              # firebase-tools 15 refuses to start the emulator on anything
              # older than JDK 21, while AGP still requires 17. Both JVMs ship;
              # 17 stays first on PATH and in JAVA_HOME so Gradle is unaffected,
              # and only the Firestore emulator recipes prepend 21.
              pkgs.zulu21
              androidSdk
            ];

            shellHook = ''
              export JAVA_HOME="${pkgs.zulu17.home}"
              # Consumed by the `db`, `web`, and `test` just recipes, which
              # prepend its bin/ to PATH. firebase-tools resolves `java` from
              # PATH rather than JAVA_HOME, so overriding JAVA_HOME alone would
              # not reach it.
              export FIREBASE_JAVA_HOME="${pkgs.zulu21.home}"
              export ANDROID_HOME="${androidSdk}/share/android-sdk"
              export ANDROID_SDK_ROOT="$ANDROID_HOME"

              # Idempotent: lefthook rewrites .git/hooks on every run.
              if [ -d .git ]; then
                lefthook install >/dev/null 2>&1 || true
              fi
            '';
          };
        }
      );

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt-tree);
    };
}
