"""Integration tests for key API response contracts."""

import os

import pytest

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


def _filesystem_blocks_payload():
    return {
        "timestamp": "2026-08-12T10:00:00",
        "mounts": [{"mountpoint": "/", "used_percent": 41.0}],
        "devices": [{"name": "vda", "write_bps": 0.0, "read_bps": 0.0}],
        "writepath": {"stages": [], "hot": "block"},
        "writeback": {"dirty_mb": 0.4, "writeback_mb": 0.0},
        "io_scheduler": {"device": "vda", "scheduler": "none"},
        "meta": {"used_percent": 41.0, "mount_count": 1},
    }


def test_filesystem_blocks_contract_allows_missing_io_scheduler():
    # A box with no real block device reports no scheduler, and that is valid.
    payload = _filesystem_blocks_payload()
    payload["io_scheduler"] = None
    validate_filesystem_blocks_response(payload)


def _drop(payload, *path):
    target = payload
    for step in path[:-1]:
        target = target[step]
    del target[path[-1]]
    return payload


def _stale_grid_payload():
    # The grid shape this endpoint served before the write-path rewrite.
    return {"timestamp": "2026-08-12T10:00:00", "rows": 4, "cols": 4,
            "zones": [], "blocks": [], "meta": {}}


@pytest.mark.parametrize(
    "payload, expected",
    [
        (_stale_grid_payload(), "missing key 'mounts'"),
        (_drop(_filesystem_blocks_payload(), "mounts"), "missing key 'mounts'"),
        (_drop(_filesystem_blocks_payload(), "writeback"), "missing key 'writeback'"),
        (_drop(_filesystem_blocks_payload(), "writepath", "hot"), r"writepath: missing key 'hot'"),
        (_drop(_filesystem_blocks_payload(), "meta", "mount_count"),
         r"meta: missing key 'mount_count'"),
    ],
)
def test_filesystem_blocks_contract_rejects_drift(payload, expected):
    with pytest.raises(ValueError, match=expected):
        validate_filesystem_blocks_response(payload)
