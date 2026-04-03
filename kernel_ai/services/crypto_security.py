"""Crypto and security realtime services."""

from __future__ import annotations

import os
import random
import subprocess
import time
from datetime import datetime

import psutil


def infer_crypto_protocol(local_port, remote_port, process_name):
    """Infer protocol/algorithm pair from ports and process hints."""
    ports = {int(local_port or 0), int(remote_port or 0)}
    p_name = (process_name or "").lower()
    if 22 in ports or "ssh" in p_name:
        return "SSH", "Curve25519/ChaCha20-Poly1305"
    if 51820 in ports or "wireguard" in p_name or p_name.startswith("wg"):
        return "WireGuard", "ChaCha20-Poly1305"
    tls_ports = {443, 465, 636, 853, 993, 995, 8443, 9443, 6443, 2376}
    if ports & tls_ports or any(x in p_name for x in ["nginx", "haproxy", "curl", "wget", "openssl", "stunnel", "traefik"]):
        return "TLS", "AES-GCM/SHA256"
    return "Crypto API", "AES/SHA"


def is_likely_crypto_actor(process_name, local_port, remote_port, protocol):
    """Heuristic gate to avoid flooding with unrelated sockets."""
    p_name = (process_name or "").lower()
    interesting_ports = {22, 443, 465, 636, 853, 993, 995, 2376, 6443, 8443, 9443, 51820}
    process_tokens = [
        "nginx",
        "haproxy",
        "envoy",
        "caddy",
        "apache",
        "httpd",
        "traefik",
        "sshd",
        "ssh",
        "wg",
        "wireguard",
        "openssl",
        "stunnel",
        "curl",
        "wget",
        "python",
        "gunicorn",
        "uvicorn",
    ]
    if protocol in ("TLS", "SSH", "WireGuard"):
        return True
    if int(local_port or 0) in interesting_ports or int(remote_port or 0) in interesting_ports:
        return True
    return any(token in p_name for token in process_tokens)


def infer_tls_terminator(process_name, local_port, protocol, tls_listener_names):
    """Guess where TLS termination happens."""
    if protocol != "TLS":
        return "n/a"
    p_name = (process_name or "").lower()
    if p_name and p_name != "unknown":
        return p_name
    if int(local_port or 0) in {443, 8443, 9443, 6443} and tls_listener_names:
        top = next(iter(tls_listener_names))
        return f"listener:{top}"
    if int(local_port or 0) in {443, 8443, 9443, 6443}:
        return "unknown"
    return "upstream-or-external-lb"


