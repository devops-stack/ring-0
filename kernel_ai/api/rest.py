"""
REST API under ``/api``. Implementations are in ``kernel_ai.webapp`` (lazy import).
"""
from flask import Blueprint

bp = Blueprint("api", __name__, url_prefix="/api")


def _core():
    from kernel_ai import webapp as core

    return core


@bp.route("/syscalls-realtime")
def syscalls_realtime():
    return _core().syscalls_realtime()


@bp.route("/kernel-data")
def kernel_data():
    return _core().kernel_data()


@bp.route("/process-kernel-map")
def process_kernel_map():
    return _core().process_kernel_map()


@bp.route("/processes")
def get_processes():
    return _core().get_processes()


@bp.route("/nginx-files")
def nginx_files():
    return _core().nginx_files()


@bp.route("/active-connections")
def active_connections():
    return _core().active_connections()


@bp.route("/traceroute")
def traceroute_info():
    return _core().traceroute_info()


@bp.route("/network-stack-realtime")
def network_stack_realtime():
    return _core().network_stack_realtime()


@bp.route("/devices-realtime")
def devices_realtime():
    return _core().devices_realtime()


@bp.route("/filesystem-blocks")
def filesystem_blocks():
    return _core().filesystem_blocks()


@bp.route("/isolation-context")
def isolation_context():
    return _core().isolation_context()


@bp.route("/process/<int:pid>/threads")
def get_process_threads(pid):
    return _core().get_process_threads(pid)


@bp.route("/process/<int:pid>/cpu")
def get_process_cpu(pid):
    return _core().get_process_cpu(pid)


@bp.route("/process/<int:pid>/fds")
def get_process_fds(pid):
    return _core().get_process_fds(pid)


@bp.route("/processes-detailed")
def get_processes_detailed():
    return _core().get_processes_detailed()


@bp.route("/ipc-links")
def get_ipc_links():
    return _core().get_ipc_links()


@bp.route("/proc-matrix")
def get_proc_matrix():
    return _core().get_proc_matrix()


@bp.route("/proc-timeline")
def get_proc_timeline():
    return _core().get_proc_timeline()


@bp.route("/execution-context")
def get_execution_context():
    return _core().get_execution_context()


@bp.route("/kernel-dna")
def kernel_dna():
    return _core().kernel_dna()


@bp.route("/crypto-realtime")
def crypto_realtime():
    return _core().crypto_realtime()


@bp.route("/security-realtime")
def security_realtime():
    return _core().security_realtime()


@bp.route("/processes-realtime")
def processes_realtime():
    return _core().processes_realtime()


@bp.route("/frontend-logs", methods=["POST", "OPTIONS"])
def ingest_frontend_logs():
    return _core().ingest_frontend_logs()
