"""Tests for ``kernel_ai.services.waits``."""

import json
import os

import pytest

from kernel_ai.services import waits as svc


def _thread(tmp_path, pid, tid, comm="worker", state="S"):
    task = tmp_path / str(pid) / "task" / str(tid)
    task.mkdir(parents=True, exist_ok=True)
    tail = " ".join(["0"] * 35)
    (task / "stat").write_text(f"{tid} ({comm}) {state} {tail} 0\n")
    (task / "comm").write_text(f"{comm}\n")
    (tmp_path / str(pid) / "comm").write_text(f"{comm}\n")
    return task


def _snapshots(tmp_path, monkeypatch, parked=None, pipes=None, locks=None):
    tasks = tmp_path / "tasks.json"
    endpoints = tmp_path / "endpoints.json"
    tasks.write_text(json.dumps({"ts": 0, "tasks": parked or {}}))
    endpoints.write_text(json.dumps({"ts": 0, "pipes": pipes or {}, "locks": locks or []}))
    monkeypatch.setattr(svc, "TASKS_SNAPSHOT", str(tasks))
    monkeypatch.setattr(svc, "ENDPOINTS_SNAPSHOT", str(endpoints))


@pytest.fixture(autouse=True)
def _proc(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    # A live wakeup snapshot on this host must not leak into these tests.
    from kernel_ai.services import wakeups as wakeups_service
    monkeypatch.setattr(wakeups_service, "SNAPSHOT", str(tmp_path / "no-wakeups.json"))


def test_a_thread_that_is_gone_is_reported_as_gone(tmp_path, monkeypatch):
    _snapshots(tmp_path, monkeypatch)
    assert svc.describe(4242, 4242).get("error") == "no such thread"


def test_threads_on_the_same_word_are_one_group(tmp_path, monkeypatch):
    for tid in (100, 101, 102):
        _thread(tmp_path, 100, tid, comm="gunicorn")
    _thread(tmp_path, 100, 103, comm="gunicorn", state="R")
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 393, "val": 0},
        "101": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 393, "val": 0},
        "102": {"pid": 100, "name": "futex", "word": "0x7f99", "op": 128, "val": 2},
    })

    out = svc.describe(100, 101)
    on = out["waiting_on"]

    assert on["kind"] == "futex"
    assert [w["tid"] for w in on["waiters"]] == [100, 101]
    assert [w["self"] for w in on["waiters"]] == [False, True]
    # The thread on another word and the one that is not waiting at all could
    # both be holding this lock; only the running one can be holding it and
    # doing something with it right now.
    assert on["candidates"]["total"] == 2
    assert {c["tid"] for c in on["candidates"]["sample"]} == {102, 103}
    assert [c["tid"] for c in on["candidates"]["running"]] == [103]


def test_a_sleeping_thread_is_not_ruled_out_as_the_holder(tmp_path, monkeypatch):
    """A lock held across a blocking call is exactly how deadlocks read."""
    _thread(tmp_path, 100, 100)
    _thread(tmp_path, 100, 101, state="S")
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 128},
        "101": {"pid": 100, "name": "epoll_wait", "fd": 4},
    })

    pool = svc.describe(100, 100)["waiting_on"]["candidates"]

    assert pool["total"] == 1
    assert pool["running"] == []
    assert [c["parked_in"] for c in pool["sample"]] == ["epoll_wait"]


def test_the_same_address_in_another_process_is_another_lock(tmp_path, monkeypatch):
    """A private futex is keyed by address inside one address space."""
    _thread(tmp_path, 100, 100, comm="gunicorn")
    _thread(tmp_path, 200, 200, comm="gunicorn")
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 393},
        "200": {"pid": 200, "name": "futex", "word": "0x7f10", "op": 393},
    })

    on = svc.describe(100, 100)["waiting_on"]

    assert [w["tid"] for w in on["waiters"]] == [100]
    assert on["scope"] == "this process only"


def test_the_operation_is_decoded_into_its_flags(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 393, "val": 0},
    })

    op = svc.describe(100, 100)["waiting_on"]["op"]

    # 393 = FUTEX_WAIT_BITSET | FUTEX_PRIVATE_FLAG | FUTEX_CLOCK_REALTIME
    assert op["cmd"] == 9
    assert op["name"] == "FUTEX_WAIT_BITSET"
    assert op["private"] is True
    assert op["realtime"] is True
    assert op["pi"] is False


def test_a_plain_contended_mutex_is_told_apart_from_a_condition_variable(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 128, "val": 2},
    })

    op = svc.describe(100, 100)["waiting_on"]["op"]

    assert (op["cmd"], op["name"], op["private"]) == (0, "FUTEX_WAIT", True)
    assert op["realtime"] is False


