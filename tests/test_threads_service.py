"""Tests for ``kernel_ai.services.threads``."""

import json
import os

from kernel_ai.services import threads as svc


def _thread(tmp_path, pid, tid, comm="worker", state="S", cpu=0,
            ran_ns=0, waited_ns=0, turns=0, vol=0, forced=0):
    """Write the four files the service reads for one thread."""
    task = tmp_path / str(pid) / "task" / str(tid)
    task.mkdir(parents=True)
    # /proc/<pid>/stat: the CPU last used is field 39 of the line, which is the
    # 37th field counting from the state.
    tail = " ".join(["0"] * 35)
    (task / "stat").write_text(f"{tid} ({comm}) {state} {tail} {cpu}\n")
    (task / "schedstat").write_text(f"{ran_ns} {waited_ns} {turns}\n")
    (task / "status").write_text(
        f"Name:\t{comm}\nThreads:\t1\n"
        f"voluntary_ctxt_switches:\t{vol}\n"
        f"nonvoluntary_ctxt_switches:\t{forced}\n"
    )
    (task / "comm").write_text(f"{comm}\n")
    return task


def _snapshots(tmp_path, monkeypatch, parked=None, scheduled=None):
    """Point the service at collector snapshots written just now."""
    syscalls = tmp_path / "syscalls.json"
    tasks = tmp_path / "tasks.json"
    sched = tmp_path / "sched_debug.json"
    syscalls.write_text(json.dumps({"ts": 0, "syscalls": []}))
    sched.write_text(json.dumps({"ts": 0, "tasks": scheduled or {}}))
    monkeypatch.setattr(svc, "SYSCALLS_SNAPSHOT", str(syscalls))
    monkeypatch.setattr(svc, "SCHED_DEBUG_SNAPSHOT", str(sched))
    if parked is None:
        monkeypatch.setattr(svc, "TASKS_SNAPSHOT", str(tmp_path / "absent.json"))
        return
    tasks.write_text(json.dumps({"ts": 0, "tasks": parked}))
    monkeypatch.setattr(svc, "TASKS_SNAPSHOT", str(tasks))


def test_a_process_that_is_gone_is_reported_as_gone(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    assert svc.describe(4242).get("error") == "no such process"


def test_every_task_of_the_process_becomes_a_thread(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100, comm="gunicorn")
    _thread(tmp_path, 100, 101, comm="pool-1")
    _thread(tmp_path, 100, 102, comm="jemalloc_bg")
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    (tmp_path / "100" / "comm").write_text("gunicorn\n")

    out = svc.describe(100)

    assert out["thread_count"] == 3
    assert {t["name"] for t in out["threads"]} == {"gunicorn", "pool-1", "jemalloc_bg"}
    assert [t["leader"] for t in out["threads"] if t["tid"] == 100] == [True]


def test_the_thread_on_a_cpu_is_listed_first(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100, ran_ns=9_000_000_000)
    _thread(tmp_path, 100, 101, state="R", ran_ns=1_000_000)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))

    out = svc.describe(100)

    assert out["threads"][0]["tid"] == 101
    assert out["threads"][0]["state_label"] == "on cpu or queued"
    assert out["totals"]["on_cpu"] == 1


def test_time_queued_is_reported_beside_time_running(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100, ran_ns=4_058_474_400, waited_ns=5_978_895_548, turns=31040)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))

    thread = svc.describe(100)["threads"][0]

    assert thread["ran_ms"] == 4058.5
    assert thread["waited_ms"] == 5978.9
    assert thread["turns"] == 31040


def test_the_dossier_keeps_seeing_the_leaders_own_switch_counters(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100, vol=11, forced=3)
    _thread(tmp_path, 100, 101, vol=70, forced=7)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))

    out = svc.describe(100)

    assert out["voluntary_ctxt_switches"] == 11
    assert out["nonvoluntary_ctxt_switches"] == 3
    assert out["totals"]["voluntary"] == 81
    assert out["totals"]["forced"] == 10


