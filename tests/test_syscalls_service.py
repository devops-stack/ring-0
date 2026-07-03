"""Tests for ``kernel_ai.services.syscalls``."""

from kernel_ai.services import syscalls as svc


def test_get_real_system_calls_non_linux_uses_fallback(monkeypatch):
    monkeypatch.setattr(svc.platform, "system", lambda: "Darwin")
    out = svc.get_real_system_calls(
        syscall_names={},
        map_syscall_to_subsystem_fn=lambda _name: "kernel",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [{"name": "mock", "count": 1, "subsystem": "kernel"}],
    )
    assert out and out[0]["name"] == "mock"


def test_get_real_system_calls_linux_empty_proc(monkeypatch):
    monkeypatch.setattr(svc.platform, "system", lambda: "Linux")
    monkeypatch.setattr(svc.os, "listdir", lambda _path: [])
    out = svc.get_real_system_calls(
        syscall_names={},
        map_syscall_to_subsystem_fn=lambda _name: "kernel",
        kernel_dna_max_procs=10,
        fallback_mock_calls_fn=lambda: [{"name": "mock"}],
    )
    assert isinstance(out, list)


def test_get_softirq_nucleotides_handles_read_error(monkeypatch):
    def _boom(*_args, **_kwargs):
        raise OSError("nope")

    monkeypatch.setattr("builtins.open", _boom)
    out = svc.get_softirq_nucleotides(map_interrupt_to_subsystem_fn=lambda _n: "kernel")
    assert out == []
