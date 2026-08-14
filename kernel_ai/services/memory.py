"""The address space of one process, as far as /proc will say.

The MEMORY tile of the dossier is a single number: how many megabytes of this
process are resident. This module is what that number is made of.

``/proc/<pid>/maps`` is the map itself — every virtual-memory area, its
permissions and, when there is one, the file it is backed by. ``smaps_rollup``
adds the resident and proportional sizes the map does not carry. The web app
cannot read either file for a foreign process (the kernel gates them with
``PTRACE_MODE_READ_FSCREDS``), so a root collector publishes a summary to
``/run/kernel-ai/maps.json``. The summary names kinds, library basenames and
sizes. It never carries a virtual address: those would slide ASLR for every
process on a public site.

When the map is readable here (the app's own workers), it is used live. When
it is not, a fresh collector snapshot is used. When neither is there, only
``/proc/<pid>/status`` remains, and the payload says so rather than filling a
region in from a total.
"""

from __future__ import annotations

import json
import os
import re
import time

PROC = "/proc"
SNAPSHOT = os.environ.get("MAPS_OUT", "/run/kernel-ai/maps.json")
SNAPSHOT_SOCK = os.environ.get("MAPS_SOCK", "/run/kernel-ai/maps.sock")
SNAPSHOT_MAX_AGE_S = 30.0
MAX_LIBRARIES = 10
MAX_STACKS = 12

MAP_RE = re.compile(
    r"^([0-9a-f]+)-([0-9a-f]+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$"
)
STACK_RE = re.compile(r"^\[stack(?::(\d+))?\]$")


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


def _kb(text, key):
    prefix = f"{key}:"
    for line in text.splitlines():
        if line.startswith(prefix):
            parts = line.split()
            try:
                return int(parts[1])
            except (IndexError, ValueError):
                return None
    return None


def _basename(path):
    if not path:
        return None
    return path.rsplit("/", 1)[-1]


def classify(path, perms):
    """What kind of area this is, from the name the kernel printed.

    A mapping with no permissions is not memory in use: Chromium and friends
    reserve terabytes of address space they never touch. Those areas are kept
    as their own kind so they do not swallow the rest of the map.
    """
    path = path or ""
    if perms.startswith("---"):
        return "reserved"
    if path == "[heap]":
        return "heap"
    if STACK_RE.match(path):
        return "stack"
    if path.startswith("[vdso") or path.startswith("[vvar") or path in (
        "[vsyscall]", "[uprobes]", "[sigpage]", "[vectors]",
    ):
        return "vdso"
    if path.startswith("[anon:") or path.startswith("[anon_shmem:") or path == "[vvar_vclock]":
        return "anonymous"
    if path.startswith("/dev/"):
        return "device"
    if path.startswith("[") and path.endswith("]"):
        return "other"
    if path:
        name = _basename(path)
        if name and (name.endswith(".so") or ".so." in name):
            return "library"
        if perms.startswith("r-x"):
            return "code"
        return "file"
    return "anonymous"


def parse_maps(text):
    """Every VMA, classified, with consecutive same-(kind, path) runs merged."""
    rows = []
    for line in text.splitlines():
        found = MAP_RE.match(line)
        if not found:
            continue
        start = int(found.group(1), 16)
        end = int(found.group(2), 16)
        if end <= start:
            continue
        perms = found.group(3)
        path = (found.group(7) or "").strip()
        kind = classify(path, perms)
        stack = STACK_RE.match(path)
        rows.append({
            "start": start,
            "end": end,
            "size_kb": (end - start) // 1024,
            "perms": perms,
            "path": path or None,
            "kind": kind,
            "tid": int(stack.group(1)) if stack and stack.group(1) else None,
        })

    merged = []
    for row in rows:
        prev = merged[-1] if merged else None
        if prev and prev["kind"] == row["kind"] and prev["path"] == row["path"] and prev["end"] == row["start"]:
            prev["end"] = row["end"]
            prev["size_kb"] += row["size_kb"]
            continue
        merged.append(dict(row))
    return merged


def _rollup(text):
    if not text:
        return None
    return {
        "rss_kb": _kb(text, "Rss"),
        "pss_kb": _kb(text, "Pss"),
        "anonymous_kb": _kb(text, "Anonymous"),
        "swap_kb": _kb(text, "Swap"),
        "shared_kb": (_kb(text, "Shared_Clean") or 0) + (_kb(text, "Shared_Dirty") or 0),
        "private_kb": (_kb(text, "Private_Clean") or 0) + (_kb(text, "Private_Dirty") or 0),
    }


