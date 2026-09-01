"""Tests for the KernelEvent v1 unprivileged broker."""

import importlib.util
from pathlib import Path


PATH = Path(__file__).parents[1] / "deploy" / "ebpf" / "sensor_broker.py"
SPEC = importlib.util.spec_from_file_location("sensor_broker", PATH)
broker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(broker)


def test_adapt_event_preserves_inspector_fields():
    payload = {
        "schema": "kernel.event/v1",
        "seq": 9,
        "kind": "syscall_span",
        "timestamp": "2026-09-01T10:00:00Z",
        "pid": 42,
        "tid": 43,
        "uid": 1000,
        "cpu": 2,
        "cgroup_id": 88,
        "comm": "worker",
        "subsystem": "fs",
        "syscall": {
            "nr": 63,
            "name": "read",
            "args": [5, 4096, 16, 0, 0, 0],
            "return": 8,
            "duration_us": 250_000,
            "fd": 5,
            "fd_target": "pipe:[8123]",
        },
        "wakeup": {
            "waker_pid": 10,
            "waker_tid": 11,
            "waker_comm": "producer",
            "wakee_tid": 43,
            "target_cpu": 2,
        },
    }

    event = broker.adapt_event(payload)

    assert event["schema"] == "kernel.event/v1"
    assert event["syscall"] == "read"
    assert event["duration_us"] == 250_000
    assert event["fd_target"] == "pipe:[8123]"
    assert event["wakeup"]["waker_comm"] == "producer"
    assert event["exit_ts"] - event["enter_ts"] == 0.25


def test_adapt_event_rejects_unknown_contract_or_kind():
    assert broker.adapt_event({"schema": "kernel.event/v0"}) is None
    assert broker.adapt_event(
        {"schema": "kernel.event/v1", "kind": "network_packet"}
    ) is None
