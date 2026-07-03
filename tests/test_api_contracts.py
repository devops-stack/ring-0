"""Integration tests for key API response contracts."""

import os

from kernel_ai.contracts.api_contracts import (
    validate_crypto_realtime_response,
    validate_execution_context_response,
    validate_filesystem_blocks_response,
    validate_isolation_context_response,
    validate_kernel_data_response,
    validate_kernel_dna_response,
    validate_network_stack_realtime_response,
    validate_proc_graph_response,
    validate_proc_timeline_response,
    validate_processes_realtime_response,
    validate_security_realtime_response,
)
from kernel_ai.webapp import create_app


def _client():
    return create_app().test_client()


def test_kernel_data_contract():
    resp = _client().get("/api/kernel-data")
    assert resp.status_code == 200
    validate_kernel_data_response(resp.get_json())


def test_network_stack_realtime_contract():
    resp = _client().get("/api/network-stack-realtime")
    assert resp.status_code == 200
    validate_network_stack_realtime_response(resp.get_json())


def test_crypto_realtime_contract():
    resp = _client().get("/api/crypto-realtime")
    assert resp.status_code == 200
    validate_crypto_realtime_response(resp.get_json())


def test_security_realtime_contract():
    resp = _client().get("/api/security-realtime")
    assert resp.status_code == 200
    validate_security_realtime_response(resp.get_json())


def test_filesystem_blocks_contract():
    resp = _client().get("/api/filesystem-blocks")
    assert resp.status_code == 200
    validate_filesystem_blocks_response(resp.get_json())


def test_processes_realtime_contract():
    resp = _client().get("/api/processes-realtime")
    assert resp.status_code == 200
    validate_processes_realtime_response(resp.get_json())


def test_execution_context_contract():
    resp = _client().get("/api/execution-context")
    assert resp.status_code == 200
    validate_execution_context_response(resp.get_json())


def test_kernel_dna_contract():
    resp = _client().get("/api/kernel-dna")
    assert resp.status_code == 200
    validate_kernel_dna_response(resp.get_json())


def test_proc_graph_contract():
    resp = _client().get("/api/proc-graph")
    assert resp.status_code == 200
    validate_proc_graph_response(resp.get_json())


def test_proc_timeline_contract():
    resp = _client().get(f"/api/proc-timeline?pid={os.getpid()}")
    assert resp.status_code == 200
    validate_proc_timeline_response(resp.get_json())


def test_isolation_context_contract():
    resp = _client().get("/api/isolation-context")
    assert resp.status_code == 200
    validate_isolation_context_response(resp.get_json())
