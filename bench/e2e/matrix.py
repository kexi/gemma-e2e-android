# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Load one model at a time and run the existing four real UI scenarios."""

import argparse
import datetime
import json
import pathlib
import subprocess
import sys
import time
import urllib.request

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE.parent / "tool-call"))
from run_matrix import model_key, register  # noqa: E402

MODELS = [
    "gemma-4-26B-A4B-it-QAT-MLX-4bit",
    "gemma-4-31B-it-MLX-4bit",
    "gemma-4-26B-A4B-it-QAT-GGUF",
    "gemma-4-E4B-it-QAT-GGUF",
    "gemma-4-E4B-it-MLX-8bit",
    "gemma-4-E2B-it-MLX-4bit",
    "gemma-4-E2B-it-MLX-8bit",
    "gemma-4-31B-it-MLX-5bit",
    "gemma-4-31B-it-MLX-6bit",
    "gemma-4-31B-it-MLX-8bit",
    "gemma-4-31B-it-QAT-GGUF",
    "gemma-4-12B-it-MLX-5bit",
    "gemma-4-12B-it-MLX-6bit",
    "gemma-4-12B-it-MLX-8bit",
    "gemma-4-12B-it-QAT-GGUF",
    "gemma-4-E4B-it-MLX-4bit",
    "gemma-4-E4B-it-MLX-5bit",
    "gemma-4-E4B-it-MLX-6bit",
]


def emit(**event: object) -> None:
    print(json.dumps(event), flush=True)


def stop_owned_process(process: subprocess.Popen, timeout: int) -> bool:
    running = process.poll() is None
    if running:
        process.terminate()
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
        return False
    return True


