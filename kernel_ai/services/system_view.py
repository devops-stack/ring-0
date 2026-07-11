"""Filesystem and isolation domain services."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import stat as _stat
import subprocess
import time
from datetime import datetime

import psutil

from kernel_ai.collectors import proc_fs as _proc_fs
from kernel_ai.logging_helpers import log_event

logger = logging.getLogger(__name__)

_FILESYSTEM_PREV_DEFAULT = {
    "timestamp": None,
    "write_bytes": None,
    "read_bytes": None,
    "per_disk": {},
}

# Pseudo/virtual filesystems we never want in the real mount map.
_PSEUDO_FSTYPES = {
    "proc", "sysfs", "devtmpfs", "devpts", "cgroup", "cgroup2", "pstore",
    "securityfs", "debugfs", "tracefs", "bpf", "configfs", "fusectl",
    "mqueue", "hugetlbfs", "autofs", "binfmt_misc", "ramfs", "nsfs",
    "rpc_pipefs", "efivarfs", "squashfs",
}


def _read_meminfo_kb(keys):
    """Return selected /proc/meminfo values (in kB) as a dict."""
    out = {k: 0 for k in keys}
    text = _proc_fs.safe_read_text("/proc/meminfo") or ""
    for line in text.splitlines():
        parts = line.split(":")
        if len(parts) != 2:
            continue
        name = parts[0].strip()
        if name in out:
            try:
                out[name] = int(parts[1].strip().split()[0])
            except (ValueError, IndexError):
                pass
    return out


def _read_vmstat(keys):
    """Return selected /proc/vmstat counters as a dict of ints."""
    out = {k: 0 for k in keys}
    text = _proc_fs.safe_read_text("/proc/vmstat") or ""
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] in out:
            try:
                out[parts[0]] = int(parts[1])
            except ValueError:
                pass
    return out


def _read_sysctl_int(path):
    text = _proc_fs.safe_read_text(path)
    if not text:
        return None
    try:
        return int(text.strip())
    except ValueError:
        return None


def _read_block_scheduler():
    """Return the active I/O scheduler of the busiest/first real block device."""
    try:
        blocks = sorted(os.listdir("/sys/block"))
    except OSError:
        return None
    for name in blocks:
        if name.startswith(("loop", "ram", "sr")):
            continue
        text = _proc_fs.safe_read_text(f"/sys/block/{name}/queue/scheduler")
        if not text:
            continue
        m = re.search(r"\[(\w+[-\w]*)\]", text)
        if m:
            return {"device": name, "scheduler": m.group(1),
                    "available": text.replace("[", "").replace("]", "").split()}
    return None


def _base_disk_name(device):
    """Map a partition device path to its I/O-counter key.

    /dev/nvme0n1p1 -> nvme0n1 ; /dev/sda1 -> sda ; /dev/mapper/x -> mapper key.
    """
    if not device:
        return ""
    name = device.split("/")[-1]
    if name.startswith("nvme"):
        # nvme0n1p1 -> nvme0n1
        return re.sub(r"(p\d+)$", "", name)
    if name.startswith(("sd", "vd", "hd", "xvd")):
        return re.sub(r"\d+$", "", name)
    return name


def _statvfs_inodes(mountpoint):
    try:
        st = os.statvfs(mountpoint)
    except OSError:
        return None
    total = int(st.f_files)
    free = int(st.f_ffree)
    if total <= 0:
        return {"inode_total": 0, "inode_used": 0, "inode_percent": 0.0}
    used = max(0, total - free)
    return {
        "inode_total": total,
        "inode_used": used,
        "inode_percent": round(used / total * 100.0, 1),
    }


_ANATOMY_BASE = "/opt/ring0/kernel-ai"
_HOT_FILES_PREV = {"ts": None, "io": {}}
_HOTFILES_SNAPSHOT = os.environ.get("HOTFILES_OUT", "/run/kernel-ai/hotfiles.json")
_HOTFILES_MAX_AGE = 6.0


def _read_hotfiles_snapshot():
    """Return the root collector's system-wide snapshot if present and fresh."""
    try:
        with open(_HOTFILES_SNAPSHOT, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    ts = data.get("ts")
    if not ts or (time.time() - float(ts)) > _HOTFILES_MAX_AGE:
        return None
    data["timestamp"] = datetime.now().isoformat()
    return data


def get_hot_files():
    """Top processes writing to the filesystem right now.

    Prefers the root ``hotfiles`` collector snapshot (system-wide). Falls back
    to unprivileged same-uid sampling of /proc/<pid>/io when the collector is
    not running.
    """
    snap = _read_hotfiles_snapshot()
    if snap:
        return snap
    now = time.time()
    prev = _HOT_FILES_PREV
    dt = max(0.001, now - prev["ts"]) if prev["ts"] else 1.0
    cur_io = {}
    rows = []
    visible_user = None
    accessible = 0
    for proc in psutil.process_iter(["pid", "name", "username"]):
        try:
            io = proc.io_counters()
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess, OSError):
            continue
        pid = proc.info["pid"]
        accessible += 1
        if visible_user is None:
            visible_user = proc.info.get("username")
        wchar = int(getattr(io, "write_chars", 0) or 0)
        rchar = int(getattr(io, "read_chars", 0) or 0)
        wbytes = int(getattr(io, "write_bytes", 0) or 0)
        cur_io[pid] = (wchar, rchar, wbytes)
        pv = prev["io"].get(pid)
        if not pv:
            continue
        w_rate = max(0.0, (wchar - pv[0]) / dt)
        r_rate = max(0.0, (rchar - pv[1]) / dt)
        wb_rate = max(0.0, (wbytes - pv[2]) / dt)
        if w_rate < 1 and r_rate < 1 and wb_rate < 1:
            continue
        files = []
        try:
            for of in proc.open_files()[:6]:
                p = str(getattr(of, "path", "") or "")
                if p.startswith("/") and not p.startswith(("/proc", "/sys", "/dev")):
                    files.append(p)
        except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess, OSError):
            pass
        rows.append({
            "pid": pid,
            "name": proc.info.get("name") or "?",
            "user": proc.info.get("username") or "?",
            "write_bps": round(w_rate, 1),
            "read_bps": round(r_rate, 1),
            "disk_write_bps": round(wb_rate, 1),
            "files": files[:3],
        })

    prev["ts"] = now
    prev["io"] = cur_io
    rows.sort(key=lambda r: r["write_bps"] + r["disk_write_bps"], reverse=True)
    return {
        "timestamp": datetime.now().isoformat(),
        "writers": rows[:12],
        "visible_user": visible_user,
        "accessible_procs": accessible,
        "source": "unprivileged",
        "note": "unprivileged /proc: only same-uid processes are visible",
    }


