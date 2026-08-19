"""Tests for ``kernel_ai.services.syscalls``."""

import json
import time

import pytest

from kernel_ai.services import syscalls as svc


@pytest.fixture(autouse=True)
def _no_collector_on_this_host(monkeypatch):
    """Keep the tests reading the machine they describe, not the one they run on.

    The service answers from the root collector's snapshot whenever a fresh one
    exists. On a host where the collector happens to be running that snapshot
    would win over the /proc each test sets up, so the path starts out pointing
    at nothing and the tests about the snapshot point it back at their own.
    """
    monkeypatch.setattr(svc, "_SYSCALLS_SNAPSHOT", "/nonexistent/kernel-ai/syscalls.json")


def test_get_real_system_calls_non_linux_uses_fallback(monkeypatch):
    monkeypatch.setattr(svc.platform, "system", lambda: "Darwin")
    out = svc.get_real_system_calls(
        syscall_names={},
        map_syscall_to_subsystem_fn=lambda _name: "kernel",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [{"name": "mock", "count": 1, "subsystem": "kernel"}],
    )
    assert out and out[0]["name"] == "mock"


def test_get_real_system_calls_linux_empty_proc(monkeypatch):
    monkeypatch.setattr(svc.platform, "system", lambda: "Linux")
    monkeypatch.setattr(svc.os, "listdir", lambda _path: [])
    out = svc.get_real_system_calls(
        syscall_names={},
        map_syscall_to_subsystem_fn=lambda _name: "kernel",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [{"name": "mock"}],
    )
    assert isinstance(out, list)


def _stub_proc(monkeypatch, parked, comms=None, kernel_threads=()):
    """Pretend /proc holds the given {pid: syscall_line} set of tasks.

    Anything named in ``kernel_threads`` gets an empty command line, which is
    how the real thing tells a kthread from a process.
    """
    monkeypatch.setattr(svc.platform, "system", lambda: "Linux")
    monkeypatch.setattr(svc.os, "listdir", lambda _path: list(parked))
    monkeypatch.setattr(svc.os.path, "exists", lambda _path: True)

    real_open = open

    def fake_open(path, *args, **kwargs):
        text = None
        for pid, line in parked.items():
            if path == f"/proc/{pid}/syscall":
                text = line
            elif path == f"/proc/{pid}/comm":
                text = (comms or {}).get(pid, f"task{pid}")
            elif path == f"/proc/{pid}/cmdline":
                text = b"" if pid in kernel_threads else b"/usr/bin/task\x00"
        if text is None:
            return real_open(path, *args, **kwargs)

        class _Handle:
            def read(self_inner, size=-1):
                return text[:size] if size and size > 0 else text

            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *_exc):
                return False

        return _Handle()

    monkeypatch.setattr("builtins.open", fake_open)


def test_waiters_name_the_processes_parked_in_each_syscall(monkeypatch):
    _stub_proc(
        monkeypatch,
        {"11": "0 0x3 0x0", "12": "0 0x4 0x0", "13": "1 0x1 0x0"},
        {"11": "nginx", "12": "nginx", "13": "bash"},
    )
    out = svc.get_real_system_calls(
        syscall_names={0: "read", 1: "write"},
        map_syscall_to_subsystem_fn=lambda _name: "fs",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [],
    )
    rows = {row["name"]: row for row in out}
    assert rows["read"]["count"] == 2
    assert [(w["pid"], w["comm"]) for w in rows["read"]["waiters"]] == [(11, "nginx"), (12, "nginx")]
    assert [(w["pid"], w["comm"]) for w in rows["write"]["waiters"]] == [(13, "bash")]


def test_waiter_list_is_capped_but_the_count_stays_honest(monkeypatch):
    pids = [str(100 + i) for i in range(svc._MAX_WAITERS_PER_SYSCALL + 5)]
    _stub_proc(monkeypatch, {pid: "0 0x3 0x0" for pid in pids})
    out = svc.get_real_system_calls(
        syscall_names={0: "read"},
        map_syscall_to_subsystem_fn=lambda _name: "fs",
        kernel_dna_max_procs=100,
        fallback_mock_calls_fn=lambda: [],
    )
    assert out[0]["count"] == len(pids)
    assert len(out[0]["waiters"]) == svc._MAX_WAITERS_PER_SYSCALL


