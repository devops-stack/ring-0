"""Kernel/observability API handlers."""

from datetime import datetime

import psutil
from flask import current_app, request
from flask import jsonify

from kernel_ai.http.common import api_json, build_error_payload
from kernel_ai.sentry_helpers import capture_exception
from kernel_ai.services import core_observability as _core_observability_service
from kernel_ai.services import telemetry_orchestration as _telemetry
from kernel_ai.state import get_state_container


def syscalls_realtime():
    return api_json(
        lambda: {
            "timestamp": datetime.now().isoformat(),
            "syscalls": _telemetry.get_real_system_calls(),
            "cpu_usage": psutil.cpu_percent(interval=1),
            "memory_usage": psutil.virtual_memory().percent,
            "system_info": _core_observability_service.get_system_info(),
        }
    )


def kernel_data():
    return api_json(
        lambda: {
            "timestamp": datetime.now().isoformat(),
            "syscalls": _telemetry.get_real_system_calls(),
            "subsystems": _telemetry.get_kernel_subsystem_status(),
            "processes": len(psutil.pids()),
            "system_stats": {
                "cpu_count": psutil.cpu_count(),
                "memory_total": psutil.virtual_memory().total,
                "disk_usage": psutil.disk_usage("/").percent,
            },
        }
    )


def process_kernel_map():
    return api_json(_telemetry.get_process_kernel_map)


def nginx_files():
    return api_json(lambda: {"files": _telemetry.get_nginx_open_files()})


def get_execution_context():
    return api_json(
        lambda: _telemetry.get_execution_context_data(
            exec_context_prev=get_state_container(current_app).exec_context_prev
        )
    )


def kernel_dna():
    return api_json(_telemetry.get_kernel_dna_data)


def sentry_test():
    """Temporary endpoint for manual Sentry verification."""
    if not current_app.config.get("SENTRY_TEST_ENDPOINT_ENABLED", False):
        return jsonify(build_error_payload("Not found", "not_found")), 404

    expected_token = current_app.config.get("SENTRY_TEST_ENDPOINT_TOKEN", "")
    incoming_token = (request.headers.get("X-Sentry-Test-Token") or "").strip()
    if expected_token and incoming_token != expected_token:
        return jsonify(build_error_payload("Forbidden", "forbidden")), 403

    mode = (request.args.get("mode") or "capture").strip().lower()
    if mode == "raise":
        raise RuntimeError("Manual sentry raise test")

    try:
        raise RuntimeError("Manual sentry capture test")
    except RuntimeError as exc:
        capture_exception(exc, where="api.sentry_test", extra={"mode": mode})

    return jsonify({"ok": True, "mode": mode, "message": "Sentry event captured"})
