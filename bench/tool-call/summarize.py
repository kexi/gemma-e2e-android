# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Summarize completed runs without treating failed calls as fast successes."""

import json
import pathlib
import statistics

HERE = pathlib.Path(__file__).parent


def main() -> None:
    summaries = []
    for marker in sorted((HERE / "results").glob("*.summary.json")):
        path = marker.with_name(marker.name.replace(".summary.json", ".jsonl"))
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        records = [row for row in rows if not row.get("warmup")]
        reasoning = []
        for row in records:
            choices = row.get("response", {}).get("choices") or [{}]
            reasoning.append(
                bool(choices[0].get("message", {}).get("reasoning_content"))
            )
        passed_times = [row["latency_ms"] for row in records if row["passed"]]
        summary = {
            "file": path.name,
            "model": records[0]["model"],
            "reasoning_effort": records[0]["request"].get("reasoning_effort"),
            "max_tokens": records[0]["request"].get("max_tokens"),
            "case_ids": list(dict.fromkeys(row["case"] for row in records)),
            "total": len(records),
            "single_tool_calls": sum(
                row.get("tool_call_count") == 1 for row in records
            ),
            "valid_arguments": sum(row.get("schema_errors") == [] for row in records),
            "passed": sum(row["passed"] for row in records),
            "reasoning_responses": sum(reasoning),
            "all_median_ms": statistics.median(row["latency_ms"] for row in records),
            "passed_median_ms": statistics.median(passed_times)
            if passed_times
            else None,
            "cases": {
                case: {
                    "passed": sum(
                        row["passed"] for row in records if row["case"] == case
                    ),
                    "median_ms": statistics.median(
                        row["latency_ms"] for row in records if row["case"] == case
                    ),
                }
                for case in dict.fromkeys(row["case"] for row in records)
            },
        }
        summaries.append(summary)
    (HERE / "results" / "aggregate.json").write_text(
        json.dumps(summaries, indent=2) + "\n"
    )
    for item in summaries:
        print(
            f"{item['model']} ({item['reasoning_effort'] or 'default'}): "
            f"tools={item['single_tool_calls']}/{item['total']} "
            f"valid={item['valid_arguments']} passed={item['passed']} "
            f"reasoning={item['reasoning_responses']} p50={item['passed_median_ms']}ms "
            f"max_tokens={item['max_tokens']} cases={len(item['case_ids'])}"
        )


if __name__ == "__main__":
    main()
