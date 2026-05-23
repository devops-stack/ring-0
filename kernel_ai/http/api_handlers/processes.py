"""Process-centric API handlers."""

from datetime import datetime
from flask import request

from kernel_ai.http.common import api_json
from kernel_ai.services import process_inspect as _process_inspect_service
from kernel_ai.services import process_timeline as _process_timeline_service
from kernel_ai.services import processes as _processes_service


def get_processes():
    return api_json(lambda: {"processes": _processes_service.get_processes_basic_data()})


def get_process_threads(pid):
    return api_json(lambda: _process_inspect_service.get_process_threads_info(pid))


def get_process_cpu(pid):
    return api_json(lambda: _process_inspect_service.get_process_cpu_info(pid))


def get_process_fds(pid):
    return api_json(lambda: _process_inspect_service.get_process_fds_info(pid))


def get_processes_detailed():
    return api_json(lambda: {"processes": _processes_service.get_processes_detailed_data()})


def get_ipc_links():
    def _payload():
        max_pairs = request.args.get("max_pairs", default=120, type=int)
        max_nodes = request.args.get("max_nodes", default=24, type=int)
        max_pairs = max(20, min(300, max_pairs))
        max_nodes = max(8, min(64, max_nodes))
        return _process_inspect_service.get_ipc_links_summary(max_pairs=max_pairs, max_nodes=max_nodes)

    return api_json(_payload)


def get_proc_matrix():
    def _payload():
        matrix = _processes_service.get_proc_matrix_data()
        return {"matrix": matrix, "timestamp": datetime.now().isoformat()}

    return api_json(_payload)


def get_proc_timeline():
    return api_json(
        lambda: _process_timeline_service.get_proc_timeline_data(
            request.args.get("pid", type=int),
            window_s=request.args.get("window_s", default=30, type=int),
        ),
        exception_statuses=[(ValueError, 400), (ProcessLookupError, 404)],
    )


def get_proc_timeline_branches():
    def _payload():
        limit = request.args.get("limit", default=6, type=int)
        events = request.args.get("events", default=10, type=int)
        window_s = request.args.get("window_s", default=30, type=int)
        return _process_timeline_service.get_proc_timeline_branches_data(
            limit=limit,
            events=events,
            window_s=window_s,
        )

    return api_json(_payload)


def processes_realtime():
    return api_json(_processes_service.collect_processes_realtime)


def get_proc_graph():
    return api_json(_processes_service.get_proc_graph_data, error_extra={"nodes": [], "edges": []})


def get_process_files():
    return api_json(lambda: {"curves": [], "timestamp": datetime.now().isoformat()}, error_extra={"curves": []})
