# Gemma tool-call comparison

日本語版: [../../docs/ja/bench/tool-call/README.md](../../docs/ja/bench/tool-call/README.md)

Uses the nine cases from `gemma-meetup-2026/bench/tool-call` in the materials
repository. The inputs and expected actions in `fixtures.py`, and `tools.json`,
are transcribed from the original benchmark. They also match the system prompt
and the seven tools in the current `packages/agent/src/llm.ts`.

```sh
lms load <model-key> --identifier <benchmark-id> --context-length 8192 --parallel 1 -y
python3 bench/tool-call/run.py --model <benchmark-id>
```

- `temperature=0`, `tool_choice=required`, and no maximum output token limit.
- After one tap as a warm-up, the nine cases run five times each, sequentially.
- A result is correct only when it has exactly one tool call, schema-valid
  arguments, the expected action, and finish_reason=tool_calls.
- `results/` stores the full requests and API responses, the settings, and the
  aggregate. The warm-up is not aggregated.
- Even with `--context-length 8192`, MLX reported a different length this time:
  131072 for E2B/E4B, 262144 for 12B/26B, and the auto-fit value per
  quantization for 31B. Both the requested and the actually loaded values are
  recorded, and the context lengths are not treated as identical. Parallelism 1
  is checked against the actual value.
- Response times include repetition of the same input and caching. They are not
  a pure generation speed, an accuracy over 45 independent problems, or a
  completion rate for on-device E2E.
- The median over all responses is kept separate from the median over
  successes only. Medians of models that succeeded on different cases are not
  simply ranked against each other.
- The app's Genkit path retries, but this measurement sends straight to the API
  and does not retry. Nor does it recover tool calls from the message body.
- The production action path leaves temperature unset. compat-oai 1.40.1 also
  does not forward Genkit's toolChoice to HTTP, so its HTTP settings differ from
  this benchmark's explicit tool_choice=required/temperature=0.
- `--reasoning-effort none|low` is an explicit control for diagnostics. `low`
  means ON for Gemma's boolean toggle. A model that does not support the control
  may ignore it, so confirm with the reasoning in the response and the input log
  as well.
- `--max-tokens` / `--cases` / `--trials` narrow a diagnostic run. Results of
  the regular 45-run comparison and of capped diagnostics are treated
  separately.

`model-configs/` holds alias definitions for verification that add only a
thinking control on top of the same MLX weights already downloaded. Register
them in LM Studio as `models/bench/<name>/model.yaml`. Existing model
definitions are not changed.

`run_controls.py` is a diagnostic script to use after registering the alias
definitions. It runs, sequentially and in this order: E4B MLX 8bit none / low,
E4B QAT GGUF none, 31B MLX 4bit low, 26B-A4B QAT MLX 4bit low, and 26B-A4B QAT
GGUF low. Every condition sets `max_tokens=1024`, normally nine cases × one
run. Only E4B QAT GGUF none measures `finish_failed` / `wait` / `key_back` once
each. This is a diagnostic added to the main run of 16 models × 45 runs, aimed
at isolating the effect of the reasoning mode. With one run per case, speed
comparisons are limited to supplementary observations. Identifiers start with
`bench-control-` to keep them apart from the regular comparison's results. If
one condition fails with an exception, the rest still run, and the script exits
with code 1 at the end.

```sh
python3 bench/tool-call/run_controls.py
python3 bench/tool-call/run_controls.py --only e4b-mlx-8bit-none e4b-mlx-8bit-low
```

When several conditions are selected with `--only`, they still run in the order
above.

`download_matrix.py` is a helper that downloads the 13 models added this time
into a dedicated directory on an external SSD. The destination and the model
list are at the top of the file. It saves and pins the Hugging Face revision.
The three highest-priority models were downloaded individually. 26B-A4B QAT MLX
and E4B MLX 8bit were measured as controls. 12B MLX 4bit is not part of this
measurement.

GGUF and MLX distributions of the same family differ in quantization,
conversion, and templates. API success or failure alone does not justify
concluding that the runtime's parser is the only cause.

`results/diagnostics/` holds preliminary diagnostics such as load failures and
is excluded from the model-comparison aggregate.
