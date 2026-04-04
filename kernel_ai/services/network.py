"""Network domain service extracted from ``webapp``."""

from __future__ import annotations

import ipaddress
import re
import subprocess
import time
from datetime import datetime

import psutil

from kernel_ai.services.infra_utils import resolve_binary
from kernel_ai.state import NETWORK_STACK_PREV, TRACEROUTE_CACHE, TRACEROUTE_CACHE_TTL_SECONDS


def get_active_connections():
    """Get active network connections."""
    try:
        connections = []
        with open("/proc/net/tcp", "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()[1:]
            for line in lines:
                parts = line.strip().split()
                if len(parts) < 4:
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

                if remote_addr != "00000000:0000":
                    remote_ip = hex_to_ip(remote_addr.split(":")[0])
                    remote_port = int(remote_addr.split(":")[1], 16)
                    connections.append(
                        {
                            "local": f"{local_ip}:{local_port}",
                            "remote": f"{remote_ip}:{remote_port}",
                            "state": state,
                            "type": "TCP",
                        }
                    )
        return connections[:20]
    except Exception:
        return get_mock_active_connections()


def get_mock_active_connections():
    return [
        {"local": "127.0.0.1:22", "remote": "192.168.1.100:54321", "state": "01", "type": "TCP"},
        {"local": "0.0.0.0:80", "remote": "10.0.0.50:12345", "state": "01", "type": "TCP"},
        {"local": "127.0.0.1:3306", "remote": "172.16.0.10:65432", "state": "01", "type": "TCP"},
        {"local": "0.0.0.0:443", "remote": "203.0.113.0:54321", "state": "01", "type": "TCP"},
        {"local": "127.0.0.1:5001", "remote": "192.168.1.101:12345", "state": "01", "type": "TCP"},
    ]


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
    except Exception:
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


def _get_ss_tcp_metrics():
    ss_cmd = resolve_binary("ss")
    if not ss_cmd:
        return {}
    try:
        result = subprocess.run([ss_cmd, "-tin"], capture_output=True, text=True, timeout=2, check=False)
        lines = (result.stdout or "").splitlines()
    except (subprocess.TimeoutExpired, OSError):
        return {}

    for idx, line in enumerate(lines):
        if not line.strip().startswith("ESTAB"):
            continue
        metrics = {}
        parts = line.split()
        if len(parts) >= 4:
            try:
                metrics["tx_queue"] = int(parts[2])
                metrics["rx_queue"] = int(parts[1])
            except ValueError:
                pass

        details = lines[idx + 1] if (idx + 1) < len(lines) else ""
        rtt_match = re.search(r"rtt:(\d+(?:\.\d+)?)/", details)
        cwnd_match = re.search(r"cwnd:(\d+)", details)
        retrans_match = re.search(r"retrans:(\d+)(?:/\d+)?", details)
        if rtt_match:
            metrics["rtt_ms"] = float(rtt_match.group(1))
        if cwnd_match:
            metrics["cwnd"] = int(cwnd_match.group(1))
        if retrans_match:
            metrics["retrans_now"] = int(retrans_match.group(1))
        if metrics:
            return metrics
    return {}


def get_network_stack_realtime():
    now = time.time()
    iface = _get_default_iface()
    pernic = psutil.net_io_counters(pernic=True)
    iface_stats = pernic.get(iface)
    all_connections = get_active_connections()
    interesting = [c for c in all_connections if not c["remote"].startswith("127.0.0.1") and not c["remote"].startswith("0.0.0.0")]
    flow = interesting[0] if interesting else (all_connections[0] if all_connections else None)
    if flow:
        flow = {
            "local": flow.get("local"),
            "remote": flow.get("remote"),
            "type": str(flow.get("type", "TCP")).upper(),
            "state_code": flow.get("state", "00"),
            "state_name": _tcp_state_name(flow.get("state", "00")),
        }

    tcpext = _parse_netstat_tcpext()
    ip_stats = _parse_snmp_section("Ip")
    tcp_stats = _parse_snmp_section("Tcp")
    ss_metrics = _get_ss_tcp_metrics()

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

    prev_ts = NETWORK_STACK_PREV["timestamp"]
    dt = max(0.001, now - prev_ts) if prev_ts else 1.0

    def rate(curr, prev):
        if prev is None:
            return 0.0
        return max(0.0, (curr - prev) / dt)

    retrans_per_sec = rate(retrans_total, NETWORK_STACK_PREV["tcpext_retrans"])
    ip_in_per_sec = rate(ip_in_total, NETWORK_STACK_PREV["ip_in"])
    ip_out_per_sec = rate(ip_out_total, NETWORK_STACK_PREV["ip_out"])
    ip_drop_per_sec = rate(ip_discards_total, NETWORK_STACK_PREV["ip_discards"])

    rx_per_sec = 0.0
    tx_per_sec = 0.0
    iface_drop_per_sec = 0.0
    rx_bytes = iface_stats.bytes_recv if iface_stats else 0
    tx_bytes = iface_stats.bytes_sent if iface_stats else 0
    iface_drops = (iface_stats.dropin + iface_stats.dropout) if iface_stats else 0
    if NETWORK_STACK_PREV["iface_rx"] is not None:
        rx_per_sec = max(0.0, (rx_bytes - NETWORK_STACK_PREV["iface_rx"]) / dt)
    if NETWORK_STACK_PREV["iface_tx"] is not None:
        tx_per_sec = max(0.0, (tx_bytes - NETWORK_STACK_PREV["iface_tx"]) / dt)
    if NETWORK_STACK_PREV["iface_drops"] is not None:
        iface_drop_per_sec = max(0.0, (iface_drops - NETWORK_STACK_PREV["iface_drops"]) / dt)

    NETWORK_STACK_PREV["timestamp"] = now
    NETWORK_STACK_PREV["tcpext_retrans"] = retrans_total
    NETWORK_STACK_PREV["ip_in"] = ip_in_total
    NETWORK_STACK_PREV["ip_out"] = ip_out_total
    NETWORK_STACK_PREV["ip_discards"] = ip_discards_total
    NETWORK_STACK_PREV["iface_rx"] = rx_bytes
    NETWORK_STACK_PREV["iface_tx"] = tx_bytes
    NETWORK_STACK_PREV["iface_drops"] = iface_drops

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
            "socket_api": {"active_sockets": len(all_connections), "established": established, "retransmits_per_sec": round(retrans_per_sec, 2)},
            "tcp_udp": {
                "established": established,
                "retrans_per_sec": round(retrans_per_sec, 2),
                "cwnd": int(ss_metrics.get("cwnd", 0)),
                "rtt_ms": round(float(ss_metrics.get("rtt_ms", 0.0)), 2),
                "tx_queue": int(ss_metrics.get("tx_queue", 0)),
            },
            "ip": {
                "in_packets_per_sec": round(ip_in_per_sec, 2),
                "out_packets_per_sec": round(ip_out_per_sec, 2),
                "drop_per_sec": round(ip_drop_per_sec, 3),
                "drop_ratio": round(drop_ratio, 5),
            },
            "netfilter": {"drop_per_sec": round(ip_drop_per_sec, 3), "drop_ratio": round(drop_ratio, 5)},
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
        "throughput_mb_s": round(throughput_mb_s, 3),
        "tcp_counters": {
            "in_segs": int(tcp_stats.get("InSegs", 0)),
            "out_segs": int(tcp_stats.get("OutSegs", 0)),
            "retrans_segs_total": int(retrans_total),
        },
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


def get_traceroute_info(remote_ip, max_hops=8):
    try:
        target_ip = ipaddress.ip_address(remote_ip)
        if target_ip.is_loopback or target_ip.is_unspecified:
            return {"remote_ip": remote_ip, "tool": None, "reached": False, "hop_count": 0, "hops": [], "note": "Local address, traceroute skipped"}
    except ValueError:
        raise ValueError("Invalid IP address")

    now = time.time()
    cached = TRACEROUTE_CACHE.get(remote_ip)
    if cached and (now - cached["timestamp"]) < TRACEROUTE_CACHE_TTL_SECONDS:
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
        TRACEROUTE_CACHE[remote_ip] = {"timestamp": now, "data": data}
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
    TRACEROUTE_CACHE[remote_ip] = {"timestamp": now, "data": data}
    return data
