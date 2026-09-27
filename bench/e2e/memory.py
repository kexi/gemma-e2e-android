# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Sample LM Studio RSS and physical footprint without changing observed processes."""

import argparse
import ctypes
import ctypes.util
import datetime
import functools
import json
import os
import pathlib
import platform
import signal
import statistics
import subprocess
import threading
import time

PS_COMMAND = ["ps", "-ww", "-axo", "pid=,ppid=,rss=,comm="]
INTERVAL_SECONDS = 1.0
LIMITATIONS = [
    "RSS sums can double-count shared resident pages between processes.",
    "RSS is not total unified-memory use, Metal allocation, or allocator peak.",
    "Physical footprint is the kernel's per-process accounting, not allocator peak.",
    "A process-group footprint sum is not system-wide unique memory consumption.",
    "Processes are read sequentially; a sample is not an atomic system snapshot.",
    "One-second sampling can miss short-lived processes and between-sample peaks.",
    "The group includes LM Studio UI/helpers, not only model inference workers.",
    "The model label is supplied by the caller; no exclusive model attribution is inferred.",
    "No baseline subtraction or OS memory-pressure correction is applied.",
]
FOOTPRINT_SOURCE = {
    "library": "libproc",
    "api": "proc_pid_rusage",
    "flavor": "RUSAGE_INFO_V0",
    "flavor_value": 0,
    "field": "ri_phys_footprint",
    "unit": "bytes",
    "struct_size_bytes": 96,
    "struct_alignment_bytes": 8,
    "field_offset_bytes": 72,
    "abi_verification": "Compiled against local macOS 14.4 SDK sys/resource.h and libproc.h",
    "kernel_source": "https://github.com/apple-oss-distributions/xnu/blob/main/osfmk/kern/bsd_kern.c",
}


class RusageInfoV0(ctypes.Structure):
    _fields_ = [("ri_uuid", ctypes.c_uint8 * 16)] + [
        (name, ctypes.c_uint64)
        for name in (
            "ri_user_time",
            "ri_system_time",
            "ri_pkg_idle_wkups",
            "ri_interrupt_wkups",
            "ri_pageins",
            "ri_wired_size",
            "ri_resident_size",
            "ri_phys_footprint",
            "ri_proc_start_abstime",
            "ri_proc_exit_abstime",
        )
    ]


