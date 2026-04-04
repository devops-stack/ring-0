"""REST API handlers facade."""

from kernel_ai.http.api_handlers.kernel import (
    get_execution_context,
    kernel_data,
    kernel_dna,
    nginx_files,
    process_kernel_map,
    syscalls_realtime,
)
from kernel_ai.http.api_handlers.network_system import (
    active_connections,
    devices_realtime,
    filesystem_blocks,
    isolation_context,
    network_stack_realtime,
    traceroute_info,
)
from kernel_ai.http.api_handlers.processes import (
    get_ipc_links,
    get_proc_graph,
    get_proc_matrix,
    get_proc_timeline,
    get_process_cpu,
    get_process_fds,
    get_process_files,
    get_process_threads,
    get_processes,
    get_processes_detailed,
    processes_realtime,
)
from kernel_ai.http.api_handlers.security_logs import (
    crypto_realtime,
    ingest_frontend_logs,
    security_realtime,
)

__all__ = [
    "active_connections",
    "crypto_realtime",
    "devices_realtime",
    "filesystem_blocks",
    "get_execution_context",
    "get_ipc_links",
    "get_proc_graph",
    "get_proc_matrix",
    "get_proc_timeline",
    "get_process_cpu",
    "get_process_fds",
    "get_process_files",
    "get_process_kernel_map",
    "get_process_threads",
    "get_processes",
    "get_processes_detailed",
    "ingest_frontend_logs",
    "isolation_context",
    "kernel_data",
    "kernel_dna",
    "network_stack_realtime",
    "nginx_files",
    "process_kernel_map",
    "processes_realtime",
    "security_realtime",
    "syscalls_realtime",
    "traceroute_info",
]

