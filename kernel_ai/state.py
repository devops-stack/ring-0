"""Process-wide mutable state (caches, deltas for realtime metrics)."""
import os
from threading import Lock

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
