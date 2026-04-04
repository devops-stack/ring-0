"""Filesystem and isolation domain services."""

from __future__ import annotations

import os
import re
import time
from datetime import datetime

import psutil

from kernel_ai.collectors import proc_fs as _proc_fs
from kernel_ai.state import FILESYSTEM_PREV


def get_filesystem_blocks():
    now = time.time()
    try:
        usage = psutil.disk_usage("/")
    except Exception:
        usage = None

    used_percent = float(usage.percent) if usage else 0.0
    total_gb = round((usage.total / (1024**3)), 2) if usage else 0.0
    used_gb = round((usage.used / (1024**3)), 2) if usage else 0.0
    free_gb = round((usage.free / (1024**3)), 2) if usage else 0.0

    io = psutil.disk_io_counters()
    write_bytes = int(io.write_bytes) if io else 0
    prev_ts = FILESYSTEM_PREV["timestamp"]
    prev_write = FILESYSTEM_PREV["write_bytes"]
    dt = max(0.001, now - prev_ts) if prev_ts else 1.0
    write_bps = 0.0 if prev_write is None else max(0.0, (write_bytes - prev_write) / dt)

    rows = 20
    cols = 34
    total_blocks = rows * cols
    used_ratio_global = max(0.0, min(1.0, used_percent / 100.0))

    zone_defs = [
        {"id": "root", "name": "/", "path": "/", "base": 1.5, "bias": 0.00},
        {"id": "var", "name": "/var", "path": "/var", "base": 1.6, "bias": 0.10},
        {"id": "home", "name": "/home", "path": "/home", "base": 1.35, "bias": 0.06},
        {"id": "usr", "name": "/usr", "path": "/usr", "base": 1.45, "bias": 0.08},
        {"id": "etc", "name": "/etc", "path": "/etc", "base": 1.0, "bias": -0.03},
        {"id": "tmp", "name": "/tmp", "path": "/tmp", "base": 1.0, "bias": -0.02},
        {"id": "dev", "name": "/dev", "path": "/dev", "base": 0.85, "bias": -0.06},
    ]

    activity_counts = {z["id"]: 0 for z in zone_defs}
    try:
        processes = list(psutil.process_iter(["pid"]))[:90]
        zone_paths = sorted([(z["path"], z["id"]) for z in zone_defs], key=lambda x: len(x[0]), reverse=True)
        for proc in processes:
            try:
                open_files = proc.open_files()[:28]
            except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess, OSError):
                continue
            for of in open_files:
                fpath = str(getattr(of, "path", "") or "")
                if not fpath.startswith("/"):
                    continue
                for prefix, zone_id in zone_paths:
                    if prefix == "/":
                        continue
                    if fpath == prefix or fpath.startswith(prefix + "/"):
                        activity_counts[zone_id] += 1
                        break
                else:
                    activity_counts["root"] += 1
    except Exception:
        pass

    weighted = []
    for z in zone_defs:
        act = float(activity_counts.get(z["id"], 0))
        z["activity"] = act
        weighted.append(max(0.2, z["base"] + act * 0.08))

    total_weight = sum(weighted) or 1.0
    row_counts = [max(1, int(round(rows * w / total_weight))) for w in weighted]
    while sum(row_counts) > rows:
        idx = max(range(len(row_counts)), key=lambda i: row_counts[i])
        if row_counts[idx] > 1:
            row_counts[idx] -= 1
        else:
            break
    while sum(row_counts) < rows:
        idx = max(range(len(weighted)), key=lambda i: weighted[i])
        row_counts[idx] += 1

    writing_ratio = min(0.20, write_bps / (300 * 1024 * 1024))
    writing_blocks_total = int(round(total_blocks * writing_ratio))
    writing_blocks_total = max(0, min(total_blocks, writing_blocks_total))

    blocks = []
    zones = []
    cursor_row = 0
    zone_scores = []
    for z in zone_defs:
        zone_scores.append(z["activity"] + 1.0)
    score_sum = sum(zone_scores) or 1.0

    seed = int(now * 3)
    for idx, z in enumerate(zone_defs):
        row_span = row_counts[idx]
        row_start = cursor_row
        row_end = min(rows - 1, cursor_row + row_span - 1)
        cursor_row += row_span

        zone_cells = max(1, (row_end - row_start + 1) * cols)
        local_used_ratio = max(0.05, min(0.98, used_ratio_global + z["bias"] + min(0.18, z["activity"] / 120.0)))
        zone_used = int(round(zone_cells * local_used_ratio))
        zone_used = max(0, min(zone_cells, zone_used))

        zone_write_share = zone_scores[idx] / score_sum
        zone_writing = int(round(writing_blocks_total * zone_write_share))
        zone_writing = max(0, min(zone_used, zone_writing))
        inode_pressure = int(max(0, min(100, round((z["activity"] * 2.6) + (zone_writing * 0.9) + (local_used_ratio * 38.0)))))

        cell_index = 0
        for r in range(row_start, row_end + 1):
            for c in range(cols):
                state = "used" if cell_index < zone_used else "free"
                blocks.append({"r": r, "c": c, "i": r * cols + c, "zone_id": z["id"], "state": state})
                cell_index += 1

        if zone_writing > 0 and zone_used > 0:
            zone_block_indices = [i for i, b in enumerate(blocks) if b["zone_id"] == z["id"] and b["state"] == "used"]
            used_len = len(zone_block_indices)
            for n in range(min(zone_writing, used_len)):
                pick = (seed * 31 + idx * 67 + n * 43) % used_len
                blocks[zone_block_indices[pick]]["state"] = "writing"

        zones.append(
            {
                "id": z["id"],
                "name": z["name"],
                "path": z["path"],
                "row_start": row_start,
                "row_end": row_end,
                "activity": int(z["activity"]),
                "used_percent": round(local_used_ratio * 100.0, 1),
                "writing_blocks": zone_writing,
                "inode_pressure": inode_pressure,
            }
        )

    writing_blocks = sum(1 for b in blocks if b["state"] == "writing")
    FILESYSTEM_PREV["timestamp"] = now
    FILESYSTEM_PREV["write_bytes"] = write_bytes

    inode_pressure_global = 0
    if zones:
        inode_pressure_global = int(round(sum(int(z.get("inode_pressure", 0)) for z in zones) / len(zones)))

    return {
        "timestamp": datetime.now().isoformat(),
        "rows": rows,
        "cols": cols,
        "zones": zones,
        "blocks": blocks,
        "meta": {
            "total_gb": total_gb,
            "used_gb": used_gb,
            "free_gb": free_gb,
            "used_percent": round(used_percent, 2),
            "write_bps": round(write_bps, 2),
            "writing_blocks": writing_blocks,
            "inode_pressure": inode_pressure_global,
        },
    }


