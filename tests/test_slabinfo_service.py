"""Tests for the privileged SLUB sampler and unprivileged snapshot reader."""

import importlib.util
import json
import os
import time

from kernel_ai.services import slabinfo as service


_COLLECTOR_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "deploy", "ebpf", "slabinfo_collector.py",
)
_spec = importlib.util.spec_from_file_location("slabinfo_collector", _COLLECTOR_PATH)
collector = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(collector)


SLABINFO = """slabinfo - version: 2.1
# name <active_objs> <num_objs> <objsize> <objperslab> <pagesperslab> : tunables <limit> <batchcount> <sharedfactor> : slabdata <active_slabs> <num_slabs> <sharedavail>
dentry 80 100 192 21 1 : tunables 0 0 0 : slabdata 4 5 0
inode_cache 10 20 640 25 4 : tunables 0 0 0 : slabdata 1 1 0
broken row
"""


def test_collector_parses_observed_cache_geometry():
    rows = collector.parse(SLABINFO)

    assert [row["name"] for row in rows] == ["dentry", "inode_cache"]
    assert rows[0]["occupancy"] == 0.8
    assert rows[0]["active_bytes"] == 80 * 192
    assert rows[0]["reserved_bytes"] == 5 * collector.PAGE_SIZE
    assert rows[1]["pages_per_slab"] == 4


def test_service_sorts_caches_by_reserved_pages(tmp_path, monkeypatch):
    caches = collector.parse(SLABINFO)
    snapshot = tmp_path / "slabinfo.json"
    snapshot.write_text(json.dumps({
        "ts": time.time(),
        "page_size": collector.PAGE_SIZE,
        "cache_count": len(caches),
        "caches": caches,
    }))
    monkeypatch.setattr(service, "SLABINFO_SNAPSHOT", str(snapshot))

    out = service.describe()

    assert out["source"]["available"] is True
    assert [row["name"] for row in out["caches"]] == ["dentry", "inode_cache"]
    assert out["totals"]["active_objs"] == 90
    assert out["totals"]["reserved_bytes"] == 9 * collector.PAGE_SIZE


def test_service_distinguishes_missing_collector_from_empty_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "SLABINFO_SNAPSHOT", str(tmp_path / "missing.json"))

    out = service.describe()

    assert out["source"] == {"available": False, "reason": "no-collector"}
    assert out["caches"] == []


def test_service_refuses_a_stale_snapshot(tmp_path, monkeypatch):
    snapshot = tmp_path / "slabinfo.json"
    snapshot.write_text(json.dumps({"caches": []}))
    os.utime(snapshot, (0, 0))
    monkeypatch.setattr(service, "SLABINFO_SNAPSHOT", str(snapshot))

    out = service.describe()

    assert out["source"]["available"] is False
    assert out["source"]["reason"] == "stale"
