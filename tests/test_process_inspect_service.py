"""Tests for ``kernel_ai.services.process_inspect``."""

from kernel_ai.services import process_inspect as svc


def test_get_ipc_links_summary_empty_proc(monkeypatch):
    monkeypatch.setattr(svc.os, "listdir", lambda path: [] if path == "/proc" else [])
    monkeypatch.setattr(svc.psutil, "net_connections", lambda kind: [])
    out = svc.get_ipc_links_summary(max_pairs=20, max_nodes=8)
    assert out["process_nodes"] == []
    assert out["pair_links"] == []
    assert out["stats"]["pair_count"] == 0
    assert out["stats"]["shared_unix_socket_inodes"] == 0
    assert out["stats"]["shared_tcp_socket_inodes"] == 0


def test_get_process_fds_info_basic(monkeypatch):
    class _FakeProc:
        def num_fds(self):
            return 3

        def open_files(self):
            return []

        def connections(self):
            return []

    monkeypatch.setattr(svc.psutil, "Process", lambda _pid: _FakeProc())
    out = svc.get_process_fds_info(123)
    assert out["pid"] == 123
    assert out["num_fds"] == 3


def test_get_process_fds_info_descriptors(monkeypatch):
    class _FakeProc:
        def num_fds(self):
            return 5

        def open_files(self):
            return []

        def connections(self):
            return []

    targets = {
        "/proc/123/fd/0": "/dev/null",
        "/proc/123/fd/1": "pipe:[10]",
        "/proc/123/fd/2": "pipe:[11]",
        "/proc/123/fd/7": "socket:[12]",
        "/proc/123/fd/19": "pipe:[13]",
    }

    monkeypatch.setattr(svc.psutil, "Process", lambda _pid: _FakeProc())
    monkeypatch.setattr(svc.os.path, "exists", lambda path: path == "/proc/123/fd")
    monkeypatch.setattr(svc.os, "listdir", lambda path: ["19", "0", "7", "2", "1"] if path == "/proc/123/fd" else [])
    monkeypatch.setattr(svc.os, "readlink", lambda path: targets[path])

    out = svc.get_process_fds_info(123)
    descriptors = out["descriptors"]
    assert [item["fd"] for item in descriptors] == [0, 1, 2, 7, 19]
    assert [item["type"] for item in descriptors] == ["stdin", "stdout", "stderr", "socket", "pipe"]
