# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Run downloaded variants serially, validating the selected model each time."""

import argparse
import datetime
import json
import pathlib
import subprocess
import sys
import time

from download_matrix import DEST, MODELS

HERE = pathlib.Path(__file__).parent
LOCAL = pathlib.Path.home() / ".lmstudio/models/lmstudio-community"


def register(name: str) -> None:
    source = DEST / name
    target = LOCAL / name
    isolated = LOCAL / f"{name}-bench"
    needs_raw_alias = (
        name.startswith("gemma-4-12B-it-MLX-")
        and source.exists()
        and not isolated.exists()
        and not isolated.is_symlink()
    )
    if needs_raw_alias:
        isolated.symlink_to(source, target_is_directory=True)
    has_isolated_target = isolated.exists()
    if has_isolated_target:
        target = isolated
    is_remote = source.exists()
    if not is_remote:
        return
    is_folder_link = target.is_symlink()
    if is_folder_link:
        matches_source = target.resolve() == source.resolve()
        if not matches_source:
            raise RuntimeError(f"Unexpected model link: {target}")
        return
    target.mkdir(exist_ok=True)
    for item in source.iterdir():
        is_model_file = item.is_file() and not item.name.startswith("downloading_")
        if not is_model_file:
            continue
        link = target / item.name
        needs_link = not link.exists() and not link.is_symlink()
        if needs_link:
            link.symlink_to(item)


def model_key(name: str) -> str:
    for attempt in range(12):
        plain = json.loads(subprocess.check_output(["lms", "ls", "--json"], text=True))
        grouped = json.loads(
            subprocess.check_output(["lms", "ls", "--json", "--variants"], text=True)
        )
        candidates = plain + [
            variant for group in grouped for variant in group.get("variants", [])
        ]
        matched = [
            model
            for model in candidates
            if name in model.get("indexedModelIdentifier", "")
            or name in model.get("path", "")
        ]
        has_match = bool(matched)
        if has_match:
            raw = [
                model
                for model in matched
                if model.get("indexedModelIdentifier", "").startswith(
                    "lmstudio-community/"
                )
            ]
            selected = (raw or matched)[0]
            return selected["modelKey"]
        time.sleep(5)
    raise RuntimeError(f"LM Studio did not index {name}")


def run(
    name: str,
    *,
    key_override: str | None = None,
    identifier_override: str | None = None,
    request_args: tuple[str, ...] = (),
) -> None:
    needs_model_lookup = key_override is None
    if needs_model_lookup:
        register(name)
        key = model_key(name)
    else:
        key = key_override
    has_identifier_override = identifier_override is not None
    identifier = (
        identifier_override
        if has_identifier_override
        else "bench-" + name.removeprefix("gemma-4-").removesuffix("-GGUF").lower()
    )
    stamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    prefix = HERE / "results" / f"{identifier}-{stamp}"
    loaded = json.loads(subprocess.check_output(["lms", "ps", "--json"], text=True))
    for model in loaded:
        owned_by_benchmark = model["identifier"].startswith("bench-")
        if not owned_by_benchmark:
            raise RuntimeError(f"Unrelated model is loaded: {model['identifier']}")
        subprocess.run(
            ["lms", "unload", model["identifier"]], check=True, capture_output=True
        )
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
    actual = json.loads(subprocess.check_output(["lms", "ps", "--json"], text=True))
    prefix.with_suffix(".loaded.json").write_text(json.dumps(actual, indent=2) + "\n")
    expected_bits = name.rsplit("-", 1)[-1] if "MLX" in name else "Q4_0"
    selected = [model for model in actual if model["identifier"] == identifier]
    correct_quantization = (
        len(selected) == 1
        and selected[0].get("quantization", {}).get("name") == expected_bits
    )
    if not correct_quantization:
        raise RuntimeError(f"Wrong quantization for {name}: {actual}")
    print(
        json.dumps(
            {"event": "loaded", "model": name, "key": key, "identifier": identifier}
        ),
        flush=True,
    )
    with prefix.with_suffix(".model-log.jsonl").open("w") as raw_log:
        capture = subprocess.Popen(
            ["lms", "log", "stream", "--json", "--source", "model"],
            stdout=raw_log,
            stderr=subprocess.STDOUT,
        )
        try:
            with prefix.with_suffix(".run.log").open("w") as log:
                subprocess.run(
                    [
                        sys.executable,
                        str(HERE / "run.py"),
                        "--model",
                        identifier,
                        *request_args,
                    ],
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    check=True,
                    timeout=3600,
                )
        finally:
            capture.terminate()
            capture.wait(timeout=30)
    subprocess.run(["lms", "unload", identifier], check=True, capture_output=True)
    print(json.dumps({"event": "completed", "model": name}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("models", nargs="*", default=MODELS)
    opts = parser.parse_args()
    failed = False
    for name in opts.models:
        try:
            run(name)
        except (RuntimeError, subprocess.SubprocessError) as error:
            failed = True
            print(
                json.dumps(
                    {"event": "model_error", "model": name, "error": str(error)}
                ),
                flush=True,
            )
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
