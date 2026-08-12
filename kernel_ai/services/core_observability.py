"""Core observability helpers extracted from webapp."""

from __future__ import annotations

import logging
import platform
import sys
import time

import psutil

from kernel_ai.logging_helpers import log_event

logger = logging.getLogger(__name__)

# Cached counters for per-second I/O pulse deltas (vmstat + disk_io + net + irq).
_IO_PULSE_PREV = {"ts": None, "vmstat": {}, "disk": None, "net": None, "intr": None}

# CPU time, I/O wait and throughput are rates, so subsystem load needs its own
# baseline between polls. Kept separate from _IO_PULSE_PREV: the two are read on
# different endpoints at different rhythms, and a shared baseline would leave both
# dividing by the wrong interval.
_SUBSYSTEM_PREV = {"ts": None, "cpu": None, "disk": None, "net": None, "net_peak": 0.0}

# A throughput meter needs a full-scale mark. The busiest second we have seen sets
# it, decaying slowly so one burst does not flatten the bar for the rest of uptime.
_NET_SCALE_FLOOR = 64 * 1024
_NET_SCALE_DECAY = 0.97


def get_system_info():
    """Get system information."""
    return {
        "platform": platform.system(),
        "kernel": platform.release(),
        "python_version": platform.python_version(),
        "cpu_count": psutil.cpu_count(),
        "memory_total": psutil.virtual_memory().total,
    }


def get_mock_system_calls():
    """Mock data for system calls."""
    return [
        {"name": "read", "count": "166 643218"},
        {"name": "write", "count": "964 016161"},
        {"name": "open", "count": "972 983879"},
        {"name": "close", "count": "989 612075"},
        {"name": "mmap", "count": "819 540732"},
        {"name": "fork", "count": "512 826219"},
        {"name": "execve", "count": "025 461491"},
        {"name": "socket", "count": "838 475394"},
        {"name": "connect", "count": "632 094939"},
        {"name": "accept", "count": "417 205788"},
    ]


def _subsystem(metric, usage, value, unit, detail=None, detail_unit=None, processes=0, warming=False):
    """One subsystem row: a meter fill plus the number the meter stands for."""
    return {
        "status": "active",
        "usage": int(max(0, min(100, round(usage)))),
        "processes": int(processes),
        "metric": metric,
        "value": value,
        "unit": unit,
        "detail": detail,
        "detail_unit": detail_unit,
        "warming": warming,
    }


def get_mock_kernel_subsystems():
    """Mock data for kernel subsystems (non-Linux hosts have no /proc to read)."""
    return {
        "memory_management": _subsystem("memory_used", 75, 75.0, "percent", 12884901888, "bytes"),
        "process_scheduler": _subsystem("cpu_busy", 85, 85.0, "percent", 45, "runnable", processes=45),
        "file_system": _subsystem("io_wait", 6, 6.0, "percent", 1048576, "bytes_per_sec"),
        "network_stack": _subsystem("net_throughput", 50, 524288.0, "bytes_per_sec", 12, "sockets", processes=12),
    }


def _read_cpu_times():
    """Aggregate jiffies from the /proc/stat cpu line."""
    try:
        with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("cpu "):
                    return [int(part) for part in line.split()[1:]]
    except (OSError, ValueError):
        pass
    return None


def _read_memory_used():
    """Bytes in use and total, the way free(1) counts them."""
    try:
        with open("/proc/meminfo", "r", encoding="utf-8", errors="ignore") as f:
            info = {}
            for line in f:
                key, _, value = line.partition(":")
                value = value.strip().replace(" kB", "")
                if value.isdigit():
                    info[key.strip()] = int(value) * 1024
        total = info.get("MemTotal", 0)
        available = info.get("MemAvailable", 0)
        if total > 0:
            return total - available, total
    except (OSError, ValueError):
        pass
    return 0, 0


