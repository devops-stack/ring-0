"""Entropy-related helpers for crypto subsystem."""

from __future__ import annotations

import logging
import time

import psutil

logger = logging.getLogger(__name__)


def read_sysctl_int(path, default=0):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read().strip()
        return int(raw or default)
    except (OSError, ValueError, TypeError):
        return int(default)


def read_proc_interrupt_total():
    try:
        with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("intr "):
                    parts = line.strip().split()
                    if len(parts) >= 2:
                        return int(parts[1])
    except (OSError, ValueError):
        return 0
    return 0


def collect_entropy_cloud_status(entropy_prev):
    """Collect Linux random subsystem entropy status and source activity."""
    now = time.time()
    entropy_bits = read_sysctl_int("/proc/sys/kernel/random/entropy_avail", 0)
    pool_size_bits = read_sysctl_int("/proc/sys/kernel/random/poolsize", 256)
    read_threshold = read_sysctl_int("/proc/sys/kernel/random/read_wakeup_threshold", 128)
    write_threshold = read_sysctl_int("/proc/sys/kernel/random/write_wakeup_threshold", 64)
    try:
        disk = psutil.disk_io_counters()
    except psutil.Error:
        disk = None
    try:
        net = psutil.net_io_counters()
    except psutil.Error:
        net = None
    intr_total = read_proc_interrupt_total()
    prev_ts = entropy_prev.get("timestamp")
    dt = max(now - prev_ts, 0.001) if prev_ts else None
    disk_read_now = int(getattr(disk, "read_bytes", 0) or 0)
    disk_write_now = int(getattr(disk, "write_bytes", 0) or 0)
    net_sent_now = int(getattr(net, "bytes_sent", 0) or 0)
    net_recv_now = int(getattr(net, "bytes_recv", 0) or 0)
    if dt:
        disk_delta = max((disk_read_now - int(entropy_prev.get("disk_read_bytes") or disk_read_now)) + (disk_write_now - int(entropy_prev.get("disk_write_bytes") or disk_write_now)), 0)
        net_delta = max((net_sent_now - int(entropy_prev.get("net_sent_bytes") or net_sent_now)) + (net_recv_now - int(entropy_prev.get("net_recv_bytes") or net_recv_now)), 0)
        intr_delta = max(intr_total - int(entropy_prev.get("interrupt_total") or intr_total), 0)
    else:
        disk_delta = 0
        net_delta = 0
        intr_delta = 0
    entropy_prev["timestamp"] = now
    entropy_prev["disk_read_bytes"] = disk_read_now
    entropy_prev["disk_write_bytes"] = disk_write_now
    entropy_prev["net_sent_bytes"] = net_sent_now
    entropy_prev["net_recv_bytes"] = net_recv_now
    entropy_prev["interrupt_total"] = intr_total

    def scale_intensity(rate_value, scale):
        return int(max(0, min(100, (float(rate_value) / float(scale)) * 100.0)))

    disk_rate = (disk_delta / dt) if dt else 0
    net_rate = (net_delta / dt) if dt else 0
    intr_rate = (intr_delta / dt) if dt else 0
    irq_intensity = scale_intensity(intr_rate, 25000)
    disk_intensity = scale_intensity(disk_rate, 80 * 1024 * 1024)
    net_intensity = scale_intensity(net_rate, 120 * 1024 * 1024)
    hwrng_intensity = 68 if entropy_bits > max(read_threshold, 128) else 34
    sources = [
        {"source": "interrupt timing", "intensity": irq_intensity, "status": "active" if irq_intensity >= 25 else "low"},
        {"source": "disk IO", "intensity": disk_intensity, "status": "active" if disk_intensity >= 18 else "low"},
        {"source": "network timing", "intensity": net_intensity, "status": "active" if net_intensity >= 18 else "low"},
        {"source": "hardware RNG", "intensity": hwrng_intensity, "status": "active" if hwrng_intensity >= 50 else "limited"},
    ]
    source_avg = int(sum(s["intensity"] for s in sources) / max(len(sources), 1))
    entropy_pct = max(0.0, min(1.0, float(entropy_bits) / max(float(pool_size_bits), 1.0)))
    particle_density = max(16, min(84, int(18 + entropy_pct * 42 + source_avg * 0.35)))
    key_birth_rate = round(0.6 + entropy_pct * 9.4 + source_avg * 0.06, 2)
    crng_state = "ready" if entropy_bits >= max(read_threshold, 128) else "warming"
    random_state = "stable" if entropy_bits >= max(write_threshold, 64) else "refilling"
    return {
        "entropy_pool_bits": int(entropy_bits),
        "entropy_pool_size_bits": int(pool_size_bits),
        "crng_state": crng_state,
        "random_subsystem_state": random_state,
        "particle_density": int(particle_density),
        "key_birth_rate_est": float(key_birth_rate),
        "sources": sources,
        "read_wakeup_threshold": int(read_threshold),
        "write_wakeup_threshold": int(write_threshold),
        "mode": "live-heuristic",
    }
