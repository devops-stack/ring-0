"""Tests for ``kernel_ai.services.core_observability``."""

from kernel_ai.services import core_observability as svc


def test_get_system_info_has_expected_keys():
    out = svc.get_system_info()
    assert "platform" in out
    assert "kernel" in out
    assert "cpu_count" in out


def test_get_process_kernel_map_falls_back_to_mock():
    out = svc.get_process_kernel_map(openai_available=False, openai_module=None)
    assert "systemd" in out
    assert "nginx" in out


def test_io_pulse_reports_context_switches_per_second(monkeypatch):
    times = iter((100.0, 102.0))
    context_switches = iter((10_000, 10_240))

    monkeypatch.setattr(svc.platform, "system", lambda: "Linux")
    monkeypatch.setattr(svc.time, "time", lambda: next(times))
    monkeypatch.setattr(svc, "_read_vmstat", lambda: {})
    monkeypatch.setattr(svc, "_read_intr_total", lambda: 0)
    monkeypatch.setattr(svc, "_read_ctxt_total", lambda: next(context_switches))
    monkeypatch.setattr(svc.psutil, "disk_io_counters", lambda: None)
    monkeypatch.setattr(svc.psutil, "net_io_counters", lambda: None)
    monkeypatch.setattr(
        svc,
        "_IO_PULSE_PREV",
        {"ts": None, "vmstat": {}, "disk": None, "net": None, "intr": None, "ctxt": None},
    )

    assert svc.get_io_pulse()["ctxt_per_sec"] == 0
    assert svc.get_io_pulse()["ctxt_per_sec"] == 120


def test_io_pulse_reports_loadavg_sources(monkeypatch):
    monkeypatch.setattr(svc.platform, "system", lambda: "Linux")
    monkeypatch.setattr(svc.time, "time", lambda: 50.0)
    monkeypatch.setattr(svc, "_read_vmstat", lambda: {})
    monkeypatch.setattr(svc, "_read_intr_total", lambda: 0)
    monkeypatch.setattr(svc, "_read_ctxt_total", lambda: 0)
    monkeypatch.setattr(svc, "_read_loadavg", lambda: (3, [1.25, 0.8, 0.4]))
    monkeypatch.setattr(svc, "_read_stat_procs", lambda: (2, 1))
    monkeypatch.setattr(svc.psutil, "disk_io_counters", lambda: None)
    monkeypatch.setattr(svc.psutil, "net_io_counters", lambda: None)
    monkeypatch.setattr(svc.psutil, "cpu_count", lambda: 4)
    monkeypatch.setattr(
        svc,
        "_IO_PULSE_PREV",
        {"ts": None, "vmstat": {}, "disk": None, "net": None, "intr": None, "ctxt": None},
    )

    first = svc.get_io_pulse()
    assert first["load1"] == 1.25
    assert first["load5"] == 0.8
    assert first["load15"] == 0.4
    assert first["procs_running"] == 2
    assert first["procs_blocked"] == 1
    assert first["cpu_count"] == 4
