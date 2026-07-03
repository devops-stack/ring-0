"""Tests for ``kernel_ai.services.crypto.entropy``."""

from kernel_ai.services.crypto import entropy as svc


def test_read_sysctl_int_missing_returns_default():
    out = svc.read_sysctl_int("/nonexistent/kernel-ai-sysctl", default=123)
    assert out == 123


def test_collect_entropy_cloud_status_basic(monkeypatch):
    class _Disk:
        read_bytes = 1000
        write_bytes = 2000

    class _Net:
        bytes_sent = 3000
        bytes_recv = 4000

    values = {
        "/proc/sys/kernel/random/entropy_avail": 256,
        "/proc/sys/kernel/random/poolsize": 256,
        "/proc/sys/kernel/random/read_wakeup_threshold": 128,
        "/proc/sys/kernel/random/write_wakeup_threshold": 64,
    }

    monkeypatch.setattr(svc, "read_sysctl_int", lambda path, default=0: values.get(path, default))
    monkeypatch.setattr(svc.psutil, "disk_io_counters", lambda: _Disk())
    monkeypatch.setattr(svc.psutil, "net_io_counters", lambda: _Net())
    monkeypatch.setattr(svc, "read_proc_interrupt_total", lambda: 100)

    prev = {
        "timestamp": None,
        "disk_read_bytes": 0,
        "disk_write_bytes": 0,
        "net_sent_bytes": 0,
        "net_recv_bytes": 0,
        "interrupt_total": 0,
    }
    out = svc.collect_entropy_cloud_status(prev)
    assert out["entropy_pool_bits"] == 256
    assert out["random_subsystem_state"] in {"stable", "refilling"}
    assert len(out["sources"]) == 4
