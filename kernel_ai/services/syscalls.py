"""Syscall and kernel telemetry helpers."""

from __future__ import annotations

import json
import os
import platform
import time
from datetime import datetime

from kernel_ai.sentry_helpers import capture_exception

# A syscall row lists the processes parked in it. More than a dozen names is
# already unreadable, and the row keeps the honest total next to the list.
_MAX_WAITERS_PER_SYSCALL = 12

# Reading /proc/<pid>/syscall of a foreign task needs ptrace-level access, which
# the backend deliberately does not have. The root collector samples the whole
# machine instead and leaves the result here; see the unit file
# deploy/kernel-ai-syscall-snapshot.service.
_SYSCALLS_SNAPSHOT = os.environ.get("SYSCALLS_OUT", "/run/kernel-ai/syscalls.json")
_SNAPSHOT_MAX_AGE = 6.0


def _is_kernel_thread(pid):
    """A kernel thread has no command line, and makes no syscalls.

    Its /proc/<pid>/syscall still reads, as ``0 0x0 …``, and counting that
    invents a row for syscall number 0 with every kthread parked in it.
    """
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return not f.read(1)
    except OSError:
        return True


def _read_comm(pid):
    """Process name from /proc/<pid>/comm, or None if it just exited."""
    try:
        with open(f"/proc/{pid}/comm", "r", encoding="utf-8", errors="replace") as f:
            return f.read().strip() or None
    except (OSError, ValueError):
        return None


