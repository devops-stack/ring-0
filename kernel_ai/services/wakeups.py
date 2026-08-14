"""Who woke whom, over a sampled window of the scheduler's work.

Every other view in this project reads a state that is simply there for the
asking. This one cannot: a wakeup leaves nothing behind. One task makes another
runnable, the scheduler moves on, and the only trace is the tracepoint the
kernel fires at that instant. A root collector samples it — see
``deploy/ebpf/wakeup_collector.py`` — and this module shapes what it caught.

Two honest limits are carried through into the payload rather than smoothed
over. The window is short and periodic, so the numbers are a sample of the
machine's waking, not a census of it. And the sampler is itself a task: reading
files wakes the things that serve them, so the collector's own thread is marked
wherever it appears.

The vocabulary is worth keeping straight. A wakeup from *task* context is one
piece of software deciding another should run — a lock released, a message
written, a child spawned. A wakeup from *hardirq* context is the hardware
saying so: a packet landed, a disk finished, a timer expired. Which of the two
dominates says more about what a machine is doing than any load average.
"""

from __future__ import annotations

import json
import os
import time

SNAPSHOT = os.environ.get("WAKEUPS_OUT", "/run/kernel-ai/wakeups.json")
SNAPSHOT_MAX_AGE_S = 30.0
MAX_EDGES = 12

CONTEXT_MEANS = {
    "task": "one task deciding another should run",
    "softirq": "deferred kernel work — the network and timer path",
    "hardirq": "the hardware itself, through an interrupt",
}


def _snapshot(path=None, max_age_s=None):
    snap = path or SNAPSHOT
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


def _unit(pid):
    """The service a pid belongs to, if systemd owns it."""
    if not pid:
        return None
    try:
        with open(f"/proc/{pid}/cgroup", "r", encoding="utf-8", errors="ignore") as fh:
            text = fh.read()
    except OSError:
        return None
    for part in text.strip().split("/"):
        if part.endswith(".service") or part.endswith(".scope"):
            return part
    return None


def _named(row):
    """A rolled-up end of the window, with tid 0 spelled as an idle cpu."""
    if not row:
        return row
    if row.get("tid") == 0 or row.get("comm") == "<idle>":
        return dict(row, comm="idle cpu", idle=True)
    return dict(row, idle=False)


def _side(edge, prefix):
    """One end of an edge: the thread, its process, and what kind of thing it is."""
    tid = edge.get(f"{prefix}tid")
    comm = edge.get(f"{prefix}comm")
    pid = edge.get(f"{prefix}pid")
    kernel = edge.get(f"{prefix}kernel")
    # Tid 0 is not a task at all. It is the CPU with nothing to run, and the
    # kernel books an interrupt's wakeup against it.
    idle = tid == 0 or comm == "<idle>"
    return {
        "tid": tid,
        "comm": "idle cpu" if idle else comm,
        "pid": pid,
        "kernel": bool(kernel),
        "idle": idle,
        "unit": _unit(pid) if pid and not kernel else None,
    }


def _why(edge, contexts):
    """The plainest true sentence about how this wakeup happened."""
    where = max(contexts, key=contexts.get) if contexts else "task"
    if edge["waker"]["idle"]:
        return "an interrupt arriving while the cpu had nothing to run"
    if where == "hardirq":
        return "an interrupt, taken while this waker happened to be running"
    if where == "softirq":
        return "deferred kernel work on the waker's back"
    if edge.get("new"):
        return "a task starting for the first time"
    return "the waker itself, in ordinary code"


def describe(max_edges=MAX_EDGES):
    """The wakeups seen in the last sampled window."""
    snap, source = _snapshot()
    out = {
        "available": source.get("available", False),
        "source": source,
        "window_s": None,
        "events": 0,
        "edges": [],
    }
    if not snap:
        return out

    window = float(snap.get("window_s") or 0) or None
    events = int(snap.get("events") or 0)
    contexts = snap.get("contexts") or {}
    observer = snap.get("observer_tid")

    edges = []
    for raw in (snap.get("edges") or [])[:max_edges]:
        edge = {
            "waker": _side(raw, "waker_"),
            "woken": _side(raw, ""),
            "count": int(raw.get("count") or 0),
            "contexts": raw.get("contexts") or {},
            "new": bool(raw.get("new")),
        }
        edge["waker"]["observer"] = edge["waker"]["tid"] == observer
        edge["woken"]["observer"] = edge["woken"]["tid"] == observer
        edge["why"] = _why(edge, edge["contexts"])
        edges.append(edge)

    out.update({
        "window_s": window,
        "events": events,
        "rate_per_s": round(events / window) if window else None,
        "lost": int(snap.get("lost") or 0),
        "distinct_edges": int(snap.get("distinct_edges") or 0),
        "contexts": {name: {"count": count, "means": CONTEXT_MEANS.get(name)}
                     for name, count in contexts.items() if count},
        "edges": edges,
        "wakers": [_named(row) for row in (snap.get("wakers") or [])[:6]],
        "wakees": [_named(row) for row in (snap.get("wakees") or [])[:6]],
        "observer_tid": observer,
    })
    return out


def for_thread(tid, max_edges=6):
    """Who was seen waking this one thread — the empirical answer to a wait.

    A thread parked on a lock is woken by whoever released it. The kernel keeps
    no record of the owner of an ordinary futex, but a wakeup observed in the
    window names the thread that actually did it.
    """
    snap, source = _snapshot()
    if not snap:
        return {"tid": int(tid), "available": False, "source": source, "wakers": []}
    tid = int(tid)
    rows = []
    for raw in snap.get("edges") or []:
        if raw.get("tid") != tid:
            continue
        rows.append({"waker": _side(raw, "waker_"), "count": int(raw.get("count") or 0),
                     "contexts": raw.get("contexts") or {}})
    rows.sort(key=lambda row: -row["count"])
    return {
        "tid": tid,
        "available": True,
        "source": source,
        "window_s": snap.get("window_s"),
        "wakers": rows[:max_edges],
    }