def test_the_owner_of_an_ordinary_futex_is_never_claimed(tmp_path, monkeypatch):
    """Userspace takes the lock without telling the kernel, so no one knows."""
    _thread(tmp_path, 100, 100)
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 128},
    })

    owner = svc.describe(100, 100)["waiting_on"]["owner"]

    assert owner["known"] is False
    assert "userspace" in owner["why"]


def test_a_priority_inheriting_futex_says_where_its_owner_lives(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 134},
    })

    on = svc.describe(100, 100)["waiting_on"]

    assert on["op"]["pi"] is True
    assert on["owner"]["known"] is False
    assert "word itself" in on["owner"]["why"]


def test_the_far_end_of_a_pipe_is_named(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100, comm="rsyslogd")
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "read", "fd": 5, "fd_target": "pipe:[4242]"},
    }, pipes={
        "4242": {
            "readers": [{"pid": 100, "fd": 5, "comm": "rsyslogd"}],
            "writers": [{"pid": 900, "fd": 1, "comm": "systemd-journal"}],
        },
    })

    on = svc.describe(100, 100)["waiting_on"]

    assert on["kind"] == "pipe"
    assert on["direction"] == "reading"
    assert on["other_end"] == [{"pid": 900, "fd": 1, "comm": "systemd-journal"}]
    assert on["same_end"] == []


def test_a_pipe_whose_far_end_is_closed_says_nothing_instead_of_inventing(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "read", "fd": 3, "fd_target": "pipe:[7]"},
    }, pipes={"7": {"readers": [{"pid": 100, "fd": 3, "comm": "worker"}], "writers": []}})

    on = svc.describe(100, 100)["waiting_on"]

    assert on["other_end"] == []
    assert on["direction"] == "reading"


def test_inherited_descriptors_on_the_same_end_are_kept_apart(tmp_path, monkeypatch):
    """A child holding the same read end is not the other side of the pipe."""
    _thread(tmp_path, 100, 100, comm="mlflow")
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "read", "fd": 0, "fd_target": "pipe:[11]"},
    }, pipes={
        "11": {
            "readers": [{"pid": 100, "fd": 0, "comm": "mlflow"},
                        {"pid": 101, "fd": 0, "comm": "python"}],
            "writers": [{"pid": 102, "fd": 1, "comm": "shell"}],
        },
    })

    on = svc.describe(100, 100)["waiting_on"]

    assert [r["pid"] for r in on["other_end"]] == [102]
    assert [r["pid"] for r in on["same_end"]] == [101]


def test_an_epoll_set_names_what_it_watches(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100, comm="systemd")
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "epoll_wait", "fd": 4, "watching": {"total": 3, "watched": [
            {"fd": 9, "events": 0x1, "target": "socket:[555]"},
            {"fd": 8, "events": 0x19, "target": "anon_inode:[timerfd]"},
            {"fd": 7, "events": 0x1, "target": "pipe:[77]"},
        ]}},
    })
    monkeypatch.setattr(svc, "socket_labels", lambda: {"555": "unix /run/systemd/journal/stdout"})

    on = svc.describe(100, 100)["waiting_on"]

    assert on["kind"] == "epoll"
    assert on["total"] == 3
    assert on["kinds"] == {"socket": 1, "timer": 1, "pipe": 1}
    by_fd = {row["fd"]: row for row in on["watched"]}
    assert by_fd[9]["label"] == "unix /run/systemd/journal/stdout"
    assert by_fd[9]["waiting_for"] == "data"
    assert by_fd[8]["label"] == "timer"
    assert by_fd[7]["label"] == "pipe:[77]"


def test_the_same_thing_watched_many_times_is_counted_once(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100, comm="systemd")
    watched = [{"fd": 80 + i, "events": 0x18, "target": "socket:[555]"} for i in range(4)]
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "epoll_wait", "fd": 4,
                "watching": {"total": 40, "watched": watched}},
    })
    monkeypatch.setattr(svc, "socket_labels", lambda: {"555": "unix /run/systemd/journal/stdout"})

    on = svc.describe(100, 100)["waiting_on"]

    assert len(on["watched"]) == 1
    assert on["watched"][0]["count"] == 4
    assert on["watched"][0]["fd"] == 80
    # The set is larger than the sample the collector kept, and says so.
    assert on["total"] == 40 and on["shown"] == 4


def test_socket_addresses_come_out_of_proc_net(tmp_path, monkeypatch):
    net = tmp_path / "net"
    net.mkdir()
    (net / "unix").write_text(
        "Num RefCount Protocol Flags Type St Inode Path\n"
        "ffff: 00000003 00000000 00000000 0001 03 4242 /run/dbus/system_bus_socket\n")
    (net / "tcp").write_text(
        "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"
        "   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000"
        " 00000000  1000        0 900 1 0000000000000000 100 0 0 10 0\n"
        "   1: 0100007F:1F90 0100007F:C350 01 00000000:00000000 00:00000000"
        " 00000000  1000        0 901 1 0000000000000000 20 4 30 10 -1\n")
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    monkeypatch.chdir(tmp_path)
    real_read = svc._read
    monkeypatch.setattr(svc, "_read", lambda p: real_read(
        str(net / os.path.basename(p)) if p.startswith("/proc/net/") else p))

    labels = svc.socket_labels()

    assert labels["4242"] == "unix /run/dbus/system_bus_socket"
    assert labels["900"] == "tcp listening on 127.0.0.1:8080"
    assert labels["901"] == "tcp 127.0.0.1:8080 to 127.0.0.1:50000"