_PATH_WALK_ALLOWED = ("/opt/ring0/kernel-ai", "/var/log", "/var/lib", "/run", "/usr")


def _sanitize_walk_path(path):
    """Only allow walking real files under non-sensitive operational roots.

    The site is public, so we must not let a caller lstat arbitrary paths and
    probe the filesystem. We accept an explicit path only if it normalizes to
    an absolute path (no ``..``) under an allow-listed root and actually exists.
    """
    if not path:
        return None
    norm = os.path.normpath(path)
    if not norm.startswith("/") or ".." in norm.split("/"):
        return None
    if not any(norm == root or norm.startswith(root + "/") for root in _PATH_WALK_ALLOWED):
        return None
    if not os.path.exists(norm):
        return None
    return norm


def get_path_walk(path=None):
    """Resolve a real path component-by-component (the dcache walk)."""
    target = _sanitize_walk_path(path) or _pick_anatomy_file() or "/opt/ring0/kernel-ai/index.html"
    target = os.path.normpath(target)
    parts = [p for p in target.split("/") if p]
    steps = [{"name": "/", "path": "/", "inode": None, "type": "dir", "mode_str": "", "size_kb": None}]
    try:
        st = os.lstat("/")
        steps[0]["inode"] = int(st.st_ino)
        steps[0]["mode_str"] = _mode_to_string(st.st_mode)
    except OSError:
        pass
    cur = ""
    for part in parts:
        cur = cur + "/" + part
        entry = {"name": part, "path": cur, "inode": None, "type": "file", "mode_str": "", "size_kb": None}
        try:
            st = os.lstat(cur)
            entry["inode"] = int(st.st_ino)
            entry["mode_str"] = _mode_to_string(st.st_mode)
            if _stat.S_ISDIR(st.st_mode):
                entry["type"] = "dir"
            elif _stat.S_ISLNK(st.st_mode):
                entry["type"] = "symlink"
                try:
                    entry["target"] = os.readlink(cur)
                except OSError:
                    pass
            else:
                entry["type"] = "file"
                entry["size_kb"] = round(st.st_size / 1024.0, 1)
        except OSError as exc:
            entry["error"] = str(exc)
            steps.append(entry)
            break
        steps.append(entry)

    dentry = {}
    dtext = _proc_fs.safe_read_text("/proc/sys/fs/dentry-state") or ""
    nums = dtext.split()
    if len(nums) >= 2:
        try:
            dentry = {
                "nr_dentry": int(nums[0]),
                "nr_unused": int(nums[1]),
                "active": int(nums[0]) - int(nums[1]),
            }
        except ValueError:
            dentry = {}

    return {
        "path": target,
        "steps": steps,
        "depth": len(steps),
        "dentry_state": dentry,
    }
