"""Tests for ``kernel_ai.services.memory``."""

import json
import os
import time

from kernel_ai.services import memory as svc

MAPS = """\
aaaadc8b0000-aaaadca17000 r-xp 00000000 fd:00 922628                     /usr/lib/systemd/systemd
aaaadca27000-aaaadca75000 r--p 00167000 fd:00 922628                     /usr/lib/systemd/systemd
aaaadca75000-aaaadca76000 rw-p 001b5000 fd:00 922628                     /usr/lib/systemd/systemd
aaaadca76000-aaaadca78000 rw-p 00000000 00:00 0
aaaaee903000-aaaaeea89000 rw-p 00000000 00:00 0                          [heap]
ffffa2ea0000-ffffa2ec2000 r-xp 00000000 fd:00 919057                     /usr/lib/aarch64-linux-gnu/libgpg-error.so.0.32.1
ffffa2ec2000-ffffa2ed1000 ---p 00022000 fd:00 919057                     /usr/lib/aarch64-linux-gnu/libgpg-error.so.0.32.1
ffffa2ed1000-ffffa2ed2000 r--p 00021000 fd:00 919057                     /usr/lib/aarch64-linux-gnu/libgpg-error.so.0.32.1
ffffa2ed2000-ffffa2ed3000 rw-p 00022000 fd:00 919057                     /usr/lib/aarch64-linux-gnu/libgpg-error.so.0.32.1
ffffc0000000-ffffc0002000 rw-p 00000000 00:00 0                          [stack:4242]
ffffff000000-ffffff002000 rw-p 00000000 00:00 0                          [stack]
ffffd0000000-ffffd0001000 r-xp 00000000 00:00 0                          [vdso]
"""

ROLLUP = """\
aaaadc8b0000-ffffe4614000 ---p 00000000 00:00 0                          [rollup]
Rss:                6584 kB
Pss:                3485 kB
Shared_Clean:       3564 kB
Shared_Dirty:          0 kB
Private_Clean:       408 kB
Private_Dirty:      2612 kB
Anonymous:          2612 kB
Swap:                  0 kB
"""

STATUS = """\
Name:	systemd
VmSize:	  167648 kB
VmRSS:	    8156 kB
VmData:	   20416 kB
VmStk:	     132 kB
VmExe:	    1436 kB
VmLib:	   12448 kB
VmSwap:	       0 kB
Threads:	1
"""


def test_adjacent_mappings_of_the_same_file_are_one_region():
    rows = svc.parse_maps(
        "7ffff7f00000-7ffff7f20000 r-xp 00000000 fd:00 1 /lib/libc.so.6\n"
        "7ffff7f20000-7ffff7f30000 r--p 00020000 fd:00 1 /lib/libc.so.6\n"
        "7ffff7f30000-7ffff7f31000 rw-p 00030000 fd:00 1 /lib/libc.so.6\n"
    )
    lib = [r for r in rows if r["kind"] == "library"]
    assert len(lib) == 1
    assert lib[0]["size_kb"] == 0x31000 // 1024


def test_the_kinds_are_told_apart():
    kinds = {r["kind"] for r in svc.parse_maps(MAPS)}
    assert kinds == {"code", "file", "anonymous", "heap", "library", "stack", "vdso", "reserved"}


def test_a_guard_page_is_reserved_not_part_of_the_library():
    """The ---p hole between text and data is not library memory."""
    rows = svc.parse_maps(MAPS)
    lib = [r for r in rows if r["kind"] == "library"]
    reserved = [r for r in rows if r["kind"] == "reserved"]
    assert len(lib) == 2
    assert reserved and all(r["path"] and "libgpg-error" in r["path"] for r in reserved)


def test_a_thread_stack_keeps_its_tid():
    stacks = [r for r in svc.parse_maps(MAPS) if r["kind"] == "stack"]
    assert {r["tid"] for r in stacks} == {4242, None}


def test_a_process_that_is_gone_is_reported_as_gone(tmp_path, monkeypatch):
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    assert svc.describe(9).get("error") == "no such process"


