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
    def _payload():
        sample = _telemetry.get_syscall_sample()
        return {
            "timestamp": datetime.now().isoformat(),
            "syscalls": sample.get("syscalls", []),
            # How the sample was taken. "self" means the root collector is not
            # running and the panel can only see the backend's own processes,
            # which the UI has to say out loud rather than pass off as the machine.
            "sample": {
                "source": sample.get("source"),
                "scope": sample.get("scope"),
                "tasks_total": sample.get("tasks_total"),
                "blocked_total": sample.get("blocked_total"),
                "age": sample.get("age"),
            },
            "cpu_usage": psutil.cpu_percent(interval=1),
            "memory_usage": psutil.virtual_memory().percent,
            "system_info": _core_observability_service.get_system_info(),
        }

    return api_json(_payload)


def socket_activity():
    def _payload():
        local = request.args.get("local", "").strip()
        remote = request.args.get("remote", "").strip()
        proto = request.args.get("proto", "TCP").strip()
        if not local or not remote:
            raise ValueError("Missing 'local' or 'remote' query parameter")
        return _telemetry.get_socket_activity(local=local, remote=remote, proto=proto)

    return api_json(_payload, exception_statuses=[(ValueError, 400)])


def syscall_detail(name):
    """What one syscall is inside this kernel, plus who is parked in it.

    The number, the chain of kernel symbols and the sleeping function all come
    from the running machine. A call nobody is parked in right now still has an
    answer — the waiter list is simply empty.
    """

    def _payload():
        from collections import Counter

        from kernel_ai.services import syscall_anatomy

        clean = "".join(ch for ch in str(name)[:64] if ch.isalnum() or ch == "_")
        sample = _telemetry.get_syscall_sample()
        rows = sample.get("syscalls") or []
        row = next((r for r in rows if str(r.get("name", "")).lower() == clean.lower()), None)

        waiters = list(row.get("waiters") or []) if row else []
        numbers = {v: k for k, v in _telemetry.get_syscall_names().items()}
        nr = (row or {}).get("nr")
        if nr is None:
            nr = numbers.get(clean)
        subsystem = (row or {}).get("subsystem") or _telemetry.map_syscall_to_subsystem(clean)

        wchans = Counter(w.get("wchan") for w in waiters if w.get("wchan"))
        anatomy = syscall_anatomy.describe(
            clean, nr=nr, subsystem=subsystem, wchans=wchans.most_common(), sampled=len(waiters)
        )

        return {
            "timestamp": datetime.now().isoformat(),
            **anatomy,
            "count": (row or {}).get("count", 0),
            "waiters": waiters,
            "sample": {"source": sample.get("source"), "scope": sample.get("scope")},
        }

    return api_json(_payload)


def wakeups():
    """Who woke whom, over the window the collector last sampled."""

    def _payload():
        from kernel_ai.services import wakeups as wakeups_service
        return {"timestamp": datetime.now().isoformat(), **wakeups_service.describe()}
    return api_json(_payload)


def runqueue():
    """Who is competing for a CPU right now, and who would be taken next."""

    def _payload():
        from kernel_ai.services import runqueue as runqueue_service

        return {"timestamp": datetime.now().isoformat(), **runqueue_service.describe()}

    return api_json(_payload)


def irq_history(irq):
    """Lifetime of one interrupt line versus host uptime."""

    def _payload():
        from kernel_ai.services import irq_anatomy

        anatomy = irq_anatomy.history(irq)
        if not anatomy or not anatomy.get("found"):
            return {"timestamp": datetime.now().isoformat(), "irq": str(irq), "found": False}
        return {"timestamp": datetime.now().isoformat(), **anatomy}

    return api_json(_payload)


def irq_detail(irq):
    """What one interrupt line is on this machine.

    Identity, affinity, the per-CPU counters and the deferred half, all read
    from /sys and /proc. Rates are not part of the answer: the panel measures
    them over its polling interval, which is a steadier window than a single
    request could sample, and the card uses those.
    """

    def _payload():
        from kernel_ai.services import irq_anatomy

        anatomy = irq_anatomy.describe(irq)
        if anatomy is None:
            return {"timestamp": datetime.now().isoformat(), "irq": str(irq), "found": False}
        return {"timestamp": datetime.now().isoformat(), "found": True, **anatomy}

    return api_json(_payload)


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
