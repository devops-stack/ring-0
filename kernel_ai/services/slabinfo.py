"""Machine-wide SLUB cache counters from the privileged snapshot.

The snapshot contains cumulative cache occupancy, not object ownership and not
the contents of individual slabs.  This service keeps those limits explicit
while selecting a small, useful set for the central-page card.
"""

from __future__ import annotations

import json
import os
import time


SLABINFO_SNAPSHOT = os.environ.get("SLABINFO_OUT", "/run/kernel-ai/slabinfo.json")
SNAPSHOT_MAX_AGE_S = 30.0
MAX_CACHES = 12


def _snapshot(path=None, max_age_s=None):
    snapshot = path or SLABINFO_SNAPSHOT
    allowed_age = SNAPSHOT_MAX_AGE_S if max_age_s is None else max_age_s
    try:
        age = max(0.0, time.time() - os.path.getmtime(snapshot))
    except OSError:
        return None, {"available": False, "reason": "no-collector"}
    if age > allowed_age:
        return None, {"available": False, "reason": "stale", "age_s": round(age, 1)}
    try:
        with open(snapshot, "r", encoding="utf-8", errors="replace") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return None, {"available": False, "reason": "unreadable"}
    if not isinstance(data, dict) or not isinstance(data.get("caches"), list):
        return None, {"available": False, "reason": "malformed"}
    return data, {"available": True, "age_s": round(age, 1)}


def describe(limit=MAX_CACHES):
    data, source = _snapshot()
    if data is None:
        return {
            "source": source,
            "page_size": None,
            "cache_count": 0,
            "hidden": 0,
            "totals": {"active_bytes": 0, "reserved_bytes": 0},
            "caches": [],
        }

    caches = [row for row in data["caches"] if isinstance(row, dict)]
    caches.sort(key=lambda row: int(row.get("reserved_bytes") or 0), reverse=True)
    selected = caches[:max(1, min(int(limit), MAX_CACHES))]
    totals = {
        "active_bytes": sum(max(0, int(row.get("active_bytes") or 0)) for row in caches),
        "reserved_bytes": sum(max(0, int(row.get("reserved_bytes") or 0)) for row in caches),
        "active_objs": sum(max(0, int(row.get("active_objs") or 0)) for row in caches),
        "num_objs": sum(max(0, int(row.get("num_objs") or 0)) for row in caches),
    }
    return {
        "source": source,
        "page_size": data.get("page_size"),
        "cache_count": len(caches),
        "hidden": max(0, len(caches) - len(selected)),
        "totals": totals,
        "caches": selected,
    }