def test_running_and_unreadable_tasks_are_not_counted_as_waiters(monkeypatch):
    _stub_proc(monkeypatch, {"21": "running", "22": "-1", "23": "0 0x3 0x0"})
    out = svc.get_real_system_calls(
        syscall_names={0: "read"},
        map_syscall_to_subsystem_fn=lambda _name: "fs",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [],
    )
    assert len(out) == 1
    assert out[0]["count"] == 1
    assert [w["pid"] for w in out[0]["waiters"]] == [23]


def test_comm_is_none_when_the_process_exits_mid_sample(monkeypatch):
    _stub_proc(monkeypatch, {"31": "0 0x3 0x0"})
    monkeypatch.setattr(svc, "_read_comm", lambda _pid: None)
    out = svc.get_real_system_calls(
        syscall_names={0: "read"},
        map_syscall_to_subsystem_fn=lambda _name: "fs",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [],
    )
    assert out[0]["waiters"] == [{"pid": 31, "comm": None}]


def test_kernel_threads_are_not_parked_in_syscall_zero(monkeypatch):
    # kthreads read as "0 0x0 …" because no call is in flight; counting them
    # would invent a top row with every kthread on the box parked in it.
    _stub_proc(
        monkeypatch,
        {"2": "0 0x0 0x0 0x0 0x0 0x0 0x0 0x0 0x0", "3": "0 0x0 0x0 0x0 0x0 0x0 0x0 0x0 0x0", "40": "0 0x3 0x0"},
        kernel_threads=("2", "3"),
    )
    out = svc.get_real_system_calls(
        syscall_names={0: "read"},
        map_syscall_to_subsystem_fn=lambda _name: "fs",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [],
    )
    assert out[0]["count"] == 1
    assert [w["pid"] for w in out[0]["waiters"]] == [40]


def _write_snapshot(tmp_path, monkeypatch, payload):
    path = tmp_path / "syscalls.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(svc, "_SYSCALLS_SNAPSHOT", str(path))
    return path


def test_a_fresh_collector_snapshot_is_preferred_over_self_sampling(tmp_path, monkeypatch):
    _write_snapshot(tmp_path, monkeypatch, {
        "ts": time.time(),
        "tasks_total": 199,
        "blocked_total": 51,
        "syscalls": [{"name": "futex", "nr": 202, "count": 30, "waiters": []}],
    })
    sample = svc.get_syscall_sample(
        syscall_names={},
        map_syscall_to_subsystem_fn=lambda _name: "sched",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [],
    )
    assert sample["scope"] == "machine"
    assert sample["blocked_total"] == 51
    assert sample["syscalls"][0]["name"] == "futex"
    # The collector samples; naming the subsystem is the app's job.
    assert sample["syscalls"][0]["subsystem"] == "sched"


def test_a_stale_snapshot_is_refused_rather_than_shown_as_now(tmp_path, monkeypatch):
    _write_snapshot(tmp_path, monkeypatch, {
        "ts": time.time() - (svc._SNAPSHOT_MAX_AGE + 30),
        "syscalls": [{"name": "futex", "count": 30, "waiters": []}],
    })
    _stub_proc(monkeypatch, {"7": "0 0x3 0x0"})
    sample = svc.get_syscall_sample(
        syscall_names={0: "read"},
        map_syscall_to_subsystem_fn=lambda _name: "fs",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [],
    )
    assert sample["scope"] == "self"
    assert [row["name"] for row in sample["syscalls"]] == ["read"]


def test_without_a_collector_the_sample_says_it_only_saw_itself(monkeypatch):
    monkeypatch.setattr(svc, "_SYSCALLS_SNAPSHOT", "/nonexistent/syscalls.json")
    _stub_proc(monkeypatch, {"7": "0 0x3 0x0", "8": "0 0x4 0x0"})
    sample = svc.get_syscall_sample(
        syscall_names={0: "read"},
        map_syscall_to_subsystem_fn=lambda _name: "fs",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [],
    )
    assert sample["source"] == "backend"
    assert sample["scope"] == "self"
    assert sample["blocked_total"] == 2


def test_get_softirq_nucleotides_handles_read_error(monkeypatch):
    def _boom(*_args, **_kwargs):
        raise OSError("nope")

    monkeypatch.setattr("builtins.open", _boom)
    out = svc.get_softirq_nucleotides(map_interrupt_to_subsystem_fn=lambda _n: "kernel")
    assert out == []
