"""Processes domain service extracted from ``webapp``.

This module intentionally keeps lightweight matrix/graph builders and delegates
heavier realtime/detail collection to ``processes_runtime``.
"""

from __future__ import annotations

from datetime import datetime
import math
import os

import psutil

from kernel_ai.services import processes_runtime as _runtime


def get_processes_basic_data() -> list[dict]:
    """Collect lightweight process list for generic process table endpoint."""
    processes = []
    for proc in psutil.process_iter(["pid", "name", "status", "memory_info"]):
        try:
            memory_info = proc.info.get("memory_info")
            memory_mb = (memory_info.rss / 1024 / 1024) if memory_info else 0.0
            processes.append(
                {
                    "pid": proc.info["pid"],
                    "name": proc.info.get("name"),
                    "status": proc.info.get("status"),
                    "memory_mb": round(memory_mb, 1),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    return processes


def get_proc_matrix_data() -> list[dict]:
    """Build Matrix view data (processes and resource usage)."""
    processes = []
    for proc in psutil.process_iter(
        ["pid", "name", "cpu_percent", "memory_info", "io_counters", "num_fds"]
    ):
        try:
            info = proc.info
            pid = info["pid"]

            cpu_percent = info.get("cpu_percent") or 0.0

            mem_mb = 0.0
            mem_info = info.get("memory_info")
            if mem_info:
                mem_mb = mem_info.rss / 1024 / 1024

            io_total_mb = 0.0
            io_counters = info.get("io_counters")
            if io_counters:
                io_total_mb = (io_counters.read_bytes + io_counters.write_bytes) / 1024 / 1024

            net_connections = 0
            tcp_path = f"/proc/{pid}/net/tcp"
            try:
                if os.path.exists(tcp_path):
                    with open(tcp_path, "r", encoding="utf-8", errors="ignore") as f:
                        lines = f.readlines()
                        net_connections = max(0, len(lines) - 1)
            except (IOError, PermissionError):
                pass

            num_fds = info.get("num_fds") or 0

            processes.append(
                {
                    "pid": pid,
                    "name": info.get("name") or "unknown",
                    "cpu": float(cpu_percent),
                    "mem": float(mem_mb),
                    "io": float(io_total_mb),
                    "net": int(net_connections),
                    "fd": int(num_fds),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    processes.sort(key=lambda p: p["cpu"], reverse=True)
    return processes[:20]


def get_processes_detailed_data() -> list[dict]:
    return _runtime.get_processes_detailed_data()


def collect_processes_realtime():
    """Collect process subsystem telemetry payload."""
    return _runtime.collect_processes_realtime()


def get_proc_graph_data():
    """Data for ``/api/proc-graph``."""
    matrix = get_proc_matrix_data()
    nodes = [{"id": "kernel", "type": "kernel", "label": "kernel", "x": 0.0, "y": 0.0, "z": 0.0}]
    edges = []
    for i, p in enumerate(matrix[:16]):
        angle = (2 * math.pi * i) / max(len(matrix[:16]), 1)
        r = 75.0
        pid = p.get("pid", i)
        nid = f"proc-{pid}"
        nodes.append(
            {
                "id": nid,
                "type": "process",
                "label": str(p.get("name", "process")),
                "x": r * math.cos(angle),
                "y": r * math.sin(angle),
                "z": 18.0 * math.sin(i * 0.45),
            }
        )
        edges.append({"from": nid, "to": "kernel"})
    return {"nodes": nodes, "edges": edges, "timestamp": datetime.now().isoformat()}
