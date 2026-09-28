# Evidence for the Gemma model comparison

日本語版: [../docs/ja/bench/README.md](../docs/ja/bench/README.md)

`tool-call/` compares tool calls against the API directly; `e2e/` covers web and
Android E2E runs through the existing app path, plus memory measurements. See
each directory's README for how to run them, and `knowledge/gemma-*-2026-09.md`
for the conditions and conclusions.

Git keeps the scripts, input fixtures, aggregates, and audit records. Raw,
machine-dependent evidence — model output, full API responses, per-process
memory samples, model listings, load logs, build logs, images and videos — is
kept locally in `results/`, `android-results/`, and `var/`, outside Git. None of
it has been deleted.

Paths and hashes in the aggregates and audit records point at the originals as
they were at measurement time. A clone does not include those originals, so
re-aggregating from raw evidence needs the files from the measurement
environment or the results of a new run. The audit records are the result of
checks made at measurement time, not proof that the checks were run in the
clone.
