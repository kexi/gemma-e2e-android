# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Replay the meetup's nine decisions; keep complete requests and responses."""

import argparse
import datetime
import hashlib
import json
import pathlib
import statistics
import time
import urllib.error
import urllib.request

from fixtures import CASES, SPEC, build_prompt, schema_errors

HERE = pathlib.Path(__file__).parent


def request_body(model: str, case: dict) -> dict:
    prompt = build_prompt(
        case["goal"], case.get("history", ""), case["screen"], case.get("facts", [])
    )
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": SPEC["system"]},
            {"role": "user", "content": prompt},
        ],
        "tools": SPEC["tools"],
        "tool_choice": "required",
        "temperature": 0,
    }


def assess(payload: dict, case: dict) -> dict:
    choices = payload.get("choices") or []
    has_choice = len(choices) == 1
    if not has_choice:
        return {"passed": False, "failure": "missing_choice"}
    choice = choices[0]
    message = choice["message"]
    calls = message.get("tool_calls") or []
    record = {
        "finish_reason": choice.get("finish_reason"),
        "tool_call_count": len(calls),
    }
    has_single_call = len(calls) == 1
    if not has_single_call:
        return {**record, "passed": False, "failure": "tool_call_count"}
    fn = calls[0]["function"]
    try:
        raw = fn["arguments"]
        args = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, KeyError) as error:
        return {
            **record,
            "passed": False,
            "failure": "invalid_json",
            "error": str(error),
        }
    is_object = isinstance(args, dict)
    if not is_object:
        return {**record, "passed": False, "failure": "arguments_not_object"}
    errors = schema_errors(fn["name"], args)
    correct = any(fn["name"] == name and check(args) for name, check in case["expect"])
    passed = not errors and correct and choice.get("finish_reason") == "tool_calls"
    return {
        **record,
        "passed": passed,
        "name": fn["name"],
        "arguments": args,
        "schema_errors": errors,
        "correct": correct,
    }


def call(
    base_url: str,
    model: str,
    case: dict,
    reasoning_effort: str | None = None,
    max_tokens: int | None = None,
) -> dict:
    body = request_body(model, case)
    has_reasoning_override = reasoning_effort is not None
    if has_reasoning_override:
        body["reasoning_effort"] = reasoning_effort
    has_output_limit = max_tokens is not None
    if has_output_limit:
        body["max_tokens"] = max_tokens
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    started = time.monotonic()
    record = {
        "model": model,
        "case": case["id"],
        "request": body,
        "at": datetime.datetime.now(datetime.UTC).isoformat(),
    }
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            record["response_text"] = response.read().decode(errors="replace")
        payload = json.loads(record["response_text"])
        record["response"] = payload
        record.update(assess(payload, case))
    except (
        urllib.error.URLError,
        TimeoutError,
        ValueError,
        TypeError,
        KeyError,
    ) as error:
        record.update(
            passed=False, failure="request_or_response_error", error=str(error)
        )
        is_http_error = isinstance(error, urllib.error.HTTPError)
        if is_http_error:
            record["error_body"] = error.read().decode(errors="replace")
    record["latency_ms"] = round((time.monotonic() - started) * 1000)
    return record


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--base-url", default="http://localhost:1234/v1")
    parser.add_argument("--trials", type=int, default=5)
    parser.add_argument("--reasoning-effort", choices=["none", "low"])
    parser.add_argument("--max-tokens", type=int)
    parser.add_argument("--cases", nargs="+", choices=[case["id"] for case in CASES])
    opts = parser.parse_args()
    cases = [case for case in CASES if not opts.cases or case["id"] in opts.cases]
    stamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    suffix = f"-reasoning-{opts.reasoning_effort}" if opts.reasoning_effort else ""
    prefix = HERE / "results" / f"{opts.model.replace('/', '_')}{suffix}-{stamp}"
    prefix.parent.mkdir(exist_ok=True)
    metadata = {
        "model": opts.model,
        "trials": opts.trials,
        "warmup_requests": 1,
        "max_tokens": opts.max_tokens,
        "cases": [case["id"] for case in cases],
        "reasoning_effort": opts.reasoning_effort,
        "fixture_sha256": hashlib.sha256(
            (HERE / "fixtures.py").read_bytes()
        ).hexdigest(),
        "tools_sha256": hashlib.sha256((HERE / "tools.json").read_bytes()).hexdigest(),
    }
    with urllib.request.urlopen(
        opts.base_url.replace("/v1", "/api/v1/models"), timeout=10
    ) as response:
        metadata["models_before"] = json.load(response)
    instances = [
        instance
        for model in metadata["models_before"]["models"]
        for instance in model.get("loaded_instances", [])
        if instance["id"] == opts.model
    ]
    has_expected_instance = len(instances) == 1
    if not has_expected_instance:
        raise SystemExit(f"Requested model is not loaded: {opts.model}")
    config = instances[0]["config"]
    has_expected_parallelism = config.get("parallel") == 1
    if not has_expected_parallelism:
        raise SystemExit(f"Expected parallel=1; got {config}")
    metadata["requested_context_length"] = 8192
    metadata["reported_context_length"] = config.get("context_length")
    prefix.with_suffix(".metadata.json").write_text(
        json.dumps(metadata, indent=2) + "\n"
    )
    records = []
    with prefix.with_suffix(".jsonl").open("w") as output:
        warmup = {
            "warmup": True,
            **call(
                opts.base_url,
                opts.model,
                CASES[0],
                opts.reasoning_effort,
                opts.max_tokens,
            ),
        }
        output.write(json.dumps(warmup, ensure_ascii=False) + "\n")
        output.flush()
        warmup_transport_failed = (
            warmup.get("failure") == "request_or_response_error"
            and "response_text" not in warmup
        )
        if warmup_transport_failed:
            raise SystemExit(
                "Warmup failed at the transport/response layer; see the saved record"
            )
        for case in cases:
            for trial in range(opts.trials):
                record = {
                    "trial": trial,
                    "warmup": False,
                    **call(
                        opts.base_url,
                        opts.model,
                        case,
                        opts.reasoning_effort,
                        opts.max_tokens,
                    ),
                }
                output.write(json.dumps(record, ensure_ascii=False) + "\n")
                output.flush()
                records.append(record)
                print(
                    json.dumps(
                        {
                            key: record.get(key)
                            for key in (
                                "model",
                                "case",
                                "trial",
                                "passed",
                                "name",
                                "arguments",
                                "latency_ms",
                                "error",
                            )
                        }
                    ),
                    flush=True,
                )
                transport_failed = (
                    record.get("failure") == "request_or_response_error"
                    and "response_text" not in record
                )
                if transport_failed:
                    raise SystemExit(
                        "Transport failed; saved partial run without a completed summary"
                    )
    successful_times = [r["latency_ms"] for r in records if r["passed"]]
    summary = {
        "model": opts.model,
        "reasoning_effort": opts.reasoning_effort,
        "passed": sum(r["passed"] for r in records),
        "total": len(records),
        "all_latency_median_ms": statistics.median(r["latency_ms"] for r in records),
        "passed_latency_median_ms": statistics.median(successful_times)
        if successful_times
        else None,
        "cases": {
            case["id"]: sum(r["passed"] for r in records if r["case"] == case["id"])
            for case in cases
        },
    }
    prefix.with_suffix(".summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary), flush=True)


if __name__ == "__main__":
    main()
