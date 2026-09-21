"""Which kernel mechanisms actually touch a packet on this host.

The network stack view answers "where is the packet". This answers the other
half: *who* handled it. Three classes, and the difference between them is the
whole point of the panel:

``path``   the packet physically goes through it (qdisc, driver, NAPI)
``hook``   attached optionally, may simply not be there (XDP, tc/clsact, nft)
``table``  the kernel consults it, the packet does not flow through it
           (conntrack, neighbour/ARP, FIB)

Everything is detected, never assumed. A mechanism the backend cannot see
reports ``unknown`` rather than ``absent`` — "no XDP program" and "we are not
allowed to look" are different statements and the UI greys them differently.

All probes here work unprivileged: ``tc``/``ip``/``ethtool`` dump via netlink,
the rest is procfs and sysfs. ``bpftool`` usually needs privilege (and on many
distro kernels the wrapper cannot even find a matching binary), so BPF program
enumeration is expected to land on ``unknown``.
"""

from __future__ import annotations

import glob
import logging
import re
import subprocess
import time
from datetime import datetime

from kernel_ai.logging_helpers import log_event
from kernel_ai.services.infra_utils import resolve_binary
from kernel_ai.services.network import _get_conntrack_stats, _get_default_iface, _read_sysctl_int

logger = logging.getLogger(__name__)

# Probes shell out; the answers change on the timescale of an admin action,
# not of a packet. Poll cheaply, refresh rarely.
_CACHE_TTL_SECONDS = 15.0
_cache: dict = {"timestamp": 0.0, "iface": None, "data": None}

ACTIVE = "active"
IDLE = "idle"
ABSENT = "absent"
UNKNOWN = "unknown"


def _run(cmd: list[str], timeout: float = 1.5) -> str | None:
    """Return stdout, or ``None`` when the tool is missing or refuses."""
    if not cmd or not cmd[0]:
        return None
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout or ""


def _mech(
    ident: str,
    label: str,
    layer: str,
    kind: str,
    state: str,
    detail: str,
    source: str,
    path: str = "both",
) -> dict:
    return {
        "id": ident,
        "label": label,
        "layer": layer,
        "kind": kind,
        "state": state,
        "detail": detail,
        "source": source,
        "path": path,
    }


def _detect_qdisc(iface: str) -> dict:
    out = _run([resolve_binary("tc") or "", "qdisc", "show", "dev", iface])
    if out is None:
        return _mech(
            "qdisc", "qdisc", "link", "path", UNKNOWN,
            "tc unavailable", "tc qdisc show", path="tx",
        )
    match = re.search(r"qdisc\s+(\S+)", out)
    if not match:
        return _mech("qdisc", "qdisc", "link", "path", UNKNOWN, "no root qdisc reported", "tc qdisc show", path="tx")
    name = match.group(1)
    backlog = re.search(r"backlog\s+(\d+)b\s+(\d+)p", out)
    detail = name
    if backlog:
        detail = f"{name} · backlog {backlog.group(2)}p"
    return _mech("qdisc", f"qdisc {name}", "link", "path", ACTIVE, detail, "tc qdisc show", path="tx")


def _detect_tc_filters(iface: str) -> list[dict]:
    tc = resolve_binary("tc") or ""
    found = []
    for hook, path in (("ingress", "rx"), ("egress", "tx")):
        out = _run([tc, "filter", "show", "dev", iface, hook])
        ident = f"tc_{hook}"
        label = f"tc {hook}"
        if out is None:
            found.append(_mech(ident, label, "link", "hook", UNKNOWN, "tc unavailable", "tc filter show", path=path))
            continue
        lines = [ln for ln in out.splitlines() if ln.strip()]
        if not lines:
            found.append(_mech(ident, label, "link", "hook", ABSENT, "no clsact filter", "tc filter show", path=path))
            continue
        bpf = "bpf" in out
        detail = f"{len(lines)} filter line(s)" + (" · bpf" if bpf else "")
        found.append(_mech(ident, label, "link", "hook", ACTIVE, detail, "tc filter show", path=path))
    return found


def _detect_xdp(iface: str) -> dict:
    out = _run([resolve_binary("ip") or "", "-d", "link", "show", "dev", iface])
    if out is None:
        return _mech("xdp", "XDP", "driver", "hook", UNKNOWN, "ip unavailable", "ip -d link", path="rx")
    if "xdp" not in out.lower():
        return _mech(
            "xdp", "XDP", "driver", "hook", ABSENT,
            "no program — skb allocated for every frame", "ip -d link", path="rx",
        )
    mode = "generic"
    for candidate in ("xdpoffload", "xdpdrv", "xdpgeneric"):
        if candidate in out:
            mode = candidate.replace("xdp", "")
            break
    prog = re.search(r"prog/xdp\s+id\s+(\d+)", out)
    detail = f"attached ({mode})" + (f" · id {prog.group(1)}" if prog else "")
    return _mech("xdp", "XDP", "driver", "hook", ACTIVE, detail, "ip -d link", path="rx")


