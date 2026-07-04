"""Tests for ``kernel_ai.services.devices``."""

from kernel_ai.services import devices as svc


def test_detect_bus_uses_category_for_net():
    assert svc._detect_bus("/sys/class/net/eth0", "net") == "net"


def test_get_devices_realtime_updates_state(monkeypatch):
    monkeypatch.setattr(svc, "_collect_block_devices", lambda _disk, _dt, _prev: [{"name": "sda", "category": "block", "bus": "pcie", "throughput_bps": 100.0, "irq_tokens": ["sda"], "driver": None}])
    monkeypatch.setattr(svc, "_collect_net_devices", lambda _dt, _prev: ([{"name": "eth0", "category": "net", "bus": "net", "throughput_bps": 50.0, "irq_tokens": ["eth0"], "driver": None}], {"eth0": 10}))
    monkeypatch.setattr(svc, "_collect_char_devices", lambda: [])
    monkeypatch.setattr(svc, "_collect_misc_input_gpu_usb", lambda: [])
    monkeypatch.setattr(svc, "_irq_total_for_tokens", lambda _lines, _tokens: 1)

    state = {"timestamp": None, "disk_sectors": {}, "net_bytes": {}, "tty_irq_total": 0, "irq_by_key": {}}
    out = svc.get_devices_realtime(
        devices_prev=state,
        read_diskstats_fn=lambda: {"sda": 20},
        read_interrupt_lines_fn=lambda: [],
        read_tty_irq_total_fn=lambda: 0,
    )

    assert "devices" in out
    assert out["meta"]["count"] >= 1
    assert state["timestamp"] is not None