def test_the_map_is_grouped_and_the_totals_come_from_the_rollup(tmp_path, monkeypatch):
    proc = tmp_path / "100"
    proc.mkdir()
    (proc / "comm").write_text("systemd\n")
    (proc / "status").write_text(STATUS)
    (proc / "maps").write_text(MAPS)
    (proc / "smaps_rollup").write_text(ROLLUP)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))

    out = svc.describe(100)

    assert out["comm"] == "systemd"
    assert out["totals"]["rss_kb"] == 6584
    assert out["totals"]["pss_kb"] == 3485
    assert out["totals"]["private_kb"] == 3020
    assert out["executable"]["name"] == "systemd"
    assert out["heap_kb"] == (0xaaaaeea89000 - 0xaaaaee903000) // 1024
    assert out["stack_count"] == 2
    assert [s["tid"] for s in out["stacks"]] == [100, 4242]
    assert out["libraries"][0]["name"] == "libgpg-error.so.0.32.1"
    assert "path" not in out["libraries"][0]
    assert "path" not in (out["executable"] or {})
    assert "start" not in json.dumps(out)
    assert out["sources"]["maps"]["available"] is True
    assert out["sources"]["rollup"]["available"] is True


def test_without_the_map_the_totals_still_come_from_status(tmp_path, monkeypatch):
    """pid 1 often refuses maps; status is still there and is not guessed from."""
    proc = tmp_path / "1"
    proc.mkdir()
    (proc / "comm").write_text("systemd\n")
    (proc / "status").write_text(STATUS)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    monkeypatch.setattr(svc, "SNAPSHOT", str(tmp_path / "no-such-maps.json"))

    out = svc.describe(1)

    assert out["kinds"] == []
    assert out["libraries"] == []
    assert out["totals"]["rss_kb"] == 8156
    assert out["totals"]["virtual_kb"] == 167648
    assert out["totals"]["exe_kb"] == 1436
    assert out["sources"]["maps"]["available"] is False
    assert out["sources"]["status"]["available"] is True


def test_a_shared_object_is_not_called_the_executable():
    text = (
        "7f00-7f10 r-xp 00000000 fd:00 1 /usr/lib/libc.so.6\n"
        "4000-4010 r-xp 00000000 fd:00 2 /usr/bin/sleep\n"
    )
    rows = svc.parse_maps(text)
    assert [r["kind"] for r in rows] == ["library", "code"]


def test_a_collected_snapshot_has_no_addresses_or_directory_paths(tmp_path, monkeypatch):
    """The world-readable file must not slide ASLR or name a home directory."""
    proc = tmp_path / "100"
    proc.mkdir()
    (proc / "comm").write_text("systemd\n")
    (proc / "status").write_text(STATUS)
    (proc / "maps").write_text(MAPS)
    (proc / "smaps_rollup").write_text(ROLLUP)
    monkeypatch.setattr(svc, "PROC", str(tmp_path))

    out = svc.collect_all()
    blob = json.dumps(out)

    assert "100" in out["processes"]
    assert out["processes"]["100"]["libraries"][0]["name"] == "libgpg-error.so.0.32.1"
    assert "aaaadc8b" not in blob
    assert "ffffa2ea" not in blob
    assert "/usr/lib" not in blob
    assert "/home/" not in blob
    assert "start" not in blob
    assert "end" not in blob


def test_a_foreign_process_uses_the_collector_snapshot(tmp_path, monkeypatch):
    """When the kernel refuses the map, a fresh snapshot still draws the card."""
    proc = tmp_path / "1"
    proc.mkdir()
    (proc / "comm").write_text("systemd\n")
    (proc / "status").write_text(STATUS)
    snap = tmp_path / "maps.json"
    snap.write_text(json.dumps({
        "ts": time.time(),
        "processes": {
            "1": {
                "comm": "systemd",
                "totals": {"virtual_kb": 9000, "rss_kb": 100, "pss_kb": 80},
                "kinds": [{"kind": "library", "virtual_kb": 500, "count": 2}],
                "libraries": [{"name": "libc.so.6", "virtual_kb": 400, "count": 2}],
                "library_count": 1,
                "stacks": [{"tid": 1, "virtual_kb": 132, "main": True}],
                "stack_count": 1,
                "executable": {"name": "systemd", "virtual_kb": 200},
                "heap_kb": 300,
            }
        },
    }))
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    monkeypatch.setattr(svc, "SNAPSHOT", str(snap))

    out = svc.describe(1)

    assert out["sources"]["maps"]["available"] is True
    assert out["sources"]["maps"]["via"] == "collector"
    assert out["libraries"][0]["name"] == "libc.so.6"
    assert "path" not in out["libraries"][0]
    assert out["totals"]["rss_kb"] == 8156
    assert out["totals"]["pss_kb"] == 80
    assert out["heap_kb"] == 300
    assert "start" not in json.dumps(out)