def _publishable(payload):
    """Strip anything that would slide ASLR or name a directory on disk.

    Addresses stay inside ``parse_maps`` so adjacent regions can be merged.
    Full paths stay there so a library can be told from the executable. What
    leaves this function — the API and the world-readable snapshot — is
    kinds, basenames and sizes.
    """
    out = dict(payload)
    exe = out.get("executable")
    if exe:
        out["executable"] = {
            "name": exe.get("name") or _basename(exe.get("path")),
            "virtual_kb": exe.get("virtual_kb"),
        }
    libs = []
    for lib in out.get("libraries") or []:
        libs.append({
            "name": lib.get("name") or _basename(lib.get("path")),
            "virtual_kb": lib.get("virtual_kb"),
            "count": lib.get("count"),
        })
    out["libraries"] = libs
    return out


def _from_regions(pid, comm, regions, rollup, status, maps_available, rollup_available):
    kinds = {}
    libraries = {}
    stacks = []
    executable = None
    heap_kb = 0
    for row in regions:
        kind = row["kind"]
        bucket = kinds.setdefault(kind, {"kind": kind, "virtual_kb": 0, "count": 0})
        bucket["virtual_kb"] += row["size_kb"]
        bucket["count"] += 1
        if kind == "library" and row["path"]:
            lib = libraries.setdefault(row["path"], {
                "path": row["path"],
                "name": _basename(row["path"]),
                "virtual_kb": 0,
                "count": 0,
            })
            lib["virtual_kb"] += row["size_kb"]
            lib["count"] += 1
        elif kind == "stack":
            stacks.append({
                "tid": row["tid"] or pid,
                "virtual_kb": row["size_kb"],
                "main": row["path"] == "[stack]",
            })
        elif kind == "code" and executable is None and row["path"]:
            executable = {"path": row["path"], "name": _basename(row["path"])}
        elif kind == "heap":
            heap_kb += row["size_kb"]
        if executable and row["path"] == executable["path"]:
            executable["virtual_kb"] = executable.get("virtual_kb", 0) + row["size_kb"]

    lib_rows = sorted(libraries.values(), key=lambda r: -r["virtual_kb"])
    kind_rows = sorted(kinds.values(), key=lambda r: -r["virtual_kb"])
    stacks.sort(key=lambda r: (not r["main"], -r["virtual_kb"]))

    virtual_kb = sum(r["size_kb"] for r in regions)
    if not virtual_kb:
        virtual_kb = _kb(status, "VmSize")

    return _publishable({
        "pid": pid,
        "comm": comm,
        "totals": {
            "virtual_kb": virtual_kb,
            "rss_kb": (rollup or {}).get("rss_kb") or _kb(status, "VmRSS"),
            "pss_kb": (rollup or {}).get("pss_kb"),
            "swap_kb": (rollup or {}).get("swap_kb") if rollup else _kb(status, "VmSwap"),
            "private_kb": (rollup or {}).get("private_kb"),
            "shared_kb": (rollup or {}).get("shared_kb"),
            "exe_kb": _kb(status, "VmExe"),
            "lib_kb": _kb(status, "VmLib"),
            "data_kb": _kb(status, "VmData"),
            "stack_kb": _kb(status, "VmStk"),
        },
        "kinds": kind_rows,
        "libraries": lib_rows[:MAX_LIBRARIES],
        "library_count": len(lib_rows),
        "stacks": stacks[:MAX_STACKS],
        "stack_count": len(stacks),
        "executable": executable,
        "heap_kb": heap_kb or None,
        "sources": {
            "maps": {"available": maps_available},
            "rollup": {"available": rollup_available},
            "status": {"available": bool(status)},
        },
    })


def _snapshot(path=None, max_age_s=SNAPSHOT_MAX_AGE_S):
    snap = path or SNAPSHOT
    try:
        age = max(0.0, time.time() - os.path.getmtime(snap))
    except OSError:
        return None, {"available": False, "reason": "no-collector"}
    if age > max_age_s:
        return None, {"available": False, "reason": "stale", "age_s": round(age, 1)}
    try:
        with open(snap, "r", encoding="utf-8", errors="ignore") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None, {"available": False, "reason": "unreadable"}
    if not isinstance(data, dict):
        return None, {"available": False, "reason": "malformed"}
    return data, {"available": True, "age_s": round(age, 1)}


def _merge_live_totals(snap_totals, status):
    """Resident size is world-readable; keep it current over a 3-second map."""
    out = dict(snap_totals or {})
    live = {
        "rss_kb": _kb(status, "VmRSS"),
        "swap_kb": _kb(status, "VmSwap"),
        "exe_kb": _kb(status, "VmExe"),
        "lib_kb": _kb(status, "VmLib"),
        "data_kb": _kb(status, "VmData"),
        "stack_kb": _kb(status, "VmStk"),
    }
    for key, value in live.items():
        if value is not None:
            out[key] = value
    return out


def _status_tgid(status, pid):
    tgid = _kb(status, "Tgid")
    return tgid if tgid else pid


def _snapshot_row(data, pid, status):
    """The published summary for this pid, or for the thread-group it belongs to."""
    procs = data.get("processes") or {}
    row = procs.get(str(pid))
    if isinstance(row, dict):
        return row
    tgid = _status_tgid(status, pid)
    if tgid != pid:
        row = procs.get(str(tgid))
        if isinstance(row, dict):
            return row
    alias = (data.get("threads") or {}).get(str(pid))
    if alias:
        row = procs.get(str(alias))
        if isinstance(row, dict):
            return row
    return None


