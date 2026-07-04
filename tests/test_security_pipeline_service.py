"""Tests for ``kernel_ai.services.crypto.security_pipeline``."""

from types import SimpleNamespace

from kernel_ai.services.crypto import security_pipeline as svc


def test_collect_security_realtime_with_empty_sources():
    psutil_module = SimpleNamespace(
        Error=Exception,
        NoSuchProcess=Exception,
        AccessDenied=Exception,
        ZombieProcess=Exception,
        process_iter=lambda _attrs: [],
        net_connections=lambda kind="inet": [],
    )
    subprocess_module = SimpleNamespace(
        SubprocessError=Exception,
        check_output=lambda *args, **kwargs: "0",
    )
    random_module = SimpleNamespace(randint=lambda _a, _b: 10)
    os_module = SimpleNamespace(path=SimpleNamespace(exists=lambda _p: False))

    out = svc.collect_security_realtime(
        security_prev={"timestamp": None, "events": 0},
        psutil_module=psutil_module,
        subprocess_module=subprocess_module,
        random_module=random_module,
        os_module=os_module,
    )
    assert "pipeline" in out
    assert "security_tools" in out
