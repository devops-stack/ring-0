"""Tests for ``kernel_ai.services.runqueue``."""

import json

import pytest

from kernel_ai.services import runqueue as svc


def _task(comm="worker", state="R", cpu=0, cgroup="/system.slice/app.service",
          vlag=0.5, deadline=100.4, avg=100.0, prio=120, current=False, slice_ms=0.7):
    row = {
        "comm": comm, "state": state, "cpu": cpu, "cgroup": cgroup,
        "vlag_ms": vlag, "deadline_v": deadline, "avg_vruntime": avg,
        "eligible": vlag >= 0, "prio": prio, "slice_ms": slice_ms,
        "switches": 12, "sum_exec_ms": 900.0,
    }
    if current:
        row["current"] = True
    return row


@pytest.fixture(autouse=True)
def _no_owner_lookup(monkeypatch, tmp_path):
    """Keep the service off this host's real /proc for owner resolution."""
    monkeypatch.setattr(svc, "PROC", str(tmp_path / "proc"))


def _snapshot(tmp_path, monkeypatch, tasks, cpus=None, reader_tid=None, loadavg=None):
    snap = tmp_path / "sched_debug.json"
    payload = {"ts": 0, "tasks": tasks, "cpus": cpus or {"0": {"nr_running": len(tasks)}}}
    if reader_tid is not None:
        payload["reader_tid"] = reader_tid
    snap.write_text(json.dumps(payload))
    monkeypatch.setattr(svc, "SCHED_DEBUG_SNAPSHOT", str(snap))

    proc = tmp_path / "proc"
    proc.mkdir(exist_ok=True)
    (proc / "loadavg").write_text(loadavg or "0.52 0.31 0.14 2/431 90210\n")


def test_only_runnable_tasks_are_in_the_queue(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, {
        "10": _task(comm="gunicorn", state="R"),
        "11": _task(comm="asleep", state="S"),
        "12": _task(comm="waiting-on-disk", state="D"),
    })

    out = svc.describe()

    assert out["queued"] == 1
    assert [r["comm"] for r in out["cpus"][0]["queue"]] == ["gunicorn"]
    # D is not queued for a CPU but every load average has counted it since 1993.
    assert out["uninterruptible"] == 1


def test_the_load_average_is_reported_with_the_kernels_live_count(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, {"10": _task()}, loadavg="1.50 0.90 0.40 3/512 4242\n")

    load = svc.describe()["load"]

    assert (load["avg1"], load["avg5"], load["avg15"]) == (1.5, 0.9, 0.4)
    assert load["running"] == 3
    assert load["total"] == 512


def test_the_task_on_the_cpu_heads_its_queue_and_the_rest_go_by_deadline(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, {
        "10": _task(comm="late", deadline=100.9),
        "11": _task(comm="running", deadline=100.8, current=True),
        "12": _task(comm="soon", deadline=100.2),
    })

    queue = svc.describe()["cpus"][0]["queue"]

    assert [r["comm"] for r in queue] == ["running", "soon", "late"]
    assert queue[1]["due_ms"] == 0.2


def test_the_next_task_is_named_when_one_queue_holds_the_competition(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, {
        "10": _task(comm="running", current=True),
        "11": _task(comm="soon", deadline=100.2),
        "12": _task(comm="later", deadline=100.6),
    })

    nxt = svc.describe()["cpus"][0]["next"]

    assert nxt == {"tid": 11, "exact": True, "reason": None}


def test_an_ineligible_task_is_not_named_next(tmp_path, monkeypatch):
    """Eligibility is the kernel's gate: a task in debt waits however near its
    deadline is."""
    _snapshot(tmp_path, monkeypatch, {
        "10": _task(comm="running", current=True),
        "11": _task(comm="in-debt", deadline=100.1, vlag=-3.0),
        "12": _task(comm="in-credit", deadline=100.5, vlag=2.0),
    })

    assert svc.describe()["cpus"][0]["next"]["tid"] == 12


def test_across_cgroups_the_pick_is_offered_but_not_claimed_as_exact(tmp_path, monkeypatch):
    """Each cgroup's cfs_rq keeps its own virtual clock.

    Comparing deadlines across two of them is not the comparison the kernel
    makes, and the group deadlines that would decide it are not printed.
    """
    _snapshot(tmp_path, monkeypatch, {
        "10": _task(comm="running", current=True),
        "11": _task(comm="ours", cgroup="/system.slice/app.service", deadline=100.2),
        # Its own queue keeps its own virtual clock, and 8000 is as near to its
        # own V as 100.2 is to ours.
        "12": _task(comm="theirs", cgroup="/user.slice", deadline=8000.4, avg=8000.0),
    })

    nxt = svc.describe()["cpus"][0]["next"]

    assert nxt["exact"] is False
    assert nxt["tid"] == 11
    assert "service queues first" in nxt["reason"]


def test_a_real_time_task_stops_the_question_being_answered(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, {
        "10": _task(comm="running", current=True),
        "11": _task(comm="irq/24-nvme", prio=49),
    })

    nxt = svc.describe()["cpus"][0]["next"]

    assert nxt["exact"] is False
    assert "real-time" in nxt["reason"]


def test_the_collector_is_marked_as_the_observer(tmp_path, monkeypatch):
    """Reading the file is work, so the reader is usually the task on the CPU."""
    _snapshot(tmp_path, monkeypatch, {
        "10": _task(comm="python3", current=True),
        "11": _task(comm="gunicorn"),
    }, reader_tid="10")

    out = svc.describe()
    by_tid = {r["tid"]: r for r in out["cpus"][0]["queue"]}

    assert out["observer_tid"] == 10
    assert by_tid[10]["observer"] is True
    assert by_tid[11]["observer"] is False


def test_queues_are_kept_apart_per_cpu(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, {
        "10": _task(comm="on-zero", cpu=0),
        "11": _task(comm="on-one", cpu=1),
    }, cpus={"0": {"nr_running": 1}, "1": {"nr_running": 1}})

    cpus = svc.describe()["cpus"]

    assert [c["cpu"] for c in cpus] == [0, 1]
    assert [len(c["queue"]) for c in cpus] == [1, 1]


def test_without_a_collector_the_queue_says_so_instead_of_being_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "SCHED_DEBUG_SNAPSHOT", str(tmp_path / "absent.json"))
    proc = tmp_path / "proc"
    proc.mkdir(exist_ok=True)
    (proc / "loadavg").write_text("0.10 0.20 0.30 1/100 5\n")

    out = svc.describe()

    assert out["source"] == {"available": False, "reason": "no-collector"}
    assert out["cpus"] == []
    assert out["scheduler"]["name"] is None
    # The load average needs no privilege, so it is still answered.
    assert out["load"]["avg1"] == 0.1


def test_a_stale_snapshot_is_refused(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, {"10": _task()})
    monkeypatch.setattr(svc, "SNAPSHOT_MAX_AGE_S", -1.0)

    out = svc.describe()

    assert out["source"]["available"] is False
    assert out["source"]["reason"] == "stale"


def test_the_unit_is_read_out_of_the_cgroup_path(tmp_path, monkeypatch):
    _snapshot(tmp_path, monkeypatch, {
        "10": _task(cgroup="/system.slice/kernel-ai.service"),
        "11": _task(cgroup="/"),
    })

    units = [r["unit"] for r in svc.describe()["cpus"][0]["queue"]]

    assert "kernel-ai.service" in units
    assert None in units
