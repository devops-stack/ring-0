"""Who is competing for a CPU right now, and who the kernel would take next.

A load average is the length of this queue, averaged: every five seconds the
kernel counts the tasks that are runnable or in an uninterruptible wait and
folds that count into three exponential averages. The number says how crowded
the machine has been; it never says who was in the crowd. This service answers
the second question for the instant of the last snapshot.

The queue itself is read from the sched_debug snapshot rather than from
``/proc``: every row there was printed in one pass over one runqueue, so the
vruntimes, deadlines and eligibility flags are comparable with each other. The
same table assembled from separate ``/proc`` reads would be a collage of
different instants, and a queue is exactly the thing that arithmetic across
instants gets wrong.

Two limits are stated rather than papered over. Reading debugfs is work, so the
task holding the CPU at the instant of a snapshot is nearly always the collector
itself; that row is marked as the observer instead of being dropped or passed
off as the machine's load. And when runnable tasks sit in different cgroups, the
kernel chooses between the groups before it chooses inside one, using group
deadlines that this file does not print — so the next task is named only when
one queue holds the whole competition.
"""

from __future__ import annotations

import json
import os
import time

PROC = "/proc"
SCHED_DEBUG_SNAPSHOT = os.environ.get("SCHED_DEBUG_OUT", "/run/kernel-ai/sched_debug.json")
SNAPSHOT_MAX_AGE_S = 15.0

# Below MAX_RT_PRIO the task is in a real-time class, which is served whole
# before the fair queue is looked at at all.
MAX_RT_PRIO = 100

# A queue is short by nature; anything longer is a machine in trouble and the
# card says how many it did not draw.
MAX_ROWS = 14


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def _snapshot(path=None, max_age_s=None):
    snap = path or SCHED_DEBUG_SNAPSHOT
    max_age_s = SNAPSHOT_MAX_AGE_S if max_age_s is None else max_age_s
    try:
        age = max(0.0, time.time() - os.path.getmtime(snap))
    except OSError:
        return None, {"available": False, "reason": "no-collector"}
    if age > max_age_s:
        return None, {"available": False, "reason": "stale", "age_s": round(age, 1)}
    try:
        with open(snap, "r", encoding="utf-8", errors="ignore") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None, {"available": False, "reason": "unreadable"}
    if not isinstance(data, dict):
        return None, {"available": False, "reason": "malformed"}
    return data, {"available": True, "age_s": round(age, 1)}


def _loadavg():
    """``/proc/loadavg``: the three averages, then runnable/total right now.

    The fourth field is the kernel's own live count, so it is worth keeping
    beside the named rows: it is current where the snapshot is a second old.
    """
    parts = _read(f"{PROC}/loadavg").split()
    out = {"avg1": None, "avg5": None, "avg15": None, "running": None, "total": None}
    try:
        out["avg1"], out["avg5"], out["avg15"] = (float(x) for x in parts[:3])
    except (IndexError, ValueError):
        return out
    if len(parts) > 3 and "/" in parts[3]:
        running, _, total = parts[3].partition("/")
        if running.isdigit() and total.isdigit():
            out["running"], out["total"] = int(running), int(total)
    return out


def _owner(tid):
    """The process a thread belongs to, from its world-readable status."""
    pid = name = None
    for line in _read(f"{PROC}/{tid}/status").splitlines():
        key, _, value = line.partition(":")
        value = value.strip()
        if key == "Name":
            name = value
        elif key == "Tgid" and value.isdigit():
            pid = int(value)
        if pid is not None and name is not None:
            break
    return pid, name


def _unit(cgroup):
    """The systemd unit a cgroup path ends in, which is the readable half."""
    path = (cgroup or "").strip()
    if not path or path == "/":
        return None
    last = path.rstrip("/").rsplit("/", 1)[-1]
    return last or None