def _parse_cgroup_path(pid):
    cgroup_text = _proc_fs.safe_read_text(f"/proc/{pid}/cgroup")
    if not cgroup_text:
        return "/"
    chosen = "/"
    for line in cgroup_text.splitlines():
        parts = line.split(":")
        if len(parts) != 3:
            continue
        _, controllers, path = parts
        path = path.strip() or "/"
        if controllers == "":
            return path
        if path and path != "/":
            chosen = path
    return chosen


def read_namespace_inode(pid, ns_name):
    ns_link = f"/proc/{pid}/ns/{ns_name}"
    try:
        target = os.readlink(ns_link)
    except (OSError, PermissionError):
        return None
    match = re.search(r"\[(\d+)\]", target)
    return match.group(1) if match else target


# Backward-compatible alias for existing imports/tests during refactor.
_read_namespace_inode = read_namespace_inode


def _read_cgroup_v2_stats(cgroup_path):
    root = "/sys/fs/cgroup"
    rel = cgroup_path.lstrip("/")
    base = os.path.join(root, rel) if rel else root

    cpu_max_text = _proc_fs.safe_read_text(os.path.join(base, "cpu.max"))
    cpu_quota_cores = None
    if cpu_max_text:
        parts = cpu_max_text.split()
        if len(parts) >= 2 and parts[0] != "max":
            try:
                quota = float(parts[0])
                period = float(parts[1])
                if period > 0:
                    cpu_quota_cores = round(quota / period, 2)
            except ValueError:
                cpu_quota_cores = None

    mem_current = _proc_fs.safe_read_text(os.path.join(base, "memory.current"))
    mem_max = _proc_fs.safe_read_text(os.path.join(base, "memory.max"))
    pids_current = _proc_fs.safe_read_text(os.path.join(base, "pids.current"))
    pids_max = _proc_fs.safe_read_text(os.path.join(base, "pids.max"))
    io_stat_text = _proc_fs.safe_read_text(os.path.join(base, "io.stat"))

    memory_current_mb = None
    memory_max_mb = None
    try:
        if mem_current is not None:
            memory_current_mb = round(int(mem_current) / (1024 * 1024), 1)
    except ValueError:
        memory_current_mb = None

    try:
        if mem_max and mem_max != "max":
            memory_max_mb = round(int(mem_max) / (1024 * 1024), 1)
    except ValueError:
        memory_max_mb = None

    io_bytes = None
    if io_stat_text:
        total = 0
        for line in io_stat_text.splitlines():
            rbytes_match = re.search(r"rbytes=(\d+)", line)
            wbytes_match = re.search(r"wbytes=(\d+)", line)
            if rbytes_match:
                total += int(rbytes_match.group(1))
            if wbytes_match:
                total += int(wbytes_match.group(1))
        io_bytes = total

    return {
        "cpu_quota_cores": cpu_quota_cores,
        "memory_current_mb": memory_current_mb,
        "memory_max_mb": memory_max_mb,
        "pids_current": int(pids_current) if pids_current and pids_current.isdigit() else None,
        "pids_max": None if pids_max in (None, "max") else (int(pids_max) if pids_max.isdigit() else None),
        "io_total_mb": round(io_bytes / (1024 * 1024), 1) if io_bytes is not None else None,
    }