def test_the_call_a_thread_is_parked_in_comes_from_the_collector(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    _thread(tmp_path, 100, 101)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    _snapshots(tmp_path, monkeypatch, parked={
        "100": {"pid": 100, "nr": 232, "name": "epoll_wait", "wchan": "ep_poll",
                "fd": 12, "fd_target": "anon_inode:[eventpoll]"},
    })

    out = svc.describe(100)
    by_tid = {t["tid"]: t for t in out["threads"]}

    assert by_tid[100]["parked_in"] == "epoll_wait"
    assert by_tid[100]["wchan"] == "ep_poll"
    assert by_tid[100]["fd_target"] == "anon_inode:[eventpoll]"
    # The other thread is running or in no call; nothing is invented for it.
    assert "parked_in" not in by_tid[101]
    assert out["sources"]["parked_in"]["available"] is True


def test_the_scheduler_verdict_comes_from_the_debugfs_snapshot(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100, state="R")
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    _snapshots(tmp_path, monkeypatch, scheduled={
        "100": {"eligible": True, "vlag_ms": 16.905, "slice_ms": 0.7, "prio": 120,
                "current": True, "deadline_v": 4103.5, "avg_vruntime": 4103.1},
    })

    out = svc.describe(100)
    thread = out["threads"][0]

    assert thread["eligible"] is True
    assert thread["vlag_ms"] == 16.905
    assert thread["nice"] == 0
    assert thread["on_cpu"] is True
    # The deadline is worth having as the distance to the runqueue's clock: it
    # is what EEVDF compares, and the raw virtual timestamp says nothing.
    assert thread["due_ms"] == 0.4
    assert out["scheduler"] == {"name": "EEVDF", "slice_ms": 0.7}


def test_a_sleeping_thread_is_given_no_lag_and_no_deadline(tmp_path, monkeypatch):
    """The kernel prints its task table per CPU, not per runqueue.

    A thread that went to sleep hours ago is still in that table, holding the
    vruntime it was frozen at, so V minus that grows for as long as it sleeps.
    Reporting it would put "owed 35,000,000 ms" against an idle kworker.
    """
    _thread(tmp_path, 100, 100, state="S")
    _thread(tmp_path, 100, 101, state="R")
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    _snapshots(tmp_path, monkeypatch, scheduled={
        "100": {"eligible": True, "vlag_ms": 35210010.846, "prio": 120,
                "slice_ms": 0.7, "deadline_v": 1.0, "avg_vruntime": 4103.1},
        "101": {"eligible": True, "vlag_ms": 0.9, "prio": 120, "slice_ms": 0.7,
                "deadline_v": 4103.4, "avg_vruntime": 4103.1},
    })

    by_tid = {t["tid"]: t for t in svc.describe(100)["threads"]}

    assert "vlag_ms" not in by_tid[100]
    assert "eligible" not in by_tid[100]
    assert "due_ms" not in by_tid[100]
    assert "on_cpu" not in by_tid[100]
    # The properties that hold whether or not it is queued still come through.
    assert by_tid[100]["nice"] == 0
    assert by_tid[101]["vlag_ms"] == 0.9
    assert by_tid[101]["due_ms"] == 0.3


def test_a_cfs_kernel_is_not_reported_as_eevdf(tmp_path, monkeypatch):
    """A pre-6.6 kernel prints a task table with no eligibility and no deadline.

    The collector parses no rows out of it, and an empty table is the evidence:
    the card is told the scheduler is unknown rather than shown an EEVDF column
    it can never fill.
    """
    _thread(tmp_path, 100, 100, state="R")
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    _snapshots(tmp_path, monkeypatch, scheduled={})

    out = svc.describe(100)

    assert out["sources"]["scheduler"]["available"] is True
    assert out["scheduler"]["name"] is None
    assert "eligible" not in out["threads"][0]


def test_without_a_collector_the_columns_are_absent_and_named_as_such(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    monkeypatch.setattr(svc, "SYSCALLS_SNAPSHOT", str(tmp_path / "nothing.json"))
    monkeypatch.setattr(svc, "TASKS_SNAPSHOT", str(tmp_path / "nothing.json"))
    monkeypatch.setattr(svc, "SCHED_DEBUG_SNAPSHOT", str(tmp_path / "nothing.json"))

    out = svc.describe(100)

    assert "parked_in" not in out["threads"][0]
    assert "eligible" not in out["threads"][0]
    assert out["sources"]["parked_in"]["reason"] == "no-collector"
    assert out["scheduler"]["name"] is None


def test_a_collector_from_before_the_thread_index_says_so(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    # The syscall collector is publishing, but no per-thread index beside it.
    _snapshots(tmp_path, monkeypatch)

    out = svc.describe(100)

    assert out["sources"]["parked_in"] == {"available": False, "reason": "no-thread-index"}


def test_a_stale_snapshot_is_refused(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    _snapshots(tmp_path, monkeypatch, parked={"100": {"name": "read"}})
    old = os.path.getmtime(tmp_path / "tasks.json") - 3600
    os.utime(tmp_path / "tasks.json", (old, old))

    out = svc.describe(100)

    assert out["sources"]["parked_in"]["reason"] == "stale"
    assert "parked_in" not in out["threads"][0]


def test_a_thread_that_exits_mid_read_is_skipped_not_faked(tmp_path, monkeypatch):
    _thread(tmp_path, 100, 100)
    (tmp_path / "100" / "task" / "101").mkdir()  # a task dir with no files left
    monkeypatch.setattr(svc, "PROC", str(tmp_path))

    out = svc.describe(100)

    assert [t["tid"] for t in out["threads"]] == [100]