_FS_TYPE_MAGIC = {"ef53": "ext4", "58465342": "xfs", "2fc12fc1": "zfs", "9123683e": "btrfs"}


def _mode_to_string(mode):
    is_dir = _stat.S_ISDIR(mode)
    kind = "d" if is_dir else ("l" if _stat.S_ISLNK(mode) else "-")
    perms = ""
    for who in ("USR", "GRP", "OTH"):
        for bit, ch in (("R", "r"), ("W", "w"), ("X", "x")):
            perms += ch if (mode & getattr(_stat, f"S_I{bit}{who}")) else "-"
    return kind + perms


def _pick_anatomy_file():
    """Choose the largest readable regular file from a few app dirs.

    A larger file is more likely to span multiple extents, which makes the
    on-disk layout interesting to visualize.
    """
    roots = [
        os.path.join(_ANATOMY_BASE, "static", "js"),
        os.path.join(_ANATOMY_BASE, "static"),
        _ANATOMY_BASE,
    ]
    for root in roots:
        best = None
        try:
            names = os.listdir(root)
        except OSError:
            continue
        for name in names:
            if name.startswith("."):
                continue
            fp = os.path.join(root, name)
            try:
                if not os.path.isfile(fp) or not os.access(fp, os.R_OK):
                    continue
                sz = os.path.getsize(fp)
            except OSError:
                continue
            if sz > 0 and (best is None or sz > best[1]):
                best = (fp, sz)
        # Prefer the first root (static/js) that yields any candidate.
        if best:
            return best[0]
    return None


