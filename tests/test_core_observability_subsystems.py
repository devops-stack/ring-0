"""Subsystem load must report measured values, never padded ones.

The panel these numbers feed used to floor CPU at 50% and pin I/O wait to 100%,
so the assertions below are deliberately about the arithmetic and about the
warming state, not merely about the shape of the payload.
"""

from kernel_ai.services import core_observability as svc


def _reset_baseline():
    svc._SUBSYSTEM_PREV.update({"ts": None, "cpu": None, "disk": None, "net": None, "net_peak": 0.0})


def _stub_proc(monkeypatch, cpu_times, memory=(4 * 1024**3, 8 * 1024**3)):
    monkeypatch.setattr(svc.platform, "system", lambda: "Linux")
    monkeypatch.setattr(svc, "_read_cpu_times", lambda: cpu_times)
    monkeypatch.setattr(svc, "_read_memory_used", lambda: memory)
    monkeypatch.setattr(svc, "_read_loadavg", lambda: (3, [1.5, 1.25, 1.0]))
    monkeypatch.setattr(svc, "_read_tcp_inuse", lambda: 31)
    monkeypatch.setattr(svc, "_read_mount_count", lambda: 52)
    monkeypatch.setattr(svc.psutil, "disk_io_counters", lambda: None)
    monkeypatch.setattr(svc.psutil, "net_io_counters", lambda: None)


def test_first_call_marks_rates_warming_instead_of_inventing_them(monkeypatch):
    _reset_baseline()
    # user, nice, system, idle, iowait
    _stub_proc(monkeypatch, [1000, 0, 500, 8000, 500])

    out = svc.get_kernel_subsystem_status()

    for key in ("process_scheduler", "file_system", "network_stack"):
        assert out[key]["warming"] is True, key
        assert out[key]["value"] is None, key
    # Memory is a level, not a rate, so it is answerable straight away.
    assert out["memory_management"]["warming"] is False
    assert out["memory_management"]["value"] == 50.0


def test_cpu_and_iowait_come_from_the_delta_between_polls(monkeypatch):
    _reset_baseline()
    _stub_proc(monkeypatch, [1000, 0, 500, 8000, 500])
    svc.get_kernel_subsystem_status()

    # Over the next interval: 70 busy, 20 idle, 10 waiting on I/O out of 100.
    _stub_proc(monkeypatch, [1060, 0, 510, 8020, 510])
    out = svc.get_kernel_subsystem_status()

    assert out["process_scheduler"]["value"] == 70.0
    assert out["process_scheduler"]["usage"] == 70
    assert out["file_system"]["value"] == 10.0
    assert out["process_scheduler"]["warming"] is False


def test_idle_machine_reports_idle_rather_than_a_floor(monkeypatch):
    _reset_baseline()
    _stub_proc(monkeypatch, [1000, 0, 500, 8000, 500])
    svc.get_kernel_subsystem_status()

    # Nothing but idle jiffies accumulated between the two polls.
    _stub_proc(monkeypatch, [1000, 0, 500, 8100, 500])
    out = svc.get_kernel_subsystem_status()

    assert out["process_scheduler"]["value"] == 0.0
    assert out["process_scheduler"]["usage"] == 0
    assert out["file_system"]["value"] == 0.0
    assert out["file_system"]["usage"] == 0


def test_scheduler_row_carries_the_load_average(monkeypatch):
    _reset_baseline()
    _stub_proc(monkeypatch, [1000, 0, 500, 8000, 500])
    out = svc.get_kernel_subsystem_status()

    assert out["process_scheduler"]["load"] == [1.5, 1.25, 1.0]
    assert out["process_scheduler"]["detail"] == 3
    assert out["process_scheduler"]["detail_unit"] == "runnable"


def test_network_throughput_is_scaled_against_the_busiest_second_seen(monkeypatch):
    class Net:
        def __init__(self, sent, recv):
            self.bytes_sent = sent
            self.bytes_recv = recv

    _reset_baseline()
    _stub_proc(monkeypatch, [1000, 0, 500, 8000, 500])
    monkeypatch.setattr(svc.psutil, "net_io_counters", lambda: Net(0, 0))
    monkeypatch.setattr(svc.time, "time", lambda: 1000.0)
    svc.get_kernel_subsystem_status()

    # 4 MiB moved over one second becomes both the reading and the full-scale mark.
    monkeypatch.setattr(svc.psutil, "net_io_counters", lambda: Net(2 * 1024**2, 2 * 1024**2))
    monkeypatch.setattr(svc.time, "time", lambda: 1001.0)
    peak = svc.get_kernel_subsystem_status()["network_stack"]
    assert peak["value"] == 4 * 1024**2
    assert peak["usage"] == 100
    assert peak["detail"] == 31
    assert peak["detail_unit"] == "sockets"

    # A quiet second afterwards must read as quiet, not as full scale.
    monkeypatch.setattr(svc.psutil, "net_io_counters", lambda: Net(2 * 1024**2, 2 * 1024**2))
    monkeypatch.setattr(svc.time, "time", lambda: 1002.0)
    quiet = svc.get_kernel_subsystem_status()["network_stack"]
    assert quiet["value"] == 0
    assert quiet["usage"] == 0
