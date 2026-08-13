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
    # Isolate the unrelated namespace probe: this test is about fd descriptor
    # parsing, and the real fingerprint reads /proc/<pid>/ns/* (not mocked here).
    monkeypatch.setattr(svc, "get_process_namespace_fingerprint", lambda _pid: {})

    out = svc.get_process_fds_info(123)
    descriptors = out["descriptors"]
    assert [item["fd"] for item in descriptors] == [0, 1, 2, 7, 19]
    assert [item["type"] for item in descriptors] == ["stdin", "stdout", "stderr", "socket", "pipe"]


class _FakeAncestor:
    """Minimal psutil.Process stand-in for lineage walking."""

    def __init__(self, pid, name, create_time, parent=None):
        self.pid = pid
        self._name = name
        self._create_time = create_time
        self._parent = parent

    def as_dict(self, _fields):
        return {
            "pid": self.pid,
            "name": self._name,
            "create_time": self._create_time,
            "status": "sleeping",
            "username": "alex",
        }

    def cmdline(self):
        return ["/usr/bin/" + self._name]

    def name(self):
        return self._name

    def parent(self):
        return self._parent

    def children(self):
        return []


def test_get_process_lineage_orders_oldest_first(monkeypatch):
    init = _FakeAncestor(1, "systemd", 1000.0)
    shell = _FakeAncestor(50, "bash", 2000.0, parent=init)
    leaf = _FakeAncestor(900, "python3", 3000.0, parent=shell)

    monkeypatch.setattr(svc.psutil, "Process", lambda _pid: leaf)
    monkeypatch.setattr(svc.psutil, "boot_time", lambda: 999.0)

    out = svc.get_process_lineage_info(900)
    assert [row["pid"] for row in out["chain"]] == [1, 50, 900]
    assert [row["name"] for row in out["chain"]] == ["systemd", "bash", "python3"]
    assert out["depth"] == 3
    assert out["truncated"] is False
    assert out["chain"][0]["create_time"] == 1000.0


def test_get_process_lineage_breaks_parent_cycle(monkeypatch):
    a = _FakeAncestor(10, "a", 1000.0)
    b = _FakeAncestor(11, "b", 1100.0, parent=a)
    a._parent = b  # pathological /proc race: parent chain loops back

    monkeypatch.setattr(svc.psutil, "Process", lambda _pid: b)
    monkeypatch.setattr(svc.psutil, "boot_time", lambda: 999.0)

    out = svc.get_process_lineage_info(11)
    assert [row["pid"] for row in out["chain"]] == [10, 11]


def test_activity_counters_expose_deltas_source(monkeypatch, tmp_path):
    class _Times:
        user = 1.25
        system = 0.5

    class _FakeProc:
        def cpu_times(self):
            return _Times()

    status = tmp_path / "status"
    status.write_text(
        "Name:\tnginx\nThreads:\t4\n"
        "voluntary_ctxt_switches:\t120\n"
        "nonvoluntary_ctxt_switches:\t7\n"
    )
    io_file = tmp_path / "io"
    io_file.write_text("read_bytes: 4096\nwrite_bytes: 8192\n")

    real_open = open

    def fake_open(path, *args, **kwargs):
        if path == "/proc/77/status":
            return real_open(status, *args, **kwargs)
        if path == "/proc/77/io":
            return real_open(io_file, *args, **kwargs)
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(svc.psutil, "Process", lambda _pid: _FakeProc())
    monkeypatch.setattr("builtins.open", fake_open)

    out = svc.get_process_activity_counters(77)
    assert out["ctx_voluntary"] == 120
    assert out["ctx_nonvoluntary"] == 7
    assert out["num_threads"] == 4
    assert out["cpu_user"] == 1.25
    assert out["read_bytes"] == 4096
    assert out["io_readable"] is True
    assert out["ts"] > 0


def test_activity_counters_survive_unreadable_io(monkeypatch):
    class _FakeProc:
        def cpu_times(self):
            raise svc.psutil.AccessDenied(77)

    def fake_open(path, *args, **kwargs):
        raise PermissionError(path)

    monkeypatch.setattr(svc.psutil, "Process", lambda _pid: _FakeProc())
    monkeypatch.setattr("builtins.open", fake_open)

    out = svc.get_process_activity_counters(77)
    assert out["io_readable"] is False
    assert out["read_bytes"] is None
    assert out["cpu_user"] is None
    assert out["ctx_voluntary"] is None
