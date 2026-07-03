"""Tests for ``kernel_ai.services.network``."""

from kernel_ai.services import network as svc


def test_tcp_state_name_mapping():
    assert svc._tcp_state_name("01") == "ESTABLISHED"
    assert svc._tcp_state_name("ff") == "FF"


def test_traceroute_invalid_ip_raises_value_error():
    try:
        svc.get_traceroute_info("not-an-ip")
        assert False, "Expected ValueError for invalid IP"
    except ValueError:
        assert True
