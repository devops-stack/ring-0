"""Tests for ``kernel_ai.services.system_view``."""

from kernel_ai.services import system_view as svc


def test_parse_cgroup_path_prefers_unified_entry(monkeypatch):
    sample = "9:memory:/foo\n0::/unified/path\n"
    monkeypatch.setattr(svc._proc_fs, "safe_read_text", lambda _path: sample)
    assert svc._parse_cgroup_path(1234) == "/unified/path"


def test_get_isolation_context_handles_empty_process_list(monkeypatch):
    monkeypatch.setattr(svc, "_read_isolation_snapshot", lambda: None)
    monkeypatch.setattr(svc.psutil, "process_iter", lambda _fields: [])
    out = svc.get_isolation_context()
    assert "namespaces" in out
    assert out["processes_scanned"] == 0
    assert out["source"] == "self"


def test_get_isolation_context_prefers_fresh_collector_snapshot(monkeypatch):
    snap = {
        "ts": 1,
        "source": "collector",
        "namespaces": [{"id": "net", "worlds": [{"sample": ["nginx"]}]}],
        "processes_scanned": 80,
        "top_cgroups": [],
    }
    monkeypatch.setattr(svc, "_read_isolation_snapshot", lambda: snap)
    out = svc.get_isolation_context()
    assert out["source"] == "collector"
    assert out["namespaces"][0]["worlds"][0]["sample"] == ["nginx"]


def test_rank_isolation_samples_puts_nginx_first():
    assert svc._rank_isolation_samples(["kthreadd", "nginx", "sshd"])[:2] == ["nginx", "sshd"]


def test_read_namespace_inode_parses_inode(monkeypatch):
    monkeypatch.setattr(svc.os, "readlink", lambda _path: "net:[4026531993]")
    assert svc.read_namespace_inode(123, "net") == "4026531993"


def test_isolation_worlds_include_exact_member_pids(monkeypatch):
    class Proc:
        def __init__(self, pid, name):
            self.info = {"pid": pid, "name": name, "memory_info": None}

    procs = [Proc(10, "alpha"), Proc(20, "beta"), Proc(30, "gamma")]
    net_inodes = {1: "host", 10: "host", 20: "isolated", 30: "host"}

    monkeypatch.setattr(svc, "_read_isolation_snapshot", lambda: None)
    monkeypatch.setattr(svc.psutil, "process_iter", lambda _fields: procs)
    monkeypatch.setattr(svc, "_parse_cgroup_path", lambda _pid: "/")
    monkeypatch.setattr(svc, "_read_cgroup_v2_stats", lambda _path: {})
    monkeypatch.setattr(
        svc,
        "read_namespace_inode",
        lambda pid, kind: net_inodes.get(pid) if kind == "net" else f"{kind}-host",
    )

    out = svc.get_isolation_context()
    net = next(ns for ns in out["namespaces"] if ns["id"] == "net")
    worlds = {world["inode"]: world for world in net["worlds"]}

    assert worlds["host"]["pids"] == [10, 30]
    assert worlds["isolated"]["pids"] == [20]