def _find_filefrag():
    """Locate the filefrag binary, including sbin dirs not on the service PATH."""
    found = shutil.which("filefrag")
    if found:
        return found
    for cand in ("/usr/sbin/filefrag", "/sbin/filefrag", "/usr/bin/filefrag", "/bin/filefrag"):
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def _parse_filefrag(path):
    """Return (fstype, extents) parsed from `filefrag -v`.

    extents: list of {logical, physical, length, flags}. Uses the FIEMAP
    ioctl under the hood, which works unprivileged on readable files.
    """
    binary = _find_filefrag()
    if not binary:
        return None, []
    try:
        res = subprocess.run(
            [binary, "-v", path],
            capture_output=True, text=True, timeout=4, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None, []
    fstype = None
    extents = []
    row_re = re.compile(r"^\s*\d+:\s+(\d+)\.\.\s*(\d+):\s+(\d+)\.\.\s*(\d+):\s+(\d+):\s*(.*)$")
    for line in (res.stdout or "").splitlines():
        mt = re.search(r"Filesystem type is:\s*(\w+)", line)
        if mt:
            fstype = _FS_TYPE_MAGIC.get(mt.group(1), mt.group(1))
            continue
        m = row_re.match(line)
        if m:
            extents.append({
                "logical": int(m.group(1)),
                "physical": int(m.group(3)),
                "length": int(m.group(5)),
                "flags": (m.group(6) or "").strip(),
            })
    return fstype, extents


def get_ext4_file_anatomy(path=None):
    """Resolve one real file to its inode metadata and on-disk extent layout."""
    target = _sanitize_walk_path(path) or _pick_anatomy_file()
    if not target or not os.path.isfile(target):
        return {"available": False, "reason": "no readable file found"}
    try:
        st = os.stat(target)
    except OSError as exc:
        return {"available": False, "reason": str(exc)}

    try:
        vfs = os.statvfs(target)
        block_size = int(vfs.f_bsize)
        dev_total_blocks = int(vfs.f_blocks)
    except OSError:
        block_size = 4096
        dev_total_blocks = 0

    fstype, extents = _parse_filefrag(target)
    if not fstype:
        # Fall back to the mount fstype.
        best_mp = ""
        try:
            for part in psutil.disk_partitions(all=False):
                mp = part.mountpoint
                if target.startswith(mp) and len(mp) > len(best_mp):
                    best_mp = mp
                    fstype = (part.fstype or "").lower()
        except (psutil.Error, OSError):
            pass

    total_len = sum(e["length"] for e in extents) or 1
    phys_positions = [e["physical"] for e in extents] + [e["physical"] + e["length"] for e in extents]
    span = {
        "min": min(phys_positions) if phys_positions else 0,
        "max": max(phys_positions) if phys_positions else 0,
    }
    fragmented = len(extents) > 1

    return {
        "available": True,
        "path": target,
        "name": os.path.basename(target),
        "inode": int(st.st_ino),
        "mode_octal": oct(st.st_mode & 0o7777),
        "mode_str": _mode_to_string(st.st_mode),
        "nlink": int(st.st_nlink),
        "uid": int(st.st_uid),
        "gid": int(st.st_gid),
        "size_bytes": int(st.st_size),
        "size_kb": round(st.st_size / 1024.0, 1),
        "blocks_512": int(st.st_blocks),
        "block_size": block_size,
        "fs_blocks": (int(st.st_size) + block_size - 1) // block_size if block_size else 0,
        "fstype": fstype or "ext4",
        "atime": datetime.fromtimestamp(st.st_atime).isoformat(timespec="seconds"),
        "mtime": datetime.fromtimestamp(st.st_mtime).isoformat(timespec="seconds"),
        "ctime": datetime.fromtimestamp(st.st_ctime).isoformat(timespec="seconds"),
        "extents": extents,
        "extent_count": len(extents),
        "total_extent_blocks": total_len,
        "fragmented": fragmented,
        "device_total_blocks": dev_total_blocks,
        "device_span": span,
        "filefrag_available": bool(_find_filefrag()),
    }


def _find_ext4_root_mount():
    """Return (device, mountpoint, options_list) for the ext4 mount of `/`."""
    text = _proc_fs.safe_read_text("/proc/mounts") or ""
    best = None
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        device, mountpoint, fstype, opts = parts[0], parts[1], parts[2], parts[3]
        if fstype != "ext4":
            continue
        if mountpoint == "/":
            return device, mountpoint, opts.split(",")
        if best is None:
            best = (device, mountpoint, opts.split(","))
    return best if best else (None, None, [])


def _parse_jbd2_info(text):
    """Extract transaction stats from /proc/fs/jbd2/<dev>/info."""
    info = {"raw": []}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        info["raw"].append(line)
        m = re.search(r"(\d+)\s+transactions?\s+\((\d+)\s+requested\)", line)
        if m:
            info["transactions"] = int(m.group(1))
            info["requested"] = int(m.group(2))
        m = re.search(r"up to\s+(\d+)\s+blocks", line)
        if m:
            info["max_blocks_per_txn"] = int(m.group(1))
        m = re.search(r"([\d.]+)ms\s+waiting for transaction", line)
        if m:
            info["avg_waiting_ms"] = float(m.group(1))
        m = re.search(r"([\d.]+)ms\s+running transaction", line)
        if m:
            info["avg_running_ms"] = float(m.group(1))
        m = re.search(r"([\d.]+)ms\s+transaction was being committed", line)
        if m:
            info["avg_commit_ms"] = float(m.group(1))
        m = re.search(r"([\d.]+)ms\s+logging transaction", line)
        if m:
            info["avg_logging_ms"] = float(m.group(1))
        m = re.search(r"(\d+)\s+blocks per transaction", line)
        if m:
            info["blocks_per_txn"] = int(m.group(1))
        m = re.search(r"(\d+)\s+logged blocks per transaction", line)
        if m:
            info["logged_blocks_per_txn"] = int(m.group(1))
        m = re.search(r"([\d.]+)us average transaction commit time", line)
        if m:
            info["commit_time_ms"] = round(float(m.group(1)) / 1000.0, 3)
        m = re.search(r"([\d.]+)ms average transaction commit time", line)
        if m:
            info["commit_time_ms"] = round(float(m.group(1)), 3)
        m = re.search(r"(\d+)\s+handles per transaction", line)
        if m:
            info["handles_per_txn"] = int(m.group(1))
    return info


def get_ext4_journal():
    """Report ext4 journaling mode and live jbd2 transaction statistics."""
    device, mountpoint, opts = _find_ext4_root_mount()
    if not device:
        return {"available": False, "reason": "no ext4 mount found"}

    data_mode = "ordered"
    for o in opts:
        if o.startswith("data="):
            data_mode = o.split("=", 1)[1]
    has_journal = "data=writeback" not in opts  # journal present unless explicitly disabled

    jbd2 = {"raw_present": False}
    jbd2_dev = None
    try:
        entries = sorted(os.listdir("/proc/fs/jbd2"))
    except OSError:
        entries = []
    # Prefer the entry matching the root device's base name.
    base = _base_disk_name(device)
    dev_tail = device.split("/")[-1]
    for ent in entries:
        if ent.startswith(dev_tail) or ent.startswith(base) or "dm-" in ent:
            jbd2_dev = ent
            break
    if not jbd2_dev and entries:
        jbd2_dev = entries[0]
    if jbd2_dev:
        info_text = _proc_fs.safe_read_text(f"/proc/fs/jbd2/{jbd2_dev}/info")
        if info_text:
            parsed = _parse_jbd2_info(info_text)
            parsed["raw_present"] = True
            parsed["raw"] = parsed.get("raw", [])[:14]
            jbd2 = parsed

    return {
        "available": True,
        "device": device,
        "mount": mountpoint,
        "mode": data_mode,
        "has_journal": has_journal,
        "jbd2_device": jbd2_dev,
        "jbd2": jbd2,
        "options": [o for o in opts if o][:10],
    }


def _build_writeback(mem, dirty_mb, writeback_mb):
    """Reconstruct the kernel dirty-page throttling thresholds.

    The kernel throttles writers in balance_dirty_pages() when dirty pages
    approach vm.dirty_ratio of dirtyable memory, and wakes background flushers
    at vm.dirty_background_ratio. If the *_bytes knobs are set they win.
    """
    mem_total_mb = round(mem.get("MemTotal", 0) / 1024.0, 1)
    mem_avail_mb = round(mem.get("MemAvailable", 0) / 1024.0, 1)
    # Dirtyable memory approximation: available memory + already-dirty pages.
    dirtyable_mb = max(1.0, mem_avail_mb + dirty_mb)

    dirty_bytes = _read_sysctl_int("/proc/sys/vm/dirty_bytes") or 0
    bg_bytes = _read_sysctl_int("/proc/sys/vm/dirty_background_bytes") or 0
    dirty_ratio = _read_sysctl_int("/proc/sys/vm/dirty_ratio")
    bg_ratio = _read_sysctl_int("/proc/sys/vm/dirty_background_ratio")

    if dirty_bytes > 0:
        thresh_mb = round(dirty_bytes / (1024.0 * 1024.0), 1)
        mode = "bytes"
    else:
        thresh_mb = round((dirty_ratio or 20) / 100.0 * dirtyable_mb, 1)
        mode = "ratio"
    if bg_bytes > 0:
        bg_thresh_mb = round(bg_bytes / (1024.0 * 1024.0), 1)
    else:
        bg_thresh_mb = round((bg_ratio if bg_ratio is not None else 10) / 100.0 * dirtyable_mb, 1)

    pct_of_thresh = round(dirty_mb / thresh_mb * 100.0, 1) if thresh_mb > 0 else 0.0
    return {
        "dirty_mb": dirty_mb,
        "writeback_mb": writeback_mb,
        "bg_thresh_mb": bg_thresh_mb,
        "thresh_mb": thresh_mb,
        "dirty_ratio": dirty_ratio if dirty_ratio is not None else 0,
        "dirty_background_ratio": bg_ratio if bg_ratio is not None else 0,
        "mem_total_mb": mem_total_mb,
        "mem_available_mb": mem_avail_mb,
        "dirtyable_mb": round(dirtyable_mb, 1),
        "pct_of_thresh": pct_of_thresh,
        "bg_flushing": dirty_mb >= bg_thresh_mb and bg_thresh_mb > 0,
        "throttling": dirty_mb >= thresh_mb and thresh_mb > 0,
        "thresh_mode": mode,
    }


def get_filesystem_blocks(filesystem_prev=None):
    filesystem_prev = _FILESYSTEM_PREV_DEFAULT if filesystem_prev is None else filesystem_prev
    now = time.time()
    prev_ts = filesystem_prev.get("timestamp")
    dt = max(0.001, now - prev_ts) if prev_ts else 1.0

    # --- Root filesystem usage (real) -------------------------------------
    try:
        usage = psutil.disk_usage("/")
    except psutil.Error:
        usage = None
    used_percent = float(usage.percent) if usage else 0.0
    total_gb = round((usage.total / (1024**3)), 2) if usage else 0.0
    used_gb = round((usage.used / (1024**3)), 2) if usage else 0.0
    free_gb = round((usage.free / (1024**3)), 2) if usage else 0.0
    root_inodes = _statvfs_inodes("/") or {"inode_total": 0, "inode_used": 0, "inode_percent": 0.0}

    # --- Global + per-device disk I/O (real) ------------------------------
    io = psutil.disk_io_counters()
    write_bytes = int(io.write_bytes) if io else 0
    read_bytes = int(io.read_bytes) if io else 0
    prev_write = filesystem_prev.get("write_bytes")
    prev_read = filesystem_prev.get("read_bytes")
    write_bps = 0.0 if prev_write is None else max(0.0, (write_bytes - prev_write) / dt)
    read_bps = 0.0 if prev_read is None else max(0.0, (read_bytes - prev_read) / dt)

    per_disk_now = {}
    device_rates = {}
    try:
        per_disk = psutil.disk_io_counters(perdisk=True) or {}
    except (psutil.Error, OSError):
        per_disk = {}
    prev_per_disk = filesystem_prev.get("per_disk") or {}
    for name, ctr in per_disk.items():
        w = int(getattr(ctr, "write_bytes", 0))
        r = int(getattr(ctr, "read_bytes", 0))
        per_disk_now[name] = {"write": w, "read": r}
        pv = prev_per_disk.get(name)
        if pv:
            device_rates[name] = {
                "write_bps": max(0.0, (w - pv.get("write", w)) / dt),
                "read_bps": max(0.0, (r - pv.get("read", r)) / dt),
            }
        else:
            device_rates[name] = {"write_bps": 0.0, "read_bps": 0.0}

    # --- Real mount map ---------------------------------------------------
    mounts = []
    seen_mp = set()
    try:
        partitions = psutil.disk_partitions(all=False)
    except (psutil.Error, OSError):
        partitions = []
    for part in partitions:
        fstype = (part.fstype or "").lower()
        mp = part.mountpoint
        if not fstype or fstype in _PSEUDO_FSTYPES:
            continue
        if mp in seen_mp:
            continue
        try:
            u = psutil.disk_usage(mp)
        except (psutil.Error, OSError):
            continue
        if u.total <= 0:
            continue
        seen_mp.add(mp)
        base = _base_disk_name(part.device)
        rates = device_rates.get(base, {"write_bps": 0.0, "read_bps": 0.0})
        inodes = _statvfs_inodes(mp) or {"inode_total": 0, "inode_used": 0, "inode_percent": 0.0}
        mounts.append(
            {
                "device": part.device,
                "disk": base,
                "mountpoint": mp,
                "fstype": fstype,
                "total_gb": round(u.total / (1024**3), 2),
                "used_gb": round(u.used / (1024**3), 2),
                "free_gb": round(u.free / (1024**3), 2),
                "used_percent": round(float(u.percent), 1),
                "inode_total": inodes["inode_total"],
                "inode_used": inodes["inode_used"],
                "inode_percent": inodes["inode_percent"],
                "write_bps": round(rates["write_bps"], 2),
                "read_bps": round(rates["read_bps"], 2),
            }
        )
    mounts.sort(key=lambda x: x["total_gb"], reverse=True)

    devices = [
        {"name": name, "write_bps": round(r["write_bps"], 2), "read_bps": round(r["read_bps"], 2)}
        for name, r in device_rates.items()
    ]
    devices.sort(key=lambda x: (x["write_bps"] + x["read_bps"]), reverse=True)

    # The write-path "device" stage should represent the disk backing `/`,
    # not a snap loopback. Prefer the root disk; fall back to the busiest
    # real (non-loop/ram) device, then to anything available.
    root_disk = next((mnt["disk"] for mnt in mounts if mnt["mountpoint"] == "/"), None)
    if root_disk and root_disk in device_rates:
        busiest = {"name": root_disk, "write_bps": round(device_rates[root_disk]["write_bps"], 2),
                   "read_bps": round(device_rates[root_disk]["read_bps"], 2)}
    else:
        real_devs = [d for d in devices if not d["name"].startswith(("loop", "ram"))]
        pool = real_devs or devices
        busiest = pool[0] if pool else {"name": "device", "write_bps": 0.0, "read_bps": 0.0}

    # --- Dirty / writeback pages + throttling thresholds (real) -----------
    mem = _read_meminfo_kb(["Dirty", "Writeback", "MemTotal", "MemAvailable"])
    dirty_mb = round(mem.get("Dirty", 0) / 1024.0, 2)
    writeback_mb = round(mem.get("Writeback", 0) / 1024.0, 2)
    writeback_block = _build_writeback(mem, dirty_mb, writeback_mb)
    io_sched = _read_block_scheduler()

    # --- VFS activity: sampled open regular-file descriptors (real) -------
    open_files_count = 0
    try:
        for proc in list(psutil.process_iter(["pid"]))[:140]:
            try:
                open_files_count += len(proc.open_files())
            except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess, OSError):
                continue
    except (psutil.Error, OSError) as exc:
        log_event(
            logger,
            "DEBUG",
            "Failed to sample open files for VFS activity",
            event_dataset="kernel_ai.app",
            component="services.system_view",
            operation="get_filesystem_blocks",
            event_data={"error": str(exc)},
        )

    write_mb_s = write_bps / (1024 * 1024)
    read_mb_s = read_bps / (1024 * 1024)
    dev_mb_s = busiest["write_bps"] / (1024 * 1024)

    # Write-path stages (real values + 0..1 normalization to pick the hot stage).
    stages = [
        {"id": "vfs", "label": "VFS", "value": f"{open_files_count} open fds",
         "norm": round(min(1.0, open_files_count / 2500.0), 3)},
        {"id": "pagecache", "label": "PAGE CACHE", "value": f"{dirty_mb:.1f} MB dirty",
         "norm": round(min(1.0, dirty_mb / 256.0), 3)},
        {"id": "writeback", "label": "WRITEBACK", "value": f"{writeback_mb:.1f} MB",
         "norm": round(min(1.0, writeback_mb / 64.0), 3)},
        {"id": "block", "label": "BLOCK / IO SCHED", "value": f"{write_mb_s:.1f} MB/s wr",
         "norm": round(min(1.0, write_mb_s / 80.0), 3)},
        {"id": "device", "label": busiest["name"].upper(), "value": f"{dev_mb_s:.1f} MB/s",
         "norm": round(min(1.0, dev_mb_s / 80.0), 3)},
    ]
    hot = max(stages, key=lambda s: s["norm"])
    hot_id = hot["id"] if hot["norm"] > 0.02 else "block"

    filesystem_prev["timestamp"] = now
    filesystem_prev["write_bytes"] = write_bytes
    filesystem_prev["read_bytes"] = read_bytes
    filesystem_prev["per_disk"] = per_disk_now

    return {
        "timestamp": datetime.now().isoformat(),
        "mounts": mounts,
        "devices": devices,
        "writepath": {
            "stages": stages,
            "hot": hot_id,
            "write_bps": round(write_bps, 2),
            "read_bps": round(read_bps, 2),
            "open_files": open_files_count,
        },
        "writeback": writeback_block,
        "io_scheduler": io_sched,
        "meta": {
            "total_gb": total_gb,
            "used_gb": used_gb,
            "free_gb": free_gb,
            "used_percent": round(used_percent, 2),
            "write_bps": round(write_bps, 2),
            "read_bps": round(read_bps, 2),
            "write_mb_s": round(write_mb_s, 3),
            "read_mb_s": round(read_mb_s, 3),
            "dirty_mb": dirty_mb,
            "writeback_mb": writeback_mb,
            "inode_percent": root_inodes["inode_percent"],
            "inode_total": root_inodes["inode_total"],
            "inode_used": root_inodes["inode_used"],
            "mount_count": len(mounts),
            "busiest_device": busiest["name"],
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
    # Per-namespace, per-inode sample process names (each inode = one isolated "world").
    namespace_samples = {k: {} for k in namespace_keys}
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

            proc_name = proc.info.get("name") or "unknown"
            for ns_name in namespace_keys:
                inode = read_namespace_inode(pid, ns_name)
                if inode:
                    ns_map = namespace_counts[ns_name]
                    ns_map[inode] = ns_map.get(inode, 0) + 1
                    samples = namespace_samples[ns_name].setdefault(inode, [])
                    if len(samples) < 5 and proc_name not in samples:
                        samples.append(proc_name)
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
        # Top isolated "worlds" for this namespace (one per inode), richest first.
        worlds = [
            {
                "inode": inode,
                "count": count,
                "sample": namespace_samples[ns_name].get(inode, []),
            }
            for inode, count in sorted(entries.items(), key=lambda kv: kv[1], reverse=True)[:6]
        ]
        namespaces.append(
            {
                "id": ns_name,
                "label": namespace_labels[ns_name],
                "unique_count": unique_count,
                "dominant_inode": dominant_inode,
                "dominant_count": dominant_count,
                "activity": activity,
                "isolated": unique_count > 1,
                "worlds": worlds,
            }
        )

    top_cgroups = sorted(cgroup_aggregates.values(), key=lambda x: (x["process_count"], x["memory_mb_sum"]), reverse=True)[:4]
    for item in top_cgroups:
        stats = _read_cgroup_v2_stats(item["path"])
        item["memory_mb_sum"] = round(item["memory_mb_sum"], 1)
        item.update(stats)

    return {"timestamp": datetime.now().isoformat(), "processes_scanned": total_scanned, "namespaces": namespaces, "top_cgroups": top_cgroups}
