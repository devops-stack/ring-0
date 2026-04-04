"""Runtime process telemetry builders.

This module holds heavier process collection logic to keep ``processes.py``
focused on lightweight matrix/graph APIs.
"""

from __future__ import annotations

from datetime import datetime
import os

import psutil


def get_processes_detailed_data() -> list[dict]:
    """Collect detailed process list for process visualization UI."""
    processes = []
    fields = ["pid", "name", "status", "memory_info", "cpu_percent", "num_threads", "num_fds"]
    for proc in psutil.process_iter(fields):
        try:
            memory_info = proc.info.get("memory_info")
            if memory_info is None:
                continue
            memory_mb = float(memory_info.rss) / 1024 / 1024

            num_fds = proc.info.get("num_fds")
            if num_fds is None or num_fds == 0:
                try:
                    pid = proc.info["pid"]
                    fd_dir = f"/proc/{pid}/fd"
                    if os.path.exists(fd_dir):
                        num_fds = len([f for f in os.listdir(fd_dir) if f.isdigit()])
                    else:
                        num_fds = 0
                except (OSError, PermissionError):
                    num_fds = 0
            if num_fds is None:
                num_fds = 0

            process_name = proc.info.get("name") or f'pid-{proc.info.get("pid", "unknown")}'
            try:
                cmdline = proc.cmdline()
                if cmdline and len(cmdline) > 0:
                    if cmdline[0] == "nginx:" and len(cmdline) > 1:
                        process_name = f"nginx: {cmdline[1]}"
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                pass

            cmdline_str = ""
            try:
                cmdline = proc.cmdline()
                if cmdline:
                    cmdline_str = " ".join(cmdline)
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                pass

            processes.append(
                {
                    "pid": proc.info["pid"],
                    "name": process_name,
                    "cmdline": cmdline_str,
                    "status": proc.info.get("status", "unknown"),
                    "memory_mb": round(memory_mb, 1),
                    "cpu_percent": round(float(proc.info.get("cpu_percent", 0) or 0), 1),
                    "num_threads": int(proc.info.get("num_threads", 0) or 0),
                    "num_fds": int(num_fds or 0),
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception:
            continue
    return processes


def _parse_meminfo_kb():
    out = {}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    out[parts[0].rstrip(":")] = int(parts[1])
    except Exception:
        pass
    return out


def _memory_strip_blocks(kind, kb_k, mem_total_kb, n_blocks, seed0):
    mem_total_kb = max(1, int(mem_total_kb))
    kb_k = max(0, int(kb_k))
    weights = []
    for i in range(n_blocks):
        v = (((seed0 + i * 104729) % 1000) + 40) / 1040.0
        weights.append(v)
    sw = sum(weights)
    share = kb_k / float(mem_total_kb)
    blocks = []
    for i in range(n_blocks):
        w = weights[i] / sw
        heat = min(1.0, 0.05 + min(0.92, share * 2.0) + (((seed0 + i * 31) % 15) / 120.0))
        blocks.append({"w": round(w, 6), "heat": round(heat, 4), "kind": kind})
    return blocks


def _build_memory_visual_rows(meminfo_kb, syscall_nodes, vm, swap):
    mi = meminfo_kb or {}
    mt = max(1, int(mi.get("MemTotal") or 0))
    if mt <= 1:
        try:
            mt = max(1, int(getattr(vm, "total", 0) / 1024))
        except Exception:
            mt = 1

    seed_base = (mt % 100000) + int(mi.get("Active", 0) or 0) % 50000
    row_specs = [
        ("buffers", "buffers", mi.get("Buffers", 0)),
        ("cached", "page cache", mi.get("Cached", 0)),
        ("anon", "anonymous (heap/stack)", mi.get("AnonPages", 0)),
    ]
    if mi.get("SReclaimable") is not None and mi.get("SUnreclaim") is not None:
        row_specs.append(("sreclaim", "slab reclaimable", mi.get("SReclaimable", 0)))
        row_specs.append(("sunreclaim", "slab unreclaimable", mi.get("SUnreclaim", 0)))
    else:
        row_specs.append(("slab", "slab / kmalloc", mi.get("Slab", 0)))
    row_specs.extend([("shmem", "shmem / tmpfs", mi.get("Shmem", 0)), ("mapped", "file mappings", mi.get("Mapped", 0))])
    dirty_wb = int(mi.get("Dirty", 0) or 0) + int(mi.get("Writeback", 0) or 0) + int(mi.get("WritebackTmp", 0) or 0)
    if dirty_wb > 0:
        row_specs.append(("dirty_wb", "dirty + writeback", dirty_wb))
    ah = int(mi.get("AnonHugePages", 0) or 0)
    if ah > 0:
        row_specs.append(("anon_huge", "transparent huge pages (anon)", ah))
    shm_h = int(mi.get("ShmemHugePages", 0) or 0)
    if shm_h > 0:
        row_specs.append(("shmem_huge", "huge pages (shmem)", shm_h))
    vmu = int(mi.get("VmallocUsed", 0) or 0)
    if vmu > 0:
        row_specs.append(("vmalloc", "vmalloc used", vmu))
    ac = int(mi.get("Active", 0) or 0)
    iac = int(mi.get("Inactive", 0) or 0)
    if ac > 0:
        row_specs.append(("active", "active (LRU)", ac))
    if iac > 0:
        row_specs.append(("inactive", "inactive (LRU)", iac))
    swap_tot = int(mi.get("SwapTotal", 0) or 0)
    swap_free = int(mi.get("SwapFree", 0) or 0)
    swap_used = max(0, swap_tot - swap_free)
    if swap_tot > 0:
        row_specs.append(("swap", "swap occupied", swap_used))

    pt = int(mi.get("PageTables", 0) or 0)
    ks = int(mi.get("KernelStack", 0) or 0)
    if pt + ks > 0:
        row_specs.append(("kmeta", "pagetables + kernel stacks", pt + ks))

    rows = []
    for sk, label, kb in row_specs:
        kb = int(kb or 0)
        if kb <= 0 and sk != "swap":
            continue
        if sk == "swap" and kb <= 0:
            continue
        sk_seed = sum(ord(c) for c in sk) * 31 + len(sk)
        n_blocks = 22 + (seed_base % 11) + (sk_seed % 9)
        seed0 = seed_base + (sk_seed % 100000)
        blocks = _memory_strip_blocks(sk, kb, mt, n_blocks, seed0)
        rows.append({"id": sk, "label": label, "kb": kb, "pct_of_ram": round(100.0 * kb / float(mt), 2) if mt else 0.0, "blocks": blocks})

    top_tasks = sorted(syscall_nodes, key=lambda x: int(x.get("rss_bytes") or 0), reverse=True)[:6]
    if top_tasks:
        tr_bytes = sum(int(x.get("rss_bytes") or 0) for x in top_tasks) or 1
        tr_kb = max(1, int(tr_bytes / 1024))
        task_blocks = []
        for p in top_tasks:
            rss = int(p.get("rss_bytes") or 0)
            if rss <= 0:
                continue
            w = rss / float(tr_bytes)
            mp = float(p.get("memory_percent") or 0.0)
            heat = min(1.0, 0.2 + (mp / 100.0) * 0.75 + (rss / float(tr_bytes)) * 0.15)
            task_blocks.append({"w": round(w, 6), "heat": round(heat, 4), "kind": "task", "pid": int(p.get("pid") or 0), "name": str(p.get("name") or "")[:14]})
        if task_blocks:
            sw = sum(b["w"] for b in task_blocks)
            if sw > 0:
                for b in task_blocks:
                    b["w"] = round(b["w"] / sw, 6)
            rows.append({"id": "tasks", "label": "sampled tasks RSS (top)", "kb": tr_kb, "pct_of_ram": round(100.0 * tr_kb / float(mt), 2) if mt else 0.0, "blocks": task_blocks})

    sr_kb = int(mi.get("SReclaimable", 0) or 0)
    su_kb = int(mi.get("SUnreclaim", 0) or 0)
    slab_total_kb = int(mi.get("Slab", 0) or 0) or (sr_kb + su_kb)
    summary = {
        "total_mb": round(mt / 1024.0, 1),
        "used_percent": round(vm.percent, 1) if vm else 0.0,
        "available_mb": round((mi.get("MemAvailable", 0) or 0) / 1024.0, 1),
        "swap_percent": round(swap.percent, 1) if swap else 0.0,
        "buffers_mb": round((mi.get("Buffers", 0) or 0) / 1024.0, 1),
        "cached_mb": round((mi.get("Cached", 0) or 0) / 1024.0, 1),
        "anon_mb": round((mi.get("AnonPages", 0) or 0) / 1024.0, 1),
        "slab_mb": round(slab_total_kb / 1024.0, 1),
        "sreclaimable_mb": round(sr_kb / 1024.0, 1),
        "sunreclaim_mb": round(su_kb / 1024.0, 1),
        "dirty_mb": round(int(mi.get("Dirty", 0) or 0) / 1024.0, 2),
        "writeback_mb": round(int(mi.get("Writeback", 0) or 0) / 1024.0, 2),
        "dirty_writeback_mb": round(dirty_wb / 1024.0, 2),
        "anon_huge_mb": round(ah / 1024.0, 2),
        "shmem_huge_mb": round(shm_h / 1024.0, 2),
        "vmalloc_mb": round(vmu / 1024.0, 2),
        "active_mb": round(ac / 1024.0, 1),
        "inactive_mb": round(iac / 1024.0, 1),
        "swap_used_mb": round(swap_used / 1024.0, 1) if swap_tot else 0.0,
        "source": "proc_meminfo+psutil+v2",
    }
    return rows, summary


def collect_processes_realtime():
    """Collect process subsystem telemetry payload."""
    lsm_raw = ""
    try:
        with open("/sys/kernel/security/lsm", "r", encoding="utf-8", errors="ignore") as f:
            lsm_raw = str(f.read().strip())
    except Exception:
        lsm_raw = ""
    active_lsms = [x.strip() for x in lsm_raw.split(",") if x.strip()]

    yama_scope = ""
    try:
        with open("/proc/sys/kernel/yama/ptrace_scope", "r", encoding="utf-8", errors="ignore") as f:
            yama_scope = str(f.read().strip())
    except Exception:
        yama_scope = ""

    syscall_nodes = []
    seccomp_modes = {"none": 0, "strict": 0, "filter": 0, "unknown": 0}
    for proc in psutil.process_iter(["pid", "ppid", "name", "username", "cpu_percent", "memory_percent", "num_threads"]):
        try:
            pid = int(proc.info.get("pid") or 0)
            if pid <= 0:
                continue
            ppid = int(proc.info.get("ppid") or 0)
            name = str(proc.info.get("name") or "unknown")
            user = str(proc.info.get("username") or "")
            cpu = float(proc.info.get("cpu_percent") or 0.0)
            mem = float(proc.info.get("memory_percent") or 0.0)
            threads = int(proc.info.get("num_threads") or 0)
            try:
                rss = int(getattr(proc.memory_info(), "rss", 0) or 0)
            except Exception:
                rss = 0
            try:
                fd_count = int(proc.num_fds() or 0)
            except Exception:
                fd_count = 0
            seccomp_mode = "unknown"
            with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="ignore") as f:
                for ln in f:
                    if ln.startswith("Seccomp:"):
                        raw = ln.split(":", 1)[1].strip()
                        if raw == "0":
                            seccomp_mode = "none"
                        elif raw == "1":
                            seccomp_mode = "strict"
                        elif raw == "2":
                            seccomp_mode = "filter"
                        else:
                            seccomp_mode = "unknown"
                        break
            seccomp_modes[seccomp_mode] = seccomp_modes.get(seccomp_mode, 0) + 1
            syscall_pressure = min(100, int(cpu * 1.5 + threads * 0.35 + mem * 0.8))
            syscall_nodes.append(
                {
                    "pid": pid,
                    "ppid": ppid,
                    "name": name,
                    "user": user,
                    "fd_count": fd_count,
                    "syscall_pressure": syscall_pressure,
                    "seccomp_mode": seccomp_mode,
                    "memory_percent": round(mem, 2),
                    "rss_bytes": rss,
                }
            )
        except Exception:
            continue
    syscall_nodes.sort(key=lambda x: x.get("syscall_pressure", 0), reverse=True)
    syscall_nodes = syscall_nodes[:14]

    network_nodes = {}
    try:
        for conn in psutil.net_connections(kind="inet"):
            pid = int(getattr(conn, "pid", 0) or 0)
            if pid <= 0:
                continue
            remote_ip = ""
            try:
                raddr = getattr(conn, "raddr", None)
                if raddr and len(raddr) >= 1:
                    remote_ip = str(raddr[0])
            except Exception:
                remote_ip = ""
            status = str(getattr(conn, "status", "") or "").upper()
            bucket = network_nodes.get(pid)
            if not bucket:
                proc_name = "unknown"
                try:
                    proc_name = psutil.Process(pid).name()
                except Exception:
                    proc_name = "unknown"
                bucket = {"pid": pid, "name": proc_name, "connections": 0, "remote_ips": set(), "states": {}}
                network_nodes[pid] = bucket
            bucket["connections"] += 1
            if remote_ip:
                bucket["remote_ips"].add(remote_ip)
            if status:
                bucket["states"][status] = bucket["states"].get(status, 0) + 1
    except Exception:
        pass

    network_tracing = []
    for _, row in network_nodes.items():
        states_sorted = sorted(row["states"].items(), key=lambda kv: kv[1], reverse=True)
        top_state = states_sorted[0][0] if states_sorted else "UNKNOWN"
        network_tracing.append(
            {
                "pid": int(row["pid"]),
                "name": str(row["name"]),
                "connections": int(row["connections"]),
                "unique_peers": int(len(row["remote_ips"])),
                "peer_sample": sorted(list(row["remote_ips"]))[:4],
                "top_state": top_state,
            }
        )
    network_tracing.sort(key=lambda x: (x.get("connections", 0), x.get("unique_peers", 0)), reverse=True)
    network_tracing = network_tracing[:14]

    security_hooks = [
        {"name": "LSM stack", "status": "active" if active_lsms else "unknown", "detail": ",".join(active_lsms[:4]) if active_lsms else "n/a"},
        {"name": "SELinux/AppArmor engines", "status": "active" if any(x in {"selinux", "apparmor"} for x in active_lsms) else "inactive", "detail": "policy-enforcement-path"},
        {"name": "BPF LSM", "status": "active" if "bpf" in active_lsms else "inactive", "detail": "dynamic-policy-hook"},
        {"name": "seccomp filter gate", "status": "active" if (seccomp_modes.get("filter", 0) + seccomp_modes.get("strict", 0)) > 0 else "inactive", "detail": f"filter:{seccomp_modes.get('filter', 0)} strict:{seccomp_modes.get('strict', 0)}"},
        {"name": "Yama ptrace scope", "status": "hardened" if yama_scope in {"2", "3"} else ("relaxed" if yama_scope in {"0", "1"} else "unknown"), "detail": yama_scope or "n/a"},
    ]

    node_pool = {}
    for row in syscall_nodes[:16]:
        pid = int(row.get("pid") or 0)
        if pid <= 0:
            continue
        node_pool[pid] = {
            "pid": pid,
            "ppid": int(row.get("ppid") or 0),
            "name": str(row.get("name") or "unknown"),
            "user": str(row.get("user") or ""),
            "syscall_pressure": int(row.get("syscall_pressure") or 0),
            "fd_count": int(row.get("fd_count") or 0),
            "seccomp_mode": str(row.get("seccomp_mode") or "unknown"),
            "connections": 0,
            "unique_peers": 0,
            "memory_percent": float(row.get("memory_percent") or 0.0),
            "rss_bytes": int(row.get("rss_bytes") or 0),
        }
    for row in network_tracing[:16]:
        pid = int(row.get("pid") or 0)
        if pid <= 0:
            continue
        if pid not in node_pool:
            node_pool[pid] = {
                "pid": pid,
                "ppid": 0,
                "name": str(row.get("name") or "unknown"),
                "user": "",
                "syscall_pressure": 0,
                "fd_count": 0,
                "seccomp_mode": "unknown",
                "connections": 0,
                "unique_peers": 0,
                "memory_percent": 0.0,
                "rss_bytes": 0,
            }
        node_pool[pid]["connections"] = int(row.get("connections") or 0)
        node_pool[pid]["unique_peers"] = int(row.get("unique_peers") or 0)

    edges = []
    edge_keys = set()
    network_by_pid = {int(r.get("pid") or 0): r for r in network_tracing}
    node_pids = sorted(node_pool.keys())

    def _add_edge(src_pid, dst_pid, edge_type, weight):
        src = int(src_pid or 0)
        dst = int(dst_pid or 0)
        if src <= 0 or dst <= 0 or src == dst:
            return
        if src not in node_pool or dst not in node_pool:
            return
        pair = tuple(sorted((src, dst)))
        key = (pair[0], pair[1], edge_type)
        if key in edge_keys:
            return
        edge_keys.add(key)
        edges.append({"source": src, "target": dst, "type": edge_type, "weight": float(max(0.1, min(1.0, weight)))})

    for pid, node in node_pool.items():
        ppid = int(node.get("ppid") or 0)
        if ppid in node_pool:
            _add_edge(pid, ppid, "ipc", 0.72)

    sorted_by_pressure = sorted(node_pool.values(), key=lambda n: n.get("syscall_pressure", 0), reverse=True)
    for i in range(len(sorted_by_pressure) - 1):
        a = sorted_by_pressure[i]
        b = sorted_by_pressure[i + 1]
        diff = abs(int(a.get("syscall_pressure", 0)) - int(b.get("syscall_pressure", 0)))
        weight = 1.0 - min(0.8, diff / 100.0)
        _add_edge(int(a.get("pid")), int(b.get("pid")), "syscalls", weight)

    for i in range(len(node_pids)):
        for j in range(i + 1, len(node_pids)):
            pa = node_pids[i]
            pb = node_pids[j]
            ra = network_by_pid.get(pa) or {}
            rb = network_by_pid.get(pb) or {}
            sa = set(ra.get("peer_sample") or [])
            sb = set(rb.get("peer_sample") or [])
            if sa and sb and (sa & sb):
                _add_edge(pa, pb, "network", 0.88)

    for i in range(len(node_pids)):
        for j in range(i + 1, len(node_pids)):
            na = node_pool[node_pids[i]]
            nb = node_pool[node_pids[j]]
            if not na.get("user") or na.get("user") != nb.get("user"):
                continue
            fa = int(na.get("fd_count") or 0)
            fb = int(nb.get("fd_count") or 0)
            if fa >= 16 and fb >= 16:
                _add_edge(int(na.get("pid")), int(nb.get("pid")), "file_access", 0.64)

    nodes = list(node_pool.values())[:18]
    edges = edges[:64]

    try:
        vm = psutil.virtual_memory()
        swap = psutil.swap_memory()
        meminfo_kb = _parse_meminfo_kb()
        strip_rows, mem_summary = _build_memory_visual_rows(meminfo_kb, syscall_nodes, vm, swap)
        memory_visual = {"layout": "strips", "rows": strip_rows, "summary": mem_summary}
    except Exception:
        memory_visual = {
            "layout": "strips",
            "rows": [],
            "summary": {"total_mb": 0, "used_percent": 0.0, "available_mb": 0, "swap_percent": 0.0, "source": "error"},
        }

    return {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "syscalls_interception": syscall_nodes,
        "network_tracing": network_tracing,
        "security_hooks": security_hooks,
        "neural_graph": {"nodes": nodes, "edges": edges},
        "memory_visual": memory_visual,
        "meta": {
            "processes_sampled": len(syscall_nodes),
            "network_processes": len(network_tracing),
            "seccomp_filter_percent": round((seccomp_modes.get("filter", 0) + seccomp_modes.get("strict", 0)) * 100.0 / max(1, sum(seccomp_modes.values())), 2),
            "mode": "live-heuristic-v1",
        },
    }