def get_isolation_context():
    namespace_keys = ["mnt", "pid", "net", "ipc", "uts", "user"]
    namespace_labels = {"mnt": "MNT", "pid": "PID", "net": "NET", "ipc": "IPC", "uts": "UTS", "user": "USER"}
    namespace_counts = {k: {} for k in namespace_keys}
    cgroup_aggregates = {}
    total_scanned = 0

    for proc in psutil.process_iter(["pid", "name", "memory_info"]):
        try:
            pid = proc.info["pid"]
            total_scanned += 1

            cgroup_path = _parse_cgroup_path(pid)
            agg = cgroup_aggregates.setdefault(cgroup_path, {"path": cgroup_path, "process_count": 0, "memory_mb_sum": 0.0, "sample_processes": []})
            agg["process_count"] += 1

            mem_info = proc.info.get("memory_info")
            if mem_info:
                agg["memory_mb_sum"] += mem_info.rss / (1024 * 1024)

            if len(agg["sample_processes"]) < 4:
                process_name = proc.info.get("name") or "unknown"
                agg["sample_processes"].append(process_name)

            for ns_name in namespace_keys:
                inode = read_namespace_inode(pid, ns_name)
                if inode:
                    ns_map = namespace_counts[ns_name]
                    ns_map[inode] = ns_map.get(inode, 0) + 1
        except (psutil.NoSuchProcess, psutil.AccessDenied, KeyError):
            continue

    namespaces = []
    for ns_name in namespace_keys:
        entries = namespace_counts[ns_name]
        unique_count = len(entries)
        dominant_inode = None
        dominant_count = 0
        if entries:
            dominant_inode, dominant_count = max(entries.items(), key=lambda kv: kv[1])
        activity = round((dominant_count / total_scanned), 3) if total_scanned > 0 else 0
        namespaces.append(
            {
                "id": ns_name,
                "label": namespace_labels[ns_name],
                "unique_count": unique_count,
                "dominant_inode": dominant_inode,
                "dominant_count": dominant_count,
                "activity": activity,
            }
        )

    top_cgroups = sorted(cgroup_aggregates.values(), key=lambda x: (x["process_count"], x["memory_mb_sum"]), reverse=True)[:4]
    for item in top_cgroups:
        stats = _read_cgroup_v2_stats(item["path"])
        item["memory_mb_sum"] = round(item["memory_mb_sum"], 1)
        item.update(stats)

    return {"timestamp": datetime.now().isoformat(), "processes_scanned": total_scanned, "namespaces": namespaces, "top_cgroups": top_cgroups}
