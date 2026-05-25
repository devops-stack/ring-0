"""Helper functions for crypto telemetry pipelines."""

from __future__ import annotations

from pathlib import Path


def _read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def _read_lines(path):
    return [line.strip() for line in _read_text(path).splitlines() if line.strip()]


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
    except OSError:
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


def _detect_wireguard_interfaces():
    dev_lines = _read_lines("/proc/net/dev")
    ifaces = []
    for line in dev_lines:
        if ":" not in line:
            continue
        name = line.split(":", 1)[0].strip()
        if name.startswith("wg") or "wireguard" in name.lower():
            ifaces.append(name)
    return ifaces


def _detect_dm_crypt_devices():
    devices = []
    for dm_dir in Path("/sys/block").glob("dm-*"):
        name = _read_text(dm_dir / "dm" / "name").strip()
        uuid = _read_text(dm_dir / "dm" / "uuid").strip()
        joined = f"{name} {uuid}".lower()
        if "crypt" not in joined and "luks" not in joined:
            continue
        devices.append({"name": name or dm_dir.name, "uuid": uuid[:32]})
    return devices


def _xfrm_stat_total():
    total = 0
    for line in _read_lines("/proc/net/xfrm_stat"):
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            total += int(parts[-1])
        except ValueError:
            continue
    return total


def collect_crypto_runtime_sources(items, proc_crypto_entries, kernel_clients, entropy_cloud):
    """Collect simple real-world crypto source signals without eBPF tracing."""
    items = list(items or [])
    proc_crypto_entries = list(proc_crypto_entries or [])
    kernel_clients = list(kernel_clients or [])
    entropy_cloud = entropy_cloud or {}

    protocols = {str(item.get("protocol") or "").upper() for item in items}
    process_names = {str(item.get("process") or "").lower() for item in items}
    client_by_name = {
        str(client.get("name") or "").lower(): client
        for client in kernel_clients
        if isinstance(client, dict)
    }
    proc_names = {
        str(entry.get("name") or entry.get("driver") or "").lower()
        for entry in proc_crypto_entries
        if isinstance(entry, dict)
    }
    proc_types = {
        str(entry.get("type") or "").lower()
        for entry in proc_crypto_entries
        if isinstance(entry, dict)
    }
    wg_ifaces = _detect_wireguard_interfaces()
    dm_crypt_devices = _detect_dm_crypt_devices()
    xfrm_total = _xfrm_stat_total()
    af_alg_present = "af_alg" in _read_text("/proc/modules").lower() or "alg" in _read_text("/proc/net/protocols").lower()

    def _confidence(active, source):
        if not active:
            return 0.0
        return {"direct": 0.95, "procfs": 0.82, "heuristic": 0.55}.get(source, 0.45)

    def _source(source_id, label, active, source, evidence):
        return {
            "id": source_id,
            "label": label,
            "active": bool(active),
            "source": source,
            "confidence": round(_confidence(active, source), 2),
            "evidence": evidence,
        }

    tls_items = [item for item in items if str(item.get("protocol") or "").upper() == "TLS"]
    ssh_items = [item for item in items if str(item.get("protocol") or "").upper() == "SSH"]
    wg_items = [item for item in items if str(item.get("protocol") or "").upper() == "WIREGUARD"]
    af_alg_candidates = sorted(
        name for name in process_names
        if any(token in name for token in ("openssl", "python", "curl", "wget"))
    )
    ipsec_clients = [
        name for name, client in client_by_name.items()
        if "ipsec" in name or "xfrm" in name or int(client.get("active_flows") or 0) > 0 and "ipsec" in name
    ]

    return [
        _source(
            "tls_sockets",
            "TLS sockets",
            bool(tls_items),
            "direct",
            {
                "flows": len(tls_items),
                "processes": sorted({str(i.get("process") or "unknown") for i in tls_items})[:5],
            },
        ),
        _source(
            "ssh_crypto",
            "SSH crypto",
            bool(ssh_items),
            "direct",
            {
                "flows": len(ssh_items),
                "processes": sorted({str(i.get("process") or "unknown") for i in ssh_items})[:5],
            },
        ),
        _source(
            "wireguard",
            "WireGuard",
            bool(wg_items or wg_ifaces or Path("/sys/module/wireguard").exists()),
            "procfs" if wg_ifaces or Path("/sys/module/wireguard").exists() else "heuristic",
            {
                "flows": len(wg_items),
                "interfaces": wg_ifaces[:5],
            },
        ),
        _source(
            "ipsec_xfrm",
            "IPsec / XFRM",
            bool(ipsec_clients or xfrm_total > 0),
            "procfs" if xfrm_total > 0 else "heuristic",
            {
                "xfrm_stat_total": xfrm_total,
                "clients": sorted(ipsec_clients)[:5],
            },
        ),
        _source(
            "dm_crypt",
            "dm-crypt / LUKS",
            bool(dm_crypt_devices or int((client_by_name.get("dm-crypt") or {}).get("active_flows") or 0) > 0),
            "procfs" if dm_crypt_devices else "heuristic",
            {
                "devices": dm_crypt_devices[:5],
            },
        ),
        _source(
            "af_alg",
            "AF_ALG userspace",
            bool(af_alg_present and af_alg_candidates),
            "procfs" if af_alg_present else "heuristic",
            {
                "module_or_protocol": bool(af_alg_present),
                "candidate_processes": af_alg_candidates[:5],
            },
        ),
        _source(
            "kernel_registry",
            "/proc/crypto registry",
            bool(proc_crypto_entries),
            "procfs",
            {
                "algorithms": len(proc_crypto_entries),
                "types": sorted(t for t in proc_types if t)[:6],
                "sample": sorted(n for n in proc_names if n)[:6],
            },
        ),
        _source(
            "entropy",
            "kernel random",
            str(entropy_cloud.get("crng_state") or "").lower() in {"ready", "initialized", "crng_ready"},
            "procfs",
            {
                "crng_state": entropy_cloud.get("crng_state"),
                "pool_bits": entropy_cloud.get("entropy_pool_bits"),
            },
        ),
    ]