def test_file_locks_of_the_process_are_carried_along(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    _snapshots(tmp_path, monkeypatch, parked={}, locks=[
        {"id": "1", "kind": "FLOCK", "mode": "WRITE", "pid": 100, "inode": "ca:01:7", "waiting": False},
        {"id": "1", "kind": "FLOCK", "mode": "WRITE", "pid": 200, "inode": "ca:01:7", "waiting": True},
    ])

    out = svc.describe(100, 100)

    assert [row["pid"] for row in out["locks"]] == [100]
    assert out["waiting_on"] is None


def test_without_the_collector_the_answer_is_missing_not_guessed(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    monkeypatch.setattr(svc, "TASKS_SNAPSHOT", str(tmp_path / "nothing.json"))
    monkeypatch.setattr(svc, "ENDPOINTS_SNAPSHOT", str(tmp_path / "nothing.json"))

    out = svc.describe(100, 100)

    assert out["waiting_on"] is None
    assert out["call"] is None
    assert out["sources"]["parked_in"]["reason"] == "no-collector"
    assert out["sources"]["endpoints"]["reason"] == "no-collector"
    assert out["seen_waking"]["available"] is False


def _wakeups(tmp_path, monkeypatch, edges):
    from kernel_ai.services import wakeups as wakeups_service
    path = tmp_path / "wakeups.json"
    path.write_text(json.dumps({
        "ts": 0, "window_s": 0.25, "events": 10, "lost": 0,
        "distinct_edges": len(edges), "contexts": {"task": 10},
        "observer_tid": 999, "edges": edges, "wakers": [], "wakees": [],
    }))
    monkeypatch.setattr(wakeups_service, "SNAPSHOT", str(path))


def test_a_waker_seen_in_the_window_is_named_but_not_called_the_owner(tmp_path, monkeypatch):
    """The kernel still does not record the holder; the window only saw a release."""
    _thread(tmp_path, 100, 100)
    _thread(tmp_path, 100, 101, comm="worker", state="R")
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 128},
    })
    _wakeups(tmp_path, monkeypatch, [{
        "waker_tid": 101, "waker_comm": "worker", "waker_pid": 100, "waker_kernel": False,
        "tid": 100, "comm": "worker", "pid": 100, "kernel": False,
        "count": 3, "contexts": {"task": 3}, "new": False,
    }])

    out = svc.describe(100, 100)
    seen = out["seen_waking"]
    owner = out["waiting_on"]["owner"]

    assert owner["known"] is False
    assert seen["available"] is True
    assert seen["wakers"][0]["tid"] == 101
    assert seen["wakers"][0]["count"] == 3
    assert seen["wakers"][0]["of"] == [100]


def test_a_waker_of_a_sibling_on_the_same_word_is_the_same_observation(tmp_path, monkeypatch):
    """Whoever woke another waiter on this word released or signaled it."""
    _thread(tmp_path, 100, 100)
    _thread(tmp_path, 100, 101)
    _thread(tmp_path, 100, 102, comm="holder", state="R")
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 128},
        "101": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 128},
    })
    _wakeups(tmp_path, monkeypatch, [{
        "waker_tid": 102, "waker_comm": "holder", "waker_pid": 100, "waker_kernel": False,
        "tid": 101, "comm": "worker", "pid": 100, "kernel": False,
        "count": 2, "contexts": {"task": 2}, "new": False,
    }])

    seen = svc.describe(100, 100)["seen_waking"]

    assert [w["tid"] for w in seen["wakers"]] == [102]
    assert seen["wakers"][0]["of"] == [101]


def test_an_interrupt_waking_the_thread_is_not_a_lock_holder(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "name": "futex", "word": "0x7f10", "op": 128},
    })
    _wakeups(tmp_path, monkeypatch, [{
        "waker_tid": 0, "waker_comm": "<idle>", "waker_pid": None, "waker_kernel": None,
        "tid": 100, "comm": "worker", "pid": 100, "kernel": False,
        "count": 4, "contexts": {"hardirq": 4}, "new": False,
    }])

    waker = svc.describe(100, 100)["seen_waking"]["wakers"][0]

    assert waker["idle"] is True
    assert waker["comm"] == "idle cpu"
    assert waker["contexts"] == {"hardirq": 4}
