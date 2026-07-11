"""Scheduler (EEVDF) + PELT telemetry sourced from ``/proc/<pid>/sched``.

Exposes the *real* Per-Entity Load Tracking signals — ``util_avg`` /
``load_avg`` / ``runnable_avg`` and their geometric ``*_sum`` accumulators —
plus EEVDF bookkeeping (``vruntime``, time ``slice``, weight from nice, and
context-switch counters) for the busiest tasks. It also ships the PELT
decay-kernel constants so the UI can draw the exact EWMA that produces
``util_avg`` (mathematically identical to the EWMA used for the Kernel DNA
z-score).

Nothing here attacks or perturbs the kernel; it only reads procfs.
"""

import json
import os
import time
from datetime import datetime, timezone

# --- PELT constants (mirror kernel/sched/pelt.c) -------------------------------
# The signal decays one period every ~1024us, halving every 32 periods, i.e.
# y = 0.5 ** (1/32). LOAD_AVG_MAX is the asymptotic value of the geometric
# sum used to normalise the *_sum accumulators into the 0..1024 *_avg range.
HALF_LIFE_PERIODS = 32
PERIOD_US = 1024
DECAY_Y = 2.0 ** (-1.0 / HALF_LIFE_PERIODS)  # ~= 0.9785720620877
LOAD_AVG_MAX = 47742
SCHED_FIXEDPOINT_SHIFT = 10  # se.load.weight is nice-weight << 10 on 64-bit
CAPACITY = 1024
NICE_0_WEIGHT = 1024  # weight of a nice-0 task (used to scale real time -> virtual time)

# Optional snapshot written by the (root) sched_debug collector. It carries the
# EEVDF fields that only live in root-only debugfs: per-task eligibility (E/N),
# virtual deadline, and the runqueue's avg_vruntime (V) needed for lag.
SCHED_DEBUG_SNAPSHOT = os.environ.get("SCHED_DEBUG_OUT", "/run/kernel-ai/sched_debug.json")
SCHED_DEBUG_MAX_AGE_S = 15.0

# kernel/sched/core.c sched_prio_to_weight[], nice -20..+19
PRIO_TO_WEIGHT = [
    88761, 71755, 56483, 46273, 36291,
    29154, 23254, 18705, 14949, 11916,
    9548, 7620, 6100, 4904, 3906,
    3121, 2501, 1991, 1586, 1277,
    1024, 820, 655, 526, 423,
    335, 272, 215, 172, 137,
    110, 87, 70, 56, 45,
    36, 29, 23, 18, 15,
]

# States we treat as "on the runqueue / competing for the CPU".
RUNNABLE_STATES = {"R"}