def run_model(
    name: str,
    platform: str,
    scenario_dir: pathlib.Path,
    results: pathlib.Path,
    sample_memory: bool,
) -> None:
    register(name)
    key = "google/gemma-4-26b-a4b-qat" if name == MODELS[0] else model_key(name)
    model_prefix = "bench-e2e-" if platform == "web" else "bench-android-e2e-"
    identifier = model_prefix + name.removeprefix("gemma-4-").lower()
    fixture = json.loads((HERE / "fixtures.json").read_text())[platform]
    scenario = {
        "id": identifier,
        "title": f"{name} — {platform} E2E",
        "target": fixture["target"],
        "cases": [dict(case, model=identifier) for case in fixture["cases"]],
    }
    scenario_dir.mkdir(parents=True, exist_ok=True)
    (scenario_dir / f"{identifier}.yaml").write_text(
        json.dumps(scenario, ensure_ascii=False, indent=2) + "\n"
    )
    stamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    prefix = results / f"{identifier}-{stamp}"
    loaded = json.loads(subprocess.check_output(["lms", "ps", "--json"], text=True))
    has_loaded_models = bool(loaded)
    if has_loaded_models:
        raise RuntimeError(f"Expected no concurrent models; loaded: {loaded}")
    with prefix.with_suffix(".load.log").open("w") as log:
        subprocess.run(
            [
                "lms",
                "load",
                key,
                "--identifier",
                identifier,
                "--context-length",
                "8192",
                "--parallel",
                "1",
                "-y",
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
            check=True,
            timeout=600,
        )
    loaded = json.loads(subprocess.check_output(["lms", "ps", "--json"], text=True))
    prefix.with_suffix(".loaded.json").write_text(json.dumps(loaded, indent=2) + "\n")
    expected_bits = name.rsplit("-", 1)[-1] if "MLX" in name else "Q4_0"
    selected = [item for item in loaded if item["identifier"] == identifier]
    correct_model = (
        len(selected) == 1
        and selected[0].get("quantization", {}).get("name") == expected_bits
    )
    if not correct_model:
        raise RuntimeError(f"Unexpected loaded model: {loaded}")
    with urllib.request.urlopen(
        "http://localhost:1234/api/v1/models", timeout=15
    ) as response:
        inventory = json.load(response)
    prefix.with_suffix(".inventory.json").write_text(
        json.dumps(inventory, indent=2) + "\n"
    )
    instances = [
        instance
        for model in inventory["models"]
        for instance in model.get("loaded_instances", [])
        if instance["id"] == identifier
    ]
    correct_parallelism = (
        len(instances) == 1 and instances[0]["config"].get("parallel") == 1
    )
    if not correct_parallelism:
        raise RuntimeError("Expected exactly one loaded instance with parallel=1")
    previous_summaries = set(results.glob(f"{identifier}-*/summary.json"))
    emit(
        event="e2e_started",
        model=name,
        identifier=identifier,
        key=key,
        platform=platform,
    )
    with (
        prefix.with_suffix(".model-log.jsonl").open("w") as model_log,
        prefix.with_suffix(".memory-capture.log").open("w") as memory_log,
    ):
        capture = subprocess.Popen(
            ["lms", "log", "stream", "--json", "--source", "model"],
            stdout=model_log,
            stderr=subprocess.STDOUT,
        )
        sampler = None
        sampler_stopped_cleanly = False
        try:
            if sample_memory:
                sampler = subprocess.Popen(
                    [
                        sys.executable,
                        str(HERE / "memory.py"),
                        "--model",
                        identifier,
                        "--output-prefix",
                        str(prefix) + ".memory",
                    ],
                    stdout=memory_log,
                    stderr=subprocess.STDOUT,
                )
            with prefix.with_suffix(".run.log").open("w") as log:
                completed = subprocess.run(
                    [
                        sys.executable,
                        str(HERE / "run.py"),
                        "--scenario",
                        identifier,
                        "--model",
                        identifier,
                        "--platform",
                        platform,
                        "--results",
                        str(results),
                        "--timeout",
                        "900",
                    ],
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    timeout=960,
                    check=False,
                )
        finally:
            try:
                has_sampler = sampler is not None
                if has_sampler:
                    sampler_stopped_cleanly = stop_owned_process(sampler, 15)
            finally:
                stop_owned_process(capture, 15)
    candidates = sorted(
        set(results.glob(f"{identifier}-*/summary.json")) - previous_summaries
    )
    has_summary = len(candidates) == 1
    if not has_summary:
        raise RuntimeError(f"Missing E2E summary for {name}")
    summary = json.loads(candidates[-1].read_text())
    is_terminal = summary.get("self_reported_status") in {"passed", "failed", "error"}
    if not is_terminal:
        raise RuntimeError(
            "E2E run may still be active; stop the matrix before changing models"
        )
    subprocess.run(["lms", "unload", identifier], check=True, capture_output=True)
    if sample_memory:
        memory_path = pathlib.Path(str(prefix) + ".memory.summary.json")
        memory = json.loads(memory_path.read_text()) if memory_path.is_file() else {}
        memory_complete = (
            sampler_stopped_cleanly
            and sampler is not None
            and sampler.returncode == 0
            and memory.get("model") == identifier
            and memory.get("status") == "complete"
            and memory.get("valid_sample_count", 0) > 0
            and memory.get("error_sample_count") == 0
            and memory.get("physical_footprint_valid_sample_count", 0) > 0
        )
        if not memory_complete:
            emit(
                event="memory_capture_failed",
                model=identifier,
                summary=str(memory_path),
            )
            raise RuntimeError("E2E completed, but memory sampling is incomplete")
        missing_footprints = memory.get(
            "physical_footprint_unavailable_sample_count", 0
        )
        if missing_footprints:
            emit(
                event="memory_footprint_samples_unavailable",
                model=name,
                missing=missing_footprints,
                total=memory["sample_count"],
                summary=str(memory_path),
            )
    emit(
        event="e2e_completed",
        model=name,
        exit_code=completed.returncode,
        self_reported_status=summary["self_reported_status"],
        evidence_check_passed=summary["evidence_check_passed"],
        summary=str(candidates[-1]),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--platform", choices=["web", "android"], default="web")
    parser.add_argument("--only", nargs="+", choices=MODELS)
    parser.add_argument("--wait-pid", type=int)
    parser.add_argument("--results", type=pathlib.Path, default=HERE / "results")
    parser.add_argument("--sample-memory", action="store_true")
    parser.add_argument(
        "--scenario-dir",
        type=pathlib.Path,
        default=ROOT / "var/model-e2e-20260927/scenarios",
    )
    args = parser.parse_args()
    has_wait_pid = args.wait_pid is not None
    if has_wait_pid:
        import os

        emit(event="waiting_for_prior_inference", pid=args.wait_pid)
        while True:
            try:
                os.kill(args.wait_pid, 0)
            except ProcessLookupError:
                break
            time.sleep(10)
    args.results.mkdir(parents=True, exist_ok=True)
    for name in args.only or MODELS:
        run_model(
            name, args.platform, args.scenario_dir, args.results, args.sample_memory
        )


if __name__ == "__main__":
    main()