@functools.cache
def footprint_api() -> tuple[object | None, dict | None]:
    matches_verified_abi = (
        ctypes.sizeof(RusageInfoV0) == FOOTPRINT_SOURCE["struct_size_bytes"]
        and ctypes.alignment(RusageInfoV0) == FOOTPRINT_SOURCE["struct_alignment_bytes"]
        and RusageInfoV0.ri_phys_footprint.offset
        == FOOTPRINT_SOURCE["field_offset_bytes"]
    )
    if not matches_verified_abi:
        return None, {"kind": "rusage_abi_mismatch"}
    library_path = ctypes.util.find_library("proc")
    has_library = library_path is not None
    if not has_library:
        return None, {"kind": "libproc_not_found"}
    try:
        library = ctypes.CDLL(library_path, use_errno=True)
        function = library.proc_pid_rusage
        function.argtypes = [
            ctypes.c_int,
            ctypes.c_int,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        function.restype = ctypes.c_int
        return function, None
    except (OSError, AttributeError) as error:
        return None, {"kind": "libproc_load_failure", "message": str(error)}


def physical_footprint(pid: int) -> dict:
    result = {
        "physical_footprint_timestamp": utc_now(),
        "physical_footprint_bytes": None,
        "proc_start_abstime": None,
        "physical_footprint_error": None,
    }
    function, error = footprint_api()
    unavailable = function is None
    if unavailable:
        result["physical_footprint_error"] = error
        return result
    info = RusageInfoV0()
    ctypes.set_errno(0)
    # The SDK declares void ** but expects the struct storage, not a pointer to it.
    buffer = ctypes.cast(ctypes.byref(info), ctypes.POINTER(ctypes.c_void_p))
    returncode = function(pid, 0, buffer)
    has_failed = returncode != 0
    if has_failed:
        error_number = ctypes.get_errno()
        result["physical_footprint_error"] = {
            "kind": "proc_pid_rusage_failure",
            "returncode": returncode,
            "errno": error_number,
            "message": os.strerror(error_number),
        }
        return result
    result["physical_footprint_bytes"] = info.ri_phys_footprint
    result["proc_start_abstime"] = info.ri_proc_start_abstime
    return result


def utc_now() -> str:
    return datetime.datetime.now(datetime.UTC).isoformat()


def process_roots() -> list[str]:
    return [
        "/Applications/LM Studio.app/Contents/",
        str(pathlib.Path.home() / "Applications/LM Studio.app/Contents") + "/",
        str(pathlib.Path.home() / ".lmstudio") + "/",
    ]


def parse_processes(output: str) -> tuple[dict[int, dict], list[dict]]:
    processes = {}
    errors = []
    for line_number, line in enumerate(output.splitlines(), 1):
        fields = line.split(None, 3)
        is_empty = not fields
        if is_empty:
            continue
        try:
            pid, ppid, rss_kib = (int(value) for value in fields[:3])
            executable = fields[3]
            has_valid_values = pid > 0 and ppid >= 0 and rss_kib >= 0
            if not has_valid_values:
                raise ValueError("Invalid process values")
        except (ValueError, IndexError):
            # Unrelated process arguments must never be copied into the evidence.
            errors.append({"line_number": line_number, "error": "Malformed ps row"})
            continue
        processes[pid] = {
            "pid": pid,
            "ppid": ppid,
            "name": pathlib.Path(executable).name,
            "executable": executable,
            "rss_kib": rss_kib,
            "rss_bytes": rss_kib * 1024,
        }
    return processes, errors


def select_processes(processes: dict[int, dict]) -> list[dict]:
    selected = {}
    roots = process_roots()
    for pid, process in processes.items():
        matching_root = next(
            (root for root in roots if process["executable"].startswith(root)), None
        )
        is_seed = matching_root is not None
        if is_seed:
            selected[pid] = process | {
                "identification": "executable_path_prefix",
                "matched_root": matching_root,
                "seed_pid": pid,
            }
    pending = True
    while pending:
        pending = False
        for pid, process in processes.items():
            parent = selected.get(process["ppid"])
            is_descendant = pid not in selected and parent is not None
            if is_descendant:
                selected[pid] = process | {
                    "identification": "descendant_of_matched_executable",
                    "matched_root": parent["matched_root"],
                    "seed_pid": parent["seed_pid"],
                }
                pending = True
    return [selected[pid] for pid in sorted(selected)]


def sample(model: str, started: float) -> dict:
    record = {
        "timestamp": utc_now(),
        "elapsed_seconds": round(time.monotonic() - started, 6),
        "model": model,
        "status": "error",
        "processes": [],
        "rss_sum_bytes": None,
        "physical_footprint_sum_bytes": None,
        "physical_footprint_status": "not_collected",
        "errors": [],
    }
    try:
        result = subprocess.run(
            PS_COMMAND, capture_output=True, text=True, timeout=5, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        record["errors"].append({"kind": type(error).__name__, "message": str(error)})
        return record
    has_failed = result.returncode != 0
    if has_failed:
        record["errors"].append(
            {
                "kind": "ps_failure",
                "returncode": result.returncode,
                "stderr": result.stderr,
            }
        )
        return record
    processes, parse_errors = parse_processes(result.stdout)
    selected = select_processes(processes)
    record["processes"] = selected
    record["errors"].extend(parse_errors)
    has_parse_errors = bool(parse_errors)
    if has_parse_errors:
        return record
    has_matches = bool(selected)
    if not has_matches:
        record["status"] = "no_matching_processes"
        record["errors"].append({"kind": "no_matching_processes"})
        return record
    record["status"] = "ok"
    record["rss_sum_bytes"] = sum(process["rss_bytes"] for process in selected)
    for process in selected:
        process.update(physical_footprint(process["pid"]))
        has_error = process["physical_footprint_error"] is not None
        if has_error:
            record["errors"].append(
                {"pid": process["pid"]} | process["physical_footprint_error"]
            )
    footprints = [process["physical_footprint_bytes"] for process in selected]
    all_available = all(value is not None for value in footprints)
    if all_available:
        record["physical_footprint_sum_bytes"] = sum(footprints)
        record["physical_footprint_status"] = "ok"
        return record
    any_available = any(value is not None for value in footprints)
    record["physical_footprint_status"] = "partial" if any_available else "error"
    return record


def per_process_statistics(records: list[dict]) -> list[dict]:
    groups = {}
    for record in records:
        for process in record["processes"]:
            identity = (
                process["pid"],
                process["executable"],
                process.get("proc_start_abstime"),
            )
            groups.setdefault(identity, []).append(process)
    statistics_by_process = []
    for (pid, executable, start), processes in groups.items():
        footprints = [
            process["physical_footprint_bytes"]
            for process in processes
            if process.get("physical_footprint_bytes") is not None
        ]
        rss = [process["rss_bytes"] for process in processes]
        statistics_by_process.append(
            {
                "pid": pid,
                "executable": executable,
                "proc_start_abstime": start,
                "sample_count": len(processes),
                "rss_median_bytes": statistics.median(rss),
                "rss_sampled_peak_bytes": max(rss),
                "physical_footprint_valid_sample_count": len(footprints),
                "physical_footprint_median_bytes": statistics.median(footprints)
                if footprints
                else None,
                "physical_footprint_sampled_peak_bytes": max(footprints)
                if footprints
                else None,
            }
        )
    return statistics_by_process


def summarize(records: list[dict], model: str, started_at: str, reason: str) -> dict:
    valid = [record for record in records if record["status"] == "ok"]
    peak = max(valid, key=lambda record: record["rss_sum_bytes"], default=None)
    values = [record["rss_sum_bytes"] for record in valid]
    footprint_records = [
        record
        for record in records
        if record.get("physical_footprint_sum_bytes") is not None
    ]
    footprint_peak = max(
        footprint_records,
        key=lambda record: record["physical_footprint_sum_bytes"],
        default=None,
    )
    footprint_values = [
        record["physical_footprint_sum_bytes"] for record in footprint_records
    ]
    return {
        "model": model,
        "started_at": started_at,
        "finished_at": utc_now(),
        "stop_reason": reason,
        "status": "complete" if valid else "no_valid_samples",
        "metric": "sum_of_lm_studio_process_rss_bytes",
        "source": {"command": PS_COMMAND, "rss_unit_bytes": 1024},
        "physical_footprint_source": FOOTPRINT_SOURCE,
        "interval_seconds": INTERVAL_SECONDS,
        "identification_roots": process_roots(),
        "sample_count": len(records),
        "valid_sample_count": len(valid),
        "error_sample_count": len(records) - len(valid),
        "rss_sum_first_bytes": values[0] if values else None,
        "rss_sum_last_bytes": values[-1] if values else None,
        "rss_sum_median_bytes": statistics.median(values) if values else None,
        "rss_sum_sampled_peak_bytes": peak["rss_sum_bytes"] if peak else None,
        "sampled_peak_timestamp": peak["timestamp"] if peak else None,
        "sampled_peak_processes": peak["processes"] if peak else None,
        "physical_footprint_valid_sample_count": len(footprint_records),
        "physical_footprint_unavailable_sample_count": len(records)
        - len(footprint_records),
        "physical_footprint_sum_median_bytes": statistics.median(footprint_values)
        if footprint_values
        else None,
        "physical_footprint_sum_sampled_peak_bytes": footprint_peak[
            "physical_footprint_sum_bytes"
        ]
        if footprint_peak
        else None,
        "physical_footprint_sampled_peak_timestamp": footprint_peak["timestamp"]
        if footprint_peak
        else None,
        "physical_footprint_sampled_peak_processes": footprint_peak["processes"]
        if footprint_peak
        else None,
        "per_process_statistics": per_process_statistics(records),
        "observed_pids": sorted(
            {process["pid"] for record in records for process in record["processes"]}
        ),
        "limitations": LIMITATIONS,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output-prefix", required=True, type=pathlib.Path)
    args = parser.parse_args()
    is_macos = platform.system() == "Darwin"
    if not is_macos:
        parser.error("This RSS sampler uses macOS ps units and executable paths")
    raw_path = pathlib.Path(str(args.output_prefix) + ".jsonl")
    summary_path = pathlib.Path(str(args.output_prefix) + ".summary.json")
    output_exists = raw_path.exists() or summary_path.exists()
    if output_exists:
        parser.error("Output already exists; choose a new prefix")
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    stopped = threading.Event()
    stop_reason = "unknown"

    def stop(signum: int, _frame: object) -> None:
        nonlocal stop_reason
        stop_reason = signal.Signals(signum).name
        stopped.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    records = []
    started_at = utc_now()
    started = time.monotonic()
    with raw_path.open("x") as output:
        try:
            while not stopped.is_set():
                sampled_at = time.monotonic()
                record = sample(args.model, started)
                records.append(record)
                output.write(json.dumps(record, ensure_ascii=False) + "\n")
                output.flush()
                elapsed = time.monotonic() - sampled_at
                stopped.wait(max(0, INTERVAL_SECONDS - elapsed))
        finally:
            summary = summarize(records, args.model, started_at, stop_reason)
            summary_path.write_text(
                json.dumps(summary, ensure_ascii=False, indent=2) + "\n"
            )
    print(json.dumps({"raw": str(raw_path), "summary": str(summary_path)}), flush=True)
    has_samples = summary["valid_sample_count"] > 0
    return 0 if has_samples else 1


if __name__ == "__main__":
    raise SystemExit(main())
