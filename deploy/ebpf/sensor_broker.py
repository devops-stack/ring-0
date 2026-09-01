#!/usr/bin/env python3
"""Unprivileged bridge from KernelEvent v1 packets to the bounded UI snapshot."""

from __future__ import annotations

from collections import deque
from datetime import datetime
import json
import os
import signal
import socket
import tempfile
import time


SOCKET_PATH = os.environ.get("KERNEL_SENSOR_SOCKET", "/run/kernel-ai/sensor.sock")
OUT_PATH = os.environ.get(
    "KERNEL_SENSOR_EVENTS_OUT", "/run/kernel-ai/kernel-events-v1.json"
)
MAX_EVENTS = max(50, int(os.environ.get("KERNEL_SENSOR_MAX_EVENTS", "800")))
MAX_EPS = max(10, int(os.environ.get("KERNEL_SENSOR_MAX_EPS", "300")))
MIN_DURATION_US = max(
    1, int(os.environ.get("KERNEL_SENSOR_MIN_DURATION_US", "100000"))
)
FLUSH_S = max(0.1, float(os.environ.get("KERNEL_SENSOR_FLUSH_S", "0.5")))
RECONNECT_S = max(0.1, float(os.environ.get("KERNEL_SENSOR_RECONNECT_S", "1")))


def _wall_seconds(value):
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return time.time()


def adapt_event(payload):
    """Validate and flatten KernelEvent v1 for the existing Inspector API."""
    if not isinstance(payload, dict) or payload.get("schema") != "kernel.event/v1":
        return None
    span = payload.get("syscall")
    if payload.get("kind") != "syscall_span" or not isinstance(span, dict):
        return None
    try:
        duration_us = max(0, int(span["duration_us"]))
        exit_ts = _wall_seconds(payload.get("timestamp"))
        event = {
            "schema": payload["schema"],
            "kind": "syscall",
            "phase": "complete",
            "seq": int(payload["seq"]),
            "enter_ts": exit_ts - duration_us / 1_000_000,
            "exit_ts": exit_ts,
            "duration_us": duration_us,
            "pid": int(payload["pid"]),
            "tid": int(payload["tid"]),
            "uid": int(payload["uid"]),
            "cpu": int(payload["cpu"]),
            "cgroup_id": int(payload.get("cgroup_id", 0)),
            "comm": str(payload.get("comm") or "?"),
            "nr": int(span["nr"]),
            "syscall": str(span["name"]),
            "ret": int(span["return"]),
            "args": [int(value) for value in span.get("args", [])][:6],
            "subsystem": str(payload.get("subsystem") or "kernel"),
        }
    except (KeyError, TypeError, ValueError):
        return None
    if span.get("fd") is not None:
        event["fd"] = int(span["fd"])
    if span.get("fd_target"):
        event["fd_target"] = str(span["fd_target"])
    wakeup = payload.get("wakeup")
    if isinstance(wakeup, dict):
        event["wakeup"] = {
            "waker_pid": wakeup.get("waker_pid"),
            "waker_tid": wakeup.get("waker_tid"),
            "waker_comm": wakeup.get("waker_comm"),
            "wakee_tid": wakeup.get("wakee_tid"),
            "target_cpu": wakeup.get("target_cpu"),
        }
    return event


def write_snapshot(events, *, seq, dropped, started_at):
    payload = {
        "ts": time.time(),
        "seq": seq,
        "dropped": dropped,
        "started_at": started_at,
        "min_duration_us": MIN_DURATION_US,
        "max_events": MAX_EVENTS,
        "sources": {
            "contract": "kernel.event/v1",
            "syscalls": "kernel-ai-sensor",
            "wakeup": "sched_wakeup correlation",
        },
        "traced_syscalls": sorted(
            {event["syscall"] for event in events if event.get("syscall")}
        ),
        "events": list(events),
    }
    directory = os.path.dirname(OUT_PATH)
    os.makedirs(directory, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".sensor-events-", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, OUT_PATH)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def run():
    stopping = False

    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    events = deque(maxlen=MAX_EVENTS)
    seq = 0
    dropped = 0
    started_at = time.time()
    window_started = time.monotonic()
    window_count = 0
    last_flush = 0.0

    while not stopping:
        stream = socket.socket(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        stream.settimeout(min(FLUSH_S, 0.5))
        try:
            stream.connect(SOCKET_PATH)
            while not stopping:
                now = time.monotonic()
                if now - window_started >= 1:
                    window_started = now
                    window_count = 0
                try:
                    packet = stream.recv(65535)
                except socket.timeout:
                    packet = None
                if packet == b"":
                    break
                if packet:
                    try:
                        normalized = adapt_event(json.loads(packet))
                    except (UnicodeDecodeError, ValueError, TypeError):
                        normalized = None
                    if normalized is None:
                        dropped += 1
                    elif window_count >= MAX_EPS:
                        dropped += 1
                    else:
                        seq += 1
                        window_count += 1
                        normalized["seq"] = seq
                        events.append(normalized)
                if now - last_flush >= FLUSH_S:
                    write_snapshot(
                        events, seq=seq, dropped=dropped, started_at=started_at
                    )
                    last_flush = now
        except OSError:
            time.sleep(RECONNECT_S)
        finally:
            stream.close()

    write_snapshot(events, seq=seq, dropped=dropped, started_at=started_at)


if __name__ == "__main__":
    run()
