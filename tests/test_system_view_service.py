"""Tests for ``kernel_ai.services.system_view``."""

from kernel_ai.services import system_view as svc


def test_parse_cgroup_path_prefers_unified_entry(monkeypatch):
    sample = "9:memory:/foo\n0::/unified/path\n"
    monkeypatch.setattr(svc._proc_fs, "safe_read_text", lambda _path: sample)
    assert svc._parse_cgroup_path(1234) == "/unified/path"


def test_get_isolation_context_handles_empty_process_list(monkeypatch):
    monkeypatch.setattr(svc.psutil, "process_iter", lambda _fields: [])
    out = svc.get_isolation_context()
    assert "namespaces" in out
    assert out["processes_scanned"] == 0


def test_read_namespace_inode_parses_inode(monkeypatch):
    monkeypatch.setattr(svc.os, "readlink", lambda _path: "net:[4026531993]")
    assert svc.read_namespace_inode(123, "net") == "4026531993"
