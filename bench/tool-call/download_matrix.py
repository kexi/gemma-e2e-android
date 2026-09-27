# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Download the requested variants to a dedicated disk, recording revisions."""

import concurrent.futures
import datetime
import json
import os
import pathlib
import subprocess

HERE = pathlib.Path(__file__).parent
DEST = pathlib.Path(
    "/Volumes/PortableSSD/gemma-model-bench-20260926/lmstudio-community"
)
MODELS = [
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
    "gemma-4-E2B-it-MLX-4bit",
    "gemma-4-E2B-it-MLX-8bit",
]


def download(name: str, *, workers: int = 4) -> dict:
    repo = f"lmstudio-community/{name}"
    metadata = json.loads(
        subprocess.check_output(
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--max-time",
                "60",
                f"https://huggingface.co/api/models/{repo}?blobs=true",
            ],
            text=True,
        )
    )
    source = HERE / "results" / f"{name}.source.json"
    source.write_text(json.dumps(metadata, indent=2) + "\n")
    env = {
        **os.environ,
        "HF_HUB_DISABLE_IMPLICIT_TOKEN": "1",
        "HF_XET_CACHE": str(DEST.parent / "xet-cache"),
    }
    log_path = HERE / "results" / f"download-{name}.log"
    with log_path.open("w") as log:
        result = subprocess.run(
            [
                "hf",
                "download",
                repo,
                "--revision",
                metadata["sha"],
                "--local-dir",
                str(DEST / name),
                "--max-workers",
                str(workers),
                "--quiet",
            ],
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            timeout=14400,
            check=False,
        )
    success = result.returncode == 0
    if success:
        link = pathlib.Path.home() / ".lmstudio/models/lmstudio-community" / name
        needs_link = not link.exists() and not link.is_symlink()
        if needs_link:
            link.symlink_to(DEST / name, target_is_directory=True)
    record = {
        "model": name,
        "downloaded": success,
        "revision": metadata["sha"],
        "at": datetime.datetime.now(datetime.UTC).isoformat(),
    }
    (HERE / "results" / f"{name}.download.json").write_text(
        json.dumps(record, indent=2) + "\n"
    )
    print(json.dumps(record), flush=True)
    return record


def main() -> None:
    DEST.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(download, name): name for name in MODELS}
        for future in concurrent.futures.as_completed(futures):
            try:
                future.result()
            except Exception as error:
                print(
                    json.dumps({"model": futures[future], "error": str(error)}),
                    flush=True,
                )


if __name__ == "__main__":
    main()
