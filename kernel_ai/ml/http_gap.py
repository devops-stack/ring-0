"""Stage 2 report: HTTP/SIEM attempts vs kernel mutations (hole and forest noise)."""

from __future__ import annotations

import argparse
import json
from typing import Any

from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.http_join import JOIN_SEC, is_web_kernel_anomaly
from kernel_ai.ml.store import fetch_anomalies_since, fetch_http_labels


def _ts(row: dict[str, Any]) -> float:
    try:
        return float(row.get("ts") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def report_gap(
    attempts: list[dict[str, Any]],
    kernel_anomalies: list[dict[str, Any]],
    *,
    slack_sec: float = JOIN_SEC,
) -> dict:
    """attempts = labeled HTTP attempt windows; kernel = Stage 1/2/4/5 rows."""
    kernel = [row for row in kernel_anomalies if not str(row.get("source") or "").startswith("stage9")]
    hits = 0
    missed = 0
    for attempt in attempts:
        ats = _ts(attempt)
        near = any(ats <= _ts(row) <= ats + slack_sec for row in kernel)
        if near:
            hits += 1
        else:
            missed += 1
    lonely = 0
    lonely_web = 0
    for row in kernel:
        kts = _ts(row)
        if any(abs(kts - _ts(attempt)) <= slack_sec for attempt in attempts):
            continue
        lonely += 1
        if is_web_kernel_anomaly(row):
            lonely_web += 1
    return {
        "attempts": len(attempts),
        "kernel_anomalies": len(kernel),
        "attempt_with_kernel": hits,
        "attempt_without_kernel": missed,
        "kernel_without_attempt": lonely,
        "kernel_web_without_attempt": lonely_web,
        "slack_sec": slack_sec,
        "note": (
            "attempt_without_kernel is the hole (wordlist, SIEM saw it, forest silent). "
            "kernel_without_attempt is host-rhythm noise (dashboard polls, retrain)."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="HTTP attempts vs kernel mutations")
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--slack-sec", type=float, default=JOIN_SEC)
    args = parser.parse_args(argv)
    cfg = MLConfig()
    labels = [r for r in fetch_http_labels(cfg.dsn, hours=args.hours) if r.get("label") == "attempt"]
    kernel = fetch_anomalies_since(cfg.dsn, hours=args.hours)
    payload = report_gap(labels, kernel, slack_sec=args.slack_sec)
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
