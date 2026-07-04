"""Tests for runtime state container helpers."""

from kernel_ai import state as st


def test_create_state_container_isolated_mutables():
    a = st.create_state_container()
    b = st.create_state_container()
    a.traceroute_cache["1.1.1.1"] = {"timestamp": 1, "data": {}}
    a.crypto_prev["active_flows"] = 77
    assert "1.1.1.1" not in b.traceroute_cache
    assert b.crypto_prev["active_flows"] != 77


def test_get_state_container_legacy_fallback():
    state = st.get_state_container(None)
    assert state.network_stack_prev is st.NETWORK_STACK_PREV
    assert state.frontend_log_file == st.FRONTEND_LOG_FILE
