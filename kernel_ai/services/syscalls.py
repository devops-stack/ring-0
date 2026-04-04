"""Syscall and kernel telemetry helpers."""

from __future__ import annotations

import os
import platform
from datetime import datetime


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


def get_real_system_calls(syscall_names, map_syscall_to_subsystem_fn, kernel_dna_max_procs, fallback_mock_calls_fn):
    """Sample blocked syscalls from /proc or fallback to vm/block/net counters."""
    try:
        if platform.system() != "Linux":
            return fallback_mock_calls_fn()

        try:
            proc_dirs = [d for d in os.listdir("/proc") if d.isdigit()]
        except PermissionError:
            proc_dirs = []

        sampled = sorted(proc_dirs, key=int)[: min(kernel_dna_max_procs, len(proc_dirs))]
        syscall_counts = {}
        for pid in sampled:
            try:
                syscall_path = f"/proc/{pid}/syscall"
                if not os.path.exists(syscall_path):
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
            except (PermissionError, FileNotFoundError, IOError, ValueError):
                continue

        if syscall_counts:
            syscalls = []
            for name, count in sorted(syscall_counts.items(), key=lambda x: x[1], reverse=True)[:20]:
                syscalls.append({"name": name, "count": count, "subsystem": map_syscall_to_subsystem_fn(name)})
            return syscalls

        merged = []
        merged.extend(_kernel_dna_vmstat_activity_nucleotides())
        merged.extend(_kernel_dna_block_device_activity_nucleotides())
        merged.extend(_kernel_dna_sockstat_activity_nucleotides())
        if merged:
            merged.sort(key=lambda x: x["count"], reverse=True)
            return merged[:20]
        return []
    except Exception:
        return [] if platform.system() == "Linux" else fallback_mock_calls_fn()


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
