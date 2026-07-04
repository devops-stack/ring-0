"""Tests for ``kernel_ai.services.process_timeline``."""

from kernel_ai.services import process_timeline as svc


class _FakeProc:
    def as_dict(self, _fields):
        return {"pid": 123, "name": "fake", "create_time": 1000.0, "status": "running"}


class _FakeIterProc:
    def __init__(self, pid, name, cpu, rss):
        self.info = {
            "pid": pid,
            "name": name,
            "cpu_percent": cpu,
            "memory_info": type("mem", (), {"rss": rss})(),
        }


def test_get_proc_timeline_data_requires_pid():
    try:
        svc.get_proc_timeline_data(None)
        assert False, "Expected ValueError"
    except ValueError:
        assert True


def test_get_proc_timeline_data_not_found(monkeypatch):
    def _raise(_pid):
        raise svc.psutil.NoSuchProcess(pid=999)

    monkeypatch.setattr(svc.psutil, "Process", _raise)
    try:
        svc.get_proc_timeline_data(999)
        assert False, "Expected ProcessLookupError"
    except ProcessLookupError:
        assert True


def test_get_proc_timeline_data_basic(monkeypatch):
    monkeypatch.setattr(svc.psutil, "Process", lambda _pid: _FakeProc())
    monkeypatch.setattr(svc, "_safe_read_text", lambda _path: "")
    out = svc.get_proc_timeline_data(123, window_s=5)
    assert out["pid"] == 123
    assert out["window_s"] == 5
    assert out["timeline"][0]["type"] == "exec"
    assert "relative_s" in out["timeline"][0]


def test_get_proc_timeline_branches_data_basic(monkeypatch):
    monkeypatch.setattr(
        svc.psutil,
        "process_iter",
        lambda _fields: [
            _FakeIterProc(101, "nginx", 12.0, 120 * 1024 * 1024),
            _FakeIterProc(202, "python3", 8.0, 220 * 1024 * 1024),
        ],
    )

    def _fake_timeline(pid, window_s=30):
        return {
            "pid": pid,
            "name": f"p{pid}",
            "window_s": window_s,
            "timeline": [
                {"type": "syscall", "name": "exec", "timestamp": "2026-01-01T00:00:00"},
                {"type": "i/o", "name": "read_bytes", "timestamp": "2026-01-01T00:00:01"},
            ],
        }

    monkeypatch.setattr(svc, "get_proc_timeline_data", _fake_timeline)
    out = svc.get_proc_timeline_branches_data(limit=2, events=4, window_s=120)
    assert "branches" in out
    assert len(out["branches"]) == 2
    assert out["branches"][0]["event_count"] >= 1
    assert out["meta"]["window_s"] == 120
