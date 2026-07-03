"""Tests for ``kernel_ai.services.processes``."""

from kernel_ai.services import processes as svc


class _FakeProc:
    def __init__(self, info):
        self.info = info


def test_get_proc_matrix_data_sorts_by_cpu(monkeypatch):
    def fake_iter(_fields):
        return [
            _FakeProc({"pid": 10, "name": "a", "cpu_percent": 2.0, "memory_info": None, "io_counters": None, "num_fds": 3}),
            _FakeProc({"pid": 20, "name": "b", "cpu_percent": 8.0, "memory_info": None, "io_counters": None, "num_fds": 4}),
        ]

    monkeypatch.setattr(svc.psutil, "process_iter", fake_iter)
    monkeypatch.setattr(svc.os.path, "exists", lambda _p: False)

    out = svc.get_proc_matrix_data()
    assert [row["pid"] for row in out[:2]] == [20, 10]


def test_get_proc_graph_data_uses_matrix(monkeypatch):
    monkeypatch.setattr(
        svc,
        "get_proc_matrix_data",
        lambda: [{"pid": 1, "name": "systemd"}, {"pid": 2, "name": "kthreadd"}],
    )

    out = svc.get_proc_graph_data()
    assert "nodes" in out and "edges" in out
    assert out["nodes"][0]["id"] == "kernel"
    assert len(out["edges"]) == 2
