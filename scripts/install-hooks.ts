// Skips only when lefthook is absent (bare shells, CI runners without the
// devshell); a failing install with lefthook present must stay loud, so the
// exit code is propagated instead of blanket `|| true`.
const lefthook = Bun.which("lefthook");

if (!lefthook) {
  console.log("lefthook not found; skipping hook install (the nix devshell provides it)");
  process.exit(0);
}

const result = Bun.spawnSync([lefthook, "install"], {
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode ?? 1);
