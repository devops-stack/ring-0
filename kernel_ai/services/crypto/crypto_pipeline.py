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

    return {
        "items": items[:24],
        "processes": unique_processes[:16],
        "protected_zones": protected_zones,
        "runtime_sources": runtime_sources,
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
            "runtime_sources": runtime_sources,
            "crypto_decision_pipeline": crypto_decision_pipelines.get("aes", {}),
            "crypto_decision_pipelines": crypto_decision_pipelines,
            "protected_zones": protected_zones,
            "source": "live-heuristic-v2",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
    }
