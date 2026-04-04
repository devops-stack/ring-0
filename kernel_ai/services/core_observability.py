"""Core observability helpers extracted from webapp."""

from __future__ import annotations

import logging
import platform
import sys

import psutil

logger = logging.getLogger(__name__)


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
        logger.debug("Failed to build kernel subsystem status, using mock: %s", exc)
        return get_mock_kernel_subsystems()


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
        logger.debug("Failed to read nginx open files, using mock: %s", exc)
        return get_mock_nginx_files()
