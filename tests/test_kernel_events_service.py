"""Tests for ``kernel_ai.services.kernel_events``."""

import json
import os
import time

from kernel_ai.services import kernel_events as svc


def _snapshot(tmp_path, monkeypatch, payload):
    path = tmp_path / "kernel-events.json"
    path.write_text(json.dumps(payload))
    monkeypatch.setattr(svc, "SNAPSHOT", str(path))
    return path


def _payload():
    return {
        "seq": 4,
        "dropped": 2,
        "min_duration_us": 100000,
        "traced_syscalls": ["read", "futex"],
        "sources": {"syscalls": "bpftrace", "wakeup": "sched_wakeup correlation"},
        "events": [
            {"seq": 1, "pid": 10, "tid": 10, "syscall": "read"},
            {"seq": 2, "pid": 20, "tid": 21, "syscall": "futex"},
            {"seq": 3, "pid": 10, "tid": 11, "syscall": "read"},
            {"seq": 4, "pid": 30, "tid": 30, "syscall": "read"},
        ],
    }


def test_filters_by_process_and_cursor(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, _payload())

    out = svc.get_kernel_events(pids=[10], since_seq=1)

    assert out["available"] is True
    assert [event["seq"] for event in out["events"]] == [3]
    assert out["seq"] == 4
    assert out["source"]["kind"] == "ebpf"
    assert out["source"]["dropped"] == 2


def test_limit_keeps_newest_events(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, _payload())

    out = svc.get_kernel_events(limit=2)

    assert [event["seq"] for event in out["events"]] == [3, 4]


def test_missing_or_stale_snapshot_is_honest(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "SNAPSHOT", str(tmp_path / "missing.json"))
    assert svc.get_kernel_events()["source"]["reason"] == "no-collector"

    path = _snapshot(tmp_path, monkeypatch, _payload())
    old = time.time() - 120
    os.utime(path, (old, old))
    assert svc.get_kernel_events()["source"]["reason"] == "stale"


def test_reports_when_client_cursor_fell_out_of_ring(tmp_path, monkeypatch):
    payload = _payload()
    payload["events"] = payload["events"][2:]
    _snapshot(tmp_path, monkeypatch, payload)

    assert svc.get_kernel_events(since_seq=1)["cursor_lost"] is True
