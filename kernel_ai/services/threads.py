"""Every thread of a process, and what the scheduler owes each one.

A process owns the memory and the descriptors; the thing Linux actually puts on
a CPU is the thread. ``/proc/<pid>/task/<tid>`` keeps the per-thread half of the
story and most of it is world-readable: the state, the CPU it last ran on, the
time it has spent running and — the number that decides how a machine feels —
the time it has spent runnable while something else held the CPU.

Two facts are not readable at this privilege and come from the root collectors
instead. The call a thread is parked in needs ptrace-level access to
``/proc/<pid>/task/<tid>/syscall``, so it is read out of the syscall snapshot.
The scheduler's own verdict — whether a thread is eligible for the CPU, and how
far its virtual clock has drifted from the fair one — lives in root-only
debugfs, so it is read out of the sched_debug snapshot. When a collector is not
running, those columns are missing rather than guessed, and the payload says
which ones and why.

That verdict is reported only for threads that are actually on a runqueue. The
kernel prints its task table per CPU rather than per runqueue, so a sleeping
thread appears there too, carrying the vruntime it was frozen at. Measuring
that against the runqueue's current fair clock produces a lag that grows for as
long as the thread sleeps — a kworker idle since boot would be shown as owed
hours of CPU. Lag and eligibility describe a place in a queue, so they are
attached to the threads that hold one and left off the rest.
"""

from __future__ import annotations

import json
import os
import time

PROC = "/proc"

SYSCALLS_SNAPSHOT = os.environ.get("SYSCALLS_OUT", "/run/kernel-ai/syscalls.json")
TASKS_SNAPSHOT = os.environ.get("TASKS_OUT", "/run/kernel-ai/tasks.json")
SCHED_DEBUG_SNAPSHOT = os.environ.get("SCHED_DEBUG_OUT", "/run/kernel-ai/sched_debug.json")
SNAPSHOT_MAX_AGE_S = 15.0

# A card is a card. Everything is counted, this is only how many get a row.
MAX_THREADS = 24

# task_state_to_char() in the kernel, spelled out.
STATE_LABEL = {
    "R": "on cpu or queued",
    "S": "sleeping, wakeable",
    "D": "uninterruptible wait",
    "T": "stopped",
    "t": "stopped by debugger",
    "X": "dead",
    "Z": "zombie",
    "P": "parked",
    "I": "idle kernel thread",
}


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _snapshot(path, max_age_s=SNAPSHOT_MAX_AGE_S):
    """A collector's snapshot, or why it cannot be used."""
    try:
        age = max(0.0, time.time() - os.path.getmtime(path))
    except OSError:
        return None, {"available": False, "reason": "no-collector"}
    if age > max_age_s:
        return None, {"available": False, "reason": "stale", "age_s": round(age, 1)}
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None, {"available": False, "reason": "unreadable"}
    if not isinstance(data, dict):
        return None, {"available": False, "reason": "malformed"}
    return data, {"available": True, "age_s": round(age, 1)}


def _stat(task_dir):
    """State and last CPU from ``stat``.

    The command sits in parentheses and may contain both spaces and brackets,
    so every field is counted from the last ``)`` rather than from the start.
    """
    line = _read(f"{task_dir}/stat")
    if not line:
        return {}
    _, _, tail = line.rpartition(") ")
    fields = tail.split()
    if not fields:
        return {}
    out = {"state": fields[0]}
    # Field 39 of the whole line is the CPU the task last ran on; counting from
    # the state, which is field 3, it is index 36.
    if len(fields) > 36:
        try:
            out["cpu"] = int(fields[36])
        except ValueError:
            pass
    return out


def _schedstat(task_dir):
    """``schedstat`` -> time on the CPU, time queued for it, and turns taken.

    The middle number is the one worth having: nanoseconds this thread spent
    runnable while the CPU was busy with something else.
    """
    parts = _read(f"{task_dir}/schedstat").split()
    try:
        return int(parts[0]), int(parts[1]), int(parts[2])
    except (IndexError, ValueError):
        return 0, 0, 0


def _switches(task_dir):
    """How this thread's turns on the CPU ended: it yielded, or it was taken."""
    vol = forced = None
    for line in _read(f"{task_dir}/status").splitlines():
        key, _, value = line.partition(":")
        value = value.strip()
        if not value.isdigit():
            continue
        if key == "voluntary_ctxt_switches":
            vol = int(value)
        elif key == "nonvoluntary_ctxt_switches":
            forced = int(value)
        if vol is not None and forced is not None:
            break
    return vol, forced


def _due_ms(sched):
    """How far the thread's virtual deadline is from the runqueue's clock.

    EEVDF picks the eligible thread with the earliest deadline, so this is the
    number the choice is made on: virtual ms until this thread's turn must have
    happened, negative once it is overdue.
    """
    deadline = sched.get("deadline_v")
    now = sched.get("avg_vruntime")
    if isinstance(deadline, (int, float)) and isinstance(now, (int, float)):
        return round(deadline - now, 3)
    return None


