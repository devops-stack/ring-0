"""Crypto telemetry pipeline extracted from legacy service."""

from __future__ import annotations

import time
from datetime import datetime

from kernel_ai.logging_helpers import log_event


def collect_crypto_realtime(crypto_prev, callbacks=None, psutil_module=None, logger=None):
    """
    Build a near-realtime list of processes likely interacting with kernel crypto.
    This is heuristic-based and derived from active network/process context.
    """
    callbacks = callbacks or {}
    psutil_module = psutil_module or __import__("psutil")
    infer_crypto_protocol_fn = callbacks.get("infer_crypto_protocol", lambda _lp, _rp, _name: ("Crypto API", "AES/SHA"))
    is_likely_crypto_actor_fn = callbacks.get("is_likely_crypto_actor", lambda *_args: True)
    infer_tls_terminator_fn = callbacks.get("infer_tls_terminator", lambda _name, _port, _proto, _listeners: "n/a")
    collect_algorithm_competition_fn = callbacks.get("collect_algorithm_competition", lambda _algo: {"request": "AES", "implementations": [], "selected": None})
    parse_proc_crypto_entries_fn = callbacks.get("parse_proc_crypto_entries", lambda: [])
    read_cpu_crypto_flags_fn = callbacks.get("read_cpu_crypto_flags", lambda: {"detected": [], "display": [], "aes_ni": False, "source": "unavailable"})
    read_kernel_crypto_ops_fn = callbacks.get("read_kernel_crypto_ops", lambda: {"available": False})
    collect_kernel_crypto_clients_fn = callbacks.get("collect_kernel_crypto_clients", lambda _items: [])
    collect_hw_offload_status_fn = callbacks.get("collect_hw_offload_status", lambda _entries, _comps: [])
    collect_sync_async_queue_fn = callbacks.get("collect_sync_async_queue", lambda _items: {})
    collect_algorithm_requesters_fn = callbacks.get("collect_algorithm_requesters", lambda _items, _clients: {"aes": [], "sha": [], "chacha20": []})
    build_crypto_decision_pipelines_fn = callbacks.get("build_crypto_decision_pipelines", lambda **_kwargs: {})
    collect_entropy_cloud_status_fn = callbacks.get("collect_entropy_cloud_status", lambda: {})
    collect_crypto_runtime_sources_fn = callbacks.get("collect_crypto_runtime_sources", lambda _items, _entries, _clients, _entropy: [])

    items = []
    tls_listener_by_port = {}
    tls_listener_names = set()
    unknown_pid_flows = 0

    try:
        connections = psutil_module.net_connections(kind="inet")
    except psutil_module.Error as exc:
        if logger:
            log_event(
                logger,
                "DEBUG",
                "Failed to read net connections for crypto realtime",
                event_dataset="kernel_ai.app",
                component="services.crypto.crypto_pipeline",
                operation="collect_crypto_realtime",
                event_data={"error": str(exc)},
            )
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
                process_name = psutil_module.Process(pid_i).name().lower()
            except psutil_module.Error:
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
                proc = psutil_module.Process(pid_i)
                process_name = proc.name()
            except psutil_module.Error:
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
        for proc in psutil_module.process_iter(attrs=["pid", "name"]):
            try:
                name = str(proc.info.get("name", "")).lower()
            except (psutil_module.Error, KeyError, TypeError):
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

    # Real network throughput (proxy for encrypted traffic volume on a TLS host).
    try:
        net_counters = psutil_module.net_io_counters()
        net_bytes_now = int(getattr(net_counters, "bytes_sent", 0) or 0) + int(getattr(net_counters, "bytes_recv", 0) or 0)
    except Exception:  # noqa: BLE001 - psutil backends vary across kernels
        net_bytes_now = 0
    prev_net_bytes = crypto_prev.get("net_bytes")
    if prev_ts and prev_net_bytes is not None and net_bytes_now:
        net_mb_s = round(max(net_bytes_now - int(prev_net_bytes), 0) / max(now - prev_ts, 0.001) / (1024.0 * 1024.0), 3)
    else:
        net_mb_s = 0.0
    crypto_prev["net_bytes"] = net_bytes_now

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
    runtime_sources = collect_crypto_runtime_sources_fn(items, proc_crypto_entries, kernel_clients, entropy_cloud)
    proc_crypto_names = {str(entry.get("name") or "").lower() for entry in proc_crypto_entries if isinstance(entry, dict)}
    client_names = {str(row.get("name") or row.get("client") or "").lower() for row in kernel_clients if isinstance(row, dict)}
    protocol_names = {str(item.get("protocol") or "").upper() for item in items}
    process_names = {str(item.get("process") or "").lower() for item in items}
    active_algos = {str(item.get("algorithm") or "").lower() for item in items}
    entropy_ready = str((entropy_cloud or {}).get("crng_state") or "").lower() in {"ready", "initialized", "crng_ready"}

    def _zone(zone_id, label, active, status, evidence, strength=0.5):
        return {
            "id": zone_id,
            "label": label,
            "active": bool(active),
            "status": status,
            "strength": round(max(0.0, min(1.0, float(strength))), 3),
            "evidence": evidence,
        }

    protected_zones = [
        _zone(
            "tls",
            "TLS / kTLS",
            "TLS" in protocol_names,
            "active" if "TLS" in protocol_names else "idle",
            {"sessions": sum(1 for i in items if i.get("protocol") == "TLS"), "terminators": sorted(tls_listener_names)[:4]},
            min(1.0, 0.35 + sum(1 for i in items if i.get("protocol") == "TLS") / 8.0),
        ),
        _zone(
            "block",
            "dm-crypt / block",
            any("xts" in algo or "aes" in algo for algo in active_algos | proc_crypto_names),
            "active" if any("xts" in algo or "aes" in algo for algo in active_algos | proc_crypto_names) else "unknown",
            {"algorithms": sorted([x for x in (active_algos | proc_crypto_names) if x])[:5]},
            0.72 if any("aes" in algo for algo in active_algos | proc_crypto_names) else 0.35,
        ),
        _zone(
            "ipsec",
            "IPsec / xfrm",
            any("xfrm" in name or "ipsec" in name for name in process_names | client_names),
            "active" if any("xfrm" in name or "ipsec" in name for name in process_names | client_names) else "idle",
            {"clients": sorted([x for x in client_names if x])[:5]},
            0.62,
        ),
        _zone(
            "fscrypt",
            "fscrypt",
            any("fscrypt" in name for name in client_names | proc_crypto_names),
            "active" if any("fscrypt" in name for name in client_names | proc_crypto_names) else "unknown",
            {"clients": sorted([x for x in client_names if "fs" in x])[:4]},
            0.48,
        ),
        _zone(
            "keyring",
            "keyring",
            any("key" in name for name in client_names | process_names),
            "active" if any("key" in name for name in client_names | process_names) else "idle",
            {"signals": sorted([x for x in (client_names | process_names) if "key" in x])[:4]},
            0.52,
        ),
        _zone(
            "entropy",
            "random / entropy",
            entropy_ready,
            "active" if entropy_ready else "weak signal",
            {"crng_state": (entropy_cloud or {}).get("crng_state"), "pool_bits": (entropy_cloud or {}).get("entropy_pool_bits")},
            0.86 if entropy_ready else 0.34,
        ),
        _zone(
            "module_sig",
            "module signature",
            any("sha" in algo or "rsa" in algo or "ecdsa" in algo for algo in proc_crypto_names | active_algos),
            "active" if any("sha" in algo or "rsa" in algo or "ecdsa" in algo for algo in proc_crypto_names | active_algos) else "unknown",
            {"algorithms": sorted([x for x in (proc_crypto_names | active_algos) if "sha" in x or "rsa" in x or "ecdsa" in x])[:5]},
            0.58,
        ),
        _zone(
            "ima_evm",
            "IMA / EVM",
            any("ima" in name or "evm" in name for name in client_names | process_names),
            "active" if any("ima" in name or "evm" in name for name in client_names | process_names) else "unknown",
            {"signals": sorted([x for x in (client_names | process_names) if "ima" in x or "evm" in x])[:4]},
            0.42,
        ),
    ]

    # --- Real CPU crypto flags ---------------------------------------------
    cpu_flags = read_cpu_crypto_flags_fn() or {}

    # --- Real kernel crypto operations (Tier 3, kprobe collector) ----------
    kernel_ops = read_kernel_crypto_ops_fn() or {"available": False}
    kernel_ops_available = bool(kernel_ops.get("available"))
    kernel_totals = kernel_ops.get("totals") or {}
    kernel_by_driver = kernel_ops.get("by_driver") or []

    # --- Selected kernel crypto algorithms (from /proc/crypto competition) --
    tls_sessions = sum(1 for i in items if i.get("protocol") == "TLS")
    family_labels = {"aes": "AES", "sha": "SHA-2", "chacha20": "ChaCha20"}

    def _norm_driver(name):
        # Normalise driver names so registry-selected wrappers match observed leaf
        # drivers, e.g. "cryptd(__xts-aes-aesni)" and "__xts-aes-aesni" -> "xts-aes-aesni".
        core = str(name or "").lower().replace("cryptd(", "").replace(")", "").strip()
        return core.lstrip("_")

    observed_ops_norm = {}
    for row in kernel_by_driver:
        drv = _norm_driver(row.get("driver"))
        if drv:
            observed_ops_norm[drv] = observed_ops_norm.get(drv, 0.0) + float(row.get("ops_per_sec") or 0.0)

    def _observed_for(driver_name):
        norm = _norm_driver(driver_name)
        if not norm:
            return 0.0
        total = 0.0
        for obs_name, obs_ops in observed_ops_norm.items():
            if norm == obs_name or norm in obs_name or obs_name in norm:
                total += obs_ops
        return total

    active_algorithms = []
    for family_key in ("aes", "sha", "chacha20"):
        comp = algorithm_competitions.get(family_key) or {}
        selected = comp.get("selected") or {}
        driver_name = str(selected.get("name") or "n/a")
        observed = _observed_for(driver_name) if driver_name != "n/a" else 0.0
        if driver_name == "n/a":
            status = "idle"
        elif observed > 0:
            status = "executing"
        else:
            status = "selected"
        active_algorithms.append(
            {
                "family": family_labels.get(family_key, family_key.upper()),
                "driver": driver_name,
                "priority": selected.get("priority"),
                "source": str(selected.get("source") or "kernel"),
                "status": status,
                "observed_ops_per_sec": round(observed, 1) if observed else 0.0,
            }
        )

    # --- Kernel crypto metrics (real / procfs-derived) ---------------------
    entropy_bits = int((entropy_cloud or {}).get("entropy_pool_bits") or 0)
    entropy_size = int((entropy_cloud or {}).get("entropy_pool_size_bits") or 256) or 256
    entropy_pct = round(100.0 * entropy_bits / entropy_size, 1)
    crng_state = str((entropy_cloud or {}).get("crng_state") or "unknown")
    rng_health = "good" if crng_state.lower() in {"ready", "initialized", "crng_ready"} else "warming"
    hw_offload_rows = crypto_stage1.get("hw_offload") or []
    aes_engine_active = any(
        "aes-ni" in str(row.get("engine", "")).lower() and row.get("status") == "active"
        for row in hw_offload_rows
    )
    if bool(cpu_flags.get("aes_ni")):
        aes_ni_status = "active" if aes_engine_active else "available"
    else:
        aes_ni_status = "n/a"
    queue_meta = crypto_stage1.get("sync_async") or {}
    # Prefer real kernel-measured throughput/latency/ops when the collector is live.
    if kernel_ops_available:
        kernel_ops_per_sec = float(kernel_totals.get("ops_per_sec") or 0.0)
        kernel_mb_s = float(kernel_totals.get("mb_per_sec") or 0.0)
        kernel_lat_us = kernel_totals.get("avg_lat_us")
        crypto_latency_ms = round(float(kernel_lat_us) / 1000.0, 4) if kernel_lat_us is not None else queue_meta.get("queue_latency_ms_est")
    else:
        kernel_ops_per_sec = None
        kernel_mb_s = None
        crypto_latency_ms = queue_meta.get("queue_latency_ms_est")
    crypto_metrics = {
        "entropy_pool_bits": entropy_bits,
        "entropy_pool_size_bits": entropy_size,
        "entropy_pct": entropy_pct,
        "crng_state": crng_state,
        "rng_health": rng_health,
        "aes_ni_status": aes_ni_status,
        "aes_ni_available": bool(cpu_flags.get("aes_ni")),
        "latency_ms": crypto_latency_ms,
        "net_mb_s": net_mb_s,
        "ops_per_sec": ops_per_sec,
        "tls_sessions": tls_sessions,
        "active_flows": active_flows,
        # Real kernel crypto (None when collector is not running)
        "kernel_ops_available": kernel_ops_available,
        "kernel_ops_per_sec": kernel_ops_per_sec,
        "kernel_mb_s": kernel_mb_s,
    }

    # --- Rolling, change-driven crypto event log ---------------------------
    def _now_hms():
        return datetime.now().strftime("%H:%M:%S")

    prev_selected = crypto_prev.get("selected_drivers") or {}
    current_selected = {a["family"]: a["driver"] for a in active_algorithms if a["driver"] != "n/a"}
    new_events = []
    for family_name, driver_name in current_selected.items():
        if prev_selected.get(family_name) != driver_name:
            new_events.append({"ts": _now_hms(), "tag": family_name.lower(), "msg": f"{driver_name}: selected"})
    crypto_prev["selected_drivers"] = current_selected

    if crypto_prev.get("crng_state_seen") != crng_state:
        new_events.append({"ts": _now_hms(), "tag": "random", "msg": f"crng -> {crng_state} ({entropy_bits}/{entropy_size}b)"})
    crypto_prev["crng_state_seen"] = crng_state

    if prev_ts and active_flows != prev_flows:
        delta_flows = active_flows - prev_flows
        sign = "+" if delta_flows > 0 else ""
        new_events.append({"ts": _now_hms(), "tag": "flows", "msg": f"crypto actors {sign}{delta_flows} -> {active_flows}"})

    if kernel_ops_available and kernel_by_driver:
        top_kernel = kernel_by_driver[0]
        top_key = f"{top_kernel.get('op')}|{top_kernel.get('driver')}"
        if crypto_prev.get("top_kernel_op") != top_key:
            new_events.append({
                "ts": _now_hms(),
                "tag": "kops",
                "msg": f"{top_kernel.get('driver')} {top_kernel.get('op')} @ {top_kernel.get('ops_per_sec')}/s",
            })
        crypto_prev["top_kernel_op"] = top_key

    active_engines = [str(row.get("engine")) for row in hw_offload_rows if row.get("status") == "active"]
    prev_engines = crypto_prev.get("hw_engines_seen")
    if prev_engines is None or set(active_engines) != set(prev_engines):
        if active_engines:
            new_events.append({"ts": _now_hms(), "tag": "offload", "msg": f"hw: {', '.join(active_engines)}"[:44]})
    crypto_prev["hw_engines_seen"] = active_engines

    prev_log = list(crypto_prev.get("event_log") or [])
    if new_events:
        prev_log = (new_events + prev_log)[:40]
    if not prev_log:
        prev_log = [{"ts": _now_hms(), "tag": "crypto", "msg": "crypto telemetry online"}]
    crypto_prev["event_log"] = prev_log
    event_log = prev_log[:12]

    return {
        "items": items[:24],
        "processes": unique_processes[:16],
        "protected_zones": protected_zones,
        "runtime_sources": runtime_sources,
        "meta": {
            "ops_per_sec": ops_per_sec,
            "net_mb_s": net_mb_s,
            "cpu_flags": cpu_flags,
            "crypto_metrics": crypto_metrics,
            "active_algorithms": active_algorithms,
            "kernel_ops": kernel_ops,
            "event_log": event_log,
            "tls_sessions": sum(1 for i in items if i.get("protocol") == "TLS"),
            "active_flows": active_flows,
            "unknown_pid_flows": int(unknown_pid_flows),
            "tls_terminators": sorted(list(tls_listener_names))[:8],
            "algorithm_competition": algorithm_competitions["aes"],
            "algorithm_competitions": algorithm_competitions,
            "algorithm_requesters": algorithm_requesters,
            "crypto_stage1": crypto_stage1,
            "entropy_cloud": entropy_cloud,
            "runtime_sources": runtime_sources,
            "crypto_decision_pipeline": crypto_decision_pipelines.get("aes", {}),
            "crypto_decision_pipelines": crypto_decision_pipelines,
            "protected_zones": protected_zones,
            "source": "live-heuristic-v2",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
    }