def test_a_stale_snapshot_is_not_used(tmp_path, monkeypatch):
    proc = tmp_path / "1"
    proc.mkdir()
    (proc / "comm").write_text("systemd\n")
    (proc / "status").write_text(STATUS)
    snap = tmp_path / "maps.json"
    snap.write_text(json.dumps({
        "ts": 0,
        "processes": {"1": {"kinds": [{"kind": "library", "virtual_kb": 1, "count": 1}]}},
    }))
    past = time.time() - 60
    os.utime(snap, (past, past))
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    monkeypatch.setattr(svc, "SNAPSHOT", str(snap))

    out = svc.describe(1)

    assert out["kinds"] == []
    assert out["sources"]["maps"]["available"] is False


def test_a_thread_uses_the_process_snapshot(tmp_path, monkeypatch):
    """The dossier pid is sometimes a tid; the map belongs to the thread-group."""
    proc = tmp_path / "4242"
    proc.mkdir()
    (proc / "comm").write_text("python\n")
    (proc / "status").write_text(STATUS + "Tgid:\t100\n")
    snap = tmp_path / "maps.json"
    snap.write_text(json.dumps({
        "ts": time.time(),
        "processes": {
            "100": {
                "comm": "python",
                "totals": {"virtual_kb": 9000, "rss_kb": 100},
                "kinds": [{"kind": "library", "virtual_kb": 500, "count": 1}],
                "libraries": [{"name": "libc.so.6", "virtual_kb": 400, "count": 1}],
                "library_count": 1,
                "stacks": [],
                "stack_count": 0,
                "executable": {"name": "python3.10", "virtual_kb": 200},
                "heap_kb": 300,
            }
        },
        "threads": {"4242": "100"},
    }))
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    monkeypatch.setattr(svc, "SNAPSHOT", str(snap))

    out = svc.describe(4242)

    assert out["sources"]["maps"]["via"] == "collector"
    assert out["libraries"][0]["name"] == "libc.so.6"
    assert out["executable"]["name"] == "python3.10"


def test_an_empty_maps_file_still_uses_the_snapshot(tmp_path, monkeypatch):
    """An open that yields no areas is not a map — fall through to the collector."""
    proc = tmp_path / "1"
    proc.mkdir()
    (proc / "comm").write_text("systemd\n")
    (proc / "status").write_text(STATUS)
    (proc / "maps").write_text("")
    snap = tmp_path / "maps.json"
    snap.write_text(json.dumps({
        "ts": time.time(),
        "processes": {
            "1": {
                "comm": "systemd",
                "totals": {"virtual_kb": 9000, "rss_kb": 100},
                "kinds": [{"kind": "library", "virtual_kb": 500, "count": 1}],
                "libraries": [{"name": "libc.so.6", "virtual_kb": 400, "count": 1}],
                "library_count": 1,
                "stacks": [],
                "stack_count": 0,
                "executable": {"name": "systemd", "virtual_kb": 200},
                "heap_kb": None,
            }
        },
    }))
    monkeypatch.setattr(svc, "PROC", str(tmp_path))
    monkeypatch.setattr(svc, "SNAPSHOT", str(snap))

    out = svc.describe(1)

    assert out["sources"]["maps"]["via"] == "collector"
    assert out["kinds"][0]["kind"] == "library"


def test_collect_all_keeps_the_last_map_when_it_goes_empty(tmp_path, monkeypatch):
    proc = tmp_path / "1"
    proc.mkdir()
    (proc / "comm").write_text("python\n")
    (proc / "status").write_text(STATUS)
    (proc / "maps").write_text("")
    monkeypatch.setattr(svc, "PROC", str(tmp_path))

    previous = {"1": {
        "comm": "python",
        "totals": {"virtual_kb": 9000, "rss_kb": 221184},
        "kinds": [{"kind": "library", "virtual_kb": 500, "count": 1}],
        "libraries": [{"name": "libc.so.6", "virtual_kb": 400, "count": 1}],
        "library_count": 1,
        "stacks": [],
        "stack_count": 0,
        "executable": {"name": "python3.10", "virtual_kb": 200},
        "heap_kb": 300,
    }}
    out = svc.collect_all(previous=previous)
    assert out["processes"]["1"]["executable"]["name"] == "python3.10"