def _thread_ids(pid):
    try:
        return sorted(int(t) for t in os.listdir(f"{PROC}/{pid}/task") if t.isdigit())
    except OSError:
        return []


def _sort_key(thread):
    # The thread on a CPU first, then whoever has lived the busiest life.
    return (
        0 if thread["state"] == "R" else 1,
        -(thread["ran_ms"] + thread["waited_ms"]),
        thread["tid"],
    )


def describe(pid, max_threads=MAX_THREADS):
    """The threads of one process, as the kernel currently sees them."""
    pid = int(pid)
    tids = _thread_ids(pid)
    if not tids:
        return {"pid": pid, "error": "no such process"}

    parked_snap, parked_src = _snapshot(TASKS_SNAPSHOT)
    sched_snap, sched_src = _snapshot(SCHED_DEBUG_SNAPSHOT)
    scheduled = (sched_snap or {}).get("tasks") or {}
    parked = (parked_snap or {}).get("tasks")
    if not isinstance(parked, dict):
        parked = {}
        if parked_src.get("reason") == "no-collector" and _snapshot(SYSCALLS_SNAPSHOT)[1]["available"]:
            # The syscall collector is running, but from a build that publishes
            # no per-thread index. Different failure, different fix.
            parked_src = {"available": False, "reason": "no-thread-index"}
        elif parked_src["available"]:
            parked_src = {"available": False, "reason": "malformed"}

    threads = []
    leader_vol = leader_forced = None
    slice_ms = None

    for tid in tids:
        task_dir = f"{PROC}/{pid}/task/{tid}"
        stat = _stat(task_dir)
        if not stat:
            # It exited between the listing and the read.
            continue
        ran_ns, waited_ns, turns = _schedstat(task_dir)
        vol, forced = _switches(task_dir)
        if tid == pid:
            leader_vol, leader_forced = vol, forced

        row = {
            "tid": tid,
            "name": _read(f"{task_dir}/comm") or None,
            "leader": tid == pid,
            "state": stat.get("state", "?"),
            "state_label": STATE_LABEL.get(stat.get("state", ""), "unknown"),
            "cpu": stat.get("cpu"),
            "ran_ms": round(ran_ns / 1e6, 1),
            "waited_ms": round(waited_ns / 1e6, 1),
            "turns": turns,
            "voluntary": vol,
            "forced": forced,
        }

        call = parked.get(str(tid))
        if isinstance(call, dict):
            row["parked_in"] = call.get("name")
            row["wchan"] = call.get("wchan") or None
            row["fd"] = call.get("fd")
            row["fd_target"] = call.get("fd_target")

        sched = scheduled.get(str(tid))
        if isinstance(sched, dict):
            prio = sched.get("prio")
            if isinstance(prio, int):
                row["nice"] = prio - 120
            if slice_ms is None:
                slice_ms = sched.get("slice_ms")
            if row["state"] == "R":
                # Queued right now: the scheduler's numbers are about this
                # thread's turn, and the deadline is what EEVDF compares.
                row["on_cpu"] = bool(sched.get("current"))
                row["eligible"] = sched.get("eligible")
                row["vlag_ms"] = sched.get("vlag_ms")
                due = _due_ms(sched)
                if due is not None:
                    row["due_ms"] = due

        threads.append(row)

    threads.sort(key=_sort_key)

    totals = {
        "ran_ms": round(sum(t["ran_ms"] for t in threads), 1),
        "waited_ms": round(sum(t["waited_ms"] for t in threads), 1),
        "turns": sum(t["turns"] for t in threads),
        "voluntary": sum(t["voluntary"] or 0 for t in threads),
        "forced": sum(t["forced"] or 0 for t in threads),
        "on_cpu": sum(1 for t in threads if t["state"] == "R"),
        "parked": sum(1 for t in threads if t.get("parked_in")),
    }

    return {
        "pid": pid,
        "comm": _read(f"{PROC}/{pid}/comm") or None,
        "thread_count": len(threads),
        "cpus": os.cpu_count() or 1,
        "threads": threads[:max_threads],
        "totals": totals,
        # The collector only produces rows on a kernel that prints eligibility
        # and a deadline per task, so a snapshot with tasks in it is itself the
        # evidence that this kernel schedules with EEVDF. Older kernels run CFS,
        # which keeps none of those numbers, and the card then says so rather
        # than showing a column of blanks.
        "scheduler": {
            "name": "EEVDF" if scheduled else None,
            "slice_ms": slice_ms,
        },
        "sources": {"parked_in": parked_src, "scheduler": sched_src},
        # The dossier has always shown the leader's own counters under this
        # name; the per-process sums live in "totals" so neither number moves.
        "voluntary_ctxt_switches": leader_vol,
        "nonvoluntary_ctxt_switches": leader_forced,
    }
