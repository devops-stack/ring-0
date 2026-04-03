"""Device realtime telemetry service."""

from __future__ import annotations

import os
import re
import time
from datetime import datetime

import psutil


def _read_major_minor_from_devfile(devfile_path):
    try:
        with open(devfile_path, "r", encoding="utf-8", errors="ignore") as f:
            value = f.read().strip()
    except Exception:
        return (None, None)
    if not value or ":" not in value:
        return (None, None)
    major_s, minor_s = value.split(":", 1)
    try:
        return (int(major_s), int(minor_s))
    except ValueError:
        return (None, None)


def _driver_from_symlink(base_path):
    link_path = os.path.join(base_path, "device", "driver")
    try:
        if os.path.islink(link_path):
            return os.path.basename(os.path.realpath(link_path))
    except OSError:
        pass
    return None


def _detect_bus(sys_path, category):
    if category == "net":
        return "net"
    try:
        real = os.path.realpath(sys_path).lower()
    except OSError:
        real = str(sys_path).lower()
    if "/usb" in real:
        return "usb"
    if "/pci" in real:
        return "pcie"
    if "/virtual" in real:
        return "virtual"
    return "pcie"


def _irq_total_for_tokens(interrupt_lines, tokens):
    if not tokens:
        return 0
    token_set = [t.lower() for t in tokens if t]
    total = 0
    for line_lower, irq_total in interrupt_lines:
        if any(tok in line_lower for tok in token_set):
            total += irq_total
    return total


def _subsystem_for_category(category):
    mapping = {
        "block": "file-system",
        "net": "network-stack",
        "char": "io-control",
        "misc": "driver-core",
        "usb": "usb-core",
        "input": "input-subsystem",
        "gpu": "drm-kms",
    }
    return mapping.get(category, "kernel-core")


def _user_interaction_for_category(category):
    mapping = {
        "block": "open/read/write/ioctl",
        "net": "socket/send/recv",
        "char": "read/write/ioctl",
        "misc": "ioctl/control",
        "usb": "udev/hotplug/ioctl",
        "input": "events -> userspace",
        "gpu": "drm ioctl/mmap",
    }
    return mapping.get(category, "syscall/ioctl")


def _collect_block_devices(disk_now, dt, devices_prev):
    devices = []
    for name, sectors_total in disk_now.items():
        prev = devices_prev["disk_sectors"].get(name)
        delta_sectors = max(0, sectors_total - prev) if prev is not None else 0
        bps = (delta_sectors * 512) / dt
        sys_path = os.path.join("/sys/block", name)
        major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
        devices.append(
            {
                "name": name,
                "category": "block",
                "bus": _detect_bus(sys_path, "block"),
                "sys_path": sys_path,
                "driver": _driver_from_symlink(sys_path),
                "major": major,
                "minor": minor,
                "throughput_bps": bps,
                "irq_tokens": [name],
                "subsystem": _subsystem_for_category("block"),
                "user_interaction": _user_interaction_for_category("block"),
            }
        )
    return devices


def _collect_net_devices(dt, devices_prev):
    devices = []
    net_now = {}
    try:
        pernic = psutil.net_io_counters(pernic=True)
        for iface, counters in pernic.items():
            total_bytes = counters.bytes_recv + counters.bytes_sent
            net_now[iface] = total_bytes
            prev = devices_prev["net_bytes"].get(iface)
            delta = max(0, total_bytes - prev) if prev is not None else 0
            bps = delta / dt
            sys_path = os.path.join("/sys/class/net", iface)
            major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
            devices.append(
                {
                    "name": iface,
                    "category": "net",
                    "bus": "net",
                    "sys_path": sys_path,
                    "driver": _driver_from_symlink(sys_path),
                    "major": major,
                    "minor": minor,
                    "throughput_bps": bps,
                    "irq_tokens": [iface],
                    "errors": int(counters.errin + counters.errout),
                    "drops": int(counters.dropin + counters.dropout),
                    "subsystem": _subsystem_for_category("net"),
                    "user_interaction": _user_interaction_for_category("net"),
                }
            )
    except Exception:
        return [], {}
    return devices, net_now


def _collect_char_devices():
    devices = []
    seeds = [("tty0", "/sys/class/tty/tty0"), ("null", "/sys/devices/virtual/mem/null"), ("random", "/sys/devices/virtual/mem/random")]
    for name, sys_path in seeds:
        major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
        devices.append(
            {
                "name": name,
                "category": "char",
                "bus": _detect_bus(sys_path, "char"),
                "sys_path": sys_path,
                "driver": _driver_from_symlink(sys_path),
                "major": major,
                "minor": minor,
                "throughput_bps": 0.0,
                "irq_tokens": [name, "tty"] if "tty" in name else [name],
                "subsystem": _subsystem_for_category("char"),
                "user_interaction": _user_interaction_for_category("char"),
            }
        )
    return devices


