"""Integration-style tests for HTTP route wiring."""

import pytest

from kernel_ai.http.api_handlers import kernel as kernel_handlers
from kernel_ai.state import get_state_container
from kernel_ai.webapp import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def client(app):
    return app.test_client()


def test_health_route_ok(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["status"] == "healthy"
    assert "timestamp" in payload
    assert "system_info" in payload


def test_traceroute_requires_ip(client):
    resp = client.get("/api/traceroute")
    assert resp.status_code == 400
    payload = resp.get_json()
    assert "Missing 'ip' query parameter" in payload["error"]
    assert payload["code"] == "bad_request"
    assert payload.get("request_id")


def test_frontend_logs_rejects_non_json(client):
    resp = client.post("/api/frontend-logs", data="not-json", content_type="application/text")
    assert resp.status_code == 400
    assert "Invalid JSON payload" in resp.get_json()["error"]


def test_create_app_can_be_called_multiple_times():
    app1 = create_app()
    app2 = create_app()
    assert app1 is not app2
    assert app1.test_client().get("/health").status_code == 200
    assert app2.test_client().get("/health").status_code == 200


def test_create_app_attaches_runtime_state_container():
    app = create_app()
    state = get_state_container(app)
    assert app.extensions["kernel_ai_state"] is state
    assert isinstance(state.traceroute_cache, dict)


def test_runtime_state_is_isolated_between_apps():
    app1 = create_app()
    app2 = create_app()
    state1 = get_state_container(app1)
    state2 = get_state_container(app2)
    state1.crypto_prev["active_flows"] = 999
    state1.traceroute_cache["8.8.8.8"] = {"timestamp": 1, "data": {"ok": True}}
    assert state2.crypto_prev["active_flows"] != 999
    assert "8.8.8.8" not in state2.traceroute_cache


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/kernel-data", 200),
        ("/api/processes", 200),
        ("/api/nginx-files", 200),
        ("/api/active-connections", 200),
        ("/api/network-stack-realtime", 200),
        ("/api/kernel-events?limit=2", 200),
        ("/api/devices-realtime", 200),
        ("/api/filesystem-blocks", 200),
    ],
)
def test_api_smoke_routes(client, path, expected):
    resp = client.get(path)
    assert resp.status_code == expected


def test_kernel_events_rejects_invalid_pid_filter(client):
    resp = client.get("/api/kernel-events?pids=1,not-a-pid")

    assert resp.status_code == 400


def test_syscalls_snapshot_is_nonblocking_and_cached(monkeypatch):
    calls = {"sample": 0, "cpu_intervals": []}

    def sample():
        calls["sample"] += 1
        return {
            "syscalls": [{"name": "read", "count": 1}],
            "source": "test",
            "scope": "machine",
            "tasks_total": 1,
            "blocked_total": 1,
            "age": 0.1,
        }

    def cpu_percent(interval=None):
        calls["cpu_intervals"].append(interval)
        return 12.5

    monkeypatch.setattr(kernel_handlers, "_syscall_payload_cache", None)
    monkeypatch.setattr(kernel_handlers, "_syscall_payload_expires_at", 0.0)
    monkeypatch.setattr(kernel_handlers._telemetry, "get_syscall_sample", sample)
    monkeypatch.setattr(kernel_handlers.psutil, "cpu_percent", cpu_percent)
    monkeypatch.setattr(
        kernel_handlers.psutil,
        "virtual_memory",
        lambda: type("Memory", (), {"percent": 34.0})(),
    )
    monkeypatch.setattr(
        kernel_handlers._core_observability_service,
        "get_system_info",
        lambda: {"system": "test"},
    )

    first = kernel_handlers._syscalls_realtime_payload()
    second = kernel_handlers._syscalls_realtime_payload()

    assert first is second
    assert calls == {"sample": 1, "cpu_intervals": [None]}
    assert first["sample"]["scope"] == "machine"


def test_metrics_endpoint_available(client):
    resp = client.get("/metrics")
    assert resp.status_code == 200
    assert "text/plain" in (resp.content_type or "")
    body = resp.get_data(as_text=True)
    assert "http_requests_total" in body
    assert "http_errors_total" in body


def test_not_found_handler_returns_json(client):
    resp = client.get("/does-not-exist")
    assert resp.status_code == 404
    assert resp.is_json
    payload = resp.get_json()
    assert payload["error"] == "Not found"
    assert payload["code"] == "not_found"
    assert payload.get("request_id")


def test_internal_error_handler_returns_json(app):
    @app.route("/__test_500")
    def _raise_error():
        raise RuntimeError("boom")

    client = app.test_client()
    resp = client.get("/__test_500")
    assert resp.status_code == 500
    assert resp.is_json
    payload = resp.get_json()
    assert payload["error"] == "Internal server error"
    assert payload["code"] == "internal_error"
    assert payload.get("request_id")


def test_request_id_header_present(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.headers.get("X-Request-ID")


def test_request_id_header_passthrough(client):
    resp = client.get("/health", headers={"X-Request-ID": "req-123"})
    assert resp.status_code == 200
    assert resp.headers.get("X-Request-ID") == "req-123"
