"""Tests for ``kernel_ai.services.execution``."""

from kernel_ai.services import execution as svc


def test_get_execution_context_data_non_linux(monkeypatch):
    monkeypatch.setattr(svc.platform, "system", lambda: "Darwin")
    out = svc.get_execution_context_data({}, lambda _x: "kernel", {"timestamp": None, "irq_totals": {}, "softirq_totals": {}})
    assert out["mode"] == "kernel"
    assert out["preempted"] is False


def test_get_kernel_dna_data_uses_callbacks():
    out = svc.get_kernel_dna_data(
        get_real_system_calls_fn=lambda: [{"name": "read", "count": 1}],
        map_syscall_to_subsystem_fn=lambda _n: "fs",
        map_interrupt_to_subsystem_fn=lambda _n: "kernel",
        softirq_nucleotides_fn=lambda: [],
    )
    assert "nucleotides" in out
    assert "genes" in out


def test_build_kernel_anomaly_mutations_from_proc_hints(monkeypatch):
    monkeypatch.setattr(
        svc,
        "_read_key_value_proc_file",
        lambda _path: {"pgmajfault": 10, "pgscan_direct": 4},
    )
    monkeypatch.setattr(svc, "_read_memory_psi_avg10", lambda: {"some": 1.5, "full": 0.0})
    monkeypatch.setattr(svc, "_read_tcp_retrans_segs", lambda: 12)
    monkeypatch.setattr(svc, "_read_softirq_totals", lambda: {"NET_RX": 500, "NET_TX": 100, "TIMER": 20})
    monkeypatch.setattr(svc, "_read_loadavg", lambda: {"load1": 4.0, "runnable": 8, "threads": 120})
    monkeypatch.setattr(svc.psutil, "cpu_count", lambda: 2)

    out = svc.build_kernel_anomaly_mutations()
    types = {row["type"] for row in out}

    assert "memory_pressure" in types
    assert "page_reclaim_pressure" in types
    assert "tcp_retransmission" in types
    assert "net_softirq_pressure" in types
    assert "scheduler_runqueue_pressure" in types
