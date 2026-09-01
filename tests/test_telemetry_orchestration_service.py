"""Tests for ``kernel_ai.services.telemetry_orchestration``."""

from kernel_ai.services import telemetry_orchestration as svc
from kernel_ai.services.telemetry_orchestration import _helix_surface, _ml_anomalies_to_mutations


def test_get_real_system_calls_delegates(monkeypatch):
    called = {}

    def fake_get_real_system_calls(**kwargs):
        called.update(kwargs)
        return [{"name": "read"}]

    monkeypatch.setattr(svc._syscalls_service, "get_real_system_calls", fake_get_real_system_calls)
    out = svc.get_real_system_calls()

    assert out == [{"name": "read"}]
    # The table of the running kernel, not a bundled one for another machine.
    assert called["syscall_names"] == svc.get_syscall_names()
    assert callable(called["map_syscall_to_subsystem_fn"])
    assert callable(called["fallback_mock_calls_fn"])


def test_get_execution_context_data_delegates(monkeypatch):
    def fake_get_execution_context_data(**kwargs):
        return {"ok": True, "exec_context_prev": kwargs["exec_context_prev"]}

    monkeypatch.setattr(svc._execution_service, "get_execution_context_data", fake_get_execution_context_data)
    out = svc.get_execution_context_data(exec_context_prev={"x": 1})
    assert out["ok"] is True
    assert out["exec_context_prev"] == {"x": 1}


def test_helix_holds_host_chatter_unless_process_owns_it():
    assert _helix_surface({"source": "stage1_baseline", "feature": "pgfault_per_sec", "meta": {}}) is False
    assert _helix_surface({"source": "stage2_isoforest", "feature": "ctxt_per_sec", "meta": {}}) is False
    assert _helix_surface({"source": "stage1_baseline", "feature": "psi_mem_some10", "meta": {}}) is True
    assert _helix_surface({"source": "stage5_process", "feature": "proc:nginx:vm_rss_mb", "meta": {"pid": 12}}) is True
    assert _helix_surface({"source": "stage9_http", "feature": "http_attempt:sensitive", "meta": {}}) is True
    muts = _ml_anomalies_to_mutations([
        {"feature": "pgfault_per_sec", "source": "stage1_baseline", "message": "x", "position": 0.62, "meta": {}},
        {"feature": "psi_mem_full10", "source": "stage1_baseline", "message": "y", "position": 0.78, "meta": {}},
    ])
    assert [m["type"] for m in muts] == ["psi_mem_full10"]