def _read_loadavg():
    """Runnable processes now, plus the 1/5/15 minute load averages."""
    try:
        with open("/proc/loadavg", "r", encoding="utf-8", errors="ignore") as f:
            parts = f.read().split()
            runnable = int(parts[3].split("/")[0])
            return runnable, [float(parts[0]), float(parts[1]), float(parts[2])]
    except (OSError, ValueError, IndexError):
        return 0, []


def _read_tcp_inuse():
    """TCP sockets currently in use, from /proc/net/sockstat."""
    try:
        with open("/proc/net/sockstat", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("TCP:"):
                    parts = line.split()
                    return int(parts[parts.index("inuse") + 1])
    except (OSError, ValueError, IndexError):
        pass
    return 0


def _read_mount_count():
    """Mounted filesystems, from /proc/mounts."""
    try:
        with open("/proc/mounts", "r", encoding="utf-8", errors="ignore") as f:
            return sum(1 for line in f if line.strip() and not line.startswith("#"))
    except OSError:
        return 0


def get_kernel_subsystem_status():
    """Real load per kernel subsystem, read from /proc.

    CPU time, I/O wait and network throughput are rates, so they are measured as
    deltas between polls. The first call after start only lays down the baseline
    and marks those three as warming rather than inventing a number for them.
    """
    try:
        if platform.system() != "Linux":
            return get_mock_kernel_subsystems()

        now = time.time()
        cpu = _read_cpu_times()
        try:
            disk = psutil.disk_io_counters()
        except (psutil.Error, OSError):
            disk = None
        try:
            net = psutil.net_io_counters()
        except (psutil.Error, OSError):
            net = None

        prev_ts = _SUBSYSTEM_PREV["ts"]
        prev_cpu = _SUBSYSTEM_PREV["cpu"]
        prev_disk = _SUBSYSTEM_PREV["disk"]
        prev_net = _SUBSYSTEM_PREV["net"]
        net_peak = _SUBSYSTEM_PREV["net_peak"]

        dt = max(0.001, now - prev_ts) if prev_ts else 0.0

        # Memory is a level, not a rate, so it is honest from the very first call.
        used_bytes, total_bytes = _read_memory_used()
        memory_pct = (used_bytes / total_bytes * 100) if total_bytes else 0.0

        cpu_busy = None
        io_wait = None
        if cpu and prev_cpu and len(cpu) == len(prev_cpu):
            delta = [now_v - prev_v for now_v, prev_v in zip(cpu, prev_cpu)]
            total_jiffies = sum(delta)
            if total_jiffies > 0:
                idle_jiffies = delta[3]
                iowait_jiffies = delta[4] if len(delta) > 4 else 0
                # Waiting on a disk is not the CPU being busy, so iowait is its own
                # number and is excluded from the busy share.
                cpu_busy = (total_jiffies - idle_jiffies - iowait_jiffies) / total_jiffies * 100
                io_wait = iowait_jiffies / total_jiffies * 100

        disk_bytes_s = None
        if disk is not None and prev_disk is not None and dt:
            moved = (disk.read_bytes - prev_disk.read_bytes) + (disk.write_bytes - prev_disk.write_bytes)
            disk_bytes_s = max(0.0, moved / dt)

        net_bytes_s = None
        if net is not None and prev_net is not None and dt:
            moved = (net.bytes_sent - prev_net.bytes_sent) + (net.bytes_recv - prev_net.bytes_recv)
            net_bytes_s = max(0.0, moved / dt)
            net_peak = max(net_bytes_s, net_peak * _NET_SCALE_DECAY, _NET_SCALE_FLOOR)

        _SUBSYSTEM_PREV.update({"ts": now, "cpu": cpu, "disk": disk, "net": net, "net_peak": net_peak})

        runnable, load_avg = _read_loadavg()
        tcp_inuse = _read_tcp_inuse()

        return {
            "memory_management": _subsystem(
                "memory_used", memory_pct, round(memory_pct, 1), "percent",
                used_bytes, "bytes",
            ),
            "process_scheduler": dict(
                _subsystem(
                    "cpu_busy", cpu_busy or 0, round(cpu_busy, 1) if cpu_busy is not None else None, "percent",
                    runnable, "runnable",
                    processes=runnable, warming=cpu_busy is None,
                ),
                load=load_avg,
            ),
            "file_system": _subsystem(
                "io_wait", io_wait or 0, round(io_wait, 1) if io_wait is not None else None, "percent",
                round(disk_bytes_s) if disk_bytes_s is not None else None, "bytes_per_sec",
                processes=_read_mount_count(), warming=io_wait is None,
            ),
            "network_stack": _subsystem(
                "net_throughput",
                (net_bytes_s / net_peak * 100) if net_bytes_s is not None and net_peak else 0,
                round(net_bytes_s) if net_bytes_s is not None else None, "bytes_per_sec",
                tcp_inuse, "sockets",
                processes=tcp_inuse, warming=net_bytes_s is None,
            ),
        }
    except (OSError, ValueError, KeyError, psutil.Error) as exc:
        log_event(
            logger,
            "DEBUG",
            "Failed to build kernel subsystem status, using mock",
            event_dataset="kernel_ai.app",
            component="services.core_observability",
            operation="get_kernel_subsystem_status",
            event_data={"error": str(exc)},
        )
        return get_mock_kernel_subsystems()


def _read_vmstat():
    """Parse /proc/vmstat into an int dict."""
    out = {}
    try:
        with open("/proc/vmstat", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                key, _, value = line.partition(" ")
                value = value.strip()
                if value.isdigit():
                    out[key] = int(value)
    except (OSError, ValueError):
        pass
    return out


def _read_intr_total():
    """Total hardware interrupts serviced since boot (from /proc/stat)."""
    try:
        with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("intr "):
                    return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return 0


def _io_pulse_zero():
    return {
        "pgfault_per_sec": 0,
        "pgmajfault_per_sec": 0,
        "pswpin_per_sec": 0,
        "pswpout_per_sec": 0,
        "disk_read_mb_s": 0.0,
        "disk_write_mb_s": 0.0,
        "disk_read_iops": 0,
        "disk_write_iops": 0,
        "net_mb_s": 0.0,
        "intr_per_sec": 0,
    }


def get_io_pulse():
    """Per-second deltas for memory (page faults/swaps) and block I/O.

    Stateful: the first call establishes a baseline and returns zeros.
    """
    try:
        if platform.system() != "Linux":
            return _io_pulse_zero()

        now = time.time()
        vmstat = _read_vmstat()
        try:
            disk = psutil.disk_io_counters()
        except (psutil.Error, OSError):
            disk = None
        try:
            net = psutil.net_io_counters()
        except (psutil.Error, OSError):
            net = None
        intr = _read_intr_total()

        prev = _IO_PULSE_PREV
        prev_ts = prev.get("ts")
        prev_vm = prev.get("vmstat") or {}
        prev_disk = prev.get("disk")
        prev_net = prev.get("net")
        prev_intr = prev.get("intr")

        # Update cache for next call.
        _IO_PULSE_PREV["ts"] = now
        _IO_PULSE_PREV["vmstat"] = vmstat
        _IO_PULSE_PREV["disk"] = disk
        _IO_PULSE_PREV["net"] = net
        _IO_PULSE_PREV["intr"] = intr

        if prev_ts is None:
            return _io_pulse_zero()

        dt = max(0.001, now - prev_ts)

        def vm_rate(key):
            delta = vmstat.get(key, 0) - prev_vm.get(key, 0)
            return max(0, int(delta / dt))

        result = {
            "pgfault_per_sec": vm_rate("pgfault"),
            "pgmajfault_per_sec": vm_rate("pgmajfault"),
            "pswpin_per_sec": vm_rate("pswpin"),
            "pswpout_per_sec": vm_rate("pswpout"),
            "disk_read_mb_s": 0.0,
            "disk_write_mb_s": 0.0,
            "disk_read_iops": 0,
            "disk_write_iops": 0,
        }

        if disk is not None and prev_disk is not None:
            result["disk_read_mb_s"] = round(max(0.0, (disk.read_bytes - prev_disk.read_bytes) / dt) / (1024 * 1024), 3)
            result["disk_write_mb_s"] = round(max(0.0, (disk.write_bytes - prev_disk.write_bytes) / dt) / (1024 * 1024), 3)
            result["disk_read_iops"] = max(0, int((disk.read_count - prev_disk.read_count) / dt))
            result["disk_write_iops"] = max(0, int((disk.write_count - prev_disk.write_count) / dt))

        if net is not None and prev_net is not None:
            net_delta = (net.bytes_sent - prev_net.bytes_sent) + (net.bytes_recv - prev_net.bytes_recv)
            result["net_mb_s"] = round(max(0.0, net_delta / dt) / (1024 * 1024), 3)

        if prev_intr is not None:
            result["intr_per_sec"] = max(0, int((intr - prev_intr) / dt))

        return result
    except (OSError, ValueError, psutil.Error) as exc:
        log_event(
            logger,
            "DEBUG",
            "Failed to build io pulse",
            event_dataset="kernel_ai.app",
            component="services.core_observability",
            operation="get_io_pulse",
            event_data={"error": str(exc)},
        )
        return _io_pulse_zero()


def get_mock_process_kernel_map():
    """Mock data for process mapping."""
    return {
        "systemd": ["kernel/sched/core.c", "kernel/time/timekeeping.c"],
        "sshd": ["kernel/security/security.c", "kernel/audit/audit.c"],
        "nginx": ["kernel/net/socket.c", "kernel/net/core/sock.c"],
        "python3": ["kernel/fs/read_write.c", "kernel/mm/memory.c"],
        "bash": ["kernel/exec.c", "kernel/fork.c"],
        "cron": ["kernel/time/timer.c", "kernel/sched/clock.c"],
    }


def get_process_kernel_map(openai_available=False, openai_module=None):
    """Get process to kernel subsystem mapping."""
    try:
        if not openai_available:
            return get_mock_process_kernel_map()
        if openai_module is None or not hasattr(openai_module, "api_key") or not openai_module.api_key:
            return get_mock_process_kernel_map()
        return get_mock_process_kernel_map()
    except (AttributeError, OSError, ValueError):
        return get_mock_process_kernel_map()


def get_mock_nginx_files():
    """Mock data for nginx files."""
    return [
        {"path": "nginx/nginx.conf", "type": "config"},
        {"path": "nginx/sites-enabled/default", "type": "config"},
        {"path": "nginx/conf.d/default.conf", "type": "config"},
        {"path": "nginx/logs/access.log", "type": "log"},
        {"path": "nginx/logs/error.log", "type": "log"},
    ]


def _classify_io_file_path(path):
    """Classify an open-file path into a coarse filesystem category."""
    low = path.lower()
    if "/var/log/" in low or low.endswith(".log"):
        return "log"
    if "/etc/" in low or low.endswith(
        (".conf", ".cfg", ".ini", ".yaml", ".yml", ".json", ".toml")
    ):
        return "config"
    if low.endswith(".so") or ".so." in low or "/lib/" in low or "/lib64/" in low:
        return "lib"
    if "/dev/" in low:
        return "device"
    if low.endswith((".db", ".sqlite", ".sqlite3")) or "/var/lib/" in low:
        return "data"
    return "other"


def _io_open_files_mock():
    """Mock data for the system-wide open-files I/O layer."""
    return [
        {"path": "/lib/x86_64-linux-gnu/libc.so.6", "type": "lib", "activity": 14,
         "process": "gunicorn", "process_count": 9, "pids": []},
        {"path": "/etc/nginx/nginx.conf", "type": "config", "activity": 6,
         "process": "nginx", "process_count": 3, "pids": []},
        {"path": "/var/log/nginx/access.log", "type": "log", "activity": 5,
         "process": "nginx", "process_count": 2, "pids": []},
        {"path": "/var/lib/postgresql/data/base", "type": "data", "activity": 4,
         "process": "postgres", "process_count": 2, "pids": []},
        {"path": "/var/log/syslog", "type": "log", "activity": 3,
         "process": "rsyslogd", "process_count": 1, "pids": []},
        {"path": "/etc/ssl/certs/ca-certificates.crt", "type": "config", "activity": 2,
         "process": "python3", "process_count": 1, "pids": []},
    ]


def get_io_open_files(limit=40, max_procs=600):
    """Aggregate open files across processes ranked by how widely they're held.

    "Activity" is approximated by the number of open handles to a path across the
    system, which surfaces hot/shared files (libs, configs, logs) for the
    KERNEL I/O LAYER visualization. Returns a list sorted by activity desc.
    """
    try:
        counts = {}
        scanned = 0
        for proc in psutil.process_iter(["pid", "name"]):
            if scanned >= max_procs:
                break
            scanned += 1
            try:
                open_files = proc.open_files()
            except (psutil.NoSuchProcess, psutil.AccessDenied, OSError):
                continue
            name = proc.info.get("name") or ""
            pid = proc.info.get("pid")
            for file in open_files:
                path = getattr(file, "path", None)
                if not path:
                    continue
                rec = counts.get(path)
                if rec is None:
                    rec = {
                        "path": path,
                        "type": _classify_io_file_path(path),
                        "count": 0,
                        "procs": set(),
                        "pids": set(),
                    }
                    counts[path] = rec
                rec["count"] += 1
                if name:
                    rec["procs"].add(name)
                if pid is not None:
                    rec["pids"].add(pid)

        if not counts:
            return _io_open_files_mock()

        ranked = sorted(counts.values(), key=lambda r: r["count"], reverse=True)[:limit]
        result = []
        for rec in ranked:
            procs = sorted(rec["procs"])
            result.append(
                {
                    "path": rec["path"],
                    "type": rec["type"],
                    "activity": rec["count"],
                    "process": procs[0] if procs else "",
                    "process_count": len(procs),
                    "pids": sorted(rec["pids"])[:32],
                }
            )
        return result
    except (psutil.Error, OSError, ValueError) as exc:
        log_event(
            logger,
            "DEBUG",
            "Failed to aggregate system open files, using mock",
            event_dataset="kernel_ai.app",
            component="services.core_observability",
            operation="get_io_open_files",
            event_data={"error": str(exc)},
        )
        return _io_open_files_mock()


def get_nginx_open_files():
    """Get open files for Nginx process."""
    try:
        nginx_processes = []
        for proc in psutil.process_iter(["pid", "name", "open_files"]):
            try:
                if proc.info["name"] and "nginx" in proc.info["name"].lower():
                    nginx_processes.append(proc.info["pid"])
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        if not nginx_processes:
            return get_mock_nginx_files()

        proc = psutil.Process(nginx_processes[0])
        open_files = proc.open_files()
        files = []
        for file in open_files:
            if not file.path:
                continue
            if "/etc/nginx/" in file.path:
                rel_path = file.path.split("/etc/nginx/")[-1]
                files.append({"path": f"nginx/{rel_path}", "type": "config"})
            elif "/var/log/nginx/" in file.path:
                rel_path = file.path.split("/var/log/nginx/")[-1]
                files.append({"path": f"nginx/logs/{rel_path}", "type": "log"})
            else:
                files.append({"path": file.path, "type": "other"})
        return files[:10]
    except (psutil.Error, OSError, ValueError) as exc:
        log_event(
            logger,
            "DEBUG",
            "Failed to read nginx open files, using mock",
            event_dataset="kernel_ai.app",
            component="services.core_observability",
            operation="get_nginx_open_files",
            event_data={"error": str(exc)},
        )
        return get_mock_nginx_files()
