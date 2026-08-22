"""Stage 0: walk local HTTP logs, label IP windows, persist (no Elasticsearch)."""

from __future__ import annotations

import argparse
import logging
import time

from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.http_features import WINDOW_SEC, build_windows
from kernel_ai.ml.http_parse import iter_log_lines
from kernel_ai.ml.store import PostgresStore

logger = logging.getLogger("kernel_ai.ml.http_label")


def collect_events(paths: list[str], *, since_ts: float | None) -> list:
    events = []
    for path in paths:
        events.extend(iter_log_lines(path, since_ts=since_ts))
    return events


def windows_to_rows(windows) -> list[dict]:
    return [
        {
            "ts": win.ts,
            "src_ip": win.src_ip,
            "window_sec": win.window_sec,
            "label": win.label,
            "cls": win.cls,
            "why": win.why,
            "teacher": "rules",
            "features": win.features,
        }
        for win in windows
    ]


def label_paths(
    paths: list[str],
    *,
    hours: float,
    window_sec: int = WINDOW_SEC,
    store: PostgresStore | None = None,
) -> dict:
    since = time.time() - hours * 3600.0
    events = collect_events(paths, since_ts=since)
    windows = build_windows(events, window_sec=window_sec, label=True)
    rows = windows_to_rows(windows)
    written = 0
    if store is not None and rows:
        written = store.insert_http_labels(rows)
        store.insert_http_windows(rows)
    attempts = sum(1 for row in rows if row["label"] == "attempt")
    return {
        "events": len(events),
        "windows": len(rows),
        "attempts": attempts,
        "benign": len(rows) - attempts,
        "written": written,
        "classes": sorted({row["cls"] for row in rows if row["label"] == "attempt"}),
    }


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Label HTTP windows from local logs")
    parser.add_argument("--nginx-log", action="append", default=[], help="nginx json_analytics path")
    parser.add_argument("--app-log", action="append", default=[], help="kernel_ai.http JSONL path")
    parser.add_argument("--hours", type=float, default=24.0)
    parser.add_argument("--window-sec", type=int, default=WINDOW_SEC)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    cfg = MLConfig()
    paths = list(args.nginx_log or []) + list(args.app_log or [])
    if not paths:
        paths = [p for p in (cfg.http_nginx_log, cfg.http_app_log) if p]
    if not paths:
        raise SystemExit("no log paths: pass --nginx-log / --app-log or set KERNEL_AI_ML_HTTP_*_LOG")

    store = None if args.dry_run else PostgresStore(cfg.dsn)
    try:
        stats = label_paths(paths, hours=args.hours, window_sec=args.window_sec, store=store)
    finally:
        if store is not None:
            store.close()
    logger.info("http_label %s", stats)
    print(stats)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