def _row(tid, task, observer_tid):
    prio = task.get("prio")
    rt = isinstance(prio, int) and prio < MAX_RT_PRIO
    pid, process = _owner(tid)
    row = {
        "tid": int(tid),
        "pid": pid,
        "comm": task.get("comm"),
        "process": process,
        "cgroup": task.get("cgroup"),
        "unit": _unit(task.get("cgroup")),
        "cpu": task.get("cpu"),
        "current": bool(task.get("current")),
        "observer": str(tid) == str(observer_tid),
        "eligible": task.get("eligible"),
        "vlag_ms": task.get("vlag_ms"),
        "switches": task.get("switches"),
        "sum_exec_ms": task.get("sum_exec_ms"),
        "rt": rt,
    }
    if isinstance(prio, int):
        row["nice"] = prio - 120
    deadline, now = task.get("deadline_v"), task.get("avg_vruntime")
    if isinstance(deadline, (int, float)) and isinstance(now, (int, float)):
        row["due_ms"] = round(deadline - now, 3)
    return row


def _order(row):
    # The task on the CPU heads its queue; the rest by the deadline the
    # scheduler compares, and a row without one goes last rather than first.
    due = row.get("due_ms")
    return (0 if row["current"] else 1, due if isinstance(due, (int, float)) else 1e18)


def _next_in(queue):
    """The task this runqueue would take next, when that can be said exactly.

    Inside one cfs_rq the rule is the kernel's own: of the eligible entities,
    the earliest virtual deadline wins. Across cgroups the same comparison is
    meaningless — each has its own virtual clock — and the group deadlines that
    would decide it are not printed, so the question is left open.
    """
    waiting = [r for r in queue if not r["current"]]
    if not waiting:
        return None
    if any(r["rt"] for r in waiting):
        return {"tid": None, "exact": False, "reason": "real-time task outranks the fair queue"}
    groups = {r.get("cgroup") for r in queue}
    ready = [r for r in waiting if r.get("eligible") and isinstance(r.get("due_ms"), (int, float))]
    if not ready:
        return {"tid": None, "exact": False, "reason": "nothing eligible in the snapshot"}
    pick = min(ready, key=lambda r: r["due_ms"])
    if len(groups) > 1:
        # systemd gives every service its own cgroup, so this is the normal
        # case on a modern machine rather than an exotic one.
        return {"tid": pick["tid"], "exact": False,
                "reason": "the kernel picks between service queues first"}
    return {"tid": pick["tid"], "exact": True, "reason": None}


def describe(max_rows=MAX_ROWS):
    """The runqueues of this machine at the instant of the last snapshot."""
    snap, source = _snapshot()
    load = _loadavg()
    tasks = (snap or {}).get("tasks") or {}
    observer = (snap or {}).get("reader_tid")

    rows, blocked, slice_ms = [], 0, None
    for tid, task in tasks.items():
        if not isinstance(task, dict):
            continue
        state = task.get("state")
        if state == "D":
            # Not queued for a CPU, but counted by every load average since
            # 1993, which is most of why a load can outgrow the processors.
            blocked += 1
            continue
        if state != "R":
            continue
        if slice_ms is None and isinstance(task.get("slice_ms"), (int, float)):
            slice_ms = task["slice_ms"]
        rows.append(_row(tid, task, observer))

    by_cpu = {}
    for row in rows:
        by_cpu.setdefault(row["cpu"], []).append(row)

    snap_cpus = (snap or {}).get("cpus") or {}
    cpus = []
    for cpu in sorted(by_cpu, key=lambda c: (c is None, c)):
        queue = sorted(by_cpu[cpu], key=_order)
        meta = snap_cpus.get(str(cpu)) if isinstance(snap_cpus, dict) else None
        cpus.append({
            "cpu": cpu,
            "nr_running": (meta or {}).get("nr_running"),
            "queued": len(queue),
            "next": _next_in(queue),
            "queue": queue[:max_rows],
            "hidden": max(0, len(queue) - max_rows),
        })

    return {
        "load": load,
        "cpu_count": os.cpu_count() or 1,
        # Rows only parse on a kernel that prints eligibility and a deadline,
        # so a snapshot with tasks in it is the evidence of EEVDF itself.
        "scheduler": {"name": "EEVDF" if tasks else None, "slice_ms": slice_ms},
        "queued": len(rows),
        "uninterruptible": blocked,
        "observer_tid": int(observer) if str(observer or "").isdigit() else None,
        "cpus": cpus,
        "source": source,
    }