def _collect_misc_input_gpu_usb():
    out = []
    misc_path = "/sys/class/misc"
    if os.path.isdir(misc_path):
        for name in sorted(os.listdir(misc_path))[:4]:
            sys_path = os.path.join(misc_path, name)
            major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
            out.append(
                {
                    "name": name,
                    "category": "misc",
                    "bus": _detect_bus(sys_path, "misc"),
                    "sys_path": sys_path,
                    "driver": _driver_from_symlink(sys_path),
                    "major": major,
                    "minor": minor,
                    "throughput_bps": 0.0,
                    "irq_tokens": [name],
                    "subsystem": _subsystem_for_category("misc"),
                    "user_interaction": _user_interaction_for_category("misc"),
                }
            )

    input_path = "/sys/class/input"
    if os.path.isdir(input_path):
        for name in sorted(os.listdir(input_path)):
            if not name.startswith("event"):
                continue
            sys_path = os.path.join(input_path, name)
            major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
            out.append(
                {
                    "name": name,
                    "category": "input",
                    "bus": _detect_bus(sys_path, "input"),
                    "sys_path": sys_path,
                    "driver": _driver_from_symlink(sys_path),
                    "major": major,
                    "minor": minor,
                    "throughput_bps": 0.0,
                    "irq_tokens": [name, "input"],
                    "subsystem": _subsystem_for_category("input"),
                    "user_interaction": _user_interaction_for_category("input"),
                }
            )
            if len([d for d in out if d["category"] == "input"]) >= 4:
                break

    drm_path = "/sys/class/drm"
    if os.path.isdir(drm_path):
        for name in sorted(os.listdir(drm_path)):
            if not re.match(r"^card\d+$", name):
                continue
            sys_path = os.path.join(drm_path, name)
            major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
            out.append(
                {
                    "name": name,
                    "category": "gpu",
                    "bus": _detect_bus(sys_path, "gpu"),
                    "sys_path": sys_path,
                    "driver": _driver_from_symlink(sys_path),
                    "major": major,
                    "minor": minor,
                    "throughput_bps": 0.0,
                    "irq_tokens": [name, "drm", "gpu"],
                    "subsystem": _subsystem_for_category("gpu"),
                    "user_interaction": _user_interaction_for_category("gpu"),
                }
            )
            if len([d for d in out if d["category"] == "gpu"]) >= 2:
                break

    usb_path = "/sys/bus/usb/devices"
    if os.path.isdir(usb_path):
        for name in sorted(os.listdir(usb_path)):
            if ":" in name or name in ("usb1", "usb2", "usb3", "usb4"):
                continue
            sys_path = os.path.join(usb_path, name)
            if not os.path.isdir(sys_path):
                continue
            out.append(
                {
                    "name": name,
                    "category": "usb",
                    "bus": "usb",
                    "sys_path": sys_path,
                    "driver": _driver_from_symlink(sys_path),
                    "major": None,
                    "minor": None,
                    "throughput_bps": 0.0,
                    "irq_tokens": [name, "usb"],
                    "subsystem": _subsystem_for_category("usb"),
                    "user_interaction": _user_interaction_for_category("usb"),
                }
            )
            if len([d for d in out if d["category"] == "usb"]) >= 4:
                break

    return out


def get_devices_realtime(devices_prev, read_diskstats_fn, read_interrupt_lines_fn, read_tty_irq_total_fn):
    now = time.time()
    prev_ts = devices_prev["timestamp"]
    dt = max(0.001, now - prev_ts) if prev_ts else 1.0
    disk_now = read_diskstats_fn()
    block_devices = _collect_block_devices(disk_now, dt, devices_prev)
    net_devices, net_now = _collect_net_devices(dt, devices_prev)
    char_devices = _collect_char_devices()
    extra_devices = _collect_misc_input_gpu_usb()
    devices = block_devices + net_devices + char_devices + extra_devices
    interrupt_lines = read_interrupt_lines_fn()

    max_bps = max([d.get("throughput_bps", 0.0) for d in devices] + [1.0])
    for d in devices:
        key = f"{d.get('category','unknown')}::{d.get('name','unknown')}"
        irq_total = _irq_total_for_tokens(interrupt_lines, d.get("irq_tokens", []))
        prev_irq = devices_prev["irq_by_key"].get(key)
        irq_per_sec = 0.0 if prev_irq is None else max(0.0, (irq_total - prev_irq) / dt)
        throughput = float(d.get("throughput_bps", 0.0))
        synthetic = irq_per_sec * 4096.0
        weighted = max(throughput, synthetic)
        d["throughput_bps"] = round(throughput, 2)
        d["throughput_mb_s"] = round(throughput / (1024 * 1024), 4)
        d["irq_total"] = int(irq_total)
        d["irq_per_sec"] = round(irq_per_sec, 2)
        d["load_norm"] = round(min(1.0, weighted / max_bps), 4)
        d["layer_path"] = ["Physical layer", "Driver layer", "Kernel subsystem", "User interaction"]
        d["driver"] = d.get("driver") or "n/a"

    devices.sort(
        key=lambda d: (d.get("load_norm", 0.0), d.get("throughput_bps", 0.0), d.get("irq_per_sec", 0.0)),
        reverse=True,
    )
    top_devices = devices[:20]
    devices_prev["timestamp"] = now
    devices_prev["disk_sectors"] = disk_now
    devices_prev["net_bytes"] = net_now
    devices_prev["tty_irq_total"] = read_tty_irq_total_fn()
    devices_prev["irq_by_key"] = {f"{d.get('category','unknown')}::{d.get('name','unknown')}": d.get("irq_total", 0) for d in top_devices}

    bus_counts = {"pcie": 0, "usb": 0, "virtual": 0, "net": 0}
    category_counts = {}
    for d in top_devices:
        bus_counts[d.get("bus", "pcie")] = bus_counts.get(d.get("bus", "pcie"), 0) + 1
        c = d.get("category", "unknown")
        category_counts[c] = category_counts.get(c, 0) + 1

    return {
        "timestamp": datetime.now().isoformat(),
        "layout": {"name": "Hardware Bus Map", "layers": ["Physical layer", "Driver layer", "Kernel subsystem", "User interaction"], "buses": ["pcie", "usb", "virtual", "net"]},
        "devices": top_devices,
        "meta": {"count": len(top_devices), "max_throughput_bps": round(max_bps, 2), "bus_counts": bus_counts, "category_counts": category_counts},
    }
