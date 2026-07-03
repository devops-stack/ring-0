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