def _read_sched_file(pid):
    """Parse ``/proc/<pid>/sched`` ("key : value" lines) into a dict."""
    out = {}
    try:
        with open(f"/proc/{pid}/sched", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if ":" in line:
                    key, _, val = line.partition(":")
                    out[key.strip()] = val.strip()
    except (OSError, ValueError):
        return None
    return out


def _fnum(mapping, key, default=0.0):
    try:
        return float(mapping.get(key, default))
    except (TypeError, ValueError):
        return default


def _read_comm(pid):
    try:
        with open(f"/proc/{pid}/comm", "r", encoding="utf-8", errors="ignore") as fh:
            return fh.read().strip() or "?"
    except OSError:
        return "?"


def _read_state(pid):
    """First char of the process state from ``/proc/<pid>/stat`` (after comm)."""
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8", errors="ignore") as fh:
            data = fh.read()
        rparen = data.rfind(")")
        rest = data[rparen + 2:].split()
        return rest[0] if rest else "?"
    except (OSError, IndexError):
        return "?"


def _read_schedstat(pid):
    """``/proc/<pid>/schedstat`` -> (on_cpu_ns, wait_ns, timeslices)."""
    try:
        with open(f"/proc/{pid}/schedstat", "r", encoding="utf-8", errors="ignore") as fh:
            parts = fh.read().split()
        return int(parts[0]), int(parts[1]), int(parts[2])
    except (OSError, ValueError, IndexError):
        return 0, 0, 0


def _loadavg():
    try:
        with open("/proc/loadavg", "r", encoding="utf-8", errors="ignore") as fh:
            return [float(x) for x in fh.read().split()[:3]]
    except (OSError, ValueError):
        return [0.0, 0.0, 0.0]


def _read_sched_debug_snapshot(path=None, max_age_s=SCHED_DEBUG_MAX_AGE_S):
    """Read the EEVDF snapshot written by the root sched_debug collector.

    Returns ``{"available": bool, "tasks": {pid: {...}}, ...}``. When the
    collector is not running the caller keeps only the client-computable
    virtual deadline and marks lag/eligibility as unavailable.
    """
    snap = path or SCHED_DEBUG_SNAPSHOT
    try:
        age = max(0.0, time.time() - os.path.getmtime(snap))
    except OSError:
        return {"available": False, "reason": "no-collector"}
    if age > max_age_s:
        return {"available": False, "reason": "stale", "age_s": round(age, 1)}
    try:
        with open(snap, "r", encoding="utf-8", errors="ignore") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return {"available": False, "reason": "unreadable"}
    if not isinstance(data, dict):
        return {"available": False, "reason": "malformed"}
    data["available"] = True
    data["age_s"] = round(age, 1)
    return data


def _build_task(pid, sd):
    prio = int(_fnum(sd, "prio", 120))
    nice = max(-20, min(19, prio - 120))
    weight_raw = _fnum(sd, "se.load.weight")
    weight = weight_raw / (1 << SCHED_FIXEDPOINT_SHIFT) if weight_raw else float(PRIO_TO_WEIGHT[nice + 20])
    on_cpu_ns, wait_ns, slices = _read_schedstat(pid)
    state = _read_state(pid)
    vruntime = _fnum(sd, "se.vruntime")
    slice_ms = _fnum(sd, "se.slice") / 1e6
    # Real->virtual time scaling: a request of length `slice` costs
    # slice * NICE_0_WEIGHT / weight in virtual time. Higher weight (lower nice)
    # => smaller virtual slice => earlier virtual deadline => scheduled sooner.
    vslice_ms = slice_ms * NICE_0_WEIGHT / weight if weight else slice_ms
    deadline_v = vruntime + vslice_ms
    return {
        "pid": pid,
        "comm": _read_comm(pid),
        "state": state,
        "runnable": state in RUNNABLE_STATES,
        # PELT signals (0..1024 range; 1024 == a full CPU of the resource)
        "util_avg": round(_fnum(sd, "se.avg.util_avg"), 1),
        "load_avg": round(_fnum(sd, "se.avg.load_avg"), 1),
        "runnable_avg": round(_fnum(sd, "se.avg.runnable_avg"), 1),
        "util_est": round(_fnum(sd, "se.avg.util_est"), 1),
        "util_sum": int(_fnum(sd, "se.avg.util_sum")),
        "load_sum": int(_fnum(sd, "se.avg.load_sum")),
        # EEVDF bookkeeping
        "vruntime": round(vruntime, 3),
        "slice_ms": round(slice_ms, 3),
        "vslice_ms": round(vslice_ms, 4),
        "deadline_v": round(deadline_v, 3),
        "weight": round(weight, 0),
        "nice": nice,
        "prio": prio,
        "policy": int(_fnum(sd, "policy", 0)),
        # activity counters
        "nr_switches": int(_fnum(sd, "nr_switches")),
        "nr_voluntary": int(_fnum(sd, "nr_voluntary_switches")),
        "nr_involuntary": int(_fnum(sd, "nr_involuntary_switches")),
        "sum_exec_ms": round(_fnum(sd, "se.sum_exec_runtime"), 1),
        "on_cpu_ms": round(on_cpu_ns / 1e6, 1),
        "wait_ms": round(wait_ns / 1e6, 1),
        "timeslices": slices,
    }


def collect_scheduler_pelt(top_n=14):
    """Return real EEVDF/PELT telemetry for the busiest ``top_n`` tasks."""
    prelim = []
    try:
        entries = os.listdir("/proc")
    except OSError:
        entries = []
    for entry in entries:
        if not entry.isdigit():
            continue
        pid = int(entry)
        sd = _read_sched_file(pid)
        if not sd:
            continue
        prelim.append((pid, sd))

    # Rank by recent activity so the view surfaces the tasks actually using the
    # CPU: util_avg first, then load_avg, then raw context switches.
    prelim.sort(
        key=lambda it: (
            _fnum(it[1], "se.avg.util_avg"),
            _fnum(it[1], "se.avg.load_avg"),
            _fnum(it[1], "nr_switches"),
        ),
        reverse=True,
    )

    tasks = [_build_task(pid, sd) for pid, sd in prelim[:top_n]]

    # Enrich with kernel-exact EEVDF fields from the sched_debug collector, when
    # available (eligibility E/N, kernel virtual deadline, and lag = V - vruntime).
    snap = _read_sched_debug_snapshot()
    snap_tasks = snap.get("tasks") or {} if snap.get("available") else {}
    for t in tasks:
        row = snap_tasks.get(str(t["pid"])) or snap_tasks.get(t["pid"])
        if isinstance(row, dict):
            t["eligible"] = bool(row.get("eligible"))
            t["vlag_ms"] = row.get("vlag_ms")
            t["avg_vruntime"] = row.get("avg_vruntime")
            t["k_deadline_v"] = row.get("deadline_v")
            t["k_vruntime_v"] = row.get("vruntime_v")
            t["cgroup"] = row.get("cgroup")
    eevdf = {
        "source": "kernel" if snap.get("available") else "computed",
        "reason": snap.get("reason"),
        "age_s": snap.get("age_s"),
        "nice_0_weight": NICE_0_WEIGHT,
    }

    # EEVDF (6.6+) exposes se.slice; older kernels run CFS without it.
    scheduler = "EEVDF" if any("se.slice" in sd for _, sd in prelim[:top_n]) else "CFS"

    # Decay kernel y^0..y^(N-1): the weight each past 1ms period contributes to
    # the current average. ~96 periods spans ~3 half-lives.
    n_bars = 96
    kernel_weights = [round(DECAY_Y ** i, 5) for i in range(n_bars)]

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "scheduler": scheduler,
        "cpus": os.cpu_count() or 1,
        "loadavg": _loadavg(),
        "task_count": len(prelim),
        "pelt": {
            "y": round(DECAY_Y, 7),
            "half_life_ms": HALF_LIFE_PERIODS,
            "period_us": PERIOD_US,
            "load_avg_max": LOAD_AVG_MAX,
            "capacity": CAPACITY,
            "kernel_weights": kernel_weights,
        },
        "eevdf": eevdf,
        "tasks": tasks,
    }