def _detect_offloads(iface: str) -> list[dict]:
    out = _run([resolve_binary("ethtool") or "", "-k", iface], timeout=2.0)
    if out is None:
        return [
            _mech("gro", "GRO", "driver", "path", UNKNOWN, "ethtool unavailable", "ethtool -k", path="rx"),
            _mech("gso", "GSO/TSO", "driver", "path", UNKNOWN, "ethtool unavailable", "ethtool -k", path="tx"),
        ]

    def flag(name: str) -> bool | None:
        match = re.search(rf"^{re.escape(name)}:\s+(on|off)", out, re.MULTILINE)
        return None if not match else match.group(1) == "on"

    gro = flag("generic-receive-offload")
    gso = flag("generic-segmentation-offload")
    tso = flag("tcp-segmentation-offload")

    gro_state = UNKNOWN if gro is None else (ACTIVE if gro else ABSENT)
    gro_detail = "coalescing frames before the stack" if gro else "every frame walks the stack alone"
    tx_on = bool(gso) or bool(tso)
    tx_state = UNKNOWN if (gso is None and tso is None) else (ACTIVE if tx_on else ABSENT)
    tx_detail = (
        f"gso={'on' if gso else 'off'} tso={'on' if tso else 'off'}"
        if tx_state != UNKNOWN
        else "not reported"
    )
    return [
        _mech("gro", "GRO", "driver", "path", gro_state, gro_detail if gro is not None else "not reported", "ethtool -k", path="rx"),
        _mech("gso", "GSO/TSO", "driver", "path", tx_state, tx_detail, "ethtool -k", path="tx"),
    ]


def _detect_rps(iface: str) -> dict:
    masks = sorted(glob.glob(f"/sys/class/net/{iface}/queues/rx-*/rps_cpus"))
    if not masks:
        return _mech("rps", "RPS", "driver", "hook", UNKNOWN, "no rx queue sysfs", "sysfs rps_cpus", path="rx")
    enabled = 0
    for item in masks:
        try:
            with open(item, "r", encoding="utf-8", errors="ignore") as fh:
                raw = fh.read().strip().replace(",", "")
        except OSError:
            continue
        if raw and int(raw, 16) != 0:
            enabled += 1
    if enabled:
        return _mech(
            "rps", "RPS", "driver", "hook", ACTIVE,
            f"{enabled}/{len(masks)} rx queues steered", "sysfs rps_cpus", path="rx",
        )
    return _mech(
        "rps", "RPS", "driver", "hook", ABSENT,
        f"off — rx stays on the interrupt CPU ({len(masks)} queue)", "sysfs rps_cpus", path="rx",
    )


