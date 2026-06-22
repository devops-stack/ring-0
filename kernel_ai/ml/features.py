"""Feature extraction from procfs.

Turns raw kernel counters into a flat ``{name: float}`` feature vector once per
tick. Monotonic counters (context switches, page faults, retransmits, ...) are
converted into per-second *rates* using the previous snapshot, because rates —
not absolute totals — are what reveal an attack-shaped spike.

Each feature also carries metadata (subsystem + helix position + a noise floor)
so a detected anomaly can be mapped straight onto the Kernel DNA visualization.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    subsystem: str
    # Position on the DNA helix (0..1), aligned with the gene bands:
    # sched 0.0-0.2, net 0.2-0.4, fs 0.4-0.6, mm 0.6-0.8, drivers 0.8-1.0.
    position: float
    # Absolute noise floor for the std used in the z-score. Prevents a quiet,
    # near-constant feature from firing on microscopic deviations.
    min_std: float
    label: str


FEATURE_SPECS: dict[str, FeatureSpec] = {
    "proc_count": FeatureSpec("proc_count", "sched", 0.06, 3.0, "processes"),
    "procs_running": FeatureSpec("procs_running", "sched", 0.10, 1.0, "runnable now"),
    "procs_blocked": FeatureSpec("procs_blocked", "sched", 0.14, 1.0, "blocked (D)"),
    "ctxt_per_sec": FeatureSpec("ctxt_per_sec", "sched", 0.18, 50.0, "context switches/s"),
    "run_queue": FeatureSpec("run_queue", "sched", 0.16, 1.0, "run-queue depth"),
    "load1": FeatureSpec("load1", "sched", 0.08, 0.2, "loadavg 1m"),
    "tcp_retrans_per_sec": FeatureSpec("tcp_retrans_per_sec", "net", 0.30, 0.5, "TCP retrans/s"),
    "tcp_inseg_per_sec": FeatureSpec("tcp_inseg_per_sec", "net", 0.26, 20.0, "TCP in segs/s"),
    "tcp_outseg_per_sec": FeatureSpec("tcp_outseg_per_sec", "net", 0.34, 20.0, "TCP out segs/s"),
    "net_softirq_per_sec": FeatureSpec("net_softirq_per_sec", "net", 0.38, 20.0, "NET softirq/s"),
    "block_softirq_per_sec": FeatureSpec("block_softirq_per_sec", "fs", 0.46, 5.0, "BLOCK softirq/s"),
    "pgfault_per_sec": FeatureSpec("pgfault_per_sec", "mm", 0.62, 50.0, "minor faults/s"),
    "pgmajfault_per_sec": FeatureSpec("pgmajfault_per_sec", "mm", 0.68, 1.0, "major faults/s"),
    "pgscan_direct_per_sec": FeatureSpec("pgscan_direct_per_sec", "mm", 0.72, 5.0, "direct reclaim/s"),
    "swap_io_per_sec": FeatureSpec("swap_io_per_sec", "mm", 0.76, 1.0, "swap io/s"),
    "psi_mem_some10": FeatureSpec("psi_mem_some10", "mm", 0.64, 0.5, "mem PSI some10"),
    "psi_mem_full10": FeatureSpec("psi_mem_full10", "mm", 0.78, 0.3, "mem PSI full10"),
    "hardirq_per_sec": FeatureSpec("hardirq_per_sec", "drivers", 0.90, 50.0, "hard IRQ/s"),
    "cpu_busy_pct": FeatureSpec("cpu_busy_pct", "drivers", 0.86, 3.0, "cpu busy %"),
}


def _read_kv(path: str) -> dict[str, int]:
    out: dict[str, int] = {}
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            for raw in f:
                parts = raw.split()
                if len(parts) == 2:
                    try:
                        out[parts[0]] = int(parts[1])
                    except ValueError:
                        continue
    except OSError:
        return {}
    return out


def _read_psi_mem() -> tuple[float, float]:
    some = full = 0.0
    try:
        with open("/proc/pressure/memory", "r", encoding="utf-8", errors="ignore") as f:
            for raw in f:
                parts = raw.split()
                if not parts:
                    continue
                target = parts[0]
                for tok in parts[1:]:
                    if tok.startswith("avg10="):
                        try:
                            val = float(tok.split("=", 1)[1])
                        except ValueError:
                            val = 0.0
                        if target == "some":
                            some = val
                        elif target == "full":
                            full = val
    except OSError:
        pass
    return some, full


def _read_loadavg() -> tuple[float, int]:
    try:
        with open("/proc/loadavg", "r", encoding="utf-8", errors="ignore") as f:
            parts = f.read().split()
        load1 = float(parts[0])
        runnable = int(parts[3].split("/", 1)[0]) if len(parts) >= 4 and "/" in parts[3] else 0
        return load1, runnable
    except (OSError, ValueError, IndexError):
        return 0.0, 0


def _read_stat() -> dict:
    out = {"ctxt": 0, "procs_running": 0, "procs_blocked": 0, "cpu_busy": 0, "cpu_total": 0}
    try:
        with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("cpu "):
                    nums = [int(x) for x in line.split()[1:] if x.isdigit()]
                    if len(nums) >= 4:
                        idle = nums[3] + (nums[4] if len(nums) > 4 else 0)
                        total = sum(nums)
                        out["cpu_busy"] = total - idle
                        out["cpu_total"] = total
                elif line.startswith("ctxt "):
                    out["ctxt"] = int(line.split()[1])
                elif line.startswith("procs_running "):
                    out["procs_running"] = int(line.split()[1])
                elif line.startswith("procs_blocked "):
                    out["procs_blocked"] = int(line.split()[1])
    except (OSError, ValueError):
        pass
    return out


def _read_tcp_snmp() -> dict[str, int]:
    out = {"RetransSegs": 0, "InSegs": 0, "OutSegs": 0}
    try:
        with open("/proc/net/snmp", "r", encoding="utf-8", errors="ignore") as f:
            lines = [ln.strip() for ln in f if ln.startswith("Tcp:")]
        if len(lines) >= 2:
            headers = lines[-2].split()[1:]
            values = lines[-1].split()[1:]
            for key, value in zip(headers, values):
                if key in out:
                    try:
                        out[key] = int(value)
                    except ValueError:
                        pass
    except OSError:
        pass
    return out


def _read_softirq_totals() -> dict[str, int]:
    totals: dict[str, int] = {}
    try:
        with open("/proc/softirqs", "r", encoding="utf-8", errors="ignore") as f:
            for raw in f.readlines()[1:]:
                if ":" not in raw:
                    continue
                left, right = raw.split(":", 1)
                totals[left.strip()] = sum(int(t) for t in right.split() if t.isdigit())
    except OSError:
        return {}
    return totals


def _read_hardirq_total() -> int:
    total = 0
    try:
        with open("/proc/interrupts", "r", encoding="utf-8", errors="ignore") as f:
            for raw in f.readlines()[1:]:
                if ":" not in raw:
                    continue
                _, right = raw.split(":", 1)
                for tok in right.split():
                    if tok.isdigit():
                        total += int(tok)
                    else:
                        break
    except OSError:
        return 0
    return total


def _count_procs() -> int:
    try:
        return sum(1 for d in os.listdir("/proc") if d.isdigit())
    except OSError:
        return 0


class FeatureExtractor:
    """Stateful procfs reader: holds the previous counter snapshot to derive
    per-second rates. Call :meth:`collect` once per tick."""

    def __init__(self) -> None:
        self._prev: dict[str, float] | None = None
        self._prev_ts: float | None = None

    def collect(self) -> dict[str, float] | None:
        now = time.time()
        stat = _read_stat()
        vmstat = _read_kv("/proc/vmstat")
        tcp = _read_tcp_snmp()
        softirq = _read_softirq_totals()
        hardirq = _read_hardirq_total()
        psi_some, psi_full = _read_psi_mem()
        load1, run_queue = _read_loadavg()

        raw = {
            "ctxt": float(stat["ctxt"]),
            "pgfault": float(vmstat.get("pgfault", 0)),
            "pgmajfault": float(vmstat.get("pgmajfault", 0)),
            "pgscan_direct": float(vmstat.get("pgscan_direct", 0)),
            "swap_io": float(vmstat.get("pswpin", 0) + vmstat.get("pswpout", 0)),
            "tcp_retrans": float(tcp["RetransSegs"]),
            "tcp_inseg": float(tcp["InSegs"]),
            "tcp_outseg": float(tcp["OutSegs"]),
            "net_softirq": float(softirq.get("NET_RX", 0) + softirq.get("NET_TX", 0)),
            "block_softirq": float(softirq.get("BLOCK", 0)),
            "hardirq": float(hardirq),
            "cpu_busy": float(stat["cpu_busy"]),
            "cpu_total": float(stat["cpu_total"]),
        }

        prev, prev_ts = self._prev, self._prev_ts
        self._prev, self._prev_ts = raw, now

        # First sample: no previous counters, so rates are undefined. Skip it.
        if prev is None or prev_ts is None:
            return None
        dt = now - prev_ts
        if dt <= 0:
            return None

        def rate(key: str) -> float:
            return max(0.0, (raw[key] - prev.get(key, raw[key])) / dt)

        cpu_total_delta = raw["cpu_total"] - prev.get("cpu_total", raw["cpu_total"])
        cpu_busy_delta = raw["cpu_busy"] - prev.get("cpu_busy", raw["cpu_busy"])
        cpu_busy_pct = (cpu_busy_delta / cpu_total_delta * 100.0) if cpu_total_delta > 0 else 0.0

        return {
            "proc_count": float(_count_procs()),
            "procs_running": float(stat["procs_running"]),
            "procs_blocked": float(stat["procs_blocked"]),
            "ctxt_per_sec": rate("ctxt"),
            "run_queue": float(run_queue),
            "load1": load1,
            "tcp_retrans_per_sec": rate("tcp_retrans"),
            "tcp_inseg_per_sec": rate("tcp_inseg"),
            "tcp_outseg_per_sec": rate("tcp_outseg"),
            "net_softirq_per_sec": rate("net_softirq"),
            "block_softirq_per_sec": rate("block_softirq"),
            "pgfault_per_sec": rate("pgfault"),
            "pgmajfault_per_sec": rate("pgmajfault"),
            "pgscan_direct_per_sec": rate("pgscan_direct"),
            "swap_io_per_sec": rate("swap_io"),
            "psi_mem_some10": psi_some,
            "psi_mem_full10": psi_full,
            "hardirq_per_sec": rate("hardirq"),
            "cpu_busy_pct": max(0.0, min(100.0, cpu_busy_pct)),
        }
