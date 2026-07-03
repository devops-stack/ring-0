"""Tests for ``kernel_ai.services.telemetry_orchestration``."""

from kernel_ai.services import telemetry_orchestration as svc


def test_get_real_system_calls_delegates(monkeypatch):
    called = {}

    def fake_get_real_system_calls(**kwargs):
        called.update(kwargs)
        return [{"name": "read"}]

    monkeypatch.setattr(svc._syscalls_service, "get_real_system_calls", fake_get_real_system_calls)
    out = svc.get_real_system_calls()

    assert out == [{"name": "read"}]
    assert called["syscall_names"] is svc.SYSCALL_NAMES
    assert callable(called["map_syscall_to_subsystem_fn"])
    assert callable(called["fallback_mock_calls_fn"])


def test_get_execution_context_data_delegates(monkeypatch):
    def fake_get_execution_context_data(**kwargs):
        return {"ok": True, "exec_context_prev": kwargs["exec_context_prev"]}

    monkeypatch.setattr(svc._execution_service, "get_execution_context_data", fake_get_execution_context_data)
    out = svc.get_execution_context_data(exec_context_prev={"x": 1})
    assert out["ok"] is True
    assert out["exec_context_prev"] == {"x": 1}
