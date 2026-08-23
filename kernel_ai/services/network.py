"""Network domain service extracted from ``webapp``."""

from __future__ import annotations

import ipaddress
import logging
import os
import re
import subprocess
import time
from datetime import datetime

import psutil

from kernel_ai.logging_helpers import log_event
from kernel_ai.services.infra_utils import resolve_binary

logger = logging.getLogger(__name__)

_NETWORK_STACK_PREV_DEFAULT = {
    "timestamp": None,
    "tcpext_retrans": None,
    "ip_in": None,
    "ip_out": None,
    "ip_discards": None,
    "iface_rx": None,
    "iface_tx": None,
    "iface_drops": None,
}
_TRACEROUTE_CACHE_DEFAULT = {}
_TRACEROUTE_CACHE_TTL_SECONDS_DEFAULT = 60
_FALLBACK_COUNTS = {}


def _record_fallback(fallback_name: str, reason: str):
    count = int(_FALLBACK_COUNTS.get(fallback_name, 0)) + 1
    _FALLBACK_COUNTS[fallback_name] = count
    # Log first occurrence and then sparse checkpoints to avoid noisy logs.
    if count in (1, 10, 100, 1000):
        log_event(
            logger,
            "INFO",
            "service_fallback_activated",
            event_dataset="kernel_ai.app",
            component="services.network",
            operation=fallback_name,
            event_data={"count": count, "reason": reason},
        )


