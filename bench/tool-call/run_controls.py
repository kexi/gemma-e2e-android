# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Run bounded thinking controls serially without mixing them into the matrix."""

import argparse
import json

from run_matrix import run

CONTROLS = [
    {
        "id": "e4b-mlx-8bit-none",
        "name": "gemma-4-E4B-it-MLX-8bit",
        "key": "bench/gemma-4-e4b-mlx-8bit-thinking",
        "effort": "none",
    },
    {
        "id": "e4b-mlx-8bit-low",
        "name": "gemma-4-E4B-it-MLX-8bit",
        "key": "bench/gemma-4-e4b-mlx-8bit-thinking",
        "effort": "low",
    },
    {
        "id": "e4b-qat-gguf-none",
        "name": "gemma-4-E4B-it-QAT-GGUF",
        "effort": "none",
        "cases": ("finish_failed", "wait", "key_back"),
    },
    {
        "id": "31b-mlx-4bit-low",
        "name": "gemma-4-31B-it-MLX-4bit",
        "key": "bench/gemma-4-31b-mlx-4bit-thinking",
        "effort": "low",
    },
    {
        "id": "26b-a4b-qat-mlx-4bit-low",
        "name": "gemma-4-26B-A4B-it-QAT-MLX-4bit",
        "key": "google/gemma-4-26b-a4b-qat",
        "effort": "low",
    },
    {
        "id": "26b-a4b-qat-gguf-low",
        "name": "gemma-4-26B-A4B-it-QAT-GGUF",
        "effort": "low",
    },
]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--only", nargs="+", choices=[control["id"] for control in CONTROLS]
    )
    opts = parser.parse_args()
    selected = set(opts.only or [control["id"] for control in CONTROLS])
    failed = False
    for control in CONTROLS:
        is_selected = control["id"] in selected
        if not is_selected:
            continue
        cases = control.get("cases", ())
        has_case_subset = bool(cases)
        request_args = (
            "--reasoning-effort",
            control["effort"],
            "--max-tokens",
            "1024",
            "--trials",
            "1",
        )
        if has_case_subset:
            request_args += ("--cases", *cases)
        identifier = f"bench-control-{control['id']}"
        print(
            json.dumps(
                {
                    "event": "control_started",
                    "control": control["id"],
                    "identifier": identifier,
                    "request_args": request_args,
                }
            ),
            flush=True,
        )
        try:
            run(
                control["name"],
                key_override=control.get("key"),
                identifier_override=identifier,
                request_args=request_args,
            )
        except Exception as error:
            failed = True
            print(
                json.dumps(
                    {
                        "event": "control_error",
                        "control": control["id"],
                        "error": str(error),
                    }
                ),
                flush=True,
            )
            continue
        print(
            json.dumps({"event": "control_completed", "control": control["id"]}),
            flush=True,
        )
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
