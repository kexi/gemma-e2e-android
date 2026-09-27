# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Record one real-model E2E scenario through the existing dashboard API."""

import argparse
import datetime
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = pathlib.Path(__file__).parent
CASE_IDS = {
    "valid-credentials",
    "invalid-password",
    "add-to-cart",
    "checkout-with-code",
}
TERMINAL = {"passed", "failed", "error"}
JSON_STRING = r'"(?:[^"\\]|\\.)*"'
UI_LINE = re.compile(
    r"^(?P<indent> *)(?:\[\d+\] )?(?P<class>\S+)"
    + rf"(?: text=(?P<text>{JSON_STRING}))?"
    + rf"(?: desc={JSON_STRING})?"
    + r"(?: id=(?P<id>\S+))?(?: checked=(?:true|false))?"
    + r"(?: disabled)?(?: focused)?(?P<editable> editable)?$"
)


def write_json(path: pathlib.Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def request(base: str, path: str, deadline: float, body: dict | None = None) -> dict:
    remaining = deadline - time.monotonic()
    is_expired = remaining <= 0
    if is_expired:
        raise TimeoutError("E2E deadline exceeded; the server run was not cancelled")
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        base.rstrip("/") + path,
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=min(30, remaining)) as response:
        return json.load(response)


def validate_cases(cases: list[dict], model: str, id_field: str) -> list[str]:
    errors = []
    has_expected_cases = (
        len(cases) == 4 and {case.get(id_field) for case in cases} == CASE_IDS
    )
    if not has_expected_cases:
        errors.append("Expected exactly the four login/shop cases")
    for case in cases:
        model_matches = case.get("model") == model
        if not model_matches:
            errors.append(
                f"{case.get(id_field)}: explicit model does not match {model}"
            )
    return errors


def validate_scenario(scenario: dict, model: str, platform: str | None) -> list[str]:
    errors = validate_cases(scenario.get("cases", []), model, "id")
    fixtures = json.loads((HERE / "fixtures.json").read_text())
    platform = platform or scenario.get("target", {}).get("platform")
    expected = fixtures.get(platform)
    known_platform = expected is not None
    if not known_platform:
        return errors + ["Unknown fixture platform"]
    target_matches = scenario.get("target") == expected["target"]
    if not target_matches:
        errors.append("Scenario target differs from the platform fixture")
    expected_ids = [case["id"] for case in expected["cases"]]
    actual_ids = [case.get("id") for case in scenario.get("cases", [])]
    ordered_ids_match = actual_ids == expected_ids
    if not ordered_ids_match:
        errors.append("Case IDs/order differ from the platform fixture")
    expected_by_id = {case["id"]: case for case in expected["cases"]}
    for case in scenario.get("cases", []):
        fixture = expected_by_id.get(case.get("id"), {})
        for field in ("prompt", "maxSteps"):
            field_matches = case.get(field) == fixture.get(field)
            if not field_matches:
                errors.append(f"{case.get('id')}: {field} differs from fixture")
        effective_target = case.get("target", scenario.get("target"))
        target_matches = effective_target == expected["target"]
        if not target_matches:
            errors.append(f"{case.get('id')}: target differs from fixture")
        effective_review = case.get("accessibility", scenario.get("accessibility"))
        has_review = bool((effective_review or {}).get("personas"))
        if has_review:
            errors.append(f"{case.get('id')}: visual review is absent from fixture")
    return errors


