"""Process timeline data service."""

from __future__ import annotations

import os
from datetime import datetime

import psutil


def get_proc_timeline_data(pid):
    """Build timeline-like process events from /proc snapshots."""
    if not pid:
        raise ValueError("PID parameter required")

    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess as e:
        raise ProcessLookupError(f"Process {pid} not found") from e

    proc_info = proc.as_dict(["pid", "name", "create_time", "status"])
    base_ts = float(proc_info["create_time"])
    ordered_events = [{"type": "exec", "pid": pid}]

    try:
        maps_path = f"/proc/{pid}/maps"
        if os.path.exists(maps_path):
            with open(maps_path, "r", encoding="utf-8", errors="ignore") as f:
                map_count = len(f.readlines())
                if map_count > 0:
                    ordered_events.append({"type": "mmap", "pid": pid, "count": map_count})
    except (IOError, PermissionError):
        pass

    try:
        io_path = f"/proc/{pid}/io"
        if os.path.exists(io_path):
            with open(io_path, "r", encoding="utf-8", errors="ignore") as f:
                io_data = {}
                for line in f:
                    if ":" in line:
                        key, value = line.split(":", 1)
                        io_data[key.strip()] = int(value.strip())
                if io_data.get("read_bytes", 0) > 0:
                    ordered_events.append({"type": "read", "pid": pid, "bytes": io_data.get("read_bytes", 0)})
                if io_data.get("write_bytes", 0) > 0:
                    ordered_events.append({"type": "write", "pid": pid, "bytes": io_data.get("write_bytes", 0)})
    except (IOError, PermissionError):
        pass

    try:
        tcp_path = f"/proc/{pid}/net/tcp"
        if os.path.exists(tcp_path):
            with open(tcp_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
                if len(lines) > 1:
                    for line in lines[1:]:
                        parts = line.split()
                        if len(parts) >= 4:
                            state = parts[3]
                            if state == "01":
                                ordered_events.append({"type": "connect", "pid": pid})
                            elif state == "0A":
                                ordered_events.append({"type": "accept", "pid": pid})
    except (IOError, PermissionError):
        pass

    step = 0.35
    timeline = []
    for i, ev in enumerate(ordered_events):
        row = dict(ev)
        row["timestamp"] = datetime.fromtimestamp(base_ts + i * step).isoformat()
        timeline.append(row)

    return {
        "timeline": timeline,
        "pid": pid,
        "name": proc_info.get("name", "unknown"),
        "timestamp": datetime.now().isoformat(),
        "timeline_time_basis": "Events are ordered from process start; 0.35s steps separate rows for the helix (kernel does not expose per-event wall times for these signals).",
    }
