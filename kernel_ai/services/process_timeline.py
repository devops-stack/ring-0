"""Process timeline data service."""

from __future__ import annotations

from datetime import datetime

import psutil


def _clamp_window_s(window_s: int | float | None) -> int:
    try:
        value = int(window_s or 30)
    except (TypeError, ValueError):
        value = 30
    return max(5, min(120, value))


def _stamp_events_with_time_window(ordered_events: list[dict], proc_create_time: float, window_s: int) -> list[dict]:
    now_ts = datetime.now().timestamp()
    proc_age_s = max(0.1, now_ts - float(proc_create_time or now_ts))
    span_s = min(float(window_s), proc_age_s)

    if not ordered_events:
        return []
    if len(ordered_events) == 1:
        row = dict(ordered_events[0])
        event_ts = now_ts
        row["timestamp"] = datetime.fromtimestamp(event_ts).isoformat()
        row["relative_s"] = round(0.0, 3)
        return [row]

    start_ts = now_ts - span_s
    timeline = []
    count = len(ordered_events)
    for i, ev in enumerate(ordered_events):
        ratio = i / (count - 1)
        event_ts = start_ts + ratio * span_s
        row = dict(ev)
        row["timestamp"] = datetime.fromtimestamp(event_ts).isoformat()
        row["relative_s"] = round(event_ts - start_ts, 3)
        timeline.append(row)
    return timeline


