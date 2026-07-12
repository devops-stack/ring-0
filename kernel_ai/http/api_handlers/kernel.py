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


def io_pulse():
    return api_json(
        lambda: {
            "timestamp": datetime.now().isoformat(),
            **_telemetry.get_io_pulse(),
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


def io_open_files():
    def _payload():
        try:
            limit = int(request.args.get("limit", 40))
        except (TypeError, ValueError):
            limit = 40
        limit = max(1, min(limit, 80))
        return {"files": _telemetry.get_io_open_files(limit=limit)}

    return api_json(_payload)


def get_execution_context():
    return api_json(
        lambda: _telemetry.get_execution_context_data(
            exec_context_prev=get_state_container(current_app).exec_context_prev
        )
    )


def kernel_dna():
    return api_json(_telemetry.get_kernel_dna_data)


def siem_alerts():
    """Recent Elastic SIEM detection alerts (web attacks) for Kernel DNA.

    Read-only bridge to the sibling Elastic server. Fails soft: if Elastic is
    unreachable/unconfigured, returns available=False with an empty list.
    """

    def _payload():
        from kernel_ai.services import siem as _siem

        try:
            hours = int(request.args.get("hours", 24))
        except (TypeError, ValueError):
            hours = 24
        try:
            limit = int(request.args.get("limit", 120))
        except (TypeError, ValueError):
            limit = 120
        return _siem.get_siem_alerts(hours=hours, limit=limit)

    return api_json(_payload)


def ml_anomalies():
    """Recent ML-detected anomalies (Stage 1 baselines) for Kernel DNA.

    Read-only: the Flask app never computes anomalies, it only reads what the
    isolated ML worker wrote to the shared store. If the store is unreachable,
    the underlying reader returns an empty list rather than failing the page.
    """

    def _payload():
        from kernel_ai.ml.config import MLConfig
        from kernel_ai.ml.store import fetch_recent_anomalies

        try:
            since = int(request.args.get("since_seconds", 120))
        except (TypeError, ValueError):
            since = 120
        since = max(5, min(since, 3600))
        try:
            limit = int(request.args.get("limit", 100))
        except (TypeError, ValueError):
            limit = 100
        limit = max(1, min(limit, 500))

        cfg = MLConfig()
        anomalies = fetch_recent_anomalies(cfg.dsn, since_seconds=since, limit=limit)
        return {
            "timestamp": datetime.now().isoformat(),
            "since_seconds": since,
            "count": len(anomalies),
            "anomalies": anomalies,
        }

    return api_json(_payload)


def ml_drift():
    """Latest model-drift verdict + short history for the Kernel DNA UI.

    Read-only: surfaces what the drift monitor / retrain job wrote to the shared
    store, plus the on-disk model artifact age (a proxy for "model freshness").
    Degrades to ``available: false`` if the store/model is unreachable.
    """

    def _payload():
        import os

        from kernel_ai.ml.config import MLConfig
        from kernel_ai.ml.store import fetch_drift_status

        try:
            history = int(request.args.get("history", 48))
        except (TypeError, ValueError):
            history = 48
        history = max(1, min(history, 200))

        cfg = MLConfig()
        status = fetch_drift_status(cfg.dsn, history=history)

        model_age_sec = None
        try:
            mtime = os.path.getmtime(cfg.model_path)
            model_age_sec = max(0.0, datetime.now().timestamp() - mtime)
        except OSError:
            model_age_sec = None

        return {
            "timestamp": datetime.now().isoformat(),
            "available": status.get("available", False),
            "model_age_sec": model_age_sec,
            "latest": status.get("latest"),
            "history": status.get("history", []),
        }

    return api_json(_payload)


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
