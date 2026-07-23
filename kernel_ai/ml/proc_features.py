"""Stage 5 — L1 per-process feature extraction from procfs.

Host-wide Stages 1–2 cannot name *which* process is odd. This module samples a
bounded set of PIDs and builds a small feature vector + parent→child lineage
edge per process. No root required; io/fd best-effort when readable.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field


# Helix band for process/lineage mutations (scheduler region).
PROC_POSITION = 0.12
PROC_SUBSYSTEM = "sched"

# Features scored by the per-comm EWMA baseline.
PROC_SCORE_FEATURES = ("fd_count", "num_threads", "vm_rss_mb")
PROC_MIN_STD = {
    "fd_count": 2.0,
    "num_threads": 1.0,
    "vm_rss_mb": 1.0,
}


@dataclass
class ProcSample:
    pid: int
    ppid: int
    comm: str
    parent_comm: str
    ruid: int
    euid: int
    age_sec: float
    num_threads: int
    fd_count: int
    vm_rss_mb: float
    tcp_estab: int = 0
    tcp_listen: int = 0
    features: dict[str, float] = field(default_factory=dict)

    def score_vector(self) -> dict[str, float]:
        return {
            "fd_count": float(self.fd_count),
            "num_threads": float(self.num_threads),
            "vm_rss_mb": float(self.vm_rss_mb),
        }


def _read_comm(pid: int) -> str:
    try:
        with open(f"/proc/{pid}/comm", "r", encoding="utf-8", errors="ignore") as fh:
            return (fh.read().strip() or "?")[:64]
    except OSError:
        return "?"


def _parse_stat(pid: int) -> tuple[str, str, int, int, int, int] | None:
    """Return (comm, state, ppid, minflt, num_threads, starttime)."""
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8", errors="ignore") as fh:
            raw = fh.read()
    except OSError:
        return None
    try:
        # comm may contain spaces/parens: pid (comm) state ppid ...
        lpar = raw.find("(")
        rpar = raw.rfind(")")
        if lpar < 0 or rpar < 0:
            return None
        comm = raw[lpar + 1 : rpar][:64] or "?"
        rest = raw[rpar + 2 :].split()
        # rest[0]=state, [1]=ppid, [7]=minflt, [17]=num_threads, [19]=starttime
        state = rest[0]
        ppid = int(rest[1])
        minflt = int(rest[7])
        num_threads = int(rest[17])
        starttime = int(rest[19])
        return comm, state, ppid, minflt, num_threads, starttime
    except (IndexError, ValueError):
        return None


def _read_uids(pid: int) -> tuple[int, int]:
    ruid = euid = 0
    try:
        with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if line.startswith("Uid:"):
                    parts = line.split()
                    # Uid: real effective saved fs
                    ruid = int(parts[1])
                    euid = int(parts[2])
                    break
    except (OSError, ValueError, IndexError):
        pass
    return ruid, euid


def _read_vm_rss_mb(pid: int) -> float:
    try:
        with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if line.startswith("VmRSS:"):
                    # kB
                    kb = float(line.split()[1])
                    return kb / 1024.0
    except (OSError, ValueError, IndexError):
        pass
    return 0.0


def _count_fds(pid: int) -> int:
    try:
        return len(os.listdir(f"/proc/{pid}/fd"))
    except OSError:
        return 0


def _boot_time() -> float:
    try:
        with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if line.startswith("btime "):
                    return float(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return time.time() - 1.0


def _clk_tck() -> float:
    try:
        return float(os.sysconf("SC_CLK_TCK"))
    except (ValueError, OSError, AttributeError):
        return 100.0


class ProcFeatureExtractor:
    """Sample up to ``max_pids`` interesting processes each tick."""

    def __init__(self, max_pids: int = 80) -> None:
        self.max_pids = max(8, max_pids)
        self._boot = _boot_time()
        self._hz = _clk_tck()
        self._comm_cache: dict[int, str] = {}

    def _parent_comm(self, ppid: int) -> str:
        if ppid <= 0:
            return "kernel"
        cached = self._comm_cache.get(ppid)
        if cached is not None:
            return cached
        name = _read_comm(ppid)
        self._comm_cache[ppid] = name
        return name

    def collect(self) -> list[ProcSample]:
        now = time.time()
        candidates: list[tuple[float, ProcSample]] = []
        try:
            pids = [int(d) for d in os.listdir("/proc") if d.isdigit()]
        except OSError:
            return []

        # Refresh lightly; drop stale cache entries opportunistically.
        if len(self._comm_cache) > 4096:
            self._comm_cache.clear()

        for pid in pids:
            parsed = _parse_stat(pid)
            if parsed is None:
                continue
            comm, _state, ppid, _minflt, num_threads, starttime = parsed
            self._comm_cache[pid] = comm
            age_sec = max(0.0, now - (self._boot + starttime / self._hz))
            ruid, euid = _read_uids(pid)
            fd_count = _count_fds(pid)
            vm_rss_mb = _read_vm_rss_mb(pid)
            parent_comm = self._parent_comm(ppid)
            sample = ProcSample(
                pid=pid,
                ppid=ppid,
                comm=comm,
                parent_comm=parent_comm,
                ruid=ruid,
                euid=euid,
                age_sec=age_sec,
                num_threads=num_threads,
                fd_count=fd_count,
                vm_rss_mb=vm_rss_mb,
            )
            sample.features = sample.score_vector()
            # Prefer young / privileged-odd / fd-heavy processes for the budget.
            interest = 0.0
            if age_sec < 60:
                interest += 5.0 - min(5.0, age_sec / 12.0)
            if euid == 0 and ruid != 0:
                interest += 8.0
            if fd_count > 32:
                interest += min(4.0, fd_count / 64.0)
            if num_threads > 8:
                interest += 1.0
            candidates.append((interest, sample))

        candidates.sort(key=lambda x: x[0], reverse=True)
        return [s for _, s in candidates[: self.max_pids]]