def _safe_read_text(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except (OSError, PermissionError):
        return ""


def _read_proc_io_events(pid: int) -> list[dict]:
    events = []
    content = _safe_read_text(f"/proc/{pid}/io")
    if not content:
        return events
    data = {}
    for line in content.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if value.isdigit():
            data[key.strip()] = int(value)
    read_bytes = int(data.get("read_bytes", 0) or 0)
    write_bytes = int(data.get("write_bytes", 0) or 0)
    if read_bytes > 0:
        events.append({"type": "i/o", "name": "read_bytes", "bytes": read_bytes})
    if write_bytes > 0:
        events.append({"type": "i/o", "name": "write_bytes", "bytes": write_bytes})
    return events


def _read_proc_syscall_event(pid: int) -> dict | None:
    content = _safe_read_text(f"/proc/{pid}/syscall").strip()
    if not content or content in {"-1", "running"}:
        return None
    parts = content.split()
    if not parts:
        return None
    try:
        num = int(parts[0])
    except ValueError:
        return None
    if num <= 0:
        return None
    return {"type": "syscall", "name": f"syscall_{num}", "count": 1}


def _read_context_switch_event(pid: int) -> dict | None:
    content = _safe_read_text(f"/proc/{pid}/status")
    if not content:
        return None
    vol = 0
    nonvol = 0
    for line in content.splitlines():
        if line.startswith("voluntary_ctxt_switches:"):
            rhs = line.split(":", 1)[1].strip()
            vol = int(rhs) if rhs.isdigit() else 0
        elif line.startswith("nonvoluntary_ctxt_switches:"):
            rhs = line.split(":", 1)[1].strip()
            nonvol = int(rhs) if rhs.isdigit() else 0
    total = vol + nonvol
    if total <= 0:
        return None
    return {
        "type": "context switch",
        "name": "context_switches",
        "count": total,
        "voluntary": vol,
        "nonvoluntary": nonvol,
    }


def _read_network_packet_event(pid: int) -> dict | None:
    content = _safe_read_text(f"/proc/{pid}/net/dev")
    if not content:
        return None
    rx_packets = 0
    tx_packets = 0
    for line in content.splitlines()[2:]:
        if ":" not in line:
            continue
        _, rhs = line.split(":", 1)
        cols = rhs.split()
        if len(cols) < 10:
            continue
        try:
            rx_packets += int(cols[1])
            tx_packets += int(cols[9])
        except ValueError:
            continue
    total_packets = rx_packets + tx_packets
    if total_packets <= 0:
        return None
    return {
        "type": "network packet",
        "name": "net_packets",
        "count": total_packets,
        "rx_packets": rx_packets,
        "tx_packets": tx_packets,
    }


def _read_interrupt_event() -> dict | None:
    content = _safe_read_text("/proc/interrupts")
    if not content:
        return None
    total = 0
    for line in content.splitlines()[1:]:
        if ":" not in line:
            continue
        _, rhs = line.split(":", 1)
        for token in rhs.split():
            if token.isdigit():
                total += int(token)
    if total <= 0:
        return None
    return {"type": "interrupt", "name": "interrupt_total", "count": total}


def _read_scheduler_tick_event() -> dict | None:
    content = _safe_read_text("/proc/stat")
    if not content:
        return None
    for line in content.splitlines():
        if line.startswith("ctxt "):
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                return {"type": "scheduler tick", "name": "ctxt", "count": int(parts[1])}
    return None


def _read_lock_unlock_event(pid: int) -> dict | None:
    content = _safe_read_text("/proc/locks")
    if not content:
        return None
    pid_str = f" {pid} "
    lock_count = 0
    for line in content.splitlines():
        if pid_str in f" {line} ":
            lock_count += 1
    if lock_count <= 0:
        return None
    return {"type": "lock/unlock", "name": "proc_locks", "count": lock_count}


def get_proc_timeline_data(pid, window_s: int = 30):
    """Build timeline-like process events from /proc snapshots."""
    if not pid:
        raise ValueError("PID parameter required")

    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess as e:
        raise ProcessLookupError(f"Process {pid} not found") from e

    proc_info = proc.as_dict(["pid", "name", "create_time", "status"])
    base_ts = float(proc_info["create_time"])
    window_s = _clamp_window_s(window_s)
    ordered_events = [{"type": "exec", "name": "exec", "pid": pid}]

    syscall_ev = _read_proc_syscall_event(pid)
    if syscall_ev:
        syscall_ev["pid"] = pid
        ordered_events.append(syscall_ev)

    ctx_ev = _read_context_switch_event(pid)
    if ctx_ev:
        ctx_ev["pid"] = pid
        ordered_events.append(ctx_ev)

    irq_ev = _read_interrupt_event()
    if irq_ev:
        irq_ev["pid"] = pid
        ordered_events.append(irq_ev)

    sched_ev = _read_scheduler_tick_event()
    if sched_ev:
        sched_ev["pid"] = pid
        ordered_events.append(sched_ev)

    for io_ev in _read_proc_io_events(pid):
        io_ev["pid"] = pid
        ordered_events.append(io_ev)

    net_ev = _read_network_packet_event(pid)
    if net_ev:
        net_ev["pid"] = pid
        ordered_events.append(net_ev)

    lock_ev = _read_lock_unlock_event(pid)
    if lock_ev:
        lock_ev["pid"] = pid
        ordered_events.append(lock_ev)

    # Keep this event for backward compatibility with existing clients.
    if proc_info.get("status"):
        ordered_events.append({"type": "syscall", "name": "process_status", "pid": pid, "status": proc_info["status"]})

    timeline = _stamp_events_with_time_window(ordered_events, base_ts, window_s)

    return {
        "timeline": timeline,
        "pid": pid,
        "name": proc_info.get("name", "unknown"),
        "timestamp": datetime.now().isoformat(),
        "window_s": window_s,
        "timeline_time_basis": "Events are sampled from /proc and distributed over selected window as a relative timeline (not exact per-event kernel timestamps).",
    }


def get_proc_timeline_branches_data(limit: int = 6, events: int = 10, window_s: int = 30):
    """Build process-branch timeline payload for multi-branch visualization."""
    limit = max(1, min(12, int(limit)))
    events = max(3, min(24, int(events)))
    window_s = _clamp_window_s(window_s)

    candidates = []
    for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_info"]):
        try:
            pid = int(proc.info.get("pid") or 0)
            if pid <= 1:
                continue
            name = str(proc.info.get("name") or "").strip()
            if not name:
                continue
            cpu = float(proc.info.get("cpu_percent") or 0.0)
            mem_info = proc.info.get("memory_info")
            mem_mb = float(getattr(mem_info, "rss", 0) or 0) / (1024 * 1024)
            score = cpu * 2.0 + (mem_mb / 256.0)
            candidates.append(
                {
                    "pid": pid,
                    "name": name,
                    "cpu_percent": round(cpu, 2),
                    "memory_mb": round(mem_mb, 1),
                    "score": score,
                }
            )
        except (psutil.Error, OSError, TypeError, ValueError):
            continue

    candidates.sort(key=lambda row: row.get("score", 0.0), reverse=True)
    branches = []
    for candidate in candidates[: max(limit * 4, limit)]:
        if len(branches) >= limit:
            break
        pid = int(candidate["pid"])
        try:
            timeline_data = get_proc_timeline_data(pid, window_s=window_s)
        except (ProcessLookupError, ValueError, psutil.Error, OSError):
            continue
        timeline = list(timeline_data.get("timeline") or [])[:events]
        if not timeline:
            continue
        branches.append(
            {
                "pid": pid,
                "name": str(timeline_data.get("name") or candidate["name"]),
                "cpu_percent": float(candidate.get("cpu_percent") or 0.0),
                "memory_mb": float(candidate.get("memory_mb") or 0.0),
                "timeline": timeline,
                "event_count": len(timeline),
            }
        )

    return {
        "branches": branches,
        "timestamp": datetime.now().isoformat(),
        "meta": {
            "limit": limit,
            "events_per_branch": events,
            "window_s": window_s,
            "branch_count": len(branches),
            "mode": "multi-branch-v1",
        },
    }