def _read_softnet() -> dict:
    """Per-CPU softirq receive health: backlog drops and budget exhaustion."""
    processed = dropped = squeezed = 0
    cpus = 0
    try:
        with open("/proc/net/softnet_stat", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                cols = line.split()
                if len(cols) < 3:
                    continue
                cpus += 1
                processed += int(cols[0], 16)
                dropped += int(cols[1], 16)
                squeezed += int(cols[2], 16)
    except (OSError, ValueError):
        return {"available": False}
    return {
        "available": True,
        "cpus": cpus,
        "processed": processed,
        "dropped": dropped,
        "time_squeeze": squeezed,
    }


def _detect_napi(softnet: dict) -> dict:
    if not softnet.get("available"):
        return _mech("napi", "NAPI / softirq", "driver", "path", UNKNOWN, "softnet_stat unreadable", "/proc/net/softnet_stat", path="rx")
    squeeze = int(softnet.get("time_squeeze", 0))
    drops = int(softnet.get("dropped", 0))
    detail = f"{softnet.get('cpus', 0)} cpu · squeeze {squeeze} · backlog drop {drops}"
    return _mech("napi", "NAPI / softirq", "driver", "path", ACTIVE, detail, "/proc/net/softnet_stat", path="rx")


def _detect_conntrack() -> dict:
    stats = _get_conntrack_stats()
    if not stats.get("available"):
        return _mech("conntrack", "conntrack", "netfilter", "table", ABSENT, "nf_conntrack not loaded", "/proc/sys/net/netfilter")
    count = int(stats.get("count", 0))
    maximum = int(stats.get("max", 0))
    pct = f"{round(stats.get('usage', 0.0) * 100, 1)}%" if maximum else "n/a"
    return _mech(
        "conntrack", "conntrack", "netfilter", "table", ACTIVE if count else IDLE,
        f"{count}/{maximum} flows · {pct}", "/proc/sys/net/netfilter",
    )


def _detect_netfilter_hook() -> dict:
    stats = _get_conntrack_stats()
    if stats.get("nft"):
        return _mech("nftables", "nftables", "netfilter", "hook", ACTIVE, "nf_tables module loaded", "/proc/modules")
    try:
        with open("/proc/modules", "r", encoding="utf-8", errors="ignore") as fh:
            mods = fh.read()
    except OSError:
        return _mech("nftables", "nftables / iptables", "netfilter", "hook", UNKNOWN, "/proc/modules unreadable", "/proc/modules")
    if "ip_tables" in mods:
        return _mech("nftables", "iptables (legacy)", "netfilter", "hook", ACTIVE, "ip_tables module loaded", "/proc/modules")
    return _mech("nftables", "nftables / iptables", "netfilter", "hook", ABSENT, "no filter backend loaded", "/proc/modules")


def _detect_neigh(iface: str) -> dict:
    states: dict[str, int] = {}
    try:
        with open("/proc/net/arp", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh.readlines()[1:]:
                parts = line.split()
                if len(parts) < 6:
                    continue
                flags_h, mac, device = parts[2], parts[3], parts[5]
                if device != iface:
                    continue
                try:
                    flags = int(flags_h, 16)
                except ValueError:
                    flags = 0
                if mac in ("00:00:00:00:00:00", "0:0:0:0:0:0"):
                    name = "INCOMPLETE"
                else:
                    name = "REACHABLE" if flags & 0x2 else "STALE"
                states[name] = states.get(name, 0) + 1
    except OSError:
        return _mech("neigh", "neighbour / ARP", "link", "table", UNKNOWN, "/proc/net/arp unreadable", "/proc/net/arp", path="tx")
    total = sum(states.values())
    stuck = states.get("INCOMPLETE", 0)
    if not total:
        return _mech("neigh", "neighbour / ARP", "link", "table", IDLE, "no entries on this link", "/proc/net/arp", path="tx")
    detail = " · ".join(f"{name.lower()} {count}" for name, count in sorted(states.items()))
    return _mech(
        "neigh", "neighbour / ARP", "link", "table",
        ACTIVE if not stuck else IDLE,
        detail + (" · frames parked in arp_queue" if stuck else ""),
        "/proc/net/arp",
        path="tx",
    )


def _detect_fib() -> dict:
    routes = 0
    try:
        with open("/proc/net/route", "r", encoding="utf-8", errors="ignore") as fh:
            routes = max(0, len(fh.readlines()) - 1)
    except OSError:
        return _mech("fib", "FIB / route lookup", "ip", "table", UNKNOWN, "/proc/net/route unreadable", "/proc/net/route")
    forwarding = _read_sysctl_int("/proc/sys/net/ipv4/ip_forward", 0)
    detail = f"{routes} route(s) · forwarding {'on' if forwarding else 'off'}"
    return _mech("fib", "FIB / route lookup", "ip", "table", ACTIVE, detail, "/proc/net/route")


def _detect_congestion_control() -> dict:
    try:
        with open("/proc/sys/net/ipv4/tcp_congestion_control", "r", encoding="utf-8", errors="ignore") as fh:
            current = fh.read().strip()
    except OSError:
        return _mech("cc", "congestion control", "tcp", "path", UNKNOWN, "sysctl unreadable", "sysctl tcp_congestion_control", path="tx")
    return _mech("cc", f"cc: {current}", "tcp", "path", ACTIVE, f"default sender algorithm ({current})", "sysctl tcp_congestion_control", path="tx")


def _detect_bpf_programs() -> dict:
    """Enumerating BPF usually needs privilege — say so instead of guessing."""
    out = _run([resolve_binary("bpftool") or "", "-j", "prog", "show"], timeout=2.0)
    if out is None:
        return _mech(
            "bpf", "eBPF programs", "userspace", "hook", UNKNOWN,
            "bpftool unavailable or not permitted", "bpftool prog show",
        )
    ids = re.findall(r'"id"\s*:\s*(\d+)', out)
    if not ids:
        return _mech("bpf", "eBPF programs", "userspace", "hook", ABSENT, "no programs loaded", "bpftool prog show")
    return _mech("bpf", "eBPF programs", "userspace", "hook", ACTIVE, f"{len(ids)} program(s) loaded", "bpftool prog show")


def _detect_af_xdp(iface: str) -> dict:
    """AF_XDP is the one common way userspace really is in the data path."""
    try:
        with open("/proc/net/xdp", "r", encoding="utf-8", errors="ignore") as fh:
            rows = [ln for ln in fh.readlines()[1:] if ln.strip()]
        state = ACTIVE if rows else ABSENT
        detail = f"{len(rows)} socket(s)" if rows else "no zero-copy sockets — userspace is off the path"
        return _mech("af_xdp", "AF_XDP", "userspace", "hook", state, detail, "/proc/net/xdp", path="rx")
    except OSError:
        return _mech(
            "af_xdp", "AF_XDP", "userspace", "hook", ABSENT,
            "no zero-copy sockets — userspace is off the path", "/proc/net/xdp", path="rx",
        )


def _detect_socket_bpf() -> dict:
    """cgroup/sockops/sk_msg hooks all need BPF enumeration to be seen at all."""
    out = _run([resolve_binary("bpftool") or "", "-j", "prog", "show"], timeout=2.0)
    if out is None:
        return _mech(
            "sock_bpf", "socket eBPF", "socket", "hook", UNKNOWN,
            "sockops / sk_msg / cgroup need bpftool", "bpftool prog show",
        )
    kinds = re.findall(r'"type"\s*:\s*"(sock[^"]*|cgroup_sock[^"]*|sk_[^"]*)"', out)
    if not kinds:
        return _mech("sock_bpf", "socket eBPF", "socket", "hook", ABSENT, "no socket-level program", "bpftool prog show")
    return _mech("sock_bpf", "socket eBPF", "socket", "hook", ACTIVE, f"{len(kinds)} program(s)", "bpftool prog show")


def _detect_nic_rings(iface: str) -> list[dict]:
    out = _run([resolve_binary("ethtool") or "", "-g", iface], timeout=2.0)
    if out is None:
        return [_mech("rings", "rx/tx rings", "nic", "path", UNKNOWN, "ethtool unavailable", "ethtool -g")]
    current = out.split("Current hardware settings:")[-1]
    rx = re.search(r"^RX:\s+(\d+)", current, re.MULTILINE)
    tx = re.search(r"^TX:\s+(\d+)", current, re.MULTILINE)
    if not rx and not tx:
        return [_mech("rings", "rx/tx rings", "nic", "path", UNKNOWN, "ring sizes not reported", "ethtool -g")]
    detail = f"rx {rx.group(1) if rx else '?'} · tx {tx.group(1) if tx else '?'} descriptors"
    return [_mech("rings", "rx/tx rings", "nic", "path", ACTIVE, detail, "ethtool -g")]


def get_network_mechanisms(iface: str | None = None, force: bool = False) -> dict:
    """Detected per-layer mechanisms for the packet-path view."""
    target = iface or _get_default_iface()
    now = time.time()
    if (
        not force
        and _cache["data"] is not None
        and _cache["iface"] == target
        and (now - float(_cache["timestamp"])) < _CACHE_TTL_SECONDS
    ):
        return _cache["data"]

    softnet = _read_softnet()
    mechanisms: list[dict] = [
        _detect_bpf_programs(),
        _detect_af_xdp(target),
        _detect_socket_bpf(),
        _detect_congestion_control(),
        _detect_fib(),
        _detect_netfilter_hook(),
        _detect_conntrack(),
        _detect_qdisc(target),
        _detect_neigh(target),
        _detect_xdp(target),
        _detect_napi(softnet),
        _detect_rps(target),
    ]
    mechanisms.extend(_detect_tc_filters(target))
    mechanisms.extend(_detect_offloads(target))
    mechanisms.extend(_detect_nic_rings(target))

    counts: dict[str, int] = {}
    for item in mechanisms:
        counts[item["state"]] = counts.get(item["state"], 0) + 1

    payload = {
        "timestamp": datetime.now().isoformat(),
        "iface": target,
        "mechanisms": mechanisms,
        "softnet": softnet,
        "summary": {
            "total": len(mechanisms),
            "active": counts.get(ACTIVE, 0),
            "idle": counts.get(IDLE, 0),
            "absent": counts.get(ABSENT, 0),
            "unknown": counts.get(UNKNOWN, 0),
        },
        "cache_ttl_seconds": _CACHE_TTL_SECONDS,
    }

    _cache.update({"timestamp": now, "iface": target, "data": payload})
    log_event(
        logger,
        "DEBUG",
        "network_mechanisms_scanned",
        event_dataset="kernel_ai.app",
        component="services.network_mechanisms",
        operation="get_network_mechanisms",
        event_data={"iface": target, **payload["summary"]},
    )
    return payload
