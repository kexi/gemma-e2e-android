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
              build-tools-35-0-0
              platforms-android-35
              emulator
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
              # Kept as a fallback: `#!/usr/bin/env node` shebang CLIs (Expo CLI)
              # resolve node, and Genkit is not officially supported on Bun yet.
              pkgs.nodejs_22
              # AGP 8.x (Expo prebuild output) requires JDK 17, and Expo
              # recommends Azul Zulu. `jdk17` already resolves to Zulu on
              # darwin but to plain OpenJDK on Linux, so name zulu17 outright
              # to keep every platform on the same JVM.
              pkgs.zulu17
              androidSdk
            ];

            shellHook = ''
              export JAVA_HOME="${pkgs.zulu17.home}"
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