def ui_rows(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        match = UI_LINE.fullmatch(line)
        is_valid = match is not None
        if not is_valid:
            continue
        row = match.groupdict()
        raw = row["text"]
        row["text"] = json.loads(raw) if raw is not None else None
        row["depth"] = len(row["indent"])
        rows.append(row)
    return rows


def exact_element(rows: list[dict], element_id: str, expected: str) -> bool:
    matches = [row for row in rows if row["id"] == element_id]
    is_unique = len(matches) == 1
    if not is_unique:
        return False
    row = matches[0]
    is_display = row["editable"] is None
    return is_display and row["text"] == expected


def element_text_present(rows: list[dict], element_id: str, expected: str) -> bool:
    matches = [i for i, row in enumerate(rows) if row["id"] == element_id]
    is_unique = len(matches) == 1
    if not is_unique:
        return False
    index = matches[0]
    parent = rows[index]
    parent_is_editable = parent["editable"] is not None
    if parent_is_editable:
        return False
    has_own_text = parent["text"] == expected
    if has_own_text:
        return True
    for child in rows[index + 1 :]:
        outside_row = child["depth"] <= parent["depth"]
        if outside_row:
            break
        is_name = child["text"] == expected and child["editable"] is None
        if is_name:
            return True
    return False


def oracle(case: dict) -> dict:
    steps = case.get("steps", [])
    finishes = [
        step for step in steps if step.get("action", {}).get("type") == "finish"
    ]
    has_finish = bool(finishes)
    selected = finishes[-1] if has_finish else None
    text = selected.get("uiText", "") if selected else ""
    rows = ui_rows(text)
    expected = {
        "valid-credentials": {
            "screenTitle": "Kexi Coffee Shop",
            "signOutButton": "Sign out",
        },
        "invalid-password": {"errorMessage": "Invalid email or password"},
        "add-to-cart": {
            "screenTitle": "Your cart",
            "cartLine-yirgacheffe": "Qty 1 - $18.00",
            "cartTotal": "Total: $18.00",
        },
        "checkout-with-code": {
            "screenTitle": "Order placed!",
            "orderNumber": "Order number: KCS-1001",
        },
    }.get(case.get("caseId"), {})
    checks = {
        element_id: exact_element(rows, element_id, value)
        for element_id, value in expected.items()
    }
    is_login = case.get("caseId") == "valid-credentials"
    if is_login:
        checks["signOutButton"] = element_text_present(
            rows, "signOutButton", "Sign out"
        )
        checks["beanRow-yirgacheffe"] = element_text_present(
            rows, "beanRow-yirgacheffe", "Yirgacheffe"
        )
    observed = bool(expected) and all(checks.values())
    return {
        "status": "passed"
        if has_finish and observed
        else "failed"
        if has_finish
        else "unavailable",
        "kind": "finish_step_element_id_exact_text",
        "step_index": selected.get("index") if selected else None,
        "checks": checks,
        "expected_elements": expected,
        "ui_text": text,
        "screenshot_path": selected.get("screenshotPath") if selected else None,
        "note": "UI text precedes the action; finish performs no navigation. Visual review is separate.",
    }


def duration_seconds(case: dict) -> float | None:
    start, end = case.get("startedAt"), case.get("finishedAt")
    has_times = bool(start and end)
    if not has_times:
        return None
    try:
        return (
            datetime.datetime.fromisoformat(end)
            - datetime.datetime.fromisoformat(start)
        ).total_seconds()
    except (TypeError, ValueError):
        return None


def summarize(run: dict | None, model: str) -> dict:
    cases = (run or {}).get("cases", [])
    return {
        "run_id": (run or {}).get("id"),
        "self_reported_status": (run or {}).get("status"),
        "validation_errors": validate_cases(cases, model, "caseId"),
        "cases": [
            {
                "case_id": case.get("caseId"),
                "model": case.get("model"),
                "self_reported_status": case.get("status"),
                "verdict_reason": case.get("verdictReason"),
                "duration_seconds": duration_seconds(case),
                "step_count": len(case.get("steps", [])),
                "actions": [step.get("action") for step in case.get("steps", [])],
                "video_path": case.get("videoPath"),
                "oracle": oracle(case),
            }
            for case in cases
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scenario", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--platform", choices=["android", "web"])
    parser.add_argument("--base-url", default="http://localhost:5175")
    parser.add_argument("--timeout", type=float, default=900)
    parser.add_argument("--results", type=pathlib.Path, default=HERE / "results")
    args = parser.parse_args()
    invalid_timeout = args.timeout <= 0
    if invalid_timeout:
        parser.error("--timeout must be positive")
    stamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%S%fZ")
    safe_id = re.sub(r"[^a-zA-Z0-9_.-]", "_", args.scenario)
    output = args.results / f"{safe_id}-{stamp}"
    output.mkdir(parents=True)
    started = time.monotonic()
    deadline = started + args.timeout
    run = None
    run_id = None
    error = None
    timed_out = False
    metadata = vars(args) | {
        "results": str(args.results),
        "started_at": datetime.datetime.now(datetime.UTC).isoformat(),
    }
    write_json(output / "request.json", metadata)
    try:
        available = request(args.base_url, "/api/scenarios", deadline)
        matches = [s for s in available["scenarios"] if s["id"] == args.scenario]
        has_one_scenario = len(matches) == 1
        if not has_one_scenario:
            raise ValueError("Expected one existing scenario with the requested ID")
        scenario = matches[0]
        write_json(output / "scenario.json", scenario)
        errors = validate_scenario(scenario, args.model, args.platform)
        has_errors = bool(errors)
        if has_errors:
            raise ValueError("; ".join(errors))
        created = request(
            args.base_url, "/api/runs", deadline, {"scenarioId": args.scenario}
        )
        write_json(output / "created.json", created)
        run_id = created["runId"]
        while True:
            try:
                payload = request(
                    args.base_url,
                    f"/api/runs/{urllib.parse.quote(run_id, safe='')}",
                    deadline,
                )
                write_json(output / "response.json", payload)
                run = payload["run"]
                write_json(output / "run.json", run)
                is_terminal = run.get("status") in TERMINAL
                if is_terminal:
                    break
                is_pending = run.get("status") in {"queued", "running"}
                if not is_pending:
                    raise ValueError(f"Unknown run status: {run.get('status')}")
            except urllib.error.HTTPError as caught:
                can_retry = caught.code == 404 or caught.code >= 500
                if not can_retry:
                    raise
            remaining = deadline - time.monotonic()
            is_expired = remaining <= 0
            if is_expired:
                raise TimeoutError(
                    "E2E deadline exceeded; the server run was not cancelled"
                )
            time.sleep(min(2, remaining))
    except Exception as caught:
        error = f"{type(caught).__name__}: {caught}"
        timed_out = isinstance(caught, TimeoutError) or time.monotonic() >= deadline
    summary = summarize(run, args.model)
    summary.update(
        metadata
        | {
            "run_id": run_id,
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "timed_out": timed_out,
            "error": error,
            "output_directory": str(output),
        }
    )
    case_statuses_terminal = all(
        case["self_reported_status"] in TERMINAL for case in summary["cases"]
    )
    validation_ok = not summary["validation_errors"] and case_statuses_terminal
    self_reported_passed = summary["self_reported_status"] == "passed" and all(
        case["self_reported_status"] == "passed" for case in summary["cases"]
    )
    oracle_passed = all(
        case["oracle"]["status"] == "passed" for case in summary["cases"]
    )
    succeeded = (
        error is None and validation_ok and self_reported_passed and oracle_passed
    )
    summary["evidence_check_passed"] = succeeded
    write_json(output / "summary.json", summary)
    write_json(output / "run.json", run)
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    raise SystemExit(0 if succeeded else 1)


if __name__ == "__main__":
    main()
