"""Tests for ``kernel_ai.services.crypto_security``."""

from kernel_ai.services import crypto_security as svc


class _FakeProc:
    def __init__(self, info):
        self.info = info


def test_collect_crypto_realtime_with_callbacks(monkeypatch):
    monkeypatch.setattr(svc.psutil, "net_connections", lambda kind="inet": [])
    monkeypatch.setattr(
        svc.psutil,
        "process_iter",
        lambda attrs=None: [_FakeProc({"pid": 101, "name": "nginx"})],
    )

    callbacks = {
        "infer_crypto_protocol": lambda _lp, _rp, _name: ("TLS", "AES-GCM/SHA256"),
        "is_likely_crypto_actor": lambda *_args: True,
        "infer_tls_terminator": lambda _name, _port, _proto, _listeners: "n/a",
        "collect_algorithm_competition": lambda algo: {"request": algo.upper(), "selected": {"name": "generic", "source": "kernel"}, "implementations": []},
        "parse_proc_crypto_entries": lambda: [],
        "collect_kernel_crypto_clients": lambda _items: [],
        "collect_hw_offload_status": lambda _entries, _comps: [],
        "collect_sync_async_queue": lambda _items: {"sync": 0, "async": 0},
        "collect_algorithm_requesters": lambda _items, _clients: {"aes": [], "sha": [], "chacha20": []},
        "build_crypto_decision_pipelines": lambda **_kwargs: {"aes": {}},
        "collect_entropy_cloud_status": lambda: {"mode": "test"},
        "collect_crypto_runtime_sources": lambda _items, _entries, _clients, _entropy: [{"id": "tls_sockets", "active": True}],
    }

    out = svc.collect_crypto_realtime(callbacks=callbacks, crypto_prev={"timestamp": None, "active_flows": 0})
    assert "items" in out
    assert "meta" in out
    assert "protected_zones" in out
    assert "runtime_sources" in out
    assert out["meta"]["runtime_sources"][0]["id"] == "tls_sockets"
    assert any(zone["id"] == "tls" for zone in out["protected_zones"])
    assert out["meta"]["active_flows"] >= 1


def test_collect_crypto_runtime_sources_marks_live_tls():
    sources = svc.collect_crypto_runtime_sources(
        items=[
            {
                "process": "nginx",
                "protocol": "TLS",
                "status": "ESTABLISHED",
                "endpoint": "127.0.0.1:443",
            }
        ],
        proc_crypto_entries=[{"name": "aes", "type": "skcipher"}],
        kernel_clients=[{"name": "kTLS", "status": "active", "active_flows": 1}],
        entropy_cloud={"crng_state": "ready", "entropy_pool_bits": 256},
    )
    by_id = {source["id"]: source for source in sources}
    assert by_id["tls_sockets"]["active"] is True
    assert by_id["tls_sockets"]["source"] == "direct"
    assert by_id["kernel_registry"]["active"] is True
    assert by_id["entropy"]["active"] is True


def test_collect_security_realtime_empty_processes(monkeypatch):
    monkeypatch.setattr(svc.psutil, "process_iter", lambda _attrs: [])
    monkeypatch.setattr(svc.psutil, "net_connections", lambda kind="inet": [])
    monkeypatch.setattr(svc.subprocess, "check_output", lambda *args, **kwargs: "0")
    monkeypatch.setattr(svc.random, "randint", lambda _a, _b: 10)

    out = svc.collect_security_realtime(security_prev={"timestamp": None, "events": 0})
    assert "pipeline" in out
    assert "security_tools" in out
    assert out["meta"]["events"] == 0


def test_collect_crypto_realtime_delegates_to_crypto_pipeline(monkeypatch):
    called = {}

    def _fake_collect(*, crypto_prev, callbacks, psutil_module, logger):
        called["ok"] = True
        assert crypto_prev["active_flows"] == 0
        assert callable(callbacks["collect_entropy_cloud_status"])
        assert psutil_module is svc.psutil
        assert logger is svc.logger
        return {"items": [], "processes": [], "meta": {"active_flows": 0}}

    monkeypatch.setattr(svc._crypto_pipeline, "collect_crypto_realtime", _fake_collect)
    out = svc.collect_crypto_realtime(crypto_prev={"timestamp": None, "active_flows": 0})
    assert called.get("ok") is True
    assert out["meta"]["active_flows"] == 0