def get_active_connections():
    """Get active network connections."""
    try:
        connections = []
        with open("/proc/net/tcp", "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()[1:]
            for line in lines:
                parts = line.strip().split()
                if len(parts) < 10:
                    continue
                local_addr = parts[1]
                remote_addr = parts[2]
                state = parts[3]

                def hex_to_ip(hex_str):
                    hex_bytes = [hex_str[i : i + 2] for i in range(0, 8, 2)]
                    hex_bytes.reverse()
                    return ".".join([str(int(b, 16)) for b in hex_bytes])

                local_ip = hex_to_ip(local_addr.split(":")[0])
                local_port = int(local_addr.split(":")[1], 16)
                try:
                    uid = int(parts[7])
                except ValueError:
                    uid = 0
                try:
                    inode = int(parts[9])
                except ValueError:
                    inode = 0

                if remote_addr != "00000000:0000":
                    remote_ip = hex_to_ip(remote_addr.split(":")[0])
                    remote_port = int(remote_addr.split(":")[1], 16)
                    connections.append(
                        {
                            "local": f"{local_ip}:{local_port}",
                            "remote": f"{remote_ip}:{remote_port}",
                            "state": state,
                            "type": "TCP",
                            "uid": uid,
                            "inode": inode,
                        }
                    )
        return connections[:20]
    except (OSError, ValueError, IndexError) as exc:
        log_event(
            logger,
            "DEBUG",
            "Failed to parse /proc/net/tcp, using mock active connections",
            event_dataset="kernel_ai.app",
            component="services.network",
            operation="get_active_connections",
            event_data={"error": str(exc)},
        )
        _record_fallback("get_active_connections", str(exc))
        return get_mock_active_connections()


def get_mock_active_connections():
    return [
        {"local": "127.0.0.1:22", "remote": "192.168.1.100:54321", "state": "01", "type": "TCP", "uid": 0, "inode": 12345},
        {"local": "0.0.0.0:80", "remote": "10.0.0.50:12345", "state": "01", "type": "TCP", "uid": 0, "inode": 12346},
        {"local": "127.0.0.1:3306", "remote": "172.16.0.10:65432", "state": "01", "type": "TCP", "uid": 0, "inode": 12347},
        {"local": "0.0.0.0:443", "remote": "203.0.113.0:54321", "state": "01", "type": "TCP", "uid": 0, "inode": 12348},
        {"local": "127.0.0.1:5001", "remote": "192.168.1.101:12345", "state": "01", "type": "TCP", "uid": 0, "inode": 12349},
    ]


def _addr_key(addr) -> str:
    if not addr:
        return ""
    if isinstance(addr, (tuple, list)) and len(addr) >= 2:
        return f"{addr[0]}:{addr[1]}"
    return str(addr)


def _get_socket_example(all_connections: list) -> dict | None:
    """Pick a live flow and attach fd/pid via psutil when possible (for Socket morph)."""
    interesting = [
        c
        for c in all_connections
        if not str(c.get("remote", "")).startswith("127.0.0.1")
        and not str(c.get("remote", "")).startswith("0.0.0.0")
    ]
    # Prefer ESTABLISHED with a real inode — better for fd→sock* morph.
    established = [
        c for c in interesting
        if str(c.get("state", "")).upper() == "01" and int(c.get("inode") or 0) > 0
    ]
    with_inode = [c for c in interesting if int(c.get("inode") or 0) > 0]
    base = (
        established[0]
        if established
        else (with_inode[0] if with_inode else (interesting[0] if interesting else (all_connections[0] if all_connections else None)))
    )
    if not base:
        return None
    example = {
        "local": base.get("local"),
        "remote": base.get("remote"),
        "type": str(base.get("type", "TCP")).upper(),
        "state_code": base.get("state", "00"),
        "state_name": _tcp_state_name(base.get("state", "00")),
        "inode": int(base.get("inode") or 0),
        "uid": int(base.get("uid") or 0),
        "fd": None,
        "pid": None,
        "process": None,
    }
    want_local = str(example["local"] or "")
    want_remote = str(example["remote"] or "")
    try:
        for conn in psutil.net_connections(kind="inet"):
            if conn.status and str(conn.status).upper() not in ("ESTABLISHED", "LISTEN", "CLOSE_WAIT", "TIME_WAIT"):
                # Still allow match by address even for other states.
                pass
            local = _addr_key(conn.laddr)
            remote = _addr_key(conn.raddr)
            if local == want_local and (not want_remote or remote == want_remote or not remote):
                example["fd"] = int(conn.fd) if conn.fd is not None and conn.fd >= 0 else None
                example["pid"] = int(conn.pid) if conn.pid is not None else None
                if example["pid"]:
                    try:
                        example["process"] = psutil.Process(example["pid"]).name()
                    except (psutil.Error, OSError):
                        example["process"] = None
                break
    except (psutil.Error, OSError, AttributeError):
        pass
    return example


def _tcp_state_name(code):
    states = {
        "01": "ESTABLISHED",
        "02": "SYN_SENT",
        "03": "SYN_RECV",
        "04": "FIN_WAIT1",
        "05": "FIN_WAIT2",
        "06": "TIME_WAIT",
        "07": "CLOSE",
        "08": "CLOSE_WAIT",
        "09": "LAST_ACK",
        "0A": "LISTEN",
        "0B": "CLOSING",
    }
    return states.get(str(code).upper(), str(code).upper())


def _get_default_iface():
    try:
        with open("/proc/net/route", "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()[1:]
        for line in lines:
            parts = line.strip().split()
            if len(parts) < 11:
                continue
            iface = parts[0]
            destination = parts[1]
            flags = int(parts[3], 16)
            if destination == "00000000" and (flags & 0x2):
                return iface
    except (OSError, ValueError):
        pass
    try:
        pernic = psutil.net_io_counters(pernic=True)
        for iface in pernic.keys():
            if iface != "lo":
                return iface
    except (psutil.Error, OSError):
        pass
    return "lo"


def _parse_netstat_tcpext():
    try:
        with open("/proc/net/netstat", "r", encoding="utf-8", errors="ignore") as f:
            lines = [line.strip() for line in f if line.strip()]
        for i in range(0, len(lines) - 1, 2):
            header = lines[i].split()
            values = lines[i + 1].split()
            if not header or header[0] != "TcpExt:":
                continue
            if not values or values[0] != "TcpExt:":
                continue
            fields = header[1:]
            nums = values[1:]
            if len(fields) != len(nums):
                continue
            mapping = {}
            for name, val in zip(fields, nums):
                try:
                    mapping[name] = int(val)
                except ValueError:
                    mapping[name] = 0
            return mapping
    except OSError:
        return {}
    return {}


def _parse_snmp_section(section_name):
    try:
        with open("/proc/net/snmp", "r", encoding="utf-8", errors="ignore") as f:
            lines = [line.strip() for line in f if line.strip()]
        for i in range(0, len(lines) - 1, 2):
            header = lines[i].split()
            values = lines[i + 1].split()
            expected_prefix = f"{section_name}:"
            if not header or header[0] != expected_prefix:
                continue
            if not values or values[0] != expected_prefix:
                continue
            fields = header[1:]
            nums = values[1:]
            if len(fields) != len(nums):
                continue
            out = {}
            for name, val in zip(fields, nums):
                try:
                    out[name] = int(val)
                except ValueError:
                    out[name] = 0
            return out
    except OSError:
        return {}
    return {}


def _endpoint_key(value):
    return str(value or "").strip().lower()


def _parse_ss_detail_metrics(line, details):
    metrics = {}
    parts = line.split()
    peer = parts[4] if len(parts) >= 5 else ""
    local = parts[3] if len(parts) >= 5 else ""
    if len(parts) >= 4:
        try:
            metrics["tx_queue"] = int(parts[2])
            metrics["rx_queue"] = int(parts[1])
        except ValueError:
            pass
    metrics["ss_local"] = local
    metrics["ss_remote"] = peer

    rtt_match = re.search(r"rtt:(\d+(?:\.\d+)?)/", details)
    cwnd_match = re.search(r"cwnd:(\d+)", details)
    retrans_match = re.search(r"retrans:(\d+)(?:/\d+)?", details)
    if rtt_match:
        metrics["rtt_ms"] = float(rtt_match.group(1))
    if cwnd_match:
        metrics["cwnd"] = int(cwnd_match.group(1))
    if retrans_match:
        metrics["retrans_now"] = int(retrans_match.group(1))
    mss_match = re.search(r"\bmss:(\d+)", details)
    if mss_match:
        metrics["mss"] = int(mss_match.group(1))

    stripped = details.strip()
    if stripped:
        cc = stripped.split(" ", 1)[0]
        if cc and re.match(r"^[a-z][a-z0-9_]+$", cc):
            metrics["cc"] = cc
    dr = re.search(r"delivery_rate\s+([\d.]+)([KMG]?)bps", details)
    if dr:
        metrics["delivery_rate_mbps"] = round(_rate_to_mbps(dr.group(1), dr.group(2)), 4)
    pr = re.search(r"pacing_rate\s+([\d.]+)([KMG]?)bps", details)
    if pr:
        metrics["pacing_rate_mbps"] = round(_rate_to_mbps(pr.group(1), pr.group(2)), 4)
    minrtt = re.search(r"minrtt:([\d.]+)", details)
    if minrtt:
        metrics["min_rtt_ms"] = float(minrtt.group(1))
    bbr = re.search(r"bbr:\(bw:([\d.]+)([KMG]?)bps,mrtt:([\d.]+)", details)
    if bbr:
        metrics["bbr_bw_mbps"] = round(_rate_to_mbps(bbr.group(1), bbr.group(2)), 4)
        metrics["bbr_mrtt_ms"] = float(bbr.group(3))
    # skmem:(r<rmem>,rb<rcvbuf>,t<wmem>,tb<sndbuf>,...)
    skmem = re.search(
        r"skmem:\(r(\d+),rb(\d+),t(\d+),tb(\d+)",
        details,
    )
    if skmem:
        metrics["rmem"] = int(skmem.group(1))
        metrics["rcvbuf"] = int(skmem.group(2))
        metrics["wmem"] = int(skmem.group(3))
        metrics["sndbuf"] = int(skmem.group(4))
    return metrics


_CC_NAMES = {
    "cubic", "bbr", "reno", "vegas", "illinois", "dctcp", "westwood",
    "htcp", "yeah", "lp", "veno", "cdg", "nv", "bic", "highspeed",
}


def _owner_from_cgroup(path):
    """Last systemd unit, not the whole cgroup path."""
    raw = str(path or "").rstrip("/")
    if not raw:
        return None
    last = raw.split("/")[-1]
    last = last.replace(".scope", "").replace(".service", "")
    if last.startswith("app-gnome-"):
        last = last[len("app-gnome-"):]
        last = last.split("_")[0].split("-")[0]
    elif last.startswith("app-org."):
        last = last.split(".")[-1].split("-")[0]
    elif last.startswith("app-"):
        last = last[4:].split("-")[0]
    last = last.strip()
    return last[:24] or None


def _parse_ss_timer(line):
    match = re.search(r"timer:\(([^,]+),([^,]+),(\d+)\)", line)
    if not match:
        return None
    return {
        "kind": match.group(1).strip(),
        "left": match.group(2).strip(),
        "retrans": int(match.group(3)),
    }


def _int_field(text, name):
    match = re.search(rf"\b{name}:(\d+)", text)
    if not match:
        return None
    return int(match.group(1))


def _float_field(text, name):
    match = re.search(rf"\b{name}:(\d+(?:\.\d+)?)", text)
    if not match:
        return None
    return float(match.group(1))


def _parse_ss_flow_row(header, details, proto):
    """Biography fields from one ss -inoe row. No sock cookie, no cgroup path."""
    parts = header.split()
    if proto == "TCP":
        if len(parts) < 5:
            return None
        state = parts[0]
        try:
            recv_q = int(parts[1])
            send_q = int(parts[2])
        except ValueError:
            recv_q = None
            send_q = None
        local = parts[3]
        remote = parts[4]
    else:
        if len(parts) < 4:
            return None
        state = "UNCONN" if parts[3] in ("0.0.0.0:*", "*:*", "[::]:*") else "ESTAB"
        try:
            recv_q = int(parts[0])
            send_q = int(parts[1])
        except ValueError:
            recv_q = None
            send_q = None
        local = parts[2]
        remote = parts[3]

    blob = f"{header} {details}"
    rtt = None
    rtt_var = None
    rtt_match = re.search(r"\brtt:(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)", details)
    if rtt_match:
        rtt = float(rtt_match.group(1))
        rtt_var = float(rtt_match.group(2))
    retrans_now = None
    retrans_total = None
    retrans_match = re.search(r"\bretrans:(\d+)/(\d+)", details)
    if retrans_match:
        retrans_now = int(retrans_match.group(1))
        retrans_total = int(retrans_match.group(2))
    cc = None
    for token in details.split():
        name = token.lower()
        if name in _CC_NAMES:
            cc = name
            break
    cgroup = None
    cg = re.search(r"cgroup:(\S+)", header)
    if cg:
        cgroup = cg.group(1)
    return {
        "local": local,
        "remote": remote,
        "proto": proto,
        "state": state,
        "recv_q": recv_q,
        "send_q": send_q,
        "owner": _owner_from_cgroup(cgroup),
        "bytes_sent": _int_field(details, "bytes_sent"),
        "bytes_acked": _int_field(details, "bytes_acked"),
        "bytes_received": _int_field(details, "bytes_received"),
        "bytes_retrans": _int_field(details, "bytes_retrans"),
        "segs_out": _int_field(details, "segs_out"),
        "segs_in": _int_field(details, "segs_in"),
        "data_segs_out": _int_field(details, "data_segs_out"),
        "data_segs_in": _int_field(details, "data_segs_in"),
        "retrans_now": retrans_now,
        "retrans_total": retrans_total,
        "last_snd_ms": _int_field(details, "lastsnd"),
        "last_rcv_ms": _int_field(details, "lastrcv"),
        "last_ack_ms": _int_field(details, "lastack"),
        "busy_ms": _int_field(details, "busy"),
        "rtt_ms": rtt,
        "rtt_var_ms": rtt_var,
        "min_rtt_ms": _float_field(details, "minrtt"),
        "cwnd": _int_field(details, "cwnd"),
        "cc": cc,
        "timer": _parse_ss_timer(blob),
        "source": "ss -tinoe" if proto == "TCP" else "ss -uinoe",
    }


def _ss_flow_dump(proto):
    ss_cmd = resolve_binary("ss")
    if not ss_cmd:
        return []
    flags = "-tinoe" if proto == "TCP" else "-uinoe"
    try:
        result = subprocess.run(
            [ss_cmd, flags],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        lines = (result.stdout or "").splitlines()
    except (subprocess.TimeoutExpired, OSError):
        return []
    rows = []
    idx = 0
    while idx < len(lines):
        line = lines[idx]
        idx += 1
        if not line.strip() or line.startswith("State") or line.startswith("Netid") or line.startswith("Recv-Q"):
            continue
        extra = []
        while idx < len(lines) and lines[idx][:1].isspace():
            extra.append(lines[idx])
            idx += 1
        row = _parse_ss_flow_row(line, " ".join(extra), proto)
        if row:
            rows.append(row)
    return rows


def get_flow_history(local=None, remote=None, proto="TCP"):
    """Biography of one 4-tuple from ss: lifetime bytes, last talk, min RTT.

    The kernel does not publish a wall-clock birth time for a socket the way
    it does for a pid. What it does keep — bytes, segments, retransmits,
    last send/recv, the lowest RTT seen — is the life of this session.
    """
    proto = str(proto or "TCP").upper()
    if proto not in {"TCP", "UDP"}:
        proto = "TCP"
    want_local = _endpoint_key(local)
    want_remote = _endpoint_key(remote)
    if not want_local or not want_remote:
        return {"found": False, "error": "local and remote are required", "proto": proto}
    for row in _ss_flow_dump(proto):
        if _endpoint_key(row.get("local")) == want_local and _endpoint_key(row.get("remote")) == want_remote:
            row["found"] = True
            return row
    return {
        "found": False,
        "local": local,
        "remote": remote,
        "proto": proto,
        "error": "socket not in ss",
    }


def _get_ss_tcp_metrics(local=None, remote=None):
    ss_cmd = resolve_binary("ss")
    if not ss_cmd:
        return {}
    try:
        result = subprocess.run([ss_cmd, "-tmin"], capture_output=True, text=True, timeout=2, check=False)
        lines = (result.stdout or "").splitlines()
    except (subprocess.TimeoutExpired, OSError):
        return {}

    want_local = _endpoint_key(local)
    want_remote = _endpoint_key(remote)
    fallback = {}
    for idx, line in enumerate(lines):
        if not line.strip().startswith("ESTAB"):
            continue
        extra = []
        for look in (1, 2):
            if idx + look < len(lines) and lines[idx + look][:1].isspace():
                extra.append(lines[idx + look])
        details = " ".join(extra)
        metrics = _parse_ss_detail_metrics(line, details)
        if not metrics:
            continue
        peer = str(metrics.get("ss_remote") or "")
        is_loop = peer.startswith("127.") or peer.startswith("[::1]") or peer.startswith("0.0.0.0")
        if want_local and want_remote:
            if _endpoint_key(metrics.get("ss_local")) == want_local and _endpoint_key(peer) == want_remote:
                return metrics
            if not fallback:
                fallback = metrics
            continue
        if not is_loop:
            return metrics
        if not fallback:
            fallback = metrics
    return fallback


def _rate_to_mbps(value, unit):
    """Convert an ss rate (e.g. 12.3 with unit 'M') to Mbit/s."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    scale = {"": 1e-6, "K": 1e-3, "M": 1.0, "G": 1e3}.get((unit or "").upper(), 1.0)
    return v * scale


def _read_sysctl_int(path: str, default: int = 0) -> int:
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            return int(fh.read().strip())
    except (OSError, ValueError):
        return default


def _get_conntrack_stats() -> dict:
    """Best-effort nf_conntrack occupancy for the Netfilter morph view."""
    count = _read_sysctl_int("/proc/sys/net/netfilter/nf_conntrack_count", 0)
    maximum = _read_sysctl_int("/proc/sys/net/netfilter/nf_conntrack_max", 0)
    available = count > 0 or maximum > 0
    # Also true when the sysctl node exists even at zero.
    try:
        available = available or os.path.exists("/proc/sys/net/netfilter/nf_conntrack_count")
    except OSError:
        pass
    usage = round(count / maximum, 5) if maximum > 0 else 0.0
    nf_conntrack = False
    nft = False
    try:
        with open("/proc/modules", "r", encoding="utf-8", errors="ignore") as fh:
            mods = fh.read()
        nf_conntrack = "nf_conntrack" in mods
        nft = "nf_tables" in mods
    except OSError:
        pass
    return {
        "available": bool(available),
        "count": int(count),
        "max": int(maximum),
        "usage": usage,
        "nf_conntrack": nf_conntrack,
        "nft": nft,
    }


def _hex_le_ipv4(hex_str: str) -> str:
    raw = (hex_str or "").strip()
    if len(raw) != 8:
        return "0.0.0.0"
    try:
        parts = [raw[i : i + 2] for i in range(0, 8, 2)]
        parts.reverse()
        return ".".join(str(int(b, 16)) for b in parts)
    except ValueError:
        return "0.0.0.0"


def _mask_to_prefix(mask_hex: str) -> int:
    try:
        value = int(mask_hex, 16)
    except ValueError:
        return 0
    return bin(value).count("1")


def get_ip_layer_map(limit_routes: int = 12, limit_neigh: int = 10) -> dict:
    """Live IP-layer map: FIB routes, ARP/neigh, ICMP + IP SNMP counters."""
    routes: list[dict] = []
    try:
        with open("/proc/net/route", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh.readlines()[1:]:
                parts = line.strip().split()
                if len(parts) < 8:
                    continue
                iface, dest_h, gw_h, flags_h = parts[0], parts[1], parts[2], parts[3]
                metric = int(parts[6]) if parts[6].isdigit() else 0
                mask_h = parts[7]
                try:
                    flags = int(flags_h, 16)
                except ValueError:
                    flags = 0
                if not (flags & 0x1):  # RTF_UP
                    continue
                dest = _hex_le_ipv4(dest_h)
                gateway = _hex_le_ipv4(gw_h)
                prefix = _mask_to_prefix(mask_h)
                is_default = dest_h == "00000000" and (flags & 0x2)
                routes.append(
                    {
                        "iface": iface,
                        "destination": "default" if is_default else f"{dest}/{prefix}",
                        "gateway": gateway if gateway != "0.0.0.0" else "*",
                        "metric": metric,
                        "flags": flags,
                        "default": bool(is_default),
                    }
                )
        routes.sort(key=lambda r: (0 if r.get("default") else 1, r.get("metric", 0), r.get("destination", "")))
        routes = routes[: max(1, int(limit_routes))]
    except OSError:
        routes = []

    neigh: list[dict] = []
    try:
        with open("/proc/net/arp", "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh.readlines()[1:]:
                parts = line.split()
                if len(parts) < 6:
                    continue
                ip_addr, _hw_type, flags_h, mac, _mask, device = parts[:6]
                try:
                    flags = int(flags_h, 16)
                except ValueError:
                    flags = 0
                if mac in ("00:00:00:00:00:00", "0:0:0:0:0:0"):
                    continue
                state = "REACHABLE" if flags & 0x2 else ("INCOMPLETE" if flags & 0x1 else "STALE")
                neigh.append(
                    {
                        "ip": ip_addr,
                        "mac": mac,
                        "iface": device,
                        "state": state,
                        "flags": flags,
                    }
                )
        neigh = neigh[: max(1, int(limit_neigh))]
    except OSError:
        neigh = []

    ip_stats = _parse_snmp_section("Ip")
    icmp_stats = _parse_snmp_section("Icmp")
    return {
        "routes": routes,
        "neigh": neigh,
        "icmp": {
            "in_msgs": int(icmp_stats.get("InMsgs", 0)),
            "out_msgs": int(icmp_stats.get("OutMsgs", 0)),
            "in_errors": int(icmp_stats.get("InErrors", 0)),
            "out_errors": int(icmp_stats.get("OutErrors", 0)),
            "in_dest_unreach": int(icmp_stats.get("InDestUnreachs", 0)),
            "out_dest_unreach": int(icmp_stats.get("OutDestUnreachs", 0)),
            "in_time_excds": int(icmp_stats.get("InTimeExcds", 0)),
            "in_echo_reps": int(icmp_stats.get("InEchoReps", 0)),
            "out_echos": int(icmp_stats.get("OutEchos", 0)),
        },
        "ip": {
            "forwarding": int(ip_stats.get("Forwarding", 0)),
            "default_ttl": int(ip_stats.get("DefaultTTL", 0)),
            "in_receives": int(ip_stats.get("InReceives", 0)),
            "out_requests": int(ip_stats.get("OutRequests", 0)),
            "in_discards": int(ip_stats.get("InDiscards", 0)),
            "out_discards": int(ip_stats.get("OutDiscards", 0)),
            "in_addr_errors": int(ip_stats.get("InAddrErrors", 0)),
            "in_hdr_errors": int(ip_stats.get("InHdrErrors", 0)),
            "reasm_reqds": int(ip_stats.get("ReasmReqds", 0)),
            "frag_oks": int(ip_stats.get("FragOKs", 0)),
        },
        "source": {"routes": "/proc/net/route", "neigh": "/proc/net/arp", "snmp": "/proc/net/snmp"},
    }


def _ip_neigh_detail(ip, iface=None):
    """used/probes/ref from ``ip -s neigh``, when iproute2 is there.

    /proc/net/arp only has flags. The NUD clock — last confirm, probes — lives
    in the neighbour entry itself and ``ip -s`` prints a slice of it.
    """
    ip_cmd = resolve_binary("ip")
    if not ip_cmd or not ip:
        return {}
    cmd = [ip_cmd, "-s", "neigh", "show", "to", str(ip)]
    if iface:
        cmd.extend(["dev", str(iface)])
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=1, check=False)
        text = (result.stdout or "").strip()
    except (subprocess.TimeoutExpired, OSError):
        return {}
    if not text:
        return {}
    header = text.splitlines()[0]
    out = {}
    state = None
    for token in header.split():
        if token.isupper() and token in {
            "REACHABLE", "STALE", "DELAY", "PROBE", "FAILED",
            "INCOMPLETE", "PERMANENT", "NOARP",
        }:
            state = token
            break
    if state:
        out["nud"] = state
    used = re.search(r"used\s+(\d+)/(\d+)/(\d+)", text)
    if used:
        out["used_s"] = int(used.group(1))
        out["confirmed_s"] = int(used.group(2))
        out["updated_s"] = int(used.group(3))
    probes = re.search(r"probes\s+(\d+)", text)
    if probes:
        out["probes"] = int(probes.group(1))
    ref = re.search(r"ref\s+(\d+)", text)
    if ref:
        out["ref"] = int(ref.group(1))
    return out


def get_ip_entry(kind, ip=None, destination=None, gateway=None, iface=None):
    """One FIB row or one neighbour — the object a Network-room door opens."""
    kind = str(kind or "").strip().lower()
    if kind not in {"neigh", "route"}:
        return {"found": False, "error": "kind must be neigh or route"}
    mapping = get_ip_layer_map(limit_routes=32, limit_neigh=32)
    if kind == "neigh":
        want = _endpoint_key(ip)
        if not want:
            return {"found": False, "kind": "neigh", "error": "ip is required"}
        for row in mapping.get("neigh") or []:
            if _endpoint_key(row.get("ip")) != want:
                continue
            if iface and str(row.get("iface") or "") != str(iface):
                continue
            extra = _ip_neigh_detail(row.get("ip"), row.get("iface"))
            return {
                "found": True,
                "kind": "neigh",
                **row,
                **extra,
                "source": "/proc/net/arp",
            }
        return {"found": False, "kind": "neigh", "ip": ip, "iface": iface}

    want_dest = str(destination or "").strip().lower()
    want_gw = str(gateway or "").strip().lower()
    want_if = str(iface or "").strip()
    if not want_dest:
        return {"found": False, "kind": "route", "error": "destination is required"}
    for row in mapping.get("routes") or []:
        dest = str(row.get("destination") or "").strip().lower()
        gw = str(row.get("gateway") or "").strip().lower()
        if dest != want_dest:
            continue
        if want_gw and gw != want_gw:
            continue
        if want_if and str(row.get("iface") or "") != want_if:
            continue
        hop = None
        hop_ip = None if row.get("gateway") in (None, "*", "0.0.0.0") else row.get("gateway")
        if hop_ip:
            for neigh in mapping.get("neigh") or []:
                if _endpoint_key(neigh.get("ip")) == _endpoint_key(hop_ip):
                    hop = {**neigh, **_ip_neigh_detail(neigh.get("ip"), neigh.get("iface"))}
                    break
        return {
            "found": True,
            "kind": "route",
            **row,
            "nexthop": hop,
            "source": "/proc/net/route",
        }
    return {"found": False, "kind": "route", "destination": destination, "gateway": gateway}


def get_network_stack_realtime(network_stack_prev=None, prefer_local=None, prefer_remote=None):
    network_stack_prev = _NETWORK_STACK_PREV_DEFAULT if network_stack_prev is None else network_stack_prev
    now = time.time()
    iface = _get_default_iface()
    pernic = psutil.net_io_counters(pernic=True)
    iface_stats = pernic.get(iface)
    all_connections = get_active_connections()
    interesting = [c for c in all_connections if not c["remote"].startswith("127.0.0.1") and not c["remote"].startswith("0.0.0.0")]
    want_local = _endpoint_key(prefer_local)
    want_remote = _endpoint_key(prefer_remote)
    pinned = None
    if want_remote:
        for conn in all_connections:
            remote_ok = _endpoint_key(conn.get("remote")) == want_remote
            local_ok = (not want_local) or _endpoint_key(conn.get("local")) == want_local
            if remote_ok and local_ok:
                pinned = conn
                break
    socket_example = _get_socket_example(all_connections)
    # One sock: prefer the pinned 4-tuple, else the example with fd/pid, else first flow.
    raw_flow = pinned or socket_example or (interesting[0] if interesting else (all_connections[0] if all_connections else None))
    flow = None
    if raw_flow:
        same_example = (
            socket_example
            and _endpoint_key(socket_example.get("local")) == _endpoint_key(raw_flow.get("local"))
            and _endpoint_key(socket_example.get("remote")) == _endpoint_key(raw_flow.get("remote"))
        )
        owner = socket_example if same_example else raw_flow
        flow = {
            "local": raw_flow.get("local"),
            "remote": raw_flow.get("remote"),
            "type": str(raw_flow.get("type", "TCP")).upper(),
            "state_code": raw_flow.get("state") or raw_flow.get("state_code") or "00",
            "state_name": raw_flow.get("state_name") or _tcp_state_name(raw_flow.get("state", "00")),
            "inode": int(raw_flow.get("inode") or 0),
            "uid": int(raw_flow.get("uid") or 0),
            "fd": owner.get("fd") if isinstance(owner, dict) else None,
            "pid": owner.get("pid") if isinstance(owner, dict) else None,
            "process": owner.get("process") if isinstance(owner, dict) else None,
        }

    tcpext = _parse_netstat_tcpext()
    ip_stats = _parse_snmp_section("Ip")
    tcp_stats = _parse_snmp_section("Tcp")
    ss_metrics = _get_ss_tcp_metrics(
        local=(flow or {}).get("local"),
        remote=(flow or {}).get("remote"),
    )
    conntrack = _get_conntrack_stats()

    retrans_total = tcpext.get("RetransSegs", 0)
    ip_in_total = ip_stats.get("InReceives", 0)
    ip_out_total = ip_stats.get("OutRequests", 0)
    ip_discards_total = ip_stats.get("InDiscards", 0) + ip_stats.get("OutDiscards", 0)

    established = 0
    try:
        with open("/proc/net/tcp", "r", encoding="utf-8", errors="ignore") as f:
            for line in f.readlines()[1:]:
                parts = line.strip().split()
                if len(parts) >= 4 and parts[3] == "01":
                    established += 1
    except OSError:
        established = 0

    prev_ts = network_stack_prev["timestamp"]
    dt = max(0.001, now - prev_ts) if prev_ts else 1.0

    def rate(curr, prev):
        if prev is None:
            return 0.0
        return max(0.0, (curr - prev) / dt)

    retrans_per_sec = rate(retrans_total, network_stack_prev["tcpext_retrans"])
    ip_in_per_sec = rate(ip_in_total, network_stack_prev["ip_in"])
    ip_out_per_sec = rate(ip_out_total, network_stack_prev["ip_out"])
    ip_drop_per_sec = rate(ip_discards_total, network_stack_prev["ip_discards"])

    rx_per_sec = 0.0
    tx_per_sec = 0.0
    iface_drop_per_sec = 0.0
    rx_bytes = iface_stats.bytes_recv if iface_stats else 0
    tx_bytes = iface_stats.bytes_sent if iface_stats else 0
    iface_drops = (iface_stats.dropin + iface_stats.dropout) if iface_stats else 0
    if network_stack_prev["iface_rx"] is not None:
        rx_per_sec = max(0.0, (rx_bytes - network_stack_prev["iface_rx"]) / dt)
    if network_stack_prev["iface_tx"] is not None:
        tx_per_sec = max(0.0, (tx_bytes - network_stack_prev["iface_tx"]) / dt)
    if network_stack_prev["iface_drops"] is not None:
        iface_drop_per_sec = max(0.0, (iface_drops - network_stack_prev["iface_drops"]) / dt)

    network_stack_prev["timestamp"] = now
    network_stack_prev["tcpext_retrans"] = retrans_total
    network_stack_prev["ip_in"] = ip_in_total
    network_stack_prev["ip_out"] = ip_out_total
    network_stack_prev["ip_discards"] = ip_discards_total
    network_stack_prev["iface_rx"] = rx_bytes
    network_stack_prev["iface_tx"] = tx_bytes
    network_stack_prev["iface_drops"] = iface_drops

    packets_per_sec = ip_in_per_sec + ip_out_per_sec
    drop_ratio = (ip_drop_per_sec / packets_per_sec) if packets_per_sec > 0 else 0.0
    throughput_mb_s = (rx_per_sec + tx_per_sec) / (1024 * 1024)

    retrans_prob = min(0.75, retrans_per_sec / 600.0)
    drop_prob = min(0.75, (ip_drop_per_sec / 500.0) + (drop_ratio * 8.0))
    packet_speed = max(1.4, min(4.8, 1.8 + throughput_mb_s / 8.0))

    socket_activity = min(1.0, (len(all_connections) / 80.0) + (retrans_per_sec / 250.0))
    tcp_activity = min(1.0, (ss_metrics.get("cwnd", 0) / 80.0) + (retrans_per_sec / 300.0))
    ip_activity = min(1.0, packets_per_sec / 15000.0)
    netfilter_activity = min(1.0, (ip_drop_per_sec / 120.0) + (drop_ratio * 6.0))
    driver_activity = min(1.0, ((rx_per_sec + tx_per_sec) / (60 * 1024 * 1024)) + (iface_drop_per_sec / 40.0))
    nic_activity = min(1.0, ((rx_per_sec + tx_per_sec) / (80 * 1024 * 1024)))

    return {
        "timestamp": datetime.now().isoformat(),
        "flow": flow,
        "layer_metrics": {
            "userspace": {"active_processes": len(psutil.pids())},
            "socket_api": {
                "active_sockets": len(all_connections),
                "established": established,
                "retransmits_per_sec": round(retrans_per_sec, 2),
                "example": socket_example,
            },
            "tcp_udp": {
                "established": established,
                "retrans_per_sec": round(retrans_per_sec, 2),
                "cwnd": int(ss_metrics.get("cwnd", 0)),
                "rtt_ms": round(float(ss_metrics.get("rtt_ms", 0.0)), 2),
                "tx_queue": int(ss_metrics.get("tx_queue", 0)),
                "rx_queue": int(ss_metrics.get("rx_queue", 0)),
                "rmem": int(ss_metrics.get("rmem", 0)),
                "wmem": int(ss_metrics.get("wmem", 0)),
                "rcvbuf": int(ss_metrics.get("rcvbuf", 0)),
                "sndbuf": int(ss_metrics.get("sndbuf", 0)),
                "cc": ss_metrics.get("cc", "unknown"),
                "delivery_rate_mbps": ss_metrics.get("delivery_rate_mbps", 0.0),
                "min_rtt_ms": round(float(ss_metrics.get("min_rtt_ms", ss_metrics.get("rtt_ms", 0.0))), 3),
            },
            "ip": {
                "in_packets_per_sec": round(ip_in_per_sec, 2),
                "out_packets_per_sec": round(ip_out_per_sec, 2),
                "drop_per_sec": round(ip_drop_per_sec, 3),
                "drop_ratio": round(drop_ratio, 5),
            },
            "netfilter": {
                "drop_per_sec": round(ip_drop_per_sec, 3),
                "drop_ratio": round(drop_ratio, 5),
                "conntrack_count": int(conntrack.get("count", 0)),
                "conntrack_max": int(conntrack.get("max", 0)),
                "conntrack_usage": float(conntrack.get("usage", 0.0)),
                "conntrack_available": bool(conntrack.get("available")),
                "nft": bool(conntrack.get("nft")),
                "nf_conntrack": bool(conntrack.get("nf_conntrack")),
            },
            "driver": {
                "iface": iface,
                "rx_mb_s": round(rx_per_sec / (1024 * 1024), 3),
                "tx_mb_s": round(tx_per_sec / (1024 * 1024), 3),
                "tx_queue": int(ss_metrics.get("tx_queue", 0)),
                "drops_per_sec": round(iface_drop_per_sec, 3),
            },
            "nic": {
                "iface": iface,
                "rx_errors": int(getattr(iface_stats, "errin", 0)) if iface_stats else 0,
                "tx_errors": int(getattr(iface_stats, "errout", 0)) if iface_stats else 0,
                "drops_total": int(iface_drops),
            },
        },
        "layer_activity": {
            "userspace": min(1.0, len(psutil.pids()) / 400.0),
            "socket": round(socket_activity, 4),
            "tcp": round(tcp_activity, 4),
            "ip": round(ip_activity, 4),
            "netfilter": round(netfilter_activity, 4),
            "driver": round(driver_activity, 4),
            "nic": round(nic_activity, 4),
        },
        "signals": {
            "drop_probability": round(drop_prob, 4),
            "retransmit_probability": round(retrans_prob, 4),
            "packet_speed": round(packet_speed, 3),
        },
        "bbr": {
            "cc": ss_metrics.get("cc", "unknown"),
            "bbr_active": "bbr_bw_mbps" in ss_metrics,
            "rtt_ms": round(float(ss_metrics.get("rtt_ms", 0.0)), 3),
            "min_rtt_ms": round(float(ss_metrics.get("min_rtt_ms", ss_metrics.get("rtt_ms", 0.0))), 3),
            "cwnd": int(ss_metrics.get("cwnd", 0)),
            "mss": int(ss_metrics.get("mss", 1448)),
            "delivery_rate_mbps": ss_metrics.get("delivery_rate_mbps", 0.0),
            "pacing_rate_mbps": ss_metrics.get("pacing_rate_mbps", 0.0),
            "bbr_bw_mbps": ss_metrics.get("bbr_bw_mbps"),
            "bbr_mrtt_ms": ss_metrics.get("bbr_mrtt_ms"),
        },
        "throughput_mb_s": round(throughput_mb_s, 3),
        "tcp_counters": {
            "in_segs": int(tcp_stats.get("InSegs", 0)),
            "out_segs": int(tcp_stats.get("OutSegs", 0)),
            "retrans_segs_total": int(retrans_total),
        },
        "ip_map": get_ip_layer_map(),
    }


def get_route_hint(remote_ip):
    ip_cmd = resolve_binary("ip")
    if not ip_cmd:
        return {"remote_ip": remote_ip, "tool": None, "reached": False, "hop_count": 0, "hops": [], "note": "Path tools unavailable on host"}
    try:
        result = subprocess.run([ip_cmd, "-o", "route", "get", remote_ip], capture_output=True, text=True, timeout=2, check=False)
        line = (result.stdout or "").strip()
        if not line:
            return {"remote_ip": remote_ip, "tool": "ip-route", "reached": False, "hop_count": 0, "hops": [], "note": "No route information available"}

        via_match = re.search(r"\svia\s(\d{1,3}(?:\.\d{1,3}){3})", line)
        dev_match = re.search(r"\sdev\s([A-Za-z0-9_.:-]+)", line)
        src_match = re.search(r"\ssrc\s(\d{1,3}(?:\.\d{1,3}){3})", line)

        hops = []
        if via_match:
            hops.append({"hop": 1, "target": via_match.group(1), "rtt_ms": None})
            hops.append({"hop": 2, "target": remote_ip, "rtt_ms": None})
        else:
            hops.append({"hop": 1, "target": remote_ip, "rtt_ms": None})

        note_parts = ["Traceroute not installed, showing kernel route hint"]
        if dev_match:
            note_parts.append(f"dev={dev_match.group(1)}")
        if src_match:
            note_parts.append(f"src={src_match.group(1)}")

        return {"remote_ip": remote_ip, "tool": "ip-route", "reached": False, "hop_count": len(hops), "hops": hops, "note": ", ".join(note_parts)}
    except (subprocess.TimeoutExpired, OSError):
        return {"remote_ip": remote_ip, "tool": "ip-route", "reached": False, "hop_count": 0, "hops": [], "note": "Route hint lookup timed out"}


def get_traceroute_info(remote_ip, max_hops=8, traceroute_cache=None, cache_ttl_seconds=None):
    traceroute_cache = _TRACEROUTE_CACHE_DEFAULT if traceroute_cache is None else traceroute_cache
    cache_ttl_seconds = _TRACEROUTE_CACHE_TTL_SECONDS_DEFAULT if cache_ttl_seconds is None else cache_ttl_seconds
    try:
        target_ip = ipaddress.ip_address(remote_ip)
        if target_ip.is_loopback or target_ip.is_unspecified:
            return {"remote_ip": remote_ip, "tool": None, "reached": False, "hop_count": 0, "hops": [], "note": "Local address, traceroute skipped"}
    except ValueError:
        log_event(
            logger,
            "DEBUG",
            "Invalid IP passed to traceroute info",
            event_dataset="kernel_ai.app",
            component="services.network",
            operation="get_traceroute_info",
            event_data={"remote_ip": remote_ip},
        )
        raise ValueError("Invalid IP address")

    now = time.time()
    cached = traceroute_cache.get(remote_ip)
    if cached and (now - cached["timestamp"]) < cache_ttl_seconds:
        return cached["data"]

    traceroute_cmd = resolve_binary("traceroute")
    tracepath_cmd = resolve_binary("tracepath")
    cmd = None
    tool = None
    if traceroute_cmd:
        cmd = [traceroute_cmd, "-n", "-m", str(max_hops), "-q", "1", "-w", "1", remote_ip]
        tool = "traceroute"
    elif tracepath_cmd:
        cmd = [tracepath_cmd, "-n", "-m", str(max_hops), remote_ip]
        tool = "tracepath"
    else:
        data = get_route_hint(remote_ip)
        traceroute_cache[remote_ip] = {"timestamp": now, "data": data}
        return data

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=7, check=False)
        output = (result.stdout or "").strip()
        if not output and result.stderr:
            output = result.stderr.strip()
    except subprocess.TimeoutExpired:
        return {"remote_ip": remote_ip, "tool": tool, "reached": False, "hop_count": 0, "hops": [], "note": "Traceroute timed out"}

    hops = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        hop_match = re.match(r"^(\d+)\s+", line)
        if not hop_match:
            tracepath_match = re.match(r"^(\d+):\s+", line)
            if not tracepath_match:
                continue
            hop_idx = int(tracepath_match.group(1))
        else:
            hop_idx = int(hop_match.group(1))

        if "*" in line and re.search(r"\*\s*\*\s*\*", line):
            hops.append({"hop": hop_idx, "target": "*", "rtt_ms": None})
            continue

        ip_match = re.search(r"(\d{1,3}(?:\.\d{1,3}){3})", line)
        rtt_match = re.search(r"(\d+(?:\.\d+)?)\s*ms", line)
        hops.append({"hop": hop_idx, "target": ip_match.group(1) if ip_match else "?", "rtt_ms": float(rtt_match.group(1)) if rtt_match else None})

    reached = any(h.get("target") == remote_ip for h in hops)
    data = {"remote_ip": remote_ip, "tool": tool, "reached": reached, "hop_count": len(hops), "hops": hops[:max_hops], "note": None}
    traceroute_cache[remote_ip] = {"timestamp": now, "data": data}
    return data