def parse_proc_crypto_entries():
    """Parse /proc/crypto into a list of dict entries."""
    entries = []
    try:
        with open("/proc/crypto", "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read()
    except Exception:
        return entries

    blocks = [block.strip() for block in raw.split("\n\n") if block.strip()]
    for block in blocks:
        item = {}
        for line in block.splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            item[key.strip().lower()] = value.strip()
        if item:
            entries.append(item)
    return entries


def collect_algorithm_competition(requested_algorithm="aes"):
    """Build algorithm competition using kernel crypto registry."""
    entries = parse_proc_crypto_entries()
    requested = (requested_algorithm or "aes").lower()
    req_type_allow = {"aes": {"skcipher", "aead", "cipher"}, "sha": {"shash", "ahash", "hash"}, "chacha20": {"skcipher", "aead", "cipher"}}
    req_tokens = {"aes": ["aes"], "sha": ["sha"], "chacha20": ["chacha20", "xchacha20", "chacha"]}
    allowed_types = req_type_allow.get(requested, {"skcipher", "aead", "cipher", "shash", "ahash", "hash"})
    tokens = req_tokens.get(requested, [requested])
    candidates = []

    for entry in entries:
        name = str(entry.get("name", "")).lower()
        driver = str(entry.get("driver", "")).lower()
        alg_type = str(entry.get("type", "")).lower()
        if not any(token in name or token in driver for token in tokens):
            continue
        if alg_type and alg_type not in allowed_types:
            continue
        try:
            priority = int(entry.get("priority", "0") or 0)
        except ValueError:
            priority = 0
        impl_name = driver or name or "unknown-impl"
        candidates.append({"name": impl_name, "priority": priority, "type": alg_type or "unknown", "source": "kernel"})

    dedup = {}
    for item in candidates:
        existing = dedup.get(item["name"])
        if existing is None or item["priority"] > existing["priority"]:
            dedup[item["name"]] = item
    candidates = list(dedup.values())
    candidates.sort(key=lambda x: x["priority"], reverse=True)

    if not candidates:
        fallback_map = {
            "aes": [{"name": "aesni-intel", "priority": 300, "type": "skcipher", "source": "mock"}, {"name": "aes-avx", "priority": 200, "type": "skcipher", "source": "mock"}, {"name": "aes-generic", "priority": 100, "type": "skcipher", "source": "mock"}],
            "sha": [{"name": "sha256-avx2", "priority": 240, "type": "shash", "source": "mock"}, {"name": "sha256-ssse3", "priority": 180, "type": "shash", "source": "mock"}, {"name": "sha256-generic", "priority": 100, "type": "shash", "source": "mock"}],
            "chacha20": [{"name": "chacha20-neon", "priority": 260, "type": "skcipher", "source": "mock"}, {"name": "chacha20-simd", "priority": 220, "type": "skcipher", "source": "mock"}, {"name": "chacha20-generic", "priority": 100, "type": "skcipher", "source": "mock"}],
        }
        candidates = fallback_map.get(requested, fallback_map["aes"])

    selected = candidates[0] if candidates else None
    return {"request": requested.upper(), "implementations": candidates[:8], "selected": selected, "selection_policy": "max-priority"}


def collect_kernel_crypto_clients(items):
    """Infer major kernel crypto clients from active context."""
    client_rules = [
        ("kTLS", ["nginx", "haproxy", "envoy", "caddy", "apache", "httpd", "traefik"], "TLS"),
        ("WireGuard", ["wg", "wireguard"], "WireGuard"),
        ("IPsec/XFRM", ["charon", "strongswan", "ipsec", "racoon"], "TLS"),
        ("dm-crypt", ["cryptsetup", "dmcrypt", "luks"], "CRYPTO API"),
        ("fscrypt", ["fscrypt"], "CRYPTO API"),
        ("AF_ALG", ["openssl", "python", "curl", "wget"], "CRYPTO API"),
    ]
    results = []
    lowered_items = [{"process": str(item.get("process", "")).lower(), "protocol": str(item.get("protocol", ""))} for item in items]
    for name, tokens, proto_hint in client_rules:
        flows = 0
        for item in lowered_items:
            proc = item["process"]
            proto = item["protocol"]
            if any(token in proc for token in tokens):
                flows += 1
            elif proto_hint and proto == proto_hint:
                flows += 1
        status = "active" if flows > 0 else "idle"
        results.append({"name": name, "status": status, "active_flows": int(flows)})
    return results


def collect_sync_async_queue(items):
    """Estimate sync/async crypto execution pressure from active flows."""
    active_items = [i for i in items if str(i.get("status", "")).upper() != "LISTEN"]
    async_items = [i for i in active_items if str(i.get("source_kind", "")) == "connection" or str(i.get("protocol", "")).upper() in {"TLS", "WIREGUARD", "SSH"}]
    sync_items = max(len(active_items) - len(async_items), 0) + sum(1 for i in items if str(i.get("source_kind", "")) == "process")
    queue_depth = max(len(async_items) - 1, 0)
    queue_latency_ms = round(0.35 + min(5.5, queue_depth * 0.42 + len(active_items) * 0.08), 2)
    return {"sync_ops_est": int(sync_items), "async_ops_est": int(len(async_items)), "queue_depth_est": int(queue_depth), "queue_latency_ms_est": queue_latency_ms, "mode": "heuristic"}


def collect_hw_offload_status(entries, algorithm_competitions):
    """Estimate hardware acceleration availability from /proc/crypto drivers."""
    names = []
    for entry in entries:
        n = str(entry.get("name", "")).lower()
        d = str(entry.get("driver", "")).lower()
        if n:
            names.append(n)
        if d:
            names.append(d)

    def has_token(tokens):
        return any(any(token in item for token in tokens) for item in names)

    selected_impls = {key: str(value.get("selected", {}).get("name", "")).lower() for key, value in (algorithm_competitions or {}).items()}
    selected_joined = " ".join(selected_impls.values())
    engines = [
        {"engine": "AES-NI / CPU INSTR", "available": has_token(["aesni", "vaes"]), "active": ("aesni" in selected_joined or "vaes" in selected_joined)},
        {"engine": "SIMD (AVX/NEON)", "available": has_token(["avx", "sse", "simd", "neon"]), "active": any(token in selected_joined for token in ["avx", "simd", "neon", "sse"])},
        {"engine": "ARM CRYPTO EXT", "available": has_token(["arm64", "ce", "neon"]), "active": "arm64" in selected_joined},
        {"engine": "QAT OFFLOAD", "available": has_token(["qat"]), "active": "qat" in selected_joined},
        {"engine": "VIRTIO-CRYPTO", "available": has_token(["virtio"]), "active": "virtio" in selected_joined},
    ]
    result = []
    for item in engines:
        if item["active"]:
            status = "active"
        elif item["available"]:
            status = "available"
        else:
            status = "unavailable"
        result.append({"engine": item["engine"], "status": status})
    return result


def read_sysctl_int(path, default=0):
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read().strip()
        return int(raw or default)
    except Exception:
        return int(default)


def read_proc_interrupt_total():
    try:
        with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("intr "):
                    parts = line.strip().split()
                    if len(parts) >= 2:
                        return int(parts[1])
    except Exception:
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
    except Exception:
        disk = None
    try:
        net = psutil.net_io_counters()
    except Exception:
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


def collect_algorithm_requesters(items, kernel_clients):
    """Infer likely requestor objects that trigger algorithm competition."""
    algo_map = {"aes": {}, "sha": {}, "chacha20": {}}
    client_boost_rules = {"aes": {"kTLS", "dm-crypt", "AF_ALG", "IPsec/XFRM"}, "sha": {"kTLS", "AF_ALG", "IPsec/XFRM"}, "chacha20": {"WireGuard", "AF_ALG"}}
    for item in items or []:
        process_name = str(item.get("process", "unknown")).lower() or "unknown"
        protocol = str(item.get("protocol", "")).upper()
        algorithm = str(item.get("algorithm", "")).upper()
        status = str(item.get("status", "")).upper()
        if status == "LISTEN":
            continue
        matched_algorithms = set()
        if "AES" in algorithm or protocol == "TLS":
            matched_algorithms.add("aes")
        if "SHA" in algorithm or protocol == "TLS":
            matched_algorithms.add("sha")
        if "CHACHA" in algorithm or protocol in {"WIREGUARD", "SSH"}:
            matched_algorithms.add("chacha20")
        if not matched_algorithms and protocol == "CRYPTO API":
            matched_algorithms.update(["aes", "sha"])
        for algo_key in matched_algorithms:
            key = f"process:{process_name}"
            bucket = algo_map[algo_key].setdefault(key, {"name": process_name, "kind": "process", "score": 0})
            bucket["score"] += 1
    for client in kernel_clients or []:
        name = str(client.get("name", "")).strip()
        flows = int(client.get("active_flows", 0) or 0)
        if not name or flows <= 0:
            continue
        for algo_key, allowed_clients in client_boost_rules.items():
            if name not in allowed_clients:
                continue
            key = f"client:{name}"
            bucket = algo_map[algo_key].setdefault(key, {"name": name, "kind": "kernel-client", "score": 0})
            bucket["score"] += max(2, flows)
    result = {}
    for algo_key, raw in algo_map.items():
        ranked = sorted(raw.values(), key=lambda x: x.get("score", 0), reverse=True)
        if not ranked:
            ranked = [{"name": "user/kernel request", "kind": "generic", "score": 1}]
        result[algo_key] = ranked[:4]
    return result


def build_crypto_decision_pipelines(algorithm_competitions, kernel_clients, hw_offload, algorithm_requesters):
    """Build visual decision pipeline metadata for each algorithm family."""
    hw_active = [h.get("engine") for h in (hw_offload or []) if h.get("status") == "active"]
    hw_available = [h.get("engine") for h in (hw_offload or []) if h.get("status") == "available"]
    capability_hint = ", ".join(hw_active[:2] or hw_available[:2]) if (hw_active or hw_available) else "generic-cpu-only"
    tfm_lookup_map = {"AES": "crypto_alloc_skcipher(aes)", "SHA": "crypto_alloc_shash(sha*)", "CHACHA20": "crypto_alloc_skcipher(chacha20)"}
    pipelines = {}
    for key, comp in (algorithm_competitions or {}).items():
        request = str(comp.get("request", key)).upper()
        impls = comp.get("implementations", []) or []
        shortlist = [str(x.get("name", "unknown")) for x in impls[:3]]
        requesters = list((algorithm_requesters or {}).get(key, []))
        top_requester = requesters[0] if requesters else {"name": "user/kernel request", "kind": "generic"}
        request_origin = f"{top_requester.get('kind', 'generic')}: {top_requester.get('name', 'unknown')}"
        selected_driver = str((comp.get("selected") or {}).get("name", "unknown"))
        fallback_driver = next((name for name in shortlist if "generic" in name.lower()), shortlist[-1] if shortlist else "none")
        selected_is_generic = "generic" in selected_driver.lower()
        selected_source = str((comp.get("selected") or {}).get("source", "kernel")).lower()
        fallback_active = selected_is_generic and len(shortlist) > 1
        pipelines[key] = {
            "request": request,
            "request_origin": request_origin,
            "requesters": requesters,
            "tfm_lookup": tfm_lookup_map.get(request, f"crypto_lookup({request.lower()})"),
            "impl_shortlist": shortlist,
            "priority_check": "max priority wins",
            "capability_check": capability_hint,
            "selected_driver": selected_driver,
            "fallback_driver": fallback_driver,
            "fallback_active": bool(fallback_active),
            "fallback_reason": "higher-priority impl unavailable or unsupported" if fallback_active else "not-triggered",
            "source": selected_source,
        }
    return pipelines


def collect_crypto_realtime(crypto_prev, entropy_prev=None, callbacks=None):
    """
    Build a near-realtime list of processes likely interacting with kernel crypto.
    This is heuristic-based and derived from active network/process context.
    """
    callbacks = callbacks or {}
    infer_crypto_protocol_fn = callbacks.get("infer_crypto_protocol", infer_crypto_protocol)
    is_likely_crypto_actor_fn = callbacks.get("is_likely_crypto_actor", is_likely_crypto_actor)
    infer_tls_terminator_fn = callbacks.get("infer_tls_terminator", infer_tls_terminator)
    collect_algorithm_competition_fn = callbacks.get("collect_algorithm_competition", collect_algorithm_competition)
    parse_proc_crypto_entries_fn = callbacks.get("parse_proc_crypto_entries", parse_proc_crypto_entries)
    collect_kernel_crypto_clients_fn = callbacks.get("collect_kernel_crypto_clients", collect_kernel_crypto_clients)
    collect_hw_offload_status_fn = callbacks.get("collect_hw_offload_status", collect_hw_offload_status)
    collect_sync_async_queue_fn = callbacks.get("collect_sync_async_queue", collect_sync_async_queue)
    collect_algorithm_requesters_fn = callbacks.get("collect_algorithm_requesters", collect_algorithm_requesters)
    build_crypto_decision_pipelines_fn = callbacks.get("build_crypto_decision_pipelines", build_crypto_decision_pipelines)
    collect_entropy_cloud_status_fn = callbacks.get("collect_entropy_cloud_status")
    entropy_prev_local = entropy_prev or {
        "timestamp": None,
        "disk_read_bytes": 0,
        "disk_write_bytes": 0,
        "net_sent_bytes": 0,
        "net_recv_bytes": 0,
        "interrupt_total": 0,
    }
    if collect_entropy_cloud_status_fn is None:
        collect_entropy_cloud_status_fn = lambda: collect_entropy_cloud_status(entropy_prev_local)

    items = []
    tls_listener_by_port = {}
    tls_listener_names = set()
    unknown_pid_flows = 0

    try:
        connections = psutil.net_connections(kind="inet")
    except Exception:
        connections = []

    tls_ports = {443, 8443, 9443, 6443}
    for conn in connections:
        status = str(getattr(conn, "status", "") or "")
        if status != "LISTEN":
            continue
        laddr = getattr(conn, "laddr", None)
        local_port = getattr(laddr, "port", 0) if laddr else 0
        if int(local_port or 0) not in tls_ports:
            continue
        pid = getattr(conn, "pid", None)
        pid_i = int(pid or 0)
        process_name = "unknown"
        if pid_i:
            try:
                process_name = psutil.Process(pid_i).name().lower()
            except Exception:
                process_name = f"pid-{pid_i}"
        tls_listener_by_port[int(local_port)] = {"pid": pid_i, "process": process_name}
        tls_listener_names.add(process_name)
        items.append(
            {
                "process": process_name,
                "pid": pid_i,
                "protocol": "TLS",
                "algorithm": "AES-GCM/SHA256",
                "endpoint": f"0.0.0.0:{int(local_port)}",
                "local_port": int(local_port),
                "remote_port": 0,
                "status": "LISTEN",
                "tls_terminator": process_name,
                "source_kind": "listener",
            }
        )

    for conn in connections:
        pid = getattr(conn, "pid", None)
        status = str(getattr(conn, "status", "") or "")
        if status not in ("ESTABLISHED", "SYN_SENT", "SYN_RECV"):
            continue

        laddr = getattr(conn, "laddr", None)
        raddr = getattr(conn, "raddr", None)
        local_ip = getattr(laddr, "ip", "") if laddr else ""
        local_port = getattr(laddr, "port", 0) if laddr else 0
        remote_ip = getattr(raddr, "ip", "") if raddr else ""
        remote_port = getattr(raddr, "port", 0) if raddr else 0

        pid_i = int(pid or 0)
        process_name = "unknown"
        if pid_i:
            try:
                proc = psutil.Process(pid_i)
                process_name = proc.name()
            except Exception:
                process_name = f"pid-{pid_i}"
        else:
            unknown_pid_flows += 1
            listener_meta = tls_listener_by_port.get(int(local_port or 0))
            if listener_meta:
                process_name = listener_meta.get("process") or "unknown"

        protocol, algorithm = infer_crypto_protocol_fn(local_port, remote_port, process_name)
        if not is_likely_crypto_actor_fn(process_name, local_port, remote_port, protocol):
            continue

        tls_terminator = infer_tls_terminator_fn(process_name, local_port, protocol, tls_listener_names)
        endpoint = f"{remote_ip}:{remote_port}" if remote_ip else f"{local_ip}:{local_port}"

        items.append(
            {
                "process": process_name.lower(),
                "pid": pid_i,
                "protocol": protocol,
                "algorithm": algorithm,
                "endpoint": endpoint,
                "local_port": int(local_port or 0),
                "remote_port": int(remote_port or 0),
                "status": status,
                "tls_terminator": tls_terminator,
                "source_kind": "connection",
            }
        )

    if not items:
        for proc in psutil.process_iter(attrs=["pid", "name"]):
            try:
                name = str(proc.info.get("name", "")).lower()
            except Exception:
                continue
            if any(token in name for token in ["nginx", "sshd", "curl", "openssl", "kube", "vpn", "python"]):
                protocol, algorithm = infer_crypto_protocol_fn(0, 0, name)
                items.append(
                    {
                        "process": name,
                        "pid": int(proc.info.get("pid") or 0),
                        "protocol": protocol,
                        "algorithm": algorithm,
                        "endpoint": "-",
                        "local_port": 0,
                        "remote_port": 0,
                        "status": "RUNNING",
                        "tls_terminator": "n/a",
                        "source_kind": "process",
                    }
                )
            if len(items) >= 12:
                break

    deduped = {}
    for item in items:
        key = (
            item.get("process"),
            int(item.get("pid") or 0),
            item.get("protocol"),
            item.get("algorithm"),
            item.get("endpoint"),
            item.get("status"),
            item.get("source_kind"),
        )
        if key not in deduped:
            deduped[key] = item
    items = list(deduped.values())

    now = time.time()
    prev_ts = crypto_prev["timestamp"]
    prev_flows = crypto_prev["active_flows"]
    active_flows = len(items)
    crypto_prev["timestamp"] = now
    crypto_prev["active_flows"] = active_flows

    if prev_ts:
        dt = max(now - prev_ts, 0.001)
        flow_delta = abs(active_flows - prev_flows)
        ops_per_sec = round((active_flows * 90) + (flow_delta / dt) * 60, 2)
    else:
        ops_per_sec = round(active_flows * 90, 2)

    unique_processes = []
    for item in items:
        p = item["process"]
        if p not in unique_processes:
            unique_processes.append(p)

    algorithm_competitions = {
        "aes": collect_algorithm_competition_fn("aes"),
        "sha": collect_algorithm_competition_fn("sha"),
        "chacha20": collect_algorithm_competition_fn("chacha20"),
    }
    proc_crypto_entries = parse_proc_crypto_entries_fn()
    kernel_clients = collect_kernel_crypto_clients_fn(items)
    hw_offload = collect_hw_offload_status_fn(proc_crypto_entries, algorithm_competitions)
    crypto_stage1 = {
        "kernel_clients": kernel_clients,
        "sync_async": collect_sync_async_queue_fn(items),
        "hw_offload": hw_offload,
    }
    algorithm_requesters = collect_algorithm_requesters_fn(items, kernel_clients)
    crypto_decision_pipelines = build_crypto_decision_pipelines_fn(
        algorithm_competitions=algorithm_competitions,
        kernel_clients=kernel_clients,
        hw_offload=hw_offload,
        algorithm_requesters=algorithm_requesters,
    )
    entropy_cloud = collect_entropy_cloud_status_fn()

    return {
        "items": items[:24],
        "processes": unique_processes[:16],
        "meta": {
            "ops_per_sec": ops_per_sec,
            "tls_sessions": sum(1 for i in items if i.get("protocol") == "TLS"),
            "active_flows": active_flows,
            "unknown_pid_flows": int(unknown_pid_flows),
            "tls_terminators": sorted(list(tls_listener_names))[:8],
            "algorithm_competition": algorithm_competitions["aes"],
            "algorithm_competitions": algorithm_competitions,
            "algorithm_requesters": algorithm_requesters,
            "crypto_stage1": crypto_stage1,
            "entropy_cloud": entropy_cloud,
            "crypto_decision_pipeline": crypto_decision_pipelines.get("aes", {}),
            "crypto_decision_pipelines": crypto_decision_pipelines,
            "source": "live-heuristic-v2",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
    }


def collect_security_realtime(security_prev):
    """
    Stage-1 security subsystem telemetry:
    - Threat decision pipeline
    - Process trust graph
    - Attack surface map
    """
    now = time.time()
    process_rows = []
    suspicious_tokens = {
        "nmap",
        "masscan",
        "hydra",
        "sqlmap",
        "metasploit",
        "msfconsole",
        "netcat",
        "nc",
        "ncat",
        "socat",
        "john",
        "hashcat",
        "strace",
        "gdb",
    }
    trusted_tokens = {"systemd", "sshd", "nginx", "python", "containerd", "dockerd", "kubelet", "cron", "rsyslogd", "dbus-daemon"}
    ptrace_like = {"strace", "gdb", "ltrace"}

    def classify_trust(score):
        if score >= 70:
            return "blocked"
        if score >= 48:
            return "suspicious"
        if score >= 28:
            return "observe"
        return "trusted"

    for proc in psutil.process_iter(["pid", "name", "username", "memory_percent", "status", "num_threads"]):
        try:
            pid = int(proc.info.get("pid") or 0)
            name = str(proc.info.get("name") or "unknown").lower()
            mem = float(proc.info.get("memory_percent") or 0.0)
            threads = int(proc.info.get("num_threads") or 0)
            status = str(proc.info.get("status") or "unknown")
            user = str(proc.info.get("username") or "")

            score = 12
            if any(tok in name for tok in suspicious_tokens):
                score += 38
            if any(tok in name for tok in trusted_tokens):
                score -= 10
            if user == "root":
                score += 14
            if threads > 120:
                score += 8
            if mem > 8.0:
                score += 8
            if status in {"zombie", "stopped"}:
                score += 10
            score = max(0, min(100, score))
            trust = classify_trust(score)

            process_rows.append(
                {
                    "pid": pid,
                    "name": name,
                    "trust": trust,
                    "risk_score": score,
                    "threads": threads,
                    "mem_percent": round(mem, 2),
                    "status": status,
                    "user": user,
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception:
            continue

    process_rows.sort(key=lambda p: (p["risk_score"], p["mem_percent"], p["threads"]), reverse=True)
    trust_graph = process_rows[:12]

    request_candidates = ["open /etc/shadow", "connect tcp:443", "exec /usr/bin/sudo", "ptrace attach", "bpf program load", "write /usr/lib/systemd/*"]
    hook_candidates = ["security_file_open", "security_socket_connect", "security_bprm_check", "seccomp-bpf", "cgroup device policy", "audit hook"]
    lanes = []
    for idx, row in enumerate(trust_graph[:10]):
        req = request_candidates[idx % len(request_candidates)]
        hook = hook_candidates[idx % len(hook_candidates)]
        score = int(row.get("risk_score") or 0)
        if score >= 70:
            verdict = "deny"
        elif score >= 45:
            verdict = "audit"
        else:
            verdict = "allow"
        lanes.append(
            {
                "process": row.get("name", "unknown"),
                "pid": int(row.get("pid", 0)),
                "request": req,
                "hook": hook,
                "verdict": verdict,
                "reason": "risk-score-policy",
                "risk_score": score,
            }
        )

    try:
        listen_ports = len([c for c in psutil.net_connections(kind="inet") if str(getattr(c, "status", "") or "") == "LISTEN"])
    except Exception:
        listen_ports = 0

    try:
        with open("/proc/modules", "r", encoding="utf-8", errors="ignore") as f:
            loaded_modules = sum(1 for _ in f)
    except Exception:
        loaded_modules = 0

    ptrace_processes = sum(1 for p in process_rows if any(tok in p.get("name", "") for tok in ptrace_like))
    root_processes = sum(1 for p in process_rows if p.get("user") == "root")
    suspicious_processes = sum(1 for p in process_rows if p.get("trust") in {"suspicious", "blocked"})

    setuid_bins = 0
    try:
        out = subprocess.check_output(
            "find /usr/bin /usr/sbin -xdev -perm -4000 -type f 2>/dev/null | wc -l",
            shell=True,
            text=True,
            timeout=1.8,
        ).strip()
        setuid_bins = int(out or 0)
    except Exception:
        setuid_bins = 0

    attack_surface = [
        {"name": "open-listen-ports", "value": int(listen_ports), "severity": "high" if listen_ports > 40 else "medium"},
        {"name": "setuid-binaries", "value": int(setuid_bins), "severity": "high" if setuid_bins > 70 else "medium"},
        {"name": "loaded-kernel-modules", "value": int(loaded_modules), "severity": "medium" if loaded_modules > 180 else "low"},
        {"name": "ptrace-capable-processes", "value": int(ptrace_processes), "severity": "high" if ptrace_processes > 0 else "low"},
        {"name": "root-processes", "value": int(root_processes), "severity": "medium" if root_processes > 120 else "low"},
        {"name": "suspicious-processes", "value": int(suspicious_processes), "severity": "high" if suspicious_processes > 6 else "medium"},
    ]

    def _read_text(path):
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return str(f.read().strip())
        except Exception:
            return ""

    apparmor_raw = _read_text("/sys/module/apparmor/parameters/enabled")
    selinux_enforce = _read_text("/sys/fs/selinux/enforce")
    selinux_policy = _read_text("/sys/fs/selinux/policyvers")
    yama_scope = _read_text("/proc/sys/kernel/yama/ptrace_scope")
    bpf_unpriv = _read_text("/proc/sys/kernel/unprivileged_bpf_disabled")
    landlock_present = os.path.exists("/sys/kernel/security/landlock")
    ima_present = os.path.exists("/sys/kernel/security/ima")
    bpf_lsm_present = os.path.exists("/sys/kernel/security/bpf")
    try:
        lsm_list_raw = _read_text("/sys/kernel/security/lsm")
        active_lsms = [x.strip() for x in lsm_list_raw.split(",")] if lsm_list_raw else []
        stacking_enabled = len([x for x in active_lsms if x in {"selinux", "apparmor", "bpf"}]) > 1
    except Exception:
        active_lsms = []
        stacking_enabled = False

    lsm_status = [
        {"name": "AppArmor", "status": "enforcing" if apparmor_raw.lower().startswith("y") else ("disabled" if apparmor_raw else "unknown"), "detail": apparmor_raw or "n/a", "type": "policy_engine"},
        {"name": "SELinux", "status": "enforcing" if selinux_enforce == "1" else ("disabled" if selinux_enforce == "0" else "unknown"), "detail": selinux_enforce or "n/a", "type": "policy_engine", "policy_version": selinux_policy or "n/a"},
        {"name": "BPF LSM", "status": "present" if bpf_lsm_present else "absent", "detail": "eBPF-based LSM" if bpf_lsm_present else "n/a", "type": "policy_engine"},
        {"name": "LSM Stacking", "status": "enabled" if stacking_enabled else "disabled", "detail": ",".join(active_lsms[:3]) if active_lsms else "n/a", "type": "stacking"},
        {"name": "Yama ptrace", "status": "hardened" if yama_scope in {"2", "3"} else ("relaxed" if yama_scope in {"0", "1"} else "unknown"), "detail": yama_scope or "n/a", "type": "restriction"},
        {"name": "unprivileged bpf", "status": "blocked" if bpf_unpriv == "1" else ("allowed" if bpf_unpriv == "0" else "unknown"), "detail": bpf_unpriv or "n/a", "type": "restriction"},
        {"name": "Landlock", "status": "present" if landlock_present else "absent", "detail": "sysfs" if landlock_present else "n/a", "type": "restriction"},
        {"name": "IMA/EVM", "status": "present" if ima_present else "absent", "detail": "sysfs" if ima_present else "n/a", "type": "integrity"},
    ]

    lsm_engines = []
    if apparmor_raw.lower().startswith("y"):
        lsm_engines.append({"name": "AppArmor", "type": "policy_engine", "status": "enforcing", "hooks": ["file_open", "bprm_check", "socket_connect"], "decisions_per_sec": random.randint(8, 45)})
    if selinux_enforce == "1":
        lsm_engines.append({"name": "SELinux", "type": "policy_engine", "status": "enforcing", "hooks": ["file_open", "bprm_check", "socket_connect", "inode_create"], "decisions_per_sec": random.randint(12, 52)})
    if bpf_lsm_present:
        lsm_engines.append({"name": "BPF LSM", "type": "policy_engine", "status": "enforcing", "hooks": ["file_open", "bprm_check", "socket_connect"], "decisions_per_sec": random.randint(5, 28)})

    all_capabilities_map = {
        0: "CAP_CHOWN",
        1: "CAP_DAC_OVERRIDE",
        2: "CAP_DAC_READ_SEARCH",
        3: "CAP_FOWNER",
        4: "CAP_FSETID",
        5: "CAP_KILL",
        6: "CAP_SETGID",
        7: "CAP_SETUID",
        8: "CAP_SETPCAP",
        9: "CAP_LINUX_IMMUTABLE",
        10: "CAP_NET_BIND_SERVICE",
        11: "CAP_NET_BROADCAST",
        12: "CAP_NET_ADMIN",
        13: "CAP_NET_RAW",
        14: "CAP_IPC_LOCK",
        15: "CAP_IPC_OWNER",
        16: "CAP_SYS_MODULE",
        17: "CAP_SYS_RAWIO",
        18: "CAP_SYS_CHROOT",
        19: "CAP_SYS_PTRACE",
        20: "CAP_SYS_PACCT",
        21: "CAP_SYS_ADMIN",
        22: "CAP_SYS_BOOT",
        23: "CAP_SYS_NICE",
        24: "CAP_SYS_RESOURCE",
        25: "CAP_SYS_TIME",
        26: "CAP_SYS_TTY_CONFIG",
        27: "CAP_MKNOD",
        28: "CAP_LEASE",
        29: "CAP_AUDIT_WRITE",
        30: "CAP_AUDIT_CONTROL",
        31: "CAP_SETFCAP",
        32: "CAP_MAC_OVERRIDE",
        33: "CAP_MAC_ADMIN",
        34: "CAP_SYSLOG",
        35: "CAP_WAKE_ALARM",
        36: "CAP_BLOCK_SUSPEND",
        37: "CAP_AUDIT_READ",
        38: "CAP_PERFMON",
        39: "CAP_BPF",
        40: "CAP_CHECKPOINT_RESTORE",
    }
    dangerous_caps = {12: "CAP_NET_ADMIN", 16: "CAP_SYS_MODULE", 17: "CAP_SYS_RAWIO", 19: "CAP_SYS_PTRACE", 21: "CAP_SYS_ADMIN", 39: "CAP_BPF"}
    capabilities_rows = []
    seccomp_counts = {"none": 0, "strict": 0, "filter": 0, "unknown": 0}
    seccomp_processes = []
    capabilities_processes = []

    common_syscalls = [
        "read",
        "write",
        "open",
        "close",
        "stat",
        "fstat",
        "lstat",
        "poll",
        "lseek",
        "mmap",
        "mprotect",
        "munmap",
        "brk",
        "rt_sigaction",
        "rt_sigprocmask",
        "rt_sigreturn",
        "ioctl",
        "pread64",
        "pwrite64",
        "readv",
        "writev",
        "access",
        "pipe",
        "select",
        "sched_yield",
        "mremap",
        "msync",
        "mincore",
        "madvise",
        "shmget",
        "shmat",
        "shmctl",
        "dup",
        "dup2",
        "pause",
        "nanosleep",
        "getitimer",
        "alarm",
        "setitimer",
        "getpid",
    ]

    for row in process_rows[:180]:
        pid = int(row.get("pid") or 0)
        if pid <= 0:
            continue
        cap_eff_hex = ""
        cap_prm_hex = ""
        seccomp_mode = "unknown"
        try:
            with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="ignore") as f:
                for ln in f:
                    if ln.startswith("CapEff:"):
                        cap_eff_hex = ln.split(":", 1)[1].strip()
                    elif ln.startswith("CapPrm:"):
                        cap_prm_hex = ln.split(":", 1)[1].strip()
                    elif ln.startswith("Seccomp:"):
                        seccomp_raw = ln.split(":", 1)[1].strip()
                        if seccomp_raw == "0":
                            seccomp_mode = "none"
                        elif seccomp_raw == "1":
                            seccomp_mode = "strict"
                        elif seccomp_raw == "2":
                            seccomp_mode = "filter"
                        else:
                            seccomp_mode = "unknown"
        except Exception:
            pass

        seccomp_counts[seccomp_mode] = seccomp_counts.get(seccomp_mode, 0) + 1
        if seccomp_mode in {"filter", "strict"}:
            allowed_syscalls = []
            blocked_syscalls = []
            proc_name_lower = str(row.get("name", "")).lower()
            if "nginx" in proc_name_lower or "apache" in proc_name_lower:
                allowed_syscalls = ["read", "write", "open", "close", "socket", "accept", "send", "recv", "epoll_wait", "fstat"]
                blocked_syscalls = ["ptrace", "mount", "umount", "sys_module", "bpf", "keyctl"]
            elif "sshd" in proc_name_lower:
                allowed_syscalls = ["read", "write", "open", "close", "socket", "accept", "send", "recv", "fork", "execve"]
                blocked_syscalls = ["mount", "umount", "sys_module", "bpf"]
            elif "docker" in proc_name_lower or "containerd" in proc_name_lower:
                allowed_syscalls = ["read", "write", "open", "close", "socket", "clone", "unshare", "mount", "umount"]
                blocked_syscalls = ["sys_module", "bpf"]
            else:
                allowed_syscalls = common_syscalls[:40]
                blocked_syscalls = ["ptrace", "mount", "umount", "sys_module", "bpf", "keyctl", "kexec_load"]
            seccomp_processes.append(
                {
                    "pid": pid,
                    "name": row.get("name", "unknown"),
                    "mode": seccomp_mode,
                    "allowed_syscalls": allowed_syscalls[:20],
                    "blocked_syscalls": blocked_syscalls,
                    "sandbox_level": "strict" if seccomp_mode == "strict" else "filter",
                }
            )

        if not cap_eff_hex:
            continue
        try:
            cap_eff_val = int(cap_eff_hex, 16)
        except Exception:
            continue

        all_caps = [all_capabilities_map.get(bit, f"CAP_{bit}") for bit in range(41) if (cap_eff_val & (1 << bit))]
        matched = [name for bit, name in dangerous_caps.items() if (cap_eff_val & (1 << bit))]
        capabilities_processes.append(
            {
                "pid": pid,
                "name": row.get("name", "unknown"),
                "user": row.get("user", ""),
                "capabilities": all_caps[:15],
                "dangerous_caps": matched,
                "cap_eff_hex": cap_eff_hex,
                "has_keys": len(all_caps) > 0,
            }
        )
        if not matched:
            continue
        risk = min(100, 20 + len(matched) * 16 + (10 if row.get("user") == "root" else 0))
        capabilities_rows.append(
            {
                "pid": pid,
                "name": row.get("name", "unknown"),
                "user": row.get("user", ""),
                "seccomp": seccomp_mode,
                "cap_eff": cap_eff_hex,
                "cap_prm": cap_prm_hex or "0",
                "dangerous": matched[:4],
                "risk_score": int(risk),
            }
        )

    capabilities_rows.sort(key=lambda x: (x.get("risk_score", 0), len(x.get("dangerous", []))), reverse=True)
    capabilities_drift = capabilities_rows[:8]

    total_seccomp_sample = max(1, sum(seccomp_counts.values()))
    unsandboxed = [r for r in capabilities_rows if r.get("seccomp") == "none"]
    unsandboxed.sort(key=lambda x: x.get("risk_score", 0), reverse=True)
    seccomp_coverage = {
        "none": int(seccomp_counts.get("none", 0)),
        "strict": int(seccomp_counts.get("strict", 0)),
        "filter": int(seccomp_counts.get("filter", 0)),
        "unknown": int(seccomp_counts.get("unknown", 0)),
        "coverage_percent": round((seccomp_counts.get("filter", 0) + seccomp_counts.get("strict", 0)) * 100.0 / total_seccomp_sample, 2),
        "high_risk_unsandboxed": [{"pid": int(r.get("pid", 0)), "name": str(r.get("name", "unknown")), "risk_score": int(r.get("risk_score", 0))} for r in unsandboxed[:6]],
    }

    prev_ts = security_prev["timestamp"]
    prev_events = int(security_prev["events"] or 0)
    current_events = len(lanes)
    security_prev["timestamp"] = now
    security_prev["events"] = current_events
    if prev_ts:
        dt = max(0.001, now - prev_ts)
        decisions_per_sec = round((current_events / dt) + abs(current_events - prev_events) * 0.6, 2)
    else:
        decisions_per_sec = float(current_events)

    return {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "pipeline": {"stages": ["request event", "LSM/seccomp hook", "policy verdict"], "lanes": lanes},
        "trust_graph": trust_graph,
        "attack_surface": attack_surface,
        "security_tools": {"lsm_status": lsm_status, "capabilities_drift": capabilities_drift, "seccomp_coverage": seccomp_coverage},
        "security_core": {
            "lsm_engines": lsm_engines,
            "seccomp_processes": seccomp_processes[:12],
            "capabilities_processes": capabilities_processes[:12],
            "stacking_enabled": stacking_enabled,
            "active_lsms": active_lsms,
        },
        "meta": {
            "decisions_per_sec": decisions_per_sec,
            "events": current_events,
            "trusted": sum(1 for p in trust_graph if p.get("trust") == "trusted"),
            "observe": sum(1 for p in trust_graph if p.get("trust") == "observe"),
            "suspicious": sum(1 for p in trust_graph if p.get("trust") == "suspicious"),
            "blocked": sum(1 for p in trust_graph if p.get("trust") == "blocked"),
            "seccomp_coverage_percent": seccomp_coverage.get("coverage_percent", 0.0),
            "mode": "live-heuristic-v2",
        },
    }
