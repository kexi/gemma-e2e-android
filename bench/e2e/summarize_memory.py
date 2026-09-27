# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Aggregate saved model memory summaries without contacting running services."""

import argparse
import datetime
import json
import math
import pathlib

HERE = pathlib.Path(__file__).parent
SUFFIX = ".memory.summary.json"


def nonnegative_number(value: object, field: str) -> int | float:
    valid = (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    )
    if not valid:
        raise ValueError(f"{field}: expected a finite nonnegative number")
    return value


def count(value: object, field: str) -> int:
    nonnegative_number(value, field)
    is_integer = isinstance(value, int)
    if not is_integer:
        raise ValueError(f"{field}: expected an integer")
    return value


def metric(summary: dict, prefix: str, valid_count: int) -> dict:
    median = summary[f"{prefix}_median_bytes"]
    peak = summary[f"{prefix}_sampled_peak_bytes"]
    no_samples = valid_count == 0
    if no_samples:
        has_statistics = median is not None or peak is not None
        if has_statistics:
            raise ValueError(f"{prefix}: statistics exist without valid samples")
        return {
            "median_bytes": None,
            "sampled_peak_bytes": None,
            "median_decimal_gb": None,
            "sampled_peak_decimal_gb": None,
        }
    median = nonnegative_number(median, f"{prefix}_median_bytes")
    peak = nonnegative_number(peak, f"{prefix}_sampled_peak_bytes")
    invalid_order = median > peak
    if invalid_order:
        raise ValueError(f"{prefix}: median exceeds sampled peak")
    return {
        "median_bytes": median,
        "sampled_peak_bytes": peak,
        "median_decimal_gb": median / 1_000_000_000,
        "sampled_peak_decimal_gb": peak / 1_000_000_000,
    }


def aggregate_row(path: pathlib.Path) -> dict:
    summary = json.loads(path.read_text())
    model = summary["model"]
    is_model_identifier = isinstance(model, str) and model.startswith("bench-")
    if not is_model_identifier:
        raise ValueError(f"{path.name}: expected a bench model identifier")
    prefix = path.name.removesuffix(SUFFIX)
    loaded_path = path.with_name(prefix + ".loaded.json")
    loaded = json.loads(loaded_path.read_text())
    matching = [item for item in loaded if item.get("identifier") == model]
    unique_model = len(matching) == 1
    if not unique_model:
        raise ValueError(f"{loaded_path.name}: expected exactly one {model}")
    total = count(summary["sample_count"], "sample_count")
    rss_valid = count(summary["valid_sample_count"], "valid_sample_count")
    rss_missing = count(summary["error_sample_count"], "error_sample_count")
    footprint_valid = count(
        summary["physical_footprint_valid_sample_count"],
        "physical_footprint_valid_sample_count",
    )
    footprint_missing = count(
        summary["physical_footprint_unavailable_sample_count"],
        "physical_footprint_unavailable_sample_count",
    )
    consistent_counts = (
        rss_valid + rss_missing == total
        and footprint_valid + footprint_missing == total
        and footprint_valid <= rss_valid
    )
    if not consistent_counts:
        raise ValueError(f"{path.name}: inconsistent sample counts")
    observed_pids = summary["observed_pids"]
    for pid in observed_pids:
        count(pid, "observed_pid")
    return {
        "model": model,
        "summary_source": path.name,
        "loaded_source": loaded_path.name,
        "status": summary["status"],
        "started_at": summary["started_at"],
        "finished_at": summary["finished_at"],
        "disk_bytes": count(matching[0]["sizeBytes"], "sizeBytes"),
        "loaded_context_length": count(matching[0]["contextLength"], "contextLength"),
        "sample_count": total,
        "rss_valid_sample_count": rss_valid,
        "rss_missing_sample_count": rss_missing,
        "physical_footprint_valid_sample_count": footprint_valid,
        "physical_footprint_missing_sample_count": footprint_missing,
        "physical_footprint": metric(
            summary, "physical_footprint_sum", footprint_valid
        ),
        "rss": metric(summary, "rss_sum", rss_valid),
        "observed_pids": sorted(set(observed_pids)),
        "interval_seconds": summary["interval_seconds"],
        "limitations": summary["limitations"],
    }


def aggregate(results: pathlib.Path) -> dict:
    rows = []
    model_sources = {}
    # Validation/smoke summaries do not have the model-run filename prefix.
    for path in sorted(results.glob("bench-*" + SUFFIX)):
        row = aggregate_row(path)
        model = row["model"]
        is_duplicate = model in model_sources
        if is_duplicate:
            raise ValueError(
                f"Duplicate model {model}: {model_sources[model]}, {path.name}"
            )
        model_sources[model] = path.name
        rows.append(row)
    return {
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "model_count": len(rows),
        "summary_glob": "bench-*" + SUFFIX,
        "method": (
            "Read saved per-model summaries and corresponding loaded-model metadata. "
            "Statistics are copied from each summary; incomplete process-group "
            "footprint samples remain missing and are not filled or summed. "
            "Decimal GB = bytes / 1,000,000,000."
        ),
        "scope": (
            "LM Studio process tree after model load through E2E completion; "
            "includes UI/helpers, excludes emulator/API and model-loading peak. "
            "Sampled peaks are not allocator peaks or unique system memory use. "
            "Smoke/validation summaries are excluded."
        ),
        "models": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--results", type=pathlib.Path, default=HERE / "android-results"
    )
    args = parser.parse_args()
    result = aggregate(args.results)
    output = args.results / "memory-aggregate.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(output), "models": result["model_count"]}))


if __name__ == "__main__":
    main()
