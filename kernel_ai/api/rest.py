"""REST API under ``/api``."""
from flask import Blueprint
from kernel_ai.http import api as h

bp = Blueprint("api", __name__, url_prefix="/api")

_API_ROUTES = [
    ("/syscalls-realtime", "syscalls_realtime", h.syscalls_realtime, None),
    ("/kernel-data", "kernel_data", h.kernel_data, None),
    ("/io-pulse", "io_pulse", h.io_pulse, None),
    ("/process-kernel-map", "process_kernel_map", h.process_kernel_map, None),
    ("/processes", "get_processes", h.get_processes, None),
    ("/nginx-files", "nginx_files", h.nginx_files, None),
    ("/io-open-files", "io_open_files", h.io_open_files, None),
    ("/active-connections", "active_connections", h.active_connections, None),
    ("/traceroute", "traceroute_info", h.traceroute_info, None),
    ("/network-stack-realtime", "network_stack_realtime", h.network_stack_realtime, None),
    ("/devices-realtime", "devices_realtime", h.devices_realtime, None),
    ("/filesystem-blocks", "filesystem_blocks", h.filesystem_blocks, None),
    ("/ext4-anatomy", "ext4_anatomy", h.ext4_anatomy, None),
    ("/ext4-journal", "ext4_journal", h.ext4_journal, None),
    ("/hot-files", "hot_files", h.hot_files, None),
    ("/path-walk", "path_walk", h.path_walk, None),
    ("/isolation-context", "isolation_context", h.isolation_context, None),
    ("/process/<int:pid>/threads", "get_process_threads", h.get_process_threads, None),
    ("/process/<int:pid>/cpu", "get_process_cpu", h.get_process_cpu, None),
    ("/process/<int:pid>/fds", "get_process_fds", h.get_process_fds, None),
    ("/processes-detailed", "get_processes_detailed", h.get_processes_detailed, None),
    ("/ipc-links", "get_ipc_links", h.get_ipc_links, None),
    ("/proc-matrix", "get_proc_matrix", h.get_proc_matrix, None),
    ("/proc-timeline", "get_proc_timeline", h.get_proc_timeline, None),
    ("/proc-timeline-branches", "get_proc_timeline_branches", h.get_proc_timeline_branches, None),
    ("/execution-context", "get_execution_context", h.get_execution_context, None),
    ("/kernel-dna", "kernel_dna", h.kernel_dna, None),
    ("/siem-alerts", "siem_alerts", h.siem_alerts, None),
    ("/ml-anomalies", "ml_anomalies", h.ml_anomalies, None),
    ("/ml-drift", "ml_drift", h.ml_drift, None),
    ("/crypto-realtime", "crypto_realtime", h.crypto_realtime, None),
    ("/crypto-aes-demo", "crypto_aes_demo", h.crypto_aes_demo, None),
    ("/security-realtime", "security_realtime", h.security_realtime, None),
    ("/processes-realtime", "processes_realtime", h.processes_realtime, None),
    ("/scheduler-pelt", "scheduler_pelt", h.scheduler_pelt, None),
    ("/frontend-logs", "ingest_frontend_logs", h.ingest_frontend_logs, ["POST", "OPTIONS"]),
    ("/proc-graph", "proc_graph", h.get_proc_graph, None),
    ("/process-files", "process_files", h.get_process_files, None),
    ("/sentry-test", "sentry_test", h.sentry_test, ["POST"]),
]

for rule, endpoint, view_func, methods in _API_ROUTES:
    kwargs = {"methods": methods} if methods else {}
    bp.add_url_rule(rule, endpoint=endpoint, view_func=view_func, **kwargs)
