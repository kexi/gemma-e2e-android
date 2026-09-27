# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Aggregate saved E2E evidence without contacting the API or model."""

import argparse
import datetime
import json
import pathlib

from run import TERMINAL, duration_seconds, oracle, validate_cases

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent.parent
DEFAULT_LOG = ROOT / "var/model-e2e-20260927/server.jsonl"


def read_json(path: pathlib.Path) -> dict:
    exists = path.is_file()
    if not exists:
        return {}
    value = json.loads(path.read_text())
    return value if isinstance(value, dict) else {}


def log_counts(path: pathlib.Path) -> tuple[dict, dict]:
    counts, active = {}, {}
    metadata = {
        "path": str(path),
        "available": path.is_file(),
        "method": "File-order case.started/case.finished intervals plus exact model; only one matching active case is attributed. LLM events lack runId/caseId. Requires serial execution.",
        "recovered_attempts_definition": "Observed failed attempts in the same decision followed by llm.decided(attempt > 1); not the number of successful retry decisions.",
        "unattributed_llm_events": 0,
        "ignored_non_json_lines": 0,
    }
    if not metadata["available"]:
        return counts, metadata
    try:
        lines = path.read_text().splitlines()
    except OSError as error:
        metadata["available"] = False
        metadata["read_error"] = str(error)
        return counts, metadata
    for line in lines:
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            metadata["ignored_non_json_lines"] += 1
            continue
        is_record = isinstance(event, dict)
        if not is_record:
            continue
        kind = event.get("event")
        key = (event.get("runId"), event.get("caseId"))
        is_start = kind == "case.started"
        if is_start:
            counts[key] = {
                "model": event.get("model"),
                "started_at": event.get("ts"),
                "finished_at": None,
                "decisions": 0,
                "failed_attempts": 0,
                "recovered_attempts": 0,
                "recovered_decisions": 0,
                "pending_failures": 0,
            }
            active[key] = counts[key]
            continue
        is_finish = kind == "case.finished"
        if is_finish:
            current = active.pop(key, None)
            has_start = current is not None
            if has_start:
                current["finished_at"] = event.get("ts")
            continue
        is_llm = kind in {"llm.decided", "llm.attempt_failed"}
        if not is_llm:
            continue
        matches = [
            item for item in active.values() if item["model"] == event.get("model")
        ]
        unambiguous = len(matches) == 1
        if not unambiguous:
            metadata["unattributed_llm_events"] += 1
            continue
        current = matches[0]
        attempt = event.get("attempt", 1)
        is_failed = kind == "llm.attempt_failed"
        if is_failed:
            current["failed_attempts"] += 1
            is_first = attempt == 1
            current["pending_failures"] = (
                1 if is_first else current["pending_failures"] + 1
            )
            continue
        current["decisions"] += 1
        recovered = min(current["pending_failures"], max(0, attempt - 1))
        current["recovered_attempts"] += recovered
        current["recovered_decisions"] += int(recovered > 0)
        current["pending_failures"] = 0
    for item in counts.values():
        del item["pending_failures"]
        item["interval_complete"] = item["finished_at"] is not None
        item["unrecovered_attempts"] = (
            item["failed_attempts"] - item["recovered_attempts"]
        )
    return counts, metadata


def artifact(raw_path: str | None) -> dict:
    has_path = bool(raw_path)
    if not has_path:
        return {"path": raw_path, "exists": False}
    path = pathlib.Path(raw_path)
    is_absolute = path.is_absolute()
    resolved = path if is_absolute else ROOT / path
    return {"path": str(resolved), "exists": resolved.is_file()}


def aggregate_run(directory: pathlib.Path, counts: dict) -> dict:
    saved = read_json(directory / "summary.json")
    scenario = read_json(directory / "scenario.json")
    run = read_json(directory / "run.json")
    request = read_json(directory / "request.json")
    model = saved.get("model") or request.get("model")
    platform = (
        scenario.get("target", {}).get("platform")
        or saved.get("platform")
        or request.get("platform")
    )
    run_id = run.get("id") or saved.get("run_id")
    cases = run.get("cases", [])
    validation_errors = validate_cases(cases, model, "caseId")
    terminal = (
        run.get("status") in TERMINAL
        and len(cases) == 4
        and all(case.get("status") in TERMINAL for case in cases)
    )
    timed_out = saved.get("timed_out", False)
    status = (
        "timed_out"
        if timed_out
        else "completed"
        if terminal and not validation_errors
        else "partial"
    )
    case_results = []
    for case in cases:
        check = oracle(case)
        verified = case.get("status") == "passed" and check["status"] == "passed"
        steps = case.get("steps", [])
        case_results.append(
            {
                "case_id": case.get("caseId"),
                "model": case.get("model"),
                "self_reported_status": case.get("status"),
                "oracle": check,
                "verified_pass": verified,
                "duration_seconds": duration_seconds(case),
                "step_count": len(steps),
                "actions": [step.get("action") for step in steps],
                "failure_reason": None
                if verified
                else {
                    "self_reported_reason": case.get("verdictReason"),
                    "oracle_status": check["status"],
                    "failed_oracle_elements": [
                        key for key, passed in check["checks"].items() if not passed
                    ],
                    "step_notes": [step["note"] for step in steps if step.get("note")],
                },
                "screenshots": [
                    {
                        "step_index": step.get("index"),
                        **artifact(step.get("screenshotPath")),
                    }
                    for step in steps
                ],
                "final_screenshot": artifact(check.get("screenshot_path")),
                "video": artifact(case.get("videoPath")),
                "llm_log_counts": counts.get((run_id, case.get("caseId"))),
            }
        )
    times = [case["duration_seconds"] for case in case_results]
    all_times_known = len(times) == 4 and all(value is not None for value in times)
    logs = [case["llm_log_counts"] for case in case_results]
    all_logs_known = len(logs) == 4 and all(item is not None for item in logs)
    totals = {
        key: sum(item[key] for item in logs if item is not None)
        for key in (
            "decisions",
            "failed_attempts",
            "recovered_attempts",
            "recovered_decisions",
            "unrecovered_attempts",
        )
    }
    return {
        "directory": str(directory),
        "run_id": run_id,
        "model": model,
        "platform": platform,
        "status": status,
        "self_reported_status": run.get("status"),
        "timed_out": timed_out,
        "error": saved.get("error"),
        "summary_available": (directory / "summary.json").is_file(),
        "validation_errors": validation_errors,
        "case_count": len(case_results),
        "verified_pass_count": sum(case["verified_pass"] for case in case_results),
        "total_case_duration_seconds": round(sum(times), 3)
        if all_times_known
        else None,
        "observed_case_duration_seconds": round(
            sum(value for value in times if value is not None), 3
        ),
        "llm_log_totals": totals if all_logs_known else None,
        "llm_log_intervals_complete": all_logs_known
        and all(item["interval_complete"] for item in logs),
        "cases": case_results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--results", type=pathlib.Path, default=HERE / "results")
    parser.add_argument("--server-log", type=pathlib.Path, default=DEFAULT_LOG)
    args = parser.parse_args()
    counts, metadata = log_counts(args.server_log)
    directories = {
        path.parent
        for pattern in ("*/summary.json", "*/run.json")
        for path in args.results.glob(pattern)
    }
    result = {
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "log_attribution": metadata,
        "runs": [aggregate_run(directory, counts) for directory in sorted(directories)],
    }
    output = args.results / "aggregate.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {"output": str(output), "runs": len(result["runs"])}, ensure_ascii=False
        )
    )


if __name__ == "__main__":
    main()
