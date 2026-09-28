# Collecting evidence for real-model E2E runs

日本語版: [../../docs/ja/bench/e2e/README.md](../../docs/ja/bench/e2e/README.md)

`run.py` runs one existing scenario through the dashboard API, which must
already be up. It does not start, load, or stop the server, the model, or the
device. The caller runs it sequentially.

As preparation, bundle the four cases of `scenarios/login[.web].yaml` and
`shop[.web].yaml` into a scenario whose every case names the actual model
identifier in `model`, and place it in `var/model-e2e-20260927/scenarios/`.
Point the API's `SCENARIOS_DIR` at that directory and prepare the Android or
web app under test. Case IDs, prompts, step limits, and targets are kept as in
the existing fixtures.

`fixtures.json` transcribes the inputs of the existing login/shop scenarios.
`matrix.py` loads one model at a time, runs the four cases, and unloads it. It
stops if another model was already loaded at the start, or if a run on the API
has not finished.

```sh
python3 bench/e2e/matrix.py --platform web --only gemma-4-31B-it-MLX-4bit
```

Android uses a dedicated AVD and an APK built from the current source, and
saves its results to a separate directory. Set the same `SCENARIOS_DIR` on the
API, together with `ANDROID_SERIAL` for the target device.

```sh
python3 bench/e2e/matrix.py --platform android --results bench/e2e/android-results --scenario-dir var/model-e2e-android-20260927/scenarios --sample-memory
python3 bench/e2e/summarize.py --results bench/e2e/android-results --server-log var/model-e2e-android-20260927/server.jsonl
python3 bench/e2e/summarize_memory.py --results bench/e2e/android-results
```

`--sample-memory` samples the processes under LM Studio and their descendants
once a second, from after the load until the four cases finish. It records the
physical footprint from macOS `proc_pid_rusage` and the RSS from `ps`, per
process and summed. Model loading, the Android emulator, and the API server are
not included. LM Studio's UI and helpers are, so this is not the Metal allocator
usage of the model alone. Because shared pages can be counted twice and peaks
shorter than the sampling interval are missed, the figure is treated as the
maximum over samples. The matrix stops if RSS sampling fails, a summary is
incomplete, or every sample is missing its footprint. A sample in which some
footprint could not be read — for example because a short-lived child process
exited — has its sum set to null and is excluded, and the number of missing
samples is reported. The result is the maximum over the remaining complete
samples, not the true peak over continuous time.

The web runs this time used Headless Chrome 153.0.8010.53 with a dedicated
profile. The model reads the screen's DOM text and goes through the real
Genkit, CDP, and screen transitions. Image review is off, and the generation
settings and retries of the action path are left at the app's defaults. This is
a smoke test measuring each model's four cases once each; it guarantees neither
a repeated success rate nor behaviour on a physical Android device.

```sh
python3 bench/e2e/run.py --scenario <scenario-id> --model <loaded-model-id> --platform web
```

The default API is `http://localhost:5175`, and the overall deadline is 900
seconds. Before starting, it checks the scenario's four cases and explicit
models, and after finishing it checks the cases that actually ran. Before
starting, it also compares the target, case order, IDs, prompts, and step limits
against the matching platform in `fixtures.json`, and checks that any per-case
target override names the same target. When `--platform` is omitted, the
platform is taken from the scenario's target. Measurement labels such as titles
are not compared. It saves to `results/<scenario>-<UTC>/` the scenario, the
settings and response of the start request, the latest full API response and run
JSON, and a summary of timing, the action sequence, and verdicts. On a timeout
it still saves the partial run it has fetched and exits with code 1. It does not
cancel the run on the server, so confirm the run has finished before switching
to the next model.

The model's own completion verdict is kept separate from a supplementary check
on the UI text of the final `finish` step. The UI text is the screen before the
action, and since `finish` causes no transition, its input is what is used.
Without a `finish` step the supplementary check is `unavailable`. The expected
strings are based on the fixture implementations for both platforms. Each line
of the shared serializer is parsed, and the `text` of elements with a stable ID
is compared for exact equality. Full-text search, desc attributes, and input
field values are never grounds for a pass. A duplicated ID is also a failure.

- Successful login: the shop name in `screenTitle`, Sign out on
  `signOutButton` itself or a descendant, and Yirgacheffe on
  `beanRow-yirgacheffe` itself or a descendant
- Wrong password: Invalid email or password in `errorMessage`
- Cart: Your cart in `screenTitle`, Qty 1 - $18.00 in `cartLine-yirgacheffe`,
  and Total: $18.00 in `cartTotal`
- Order: Order placed! in `screenTitle`, and Order number: KCS-1001 in
  `orderNumber`

This check is a string-based supplement; an independent visual check of the
screen images is done separately. The exit code is 0 only when the model's own
verdict, the case layout, and the supplementary check all pass.

`python3 bench/e2e/summarize.py` reads only the saved JSON and the local server
log, and re-aggregates them into `results/aggregate.json`. It distinguishes
`completed` / `partial` / `timed_out`, and counts in `verified_pass_count` the
cases where both the model's own verdict and the UI check passed. Images and
videos are only checked for existence; their content is not treated as visually
verified. The LLM log carries no runId, so events are matched by model name and
by the `case.started` – `case.finished` span of a sequential run. Events whose
match is ambiguous are not attributed, and a missing log is not taken to mean
zero occurrences. `recovered_attempts` is the number of failed attempts that
recovered into a later `llm.decided`, and `recovered_decisions` is the number
of decisions in which such a recovery happened.

`results/genkit-wire-probe.json` checks the shape of what is sent, by swapping
out the fetch of the real GenkitLlm. It confirmed that on the existing
compat-oai path the HTTP body has no tool_choice and no per-tool description.
It is not counted in model inference or E2E success figures, and is treated as a
difference in conditions from the direct API benchmark.
