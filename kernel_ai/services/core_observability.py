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


def get_mock_kernel_subsystems():
    """Mock data for kernel subsystems."""
    return {
        "memory_management": {"status": "active", "usage": 75, "processes": 25},
        "process_scheduler": {"status": "active", "usage": 85, "processes": 45},
        "file_system": {"status": "active", "usage": 60, "processes": 15},
        "network_stack": {"status": "active", "usage": 50, "processes": 12},
    }


def get_kernel_subsystem_status():
    """Get real kernel subsystem status from /proc filesystem."""
    try:
        if platform.system() != "Linux":
            return get_mock_kernel_subsystems()

        subsystems = {}

        try:
            with open("/proc/meminfo", "r", encoding="utf-8", errors="ignore") as f:
                meminfo = {}
                for line in f:
                    if ":" in line:
                        key, value = line.split(":", 1)
                        meminfo[key.strip()] = value.strip()
                mem_total_kb = int(meminfo.get("MemTotal", "0").replace(" kB", ""))
                mem_available_kb = int(meminfo.get("MemAvailable", "0").replace(" kB", ""))
                active_kb = int(meminfo.get("Active", "0").replace(" kB", ""))
                memory_usage = int(((mem_total_kb - mem_available_kb) / mem_total_kb) * 100) if mem_total_kb > 0 else 0
                processes_estimate = max(10, min(100, active_kb // 50000))
                subsystems["memory_management"] = {"status": "active", "usage": memory_usage, "processes": processes_estimate}
        except (IOError, ValueError, KeyError):
            subsystems["memory_management"] = {"status": "active", "usage": 75, "processes": 25}

        try:
            with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
                cpu_usage = 0
                for line in f:
                    if line.startswith("cpu "):
                        parts = line.split()
                        if len(parts) >= 5:
                            user_time = int(parts[1])
                            system_time = int(parts[3])
                            idle_time = int(parts[4])
                            total_time = user_time + system_time + idle_time
                            cpu_usage = int(((user_time + system_time) / total_time) * 100) if total_time > 0 else 0
                        break
                scheduler_usage = min(100, max(50, cpu_usage))
                try:
                    with open("/proc/loadavg", "r", encoding="utf-8", errors="ignore") as f:
                        loadavg = f.read().strip().split()
                        running_processes = int(float(loadavg[3].split("/")[0]))
                except (OSError, ValueError, IndexError, psutil.Error):
                    running_processes = len(psutil.pids()) if "psutil" in sys.modules else 50
                subsystems["process_scheduler"] = {"status": "active", "usage": scheduler_usage, "processes": running_processes}
        except (IOError, ValueError, KeyError):
            subsystems["process_scheduler"] = {"status": "active", "usage": 85, "processes": 45}

        try:
            with open("/proc/mounts", "r", encoding="utf-8", errors="ignore") as f:
                mount_count = len([line for line in f if line.strip() and not line.startswith("#")])
            try:
                with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
                    fs_usage = 60
                    for line in f:
                        if line.startswith("cpu "):
                            parts = line.split()
                            fs_usage = min(100, max(20, int(parts[5]) // 100)) if len(parts) >= 6 else 60
                            break
            except (OSError, ValueError, IndexError):
                fs_usage = 60
            fs_processes = max(5, min(50, mount_count * 2))
            subsystems["file_system"] = {"status": "active", "usage": fs_usage, "processes": fs_processes}
        except (IOError, ValueError):
            subsystems["file_system"] = {"status": "active", "usage": 60, "processes": 15}

        try:
            network_usage = 30
            network_processes = 8
            try:
                with open("/proc/net/sockstat", "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if line.startswith("TCP:"):
                            parts = line.split()
                            try:
                                inuse_idx = parts.index("inuse") + 1 if "inuse" in parts else -1
                                alloc_idx = parts.index("alloc") + 1 if "alloc" in parts else -1
                                tcp_inuse = int(parts[inuse_idx]) if 0 < inuse_idx < len(parts) else 0
                                tcp_alloc = int(parts[alloc_idx]) if 0 < alloc_idx < len(parts) else tcp_inuse + 10
                                network_usage = min(100, max(20, int((tcp_inuse / tcp_alloc) * 100))) if tcp_alloc > 0 else 30
                                network_processes = max(8, min(50, tcp_inuse // 2))
                            except (ValueError, IndexError):
                                network_usage = 30
                                network_processes = 12
                            break
            except FileNotFoundError:
                try:
                    with open("/proc/net/tcp", "r", encoding="utf-8", errors="ignore") as f:
                        tcp_connections = len([line for line in f if line.strip() and not line.startswith("sl")])
                    network_usage = min(100, max(20, tcp_connections // 10))
                    network_processes = max(8, min(50, tcp_connections // 5))
                except (OSError, ValueError, IndexError):
                    pass
            subsystems["network_stack"] = {"status": "active", "usage": network_usage, "processes": network_processes}
        except (IOError, ValueError):
            subsystems["network_stack"] = {"status": "active", "usage": 50, "processes": 12}

        return subsystems
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
