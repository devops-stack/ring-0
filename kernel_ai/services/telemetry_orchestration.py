"""Cross-service orchestration for telemetry endpoints."""

from __future__ import annotations

import os

from kernel_ai.services import core_observability as _core_observability_service
from kernel_ai.services import execution as _execution_service
from kernel_ai.services import kernel_maps as _kernel_maps_service
from kernel_ai.services import syscalls as _syscalls_service

try:
    import openai

    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False


def get_syscall_names():
    return _kernel_maps_service.get_syscall_names()


KERNEL_DNA_MAX_PROCS = int(os.environ.get("KERNEL_DNA_MAX_PROCS", "1200"))


def map_syscall_to_subsystem(syscall_name):
    return _kernel_maps_service.map_syscall_to_subsystem(syscall_name)


def map_interrupt_to_subsystem(interrupt_name):
    return _kernel_maps_service.map_interrupt_to_subsystem(interrupt_name)


def get_mock_system_calls():
    return _core_observability_service.get_mock_system_calls()


def get_real_system_calls():
    return _syscalls_service.get_real_system_calls(
        syscall_names=get_syscall_names(),
        map_syscall_to_subsystem_fn=map_syscall_to_subsystem,
        kernel_dna_max_procs=KERNEL_DNA_MAX_PROCS,
        fallback_mock_calls_fn=get_mock_system_calls,
    )


def get_syscall_sample():
    return _syscalls_service.get_syscall_sample(
        syscall_names=get_syscall_names(),
        map_syscall_to_subsystem_fn=map_syscall_to_subsystem,
        kernel_dna_max_procs=KERNEL_DNA_MAX_PROCS,
        fallback_mock_calls_fn=get_mock_system_calls,
    )


def get_kernel_subsystem_status():
    return _core_observability_service.get_kernel_subsystem_status()


def get_io_pulse():
    return _core_observability_service.get_io_pulse()


def get_process_kernel_map():
    return _core_observability_service.get_process_kernel_map(
        openai_available=OPENAI_AVAILABLE,
        openai_module=openai if OPENAI_AVAILABLE else None,
    )


def get_nginx_open_files():
    return _core_observability_service.get_nginx_open_files()


def get_io_open_files(limit=40):
    return _core_observability_service.get_io_open_files(limit=limit)


def _kernel_dna_softirq_nucleotides(limit=8):
    return _syscalls_service.get_softirq_nucleotides(
        map_interrupt_to_subsystem_fn=map_interrupt_to_subsystem,
        limit=limit,
    )


KERNEL_DNA_ML_SINCE_SEC = int(os.environ.get("KERNEL_DNA_ML_SINCE_SEC", "120"))
KERNEL_DNA_ML_MAX = int(os.environ.get("KERNEL_DNA_ML_MAX", "8"))

# Host-rate chatter: keep in the store, keep off the helix unless a process
# or a named detector (sequence / HTTP / lineage) owns the row.
_HELIX_HOLD_FEATURES = frozenset({
    "pgfault_per_sec",
    "ctxt_per_sec",
    "tcp_inseg_per_sec",
    "tcp_outseg_per_sec",
    "net_softirq_per_sec",
    "hardirq_per_sec",
    "cpu_busy_pct",
    "block_softirq_per_sec",
    "tcp_retrans_per_sec",
    "procs_running",
    "proc_count",
    "run_queue",
    "load1",
})
_HELIX_ALWAYS_SOURCES = frozenset({
    "stage4_sequence",
    "stage5_process",
    "stage8_sequence",
    "stage9_http",
    "stage9_success",
})


def _helix_surface(row):
    """Whether a stored ML anomaly should become a helix mutation."""
    source = str(row.get("source") or "")
    if source in _HELIX_ALWAYS_SOURCES or source.startswith("stage9"):
        return True
    meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
    if meta.get("pid"):
        return True
    feature = str(row.get("feature") or "")
    return feature not in _HELIX_HOLD_FEATURES


def _ml_anomalies_to_mutations(rows):
    """Map stored ML anomalies onto the Kernel DNA mutation contract.

    Keeps only the most recent anomaly per feature (rows arrive newest-first)
    and caps the total so the helix is never flooded. HTTP attempts use a
    distinct feature per class (http_attempt:scanner, …) so they do not
    collapse into one helix point.
    """
    mutations = []
    seen = set()
    for row in rows:
        if not _helix_surface(row):
            continue
        feature = row.get("feature")
        if feature in seen:
            continue
        seen.add(feature)
        attack = row.get("attack")
        meta = row.get("meta") if isinstance(row.get("meta"), dict) else {}
        if not attack:
            attack = meta.get("attack")
        ml_source = row.get("source") or "ml"
        why = meta.get("why")
        src_ip = str(meta.get("src_ip") or "")
        ip_tail = ".".join(src_ip.split(".")[-2:]) if src_ip else ""
        message = row.get("message", "")
        if why and why not in message:
            message = f"{message} · {why}" if message else str(why)
        if ip_tail and "ip …" not in message:
            message = f"{message} · ip …{ip_tail}"
        mut = {
            "type": feature or row.get("type") or "ml_anomaly",
            "severity": row.get("severity", "medium"),
            "message": message,
            "description": message,
            "position": row.get("position", 0.5),
            "source": "ml",
            "ml_source": ml_source,
            "subsystem": row.get("subsystem"),
            "score": row.get("score"),
            "cls": meta.get("cls"),
            "why": why,
            "src_ip": src_ip,
        }
        if attack:
            mut["attack"] = attack
        mutations.append(mut)
        if len(mutations) >= KERNEL_DNA_ML_MAX:
            break
    return mutations


def _get_ml_mutations():
    """Read recent ML anomalies from the shared store. Never raises: if the ML
    store is unavailable the Kernel DNA view simply shows rule-based mutations."""
    try:
        from kernel_ai.ml.config import MLConfig
        from kernel_ai.ml.store import fetch_recent_anomalies

        cfg = MLConfig()
        rows = fetch_recent_anomalies(
            cfg.dsn, since_seconds=KERNEL_DNA_ML_SINCE_SEC, limit=100
        )
        return _ml_anomalies_to_mutations(rows)
    except Exception:
        return []


def get_kernel_dna_data():
    data = _execution_service.get_kernel_dna_data(
        get_real_system_calls_fn=get_real_system_calls,
        map_syscall_to_subsystem_fn=map_syscall_to_subsystem,
        map_interrupt_to_subsystem_fn=map_interrupt_to_subsystem,
        softirq_nucleotides_fn=_kernel_dna_softirq_nucleotides,
    )
    # Tag existing (threshold) mutations and merge in ML-detected ones so the
    # UI can render both sources side by side, visually distinguished.
    for mutation in data.get("mutations", []):
        mutation.setdefault("source", "rule")
    data.setdefault("mutations", []).extend(_get_ml_mutations())
    return data


def get_execution_context_data(exec_context_prev):
    return _execution_service.get_execution_context_data(
        syscall_names=get_syscall_names(),
        map_interrupt_to_subsystem_fn=map_interrupt_to_subsystem,
        exec_context_prev=exec_context_prev,
    )