def _from_snapshot(pid, comm, status):
    data, meta = _snapshot()
    if not data:
        return None, meta
    row = _snapshot_row(data, pid, status)
    if not isinstance(row, dict):
        return None, meta
    return _publishable({
        "pid": pid,
        "comm": comm or row.get("comm"),
        "totals": _merge_live_totals(row.get("totals"), status),
        "kinds": row.get("kinds") or [],
        "libraries": row.get("libraries") or [],
        "library_count": row.get("library_count") or 0,
        "stacks": row.get("stacks") or [],
        "stack_count": row.get("stack_count") or 0,
        "executable": row.get("executable"),
        "heap_kb": row.get("heap_kb"),
        "sources": {
            "maps": {"available": True, "via": "collector", "age_s": meta.get("age_s")},
            "rollup": {"available": True, "via": "collector"},
            "status": {"available": bool(status)},
        },
    }), meta


def collect_one(pid):
    """Public summary of one process, or None if there is no map to publish.

    Used by the root collector. Addresses and directory paths are stripped
    before this returns, so the snapshot can be world-readable.
    """
    pid = int(pid)
    maps_text = _read(f"{PROC}/{pid}/maps")
    if maps_text is None:
        return None
    status = _read(f"{PROC}/{pid}/status") or ""
    rollup_text = _read(f"{PROC}/{pid}/smaps_rollup")
    comm = _read(f"{PROC}/{pid}/comm")
    comm = comm.strip() if comm else None
    row = _from_regions(
        pid, comm, parse_maps(maps_text), _rollup(rollup_text),
        status, True, rollup_text is not None,
    )
    if not row.get("kinds"):
        return None
    return {
        "comm": row.get("comm"),
        "totals": row.get("totals"),
        "kinds": row.get("kinds"),
        "libraries": row.get("libraries"),
        "library_count": row.get("library_count"),
        "stacks": row.get("stacks"),
        "stack_count": row.get("stack_count"),
        "executable": row.get("executable"),
        "heap_kb": row.get("heap_kb"),
    }


def collect_all(previous=None):
    """Every userspace process the caller can see a map for, without addresses.

    ``previous`` keeps the last good summary for a pid whose map just went
    empty (a zombie still has VmSize in status). Threads are indexed onto
    their thread-group so a click on a tid still finds the map.
    """
    processes = {}
    threads = {}
    previous = previous or {}
    try:
        names = os.listdir(PROC)
    except OSError:
        names = []
    for name in names:
        if not name.isdigit():
            continue
        row = collect_one(int(name))
        if not row:
            old = previous.get(name)
            status = _read(f"{PROC}/{name}/status") or ""
            if old and _kb(status, "VmSize"):
                row = old
        if not row:
            continue
        processes[name] = row
        try:
            tids = os.listdir(f"{PROC}/{name}/task")
        except OSError:
            tids = []
        for tid in tids:
            if tid.isdigit() and tid != name:
                threads[tid] = name
    return {"ts": time.time(), "processes": processes, "threads": threads}


def _ask_collector(pid):
    """Wake the root collector for this pid. The answer lands in the snapshot."""
    try:
        import socket
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        try:
            sock.settimeout(0.05)
            sock.sendto(str(int(pid)).encode("ascii"), SNAPSHOT_SOCK)
        finally:
            sock.close()
        return True
    except OSError:
        return False


def describe(pid):
    """The address space of this process, as far as /proc can honestly say."""
    pid = int(pid)
    if not os.path.isdir(f"{PROC}/{pid}"):
        return {"pid": pid, "error": "no such process"}

    status = _read(f"{PROC}/{pid}/status") or ""
    maps_text = _read(f"{PROC}/{pid}/maps")
    rollup_text = _read(f"{PROC}/{pid}/smaps_rollup")
    comm = _read(f"{PROC}/{pid}/comm")
    comm = comm.strip() if comm else None

    # A live map with actual areas wins. An empty file is not a map: some
    # kernels open /proc/pid/maps and print nothing when the ptrace check
    # fails, and a zombie keeps its status totals after the map is gone.
    if maps_text:
        return _from_regions(
            pid, comm, parse_maps(maps_text), _rollup(rollup_text),
            status, True, rollup_text is not None,
        )

    snapped, _meta = _from_snapshot(pid, comm, status)
    if snapped:
        return snapped

    if _kb(status, "VmSize") and _ask_collector(pid):
        for _ in range(6):
            time.sleep(0.05)
            snapped, _meta = _from_snapshot(pid, comm, status)
            if snapped:
                return snapped

    return _from_regions(
        pid, comm, [], _rollup(rollup_text),
        status, bool(maps_text is not None), rollup_text is not None,
    )