def _kernel_dna_read_proc_vmstat():
    """Parse /proc/vmstat into a dict of int counters."""
    vm = {}
    try:
        with open("/proc/vmstat", "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    vm[parts[0]] = int(parts[1])
    except (OSError, ValueError):
        pass
    return vm


def _kernel_dna_vmstat_activity_nucleotides():
    """Real VM counters when no per-task syscall sample is available."""
    result = []
    vm = _kernel_dna_read_proc_vmstat()
    mapping = [
        ("pgfault", "mm"),
        ("pgmajfault", "mm"),
        ("pswpin", "mm"),
        ("pswpout", "mm"),
        ("oom_kill", "mm"),
        ("nr_dirty", "mm"),
        ("nr_written", "mm"),
        ("pgscan_kswapd", "mm"),
        ("pgscan_direct", "mm"),
        ("workingset_refault", "mm"),
    ]
    for key, sub in mapping:
        if key in vm and vm[key] > 0:
            result.append({"name": f"vm:{key}", "count": vm[key], "subsystem": sub})
    return result


def _kernel_dna_block_device_activity_nucleotides():
    """Cumulative I/O from /sys/block/<dev>/stat."""
    result = []
    tr = tw = tsr = tsw = 0
    try:
        for name in os.listdir("/sys/block"):
            if name.startswith(("loop", "ram")):
                continue
            stat_path = os.path.join("/sys/block", name, "stat")
            if not os.path.isfile(stat_path):
                continue
            with open(stat_path, "r", encoding="utf-8", errors="replace") as f:
                st = f.read().split()
            if len(st) < 7:
                continue
            tr += int(st[0])
            tsr += int(st[2])
            tw += int(st[4])
            tsw += int(st[6])
    except (OSError, ValueError, IndexError):
        pass
    if tr > 0:
        result.append({"name": "disk:read_ios", "count": tr, "subsystem": "fs"})
    if tw > 0:
        result.append({"name": "disk:write_ios", "count": tw, "subsystem": "fs"})
    if tsr > 0:
        result.append({"name": "disk:sectors_read", "count": tsr, "subsystem": "fs"})
    if tsw > 0:
        result.append({"name": "disk:sectors_written", "count": tsw, "subsystem": "fs"})
    return result


def _kernel_dna_sockstat_activity_nucleotides():
    """Socket counts from /proc/net/sockstat."""
    result = []
    try:
        with open("/proc/net/sockstat", "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.split()
                if line.startswith("TCP:") and len(parts) >= 3:
                    result.append({"name": "net:tcp_inuse", "count": int(parts[2]), "subsystem": "net"})
                elif line.startswith("UDP:") and len(parts) >= 3:
                    result.append({"name": "net:udp_inuse", "count": int(parts[2]), "subsystem": "net"})
    except (OSError, ValueError, IndexError):
        pass
    return result


def read_snapshot():
    """The root collector's system-wide sample, if it is present and fresh.

    A stale file is worth less than nothing here — the panel would claim
    processes are parked in calls they left minutes ago — so anything older
    than a few sample intervals is discarded and the caller falls back to what
    it can see itself.
    """
    try:
        with open(_SYSCALLS_SNAPSHOT, "r", encoding="utf-8", errors="replace") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    ts = data.get("ts")
    try:
        age = time.time() - float(ts)
    except (TypeError, ValueError):
        return None
    if age > _SNAPSHOT_MAX_AGE:
        return None
    data["age"] = round(age, 2)
    return data


def get_syscall_sample(syscall_names, map_syscall_to_subsystem_fn, kernel_dna_max_procs, fallback_mock_calls_fn):
    """Rows of parked calls together with how honestly they were obtained.

    ``scope`` is the part callers must not lose: ``machine`` means the root
    collector answered and the rows cover every task on the box, ``self`` means
    only the backend's own processes were readable and the panel is looking at
    itself.
    """
    snapshot = read_snapshot()
    if snapshot and snapshot.get("syscalls"):
        # The collector deliberately leaves the subsystem out: it samples, and
        # naming things is the app's job.
        rows = snapshot["syscalls"]
        for row in rows:
            row["subsystem"] = map_syscall_to_subsystem_fn(row.get("name", ""))
        return {
            "syscalls": rows,
            "source": "collector",
            "scope": "machine",
            "tasks_total": snapshot.get("tasks_total"),
            "blocked_total": snapshot.get("blocked_total"),
            "age": snapshot.get("age"),
        }
    rows = _sample_visible_processes(
        syscall_names, map_syscall_to_subsystem_fn, kernel_dna_max_procs, fallback_mock_calls_fn
    )
    return {
        "syscalls": rows,
        "source": "backend",
        "scope": "self",
        "tasks_total": None,
        "blocked_total": sum(row.get("count", 0) for row in rows if isinstance(row.get("count"), int)),
        "age": 0.0,
    }


def get_real_system_calls(syscall_names, map_syscall_to_subsystem_fn, kernel_dna_max_procs, fallback_mock_calls_fn):
    """Just the rows, for callers that do not care how they were obtained."""
    return get_syscall_sample(
        syscall_names, map_syscall_to_subsystem_fn, kernel_dna_max_procs, fallback_mock_calls_fn
    )["syscalls"]


def _sample_visible_processes(syscall_names, map_syscall_to_subsystem_fn, kernel_dna_max_procs, fallback_mock_calls_fn):
    """Sample blocked syscalls from /proc or fallback to vm/block/net counters.

    Without ptrace-level access this only ever sees the backend's own
    processes, which is why the collector exists; this is what is left when it
    is not running.
    """
    try:
        if platform.system() != "Linux":
            return fallback_mock_calls_fn()

        try:
            proc_dirs = [d for d in os.listdir("/proc") if d.isdigit()]
        except PermissionError:
            proc_dirs = []

        sampled = sorted(proc_dirs, key=int)[: min(kernel_dna_max_procs, len(proc_dirs))]
        syscall_counts = {}
        syscall_waiters = {}
        syscall_numbers = {}
        for pid in sampled:
            try:
                syscall_path = f"/proc/{pid}/syscall"
                if not os.path.exists(syscall_path):
                    continue
                if _is_kernel_thread(pid):
                    continue
                with open(syscall_path, "r", encoding="utf-8", errors="replace") as f:
                    line = f.read().strip()
                if not line or line in ("-1", "running"):
                    continue
                parts = line.split()
                if not parts:
                    continue
                try:
                    syscall_num = int(parts[0])
                except ValueError:
                    continue
                syscall_name = syscall_names.get(syscall_num, f"syscall_{syscall_num}")
                syscall_counts[syscall_name] = syscall_counts.get(syscall_name, 0) + 1
                syscall_numbers[syscall_name] = syscall_num
                # Keep who is parked here: the count is a set of processes, and the
                # UI opens the dossier of any of them by pid.
                waiters = syscall_waiters.setdefault(syscall_name, [])
                if len(waiters) < _MAX_WAITERS_PER_SYSCALL:
                    waiters.append({"pid": int(pid), "comm": _read_comm(pid)})
            except (PermissionError, FileNotFoundError, IOError, ValueError):
                continue

        if syscall_counts:
            syscalls = []
            for name, count in sorted(syscall_counts.items(), key=lambda x: x[1], reverse=True)[:20]:
                syscalls.append({
                    "name": name,
                    "nr": syscall_numbers.get(name),
                    "count": count,
                    "subsystem": map_syscall_to_subsystem_fn(name),
                    "waiters": syscall_waiters.get(name, []),
                })
            return syscalls

        merged = []
        merged.extend(_kernel_dna_vmstat_activity_nucleotides())
        merged.extend(_kernel_dna_block_device_activity_nucleotides())
        merged.extend(_kernel_dna_sockstat_activity_nucleotides())
        if merged:
            merged.sort(key=lambda x: x["count"], reverse=True)
            return merged[:20]
        return []
    except Exception as exc:
        capture_exception(exc, where="services.syscalls.get_real_system_calls")
        return [] if platform.system() == "Linux" else fallback_mock_calls_fn()


# One process can park hundreds of threads in a call; past this the list stops
# being readable and the honest total is reported beside it.
_MAX_TASK_CALLS = 48


def _read_proc_io(pid):
    """syscr/syscw of a task: how many read and write calls it has ever made.

    These are counters the kernel keeps per task, so a difference between two
    samples is a real count of calls made in between — the closest thing to
    "what is it calling" that is readable without ptrace.
    """
    out = {}
    try:
        with open(f"/proc/{pid}/io", "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                key, _, value = line.partition(":")
                if key in ("syscr", "syscw", "rchar", "wchar"):
                    out[key] = int(value.strip())
    except (OSError, ValueError):
        return {}
    return out


def _read_proc_ctxt(pid):
    """Voluntary and forced context switches — world-readable, unlike the rest."""
    out = {}
    try:
        with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.startswith("voluntary_ctxt_switches"):
                    out["voluntary"] = int(line.split(":")[1].strip())
                elif line.startswith("nonvoluntary_ctxt_switches"):
                    out["forced"] = int(line.split(":")[1].strip())
    except (OSError, ValueError, IndexError):
        return {}
    return out


def read_process_calls(pid, syscall_names, max_calls=_MAX_TASK_CALLS):
    """What one process is calling, at the two levels the kernel will show us.

    The name of the call a thread is parked in comes from /proc/<pid>/syscall,
    which needs ptrace-level access and is therefore closed for most processes
    on a box with ptrace_scope set. The *counts* of read and write calls in
    /proc/<pid>/io are not, so a process that will not tell us what it is
    parked in will still tell us how many calls it has made. The two are
    reported separately: a missing name is not a quiet process.
    """
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return {"readable": False, "reason": "bad pid"}

    io = _read_proc_io(pid)
    ctxt = _read_proc_ctxt(pid)
    base = {"readable": bool(io or ctxt), "io": io, "ctxt": ctxt}
    if not base["readable"]:
        return {"readable": False, "reason": "process is gone or closed to us"}

    task_dir = f"/proc/{pid}/task"
    try:
        tids = sorted(os.listdir(task_dir), key=int)
    except (OSError, ValueError):
        return dict(base, calls_readable=False, reason="task list not readable", calls=[])

    calls = []
    parked = 0
    denied = 0
    for tid in tids:
        try:
            with open(f"{task_dir}/{tid}/syscall", "r", encoding="utf-8", errors="replace") as fh:
                line = fh.read().strip()
        except PermissionError:
            denied += 1
            continue
        except (OSError, ValueError):
            continue
        if not line or line in ("-1", "running"):
            continue
        head = line.split()
        try:
            nr = int(head[0])
        except (IndexError, ValueError):
            continue
        parked += 1
        if len(calls) >= max_calls:
            continue
        calls.append({
            "tid": int(tid),
            "comm": _read_comm(tid),
            "nr": nr,
            "name": syscall_names.get(nr, f"syscall_{nr}"),
        })
    if denied and not calls:
        return dict(
            base,
            calls_readable=False,
            reason="ptrace scope hides what it is parked in",
            calls=[],
            threads=len(tids),
        )
    return dict(
        base,
        calls_readable=True,
        reason=None,
        calls=calls,
        parked=parked,
        threads=len(tids),
    )


def get_softirq_nucleotides(map_interrupt_to_subsystem_fn, limit=8):
    """Per-vector softirq totals from /proc/softirqs."""
    out = []
    try:
        with open("/proc/softirqs", "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        if len(lines) < 2:
            return out
        for line in lines[1 : 1 + limit]:
            parts = line.split()
            if len(parts) < 2:
                continue
            vec = parts[0].rstrip(":")
            total = sum(int(x) for x in parts[1:] if x.isdigit())
            if total > 0:
                out.append(
                    {
                        "type": "interrupt",
                        "code": "T",
                        "name": f"softirq:{vec}",
                        "count": total,
                        "subsystem": map_interrupt_to_subsystem_fn(vec),
                        "timestamp": datetime.now().isoformat(),
                    }
                )
    except (OSError, ValueError):
        pass
    return out
