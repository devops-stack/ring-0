"""Process-wide mutable state and per-app state container."""

from __future__ import annotations

import os
from copy import deepcopy
from dataclasses import dataclass
from threading import Lock
from typing import Any

TRACEROUTE_CACHE = {}
TRACEROUTE_CACHE_TTL_SECONDS = 60
NETWORK_STACK_PREV = {
    "timestamp": None,
    "tcpext_retrans": None,
    "ip_in": None,
    "ip_out": None,
    "ip_discards": None,
    "iface_rx": None,
    "iface_tx": None,
    "iface_drops": None,
}
DEVICES_PREV = {
    "timestamp": None,
    "disk_sectors": {},
    "net_bytes": {},
    "tty_irq_total": None,
    "irq_by_key": {},
}
FILESYSTEM_PREV = {
    "timestamp": None,
    "write_bytes": None,
}
CRYPTO_PREV = {
    "timestamp": None,
    "active_flows": 0,
}
ENTROPY_PREV = {
    "timestamp": None,
    "disk_read_bytes": None,
    "disk_write_bytes": None,
    "net_sent_bytes": None,
    "net_recv_bytes": None,
    "interrupt_total": None,
}
EXEC_CONTEXT_PREV = {
    "timestamp": None,
    "irq_totals": {},
    "softirq_totals": {},
}
SECURITY_PREV = {
    "timestamp": None,
    "events": 0,
}
FRONTEND_LOG_WRITE_LOCK = Lock()
FRONTEND_LOG_FILE = os.getenv("FRONTEND_LOG_FILE", "/opt/ring0/kernel-ai/logs/frontend-events.jsonl")


@dataclass
class RuntimeState:
    traceroute_cache: dict
    traceroute_cache_ttl_seconds: int
    network_stack_prev: dict
    devices_prev: dict
    filesystem_prev: dict
    crypto_prev: dict
    entropy_prev: dict
    exec_context_prev: dict
    security_prev: dict
    frontend_log_write_lock: Lock
    frontend_log_file: str


def create_state_container(frontend_log_file: str | None = None) -> RuntimeState:
    """Create isolated mutable runtime state for one Flask app instance."""
    return RuntimeState(
        traceroute_cache={},
        traceroute_cache_ttl_seconds=TRACEROUTE_CACHE_TTL_SECONDS,
        network_stack_prev=deepcopy(NETWORK_STACK_PREV),
        devices_prev=deepcopy(DEVICES_PREV),
        filesystem_prev=deepcopy(FILESYSTEM_PREV),
        crypto_prev=deepcopy(CRYPTO_PREV),
        entropy_prev=deepcopy(ENTROPY_PREV),
        exec_context_prev=deepcopy(EXEC_CONTEXT_PREV),
        security_prev=deepcopy(SECURITY_PREV),
        frontend_log_write_lock=Lock(),
        frontend_log_file=frontend_log_file or FRONTEND_LOG_FILE,
    )


_LEGACY_STATE = RuntimeState(
    traceroute_cache=TRACEROUTE_CACHE,
    traceroute_cache_ttl_seconds=TRACEROUTE_CACHE_TTL_SECONDS,
    network_stack_prev=NETWORK_STACK_PREV,
    devices_prev=DEVICES_PREV,
    filesystem_prev=FILESYSTEM_PREV,
    crypto_prev=CRYPTO_PREV,
    entropy_prev=ENTROPY_PREV,
    exec_context_prev=EXEC_CONTEXT_PREV,
    security_prev=SECURITY_PREV,
    frontend_log_write_lock=FRONTEND_LOG_WRITE_LOCK,
    frontend_log_file=FRONTEND_LOG_FILE,
)


def attach_state_container(app: Any, state: RuntimeState | None = None) -> RuntimeState:
    """Attach runtime state container to Flask app extensions."""
    runtime_state = state or create_state_container()
    app.extensions["kernel_ai_state"] = runtime_state
    return runtime_state


def get_state_container(app: Any | None) -> RuntimeState:
    """Get app state when available, fallback to process-global legacy state."""
    if app is not None:
        runtime_state = getattr(app, "extensions", {}).get("kernel_ai_state")
        if runtime_state is not None:
            return runtime_state
    return _LEGACY_STATE
