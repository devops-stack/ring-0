"""Execution context and kernel DNA services."""

from __future__ import annotations

import os
import platform
import time
from datetime import datetime

import psutil


def get_execution_context_data(syscall_names, map_interrupt_to_subsystem_fn, exec_context_prev):
    """Collect execution context payload used by Ring-1 visualization."""
    if platform.system() != "Linux":
        return {
            "mode": "kernel",
            "cpu_state": "running",
            "syscall_active": False,
            "syscall_name": None,
            "interrupts": [],
            "preempted": False,
            "preempted_pid": None,
        }

    mode = "user"
    syscall_active = False
    syscall_name = None
    active_pid = None
    active_syscalls = []

    try:
        proc_dirs = [d for d in os.listdir("/proc") if d.isdigit()]
        sampled_procs = proc_dirs[:100]

        syscall_count = 0
        for pid in sampled_procs:
            try:
                syscall_path = f"/proc/{pid}/syscall"
                if os.path.exists(syscall_path):
                    with open(syscall_path, "r", encoding="utf-8", errors="ignore") as f:
                        line = f.read().strip()
                        if line and line != "-1":
                            parts = line.split()
                            if parts:
                                syscall_num = int(parts[0])
                                if syscall_num > 0:
                                    syscall_count += 1
                                    current_syscall_name = syscall_names.get(syscall_num, f"syscall_{syscall_num}")
                                    active_syscalls.append({"pid": int(pid), "syscall_name": current_syscall_name})
                                    if not syscall_active:
                                        syscall_active = True
                                        syscall_name = current_syscall_name
                                        active_pid = int(pid)
                                    mode = "kernel"
            except (ValueError, IOError, PermissionError):
                continue

        if syscall_count > 0:
            mode = "kernel"
    except PermissionError:
        pass

    cpu_state = "running"
    try:
        with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
            cpu_line = f.readline()
            if cpu_line.startswith("cpu "):
                parts = cpu_line.split()
                if len(parts) >= 5:
                    idle_time = int(parts[4])
                    total_time = sum(int(p) for p in parts[1:11] if p.isdigit())
                    if total_time > 0:
                        idle_percent = (idle_time / total_time) * 100
                        if idle_percent > 90:
                            cpu_state = "idle"
                        elif idle_percent > 50:
                            cpu_state = "sleeping"
    except (IOError, ValueError, IndexError):
        pass

    interrupts = []
    all_process_pids = []
    try:
        proc_dirs = [d for d in os.listdir("/proc") if d.isdigit()]
        all_process_pids = [int(pid) for pid in proc_dirs[:200] if pid.isdigit()]
    except PermissionError:
        pass

    try:
        with open("/proc/interrupts", "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            for line in lines[1:]:
                if line.strip():
                    parts = line.split()
                    if len(parts) > 1:
                        for i in range(1, min(len(parts), 5)):
                            try:
                                count = int(parts[i])
                                if count > 0:
                                    irq_num = parts[0].rstrip(":")
                                    associated_pid = None
                                    if all_process_pids:
                                        hash_value = (i - 1) * 100 + int(irq_num) if irq_num.isdigit() else (i - 1) * 100
                                        process_index = hash_value % len(all_process_pids)
                                        associated_pid = all_process_pids[process_index]

                                    interrupts.append(
                                        {
                                            "cpu": i - 1,
                                            "irq": irq_num,
                                            "count": count,
                                            "pid": associated_pid,
                                            "timestamp": datetime.now().isoformat(),
                                        }
                                    )
                                    break
                            except (ValueError, IndexError):
                                continue
    except (IOError, PermissionError):
        pass

    now_ts = time.time()
    prev_ts = exec_context_prev.get("timestamp")
    dt = (now_ts - prev_ts) if prev_ts else None
    if dt is not None and dt <= 0:
        dt = None

    irq_totals_now = {}
    irq_rows = []
    try:
        with open("/proc/interrupts", "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
        for raw in lines[1:]:
            if ":" not in raw:
                continue
            left, right = raw.split(":", 1)
            irq_name = left.strip()
            tokens = right.split()
            if not tokens:
                continue

            counts = []
            idx = 0
            while idx < len(tokens) and tokens[idx].isdigit():
                counts.append(int(tokens[idx]))
                idx += 1
            if not counts:
                continue
            total = sum(counts)
            desc = " ".join(tokens[idx:]).strip() or irq_name
            key = f"{irq_name}:{desc}"
            irq_totals_now[key] = total

            prev_total = exec_context_prev["irq_totals"].get(key)
            per_sec = 0.0
            if dt and prev_total is not None:
                per_sec = max(0.0, (total - prev_total) / dt)

            top_cpu = int(max(range(len(counts)), key=lambda i: counts[i])) if counts else None
            irq_rows.append(
                {
                    "irq": irq_name,
                    "label": desc,
                    "total": int(total),
                    "per_sec": round(per_sec, 2),
                    "top_cpu": top_cpu,
                    "subsystem": map_interrupt_to_subsystem_fn(desc),
                }
            )
    except (IOError, PermissionError):
        pass

    softirq_totals_now = {}
    softirq_rows = []
    try:
        with open("/proc/softirqs", "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
        for raw in lines[1:]:
            if ":" not in raw:
                continue
            left, right = raw.split(":", 1)
            name = left.strip()
            counts = []
            for tok in right.split():
                if tok.isdigit():
                    counts.append(int(tok))
            if not counts:
                continue
            total = sum(counts)
            softirq_totals_now[name] = total
            prev_total = exec_context_prev["softirq_totals"].get(name)
            per_sec = 0.0
            if dt and prev_total is not None:
                per_sec = max(0.0, (total - prev_total) / dt)
            softirq_rows.append({"name": name, "total": int(total), "per_sec": round(per_sec, 2)})
    except (IOError, PermissionError):
        pass

    irq_rows.sort(key=lambda row: (row["per_sec"], row["total"]), reverse=True)
    softirq_rows.sort(key=lambda row: (row["per_sec"], row["total"]), reverse=True)
    hard_top = irq_rows[:5]
    soft_top = softirq_rows[:4]

    hard_total_rate = sum(row["per_sec"] for row in irq_rows)
    soft_total_rate = sum(row["per_sec"] for row in softirq_rows)
    net_softirq_rate = 0.0
    block_softirq_rate = 0.0
    timer_softirq_rate = 0.0
    for row in softirq_rows:
        nm = row["name"].upper()
        if nm in ("NET_RX", "NET_TX"):
            net_softirq_rate += row["per_sec"]
        elif nm == "BLOCK":
            block_softirq_rate += row["per_sec"]
        elif nm == "TIMER":
            timer_softirq_rate += row["per_sec"]

    exec_context_prev["timestamp"] = now_ts
    exec_context_prev["irq_totals"] = irq_totals_now
    exec_context_prev["softirq_totals"] = softirq_totals_now

    preempted = False
    preempted_pid = None
    try:
        proc_dirs = [d for d in os.listdir("/proc") if d.isdigit()]
        for pid in proc_dirs[:20]:
            try:
                stat_path = f"/proc/{pid}/stat"
                if os.path.exists(stat_path):
                    with open(stat_path, "r", encoding="utf-8", errors="ignore") as f:
                        stat_data = f.read().split()
                        if len(stat_data) > 2:
                            state = stat_data[2]
                            if state == "R" and active_pid and int(pid) != active_pid:
                                preempted = True
                                preempted_pid = int(pid)
                                break
            except (ValueError, IOError, PermissionError, IndexError):
                continue
    except PermissionError:
        pass

    return {
        "mode": mode,
        "cpu_state": cpu_state,
        "syscall_active": syscall_active,
        "syscall_name": syscall_name,
        "active_pid": active_pid,
        "active_syscalls": active_syscalls,
        "interrupts": interrupts[:10],
        "irq_stack": {
            "hard": hard_top,
            "soft": soft_top,
            "summary": {
                "hard_total_per_sec": round(hard_total_rate, 2),
                "soft_total_per_sec": round(soft_total_rate, 2),
                "net_softirq_per_sec": round(net_softirq_rate, 2),
                "block_softirq_per_sec": round(block_softirq_rate, 2),
                "timer_softirq_per_sec": round(timer_softirq_rate, 2),
            },
        },
        "preempted": preempted,
        "preempted_pid": preempted_pid,
        "cpu_count": psutil.cpu_count(),
        "timestamp": datetime.now().isoformat(),
    }


def get_kernel_dna_data(get_real_system_calls_fn, map_syscall_to_subsystem_fn, map_interrupt_to_subsystem_fn, softirq_nucleotides_fn):
    """Collect Kernel DNA data for visualization."""
    dna_data = {"nucleotides": [], "genes": [], "mutations": [], "timestamp": datetime.now().isoformat()}

    try:
        syscalls = get_real_system_calls_fn()
        for syscall in syscalls[:20]:
            dna_data["nucleotides"].append(
                {
                    "type": "syscall",
                    "code": "A",
                    "name": syscall["name"],
                    "count": syscall.get("count", 0),
                    "subsystem": syscall.get("subsystem") or map_syscall_to_subsystem_fn(syscall["name"]),
                    "timestamp": datetime.now().isoformat(),
                }
            )
    except Exception:
        pass

    try:
        with open("/proc/interrupts", "r", encoding="utf-8", errors="ignore") as f:
            interrupt_lines = f.readlines()
            for line in interrupt_lines[1:11]:
                parts = line.strip().split()
                if len(parts) > 1:
                    interrupt_name = parts[0].rstrip(":")
                    total_count = sum(int(x) for x in parts[1:] if x.isdigit())
                    if total_count > 0:
                        dna_data["nucleotides"].append(
                            {
                                "type": "interrupt",
                                "code": "T",
                                "name": interrupt_name,
                                "count": total_count,
                                "subsystem": map_interrupt_to_subsystem_fn(interrupt_name),
                                "timestamp": datetime.now().isoformat(),
                            }
                        )
    except (IOError, ValueError, PermissionError):
        dna_data["nucleotides"].extend(softirq_nucleotides_fn())

    try:
        with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("ctxt "):
                    ctxt_count = int(line.split()[1])
                    dna_data["nucleotides"].append(
                        {
                            "type": "context_switch",
                            "code": "C",
                            "name": "context_switch",
                            "count": ctxt_count,
                            "subsystem": "sched",
                            "timestamp": datetime.now().isoformat(),
                        }
                    )
                    break
    except (IOError, ValueError, PermissionError):
        pass

    try:
        with open("/proc/locks", "r", encoding="utf-8", errors="ignore") as f:
            lock_lines = f.readlines()
            lock_count = len(lock_lines)
            if lock_count > 0:
                dna_data["nucleotides"].append(
                    {
                        "type": "lock",
                        "code": "G",
                        "name": "mutex/lock",
                        "count": lock_count,
                        "subsystem": "kernel",
                        "timestamp": datetime.now().isoformat(),
                    }
                )
    except (IOError, PermissionError):
        try:
            process_count = len(psutil.pids())
            estimated_locks = process_count // 10
            dna_data["nucleotides"].append(
                {
                    "type": "lock",
                    "code": "G",
                    "name": "mutex/lock",
                    "count": estimated_locks,
                    "subsystem": "kernel",
                    "timestamp": datetime.now().isoformat(),
                }
            )
        except Exception:
            pass

    dna_data["genes"] = [
        {"name": "sched", "start": 0, "end": 0.2, "color": "#58b6d8"},
        {"name": "net", "start": 0.2, "end": 0.4, "color": "#4a9eff"},
        {"name": "fs", "start": 0.4, "end": 0.6, "color": "#6bcf7f"},
        {"name": "mm", "start": 0.6, "end": 0.8, "color": "#ffa94d"},
        {"name": "drivers", "start": 0.8, "end": 1.0, "color": "#ff6b9d"},
    ]

    mutations = []
    syscall_count = sum(1 for n in dna_data["nucleotides"] if n["type"] == "syscall")
    if syscall_count > 15:
        mutations.append({"type": "syscall_flood", "severity": "high", "message": f"Syscall flood detected: {syscall_count} active syscalls", "position": 0.3})

    ctxt_switches = [n for n in dna_data["nucleotides"] if n["type"] == "context_switch"]
    if ctxt_switches and ctxt_switches[0]["count"] > 1000000:
        mutations.append({"type": "abnormal_context_switch", "severity": "medium", "message": "Abnormal context switching rate detected", "position": 0.5})

    locks = [n for n in dna_data["nucleotides"] if n["type"] == "lock"]
    if locks and locks[0]["count"] > 100:
        mutations.append({"type": "lock_contention", "severity": "medium", "message": f'High lock contention: {locks[0]["count"]} active locks', "position": 0.7})

    dna_data["mutations"] = mutations
    return dna_data
