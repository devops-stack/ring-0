"""Read the bounded eBPF stream used by Kernel Event Inspector."""

from __future__ import annotations

import json
import os
import time

SNAPSHOT = os.environ.get("KERNEL_EVENTS_SNAPSHOT", "/run/kernel-ai/kernel-events.json")
MAX_AGE_S = float(os.environ.get("KERNEL_EVENTS_MAX_AGE_S", "5"))
MAX_LIMIT = 200


def _unavailable(reason, *, age=None):
    return {
        "available": False,
        "seq": 0,
        "events": [],
        "source": {
            "kind": "ebpf",
            "scope": "machine",
            "reason": reason,
            "age": age,
        },
    }


def _snapshot():
    try:
        stat = os.stat(SNAPSHOT)
    except OSError:
        return None, _unavailable("no-collector")
    age = max(0.0, time.time() - stat.st_mtime)
    if age > MAX_AGE_S:
        return None, _unavailable("stale", age=round(age, 3))
    try:
        with open(SNAPSHOT, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError, TypeError):
        return None, _unavailable("invalid-snapshot", age=round(age, 3))
    if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
        return None, _unavailable("invalid-snapshot", age=round(age, 3))
    return payload, None


def get_kernel_events(*, pids=None, since_seq=0, limit=80):
    payload, error = _snapshot()
    if error:
        return error
    wanted = set()
    for pid in pids or []:
        try:
            value = int(pid)
        except (TypeError, ValueError):
            continue
        if value > 0:
            wanted.add(value)
    since = max(0, int(since_seq or 0))
    bounded_limit = max(1, min(MAX_LIMIT, int(limit or 80)))
    all_events = [event for event in payload["events"] if isinstance(event, dict)]
    oldest_seq = min((int(event.get("seq", 0)) for event in all_events), default=0)
    cursor_lost = bool(since and oldest_seq and since < oldest_seq - 1)
    events = []
    for event in all_events:
        try:
            seq = int(event.get("seq", 0))
            pid = int(event.get("pid", 0))
        except (TypeError, ValueError):
            continue
        if seq <= since:
            continue
        if wanted and pid not in wanted:
            continue
        events.append(event)
    events = events[-bounded_limit:]
    age = max(0.0, time.time() - os.path.getmtime(SNAPSHOT))
    return {
        "available": True,
        "seq": int(payload.get("seq", 0)),
        "events": events,
        "cursor_lost": cursor_lost,
        "source": {
            "kind": "ebpf",
            "scope": "machine",
            "age": round(age, 3),
            "dropped": int(payload.get("dropped", 0)),
            "min_duration_us": int(payload.get("min_duration_us", 0)),
            "traced_syscalls": payload.get("traced_syscalls", []),
            "syscalls": (payload.get("sources") or {}).get("syscalls"),
            "wakeup": (payload.get("sources") or {}).get("wakeup"),
        },
    }
