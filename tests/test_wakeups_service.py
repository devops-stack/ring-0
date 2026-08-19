"""Tests for ``kernel_ai.services.wakeups``."""

import json

import pytest

from kernel_ai.services import wakeups as svc


def _snapshot(tmp_path, monkeypatch, payload):
    path = tmp_path / "wakeups.json"
    path.write_text(json.dumps(payload))
    monkeypatch.setattr(svc, "SNAPSHOT", str(path))
    return path


@pytest.fixture(autouse=True)
def _no_units(monkeypatch):
    monkeypatch.setattr(svc, "_unit", lambda pid: None)


PAYLOAD = {
    "ts": 0,
    "window_s": 0.25,
    "events": 156,
    "lost": 0,
    "distinct_edges": 31,
    "contexts": {"task": 122, "softirq": 30, "hardirq": 4},
    "observer_tid": 999,
    "edges": [
        {"waker_tid": 22, "waker_comm": "kauditd", "waker_pid": 22, "waker_kernel": True,
         "tid": 128826, "comm": "systemd-journal", "pid": 128826, "kernel": False,
         "count": 24, "contexts": {"task": 24}, "new": False},
        {"waker_tid": 0, "waker_comm": "<idle>", "waker_pid": None, "waker_kernel": None,
         "tid": 75798, "comm": "auditd", "pid": 75798, "kernel": False,
         "count": 9, "contexts": {"hardirq": 9}, "new": False},
        {"waker_tid": 999, "waker_comm": "python3", "waker_pid": 999, "waker_kernel": False,
         "tid": 400, "comm": "systemd-journal", "pid": 400, "kernel": False,
         "count": 3, "contexts": {"task": 3}, "new": False},
    ],
    "wakers": [{"tid": 22, "comm": "kauditd", "count": 24, "partners": 1}],
    "wakees": [{"tid": 128826, "comm": "systemd-journal", "count": 24, "partners": 1}],
}


def test_the_window_is_reported_as_a_rate_and_a_length(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, PAYLOAD)

    out = svc.describe()

    assert out["available"] is True
    assert out["window_s"] == 0.25
    assert out["events"] == 156
    assert out["rate_per_s"] == 624
    assert out["lost"] == 0


def test_each_context_carries_what_it_means(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, PAYLOAD)

    contexts = svc.describe()["contexts"]

    assert contexts["hardirq"]["count"] == 4
    assert "hardware" in contexts["hardirq"]["means"]
    assert contexts["task"]["count"] == 122


def test_an_edge_names_both_ends(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, PAYLOAD)

    edge = svc.describe()["edges"][0]

    assert edge["waker"]["comm"] == "kauditd"
    assert edge["waker"]["kernel"] is True
    assert edge["woken"]["comm"] == "systemd-journal"
    assert edge["count"] == 24
    assert edge["why"] == "the waker itself, in ordinary code"


def test_a_wakeup_from_an_idle_cpu_is_told_as_an_interrupt(tmp_path, monkeypatch):
    """Tid 0 is not a task: it is the cpu with nothing to run."""
    _snapshot(tmp_path, monkeypatch, PAYLOAD)

    edge = svc.describe()["edges"][1]

    assert edge["waker"]["idle"] is True
    assert edge["waker"]["comm"] == "idle cpu"
    assert edge["why"] == "an interrupt arriving while the cpu had nothing to run"


def test_the_collector_is_marked_where_it_appears(tmp_path, monkeypatch):
    """Reading files wakes what serves them, and the sampler reads files."""
    _snapshot(tmp_path, monkeypatch, PAYLOAD)

    edges = svc.describe()["edges"]

    assert edges[2]["waker"]["observer"] is True
    assert edges[0]["waker"]["observer"] is False


def test_a_thread_can_ask_who_was_seen_waking_it(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, PAYLOAD)

    out = svc.for_thread(128826)

    assert out["available"] is True
    assert [row["waker"]["comm"] for row in out["wakers"]] == ["kauditd"]
    assert out["wakers"][0]["count"] == 24


def test_a_thread_nobody_was_seen_waking_gets_an_empty_answer(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, PAYLOAD)

    assert svc.for_thread(4242)["wakers"] == []


def test_without_the_collector_nothing_is_claimed(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "SNAPSHOT", str(tmp_path / "missing.json"))

    out = svc.describe()

    assert out["available"] is False
    assert out["edges"] == []
    assert out["source"]["reason"] == "no-collector"


def test_a_stale_window_is_refused(tmp_path, monkeypatch):
    import os
    import time

    path = _snapshot(tmp_path, monkeypatch, PAYLOAD)
    old = time.time() - 120
    os.utime(path, (old, old))

    out = svc.describe()

    assert out["available"] is False
    assert out["source"]["reason"] == "stale"


def test_dropped_events_reach_the_payload(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, dict(PAYLOAD, lost=4231))

    assert svc.describe()["lost"] == 4231
