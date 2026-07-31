"""Minimal Sigma-lite matcher (JSON rules, no PyYAML dependency).

Full Sigma is Stage 7 aspirational; this covers a few high-precision patterns
we can express from ML anomaly records + Stage 5 meta (comm/lineage).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger("kernel_ai.ml.attribution.sigma")

_RULES_DIR = Path(__file__).resolve().parents[1] / "rules" / "sigma"


def load_rules(directory: Path | None = None) -> list[dict]:
    root = directory or _RULES_DIR
    rules: list[dict] = []
    if not root.is_dir():
        return rules
    for path in sorted(root.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("skip sigma rule %s: %s", path.name, exc)
            continue
        if isinstance(data, dict):
            data.setdefault("id", path.stem)
            rules.append(data)
        elif isinstance(data, list):
            for i, item in enumerate(data):
                if isinstance(item, dict):
                    item.setdefault("id", f"{path.stem}_{i}")
                    rules.append(item)
    return rules


def match_anomaly(anomaly: dict, rules: list[dict] | None = None) -> dict | None:
    """Return attack dict from the first matching rule, else None."""
    rules = rules if rules is not None else load_rules()
    meta = anomaly.get("meta") or {}
    hay = {
        "source": str(anomaly.get("source") or ""),
        "feature": str(anomaly.get("feature") or ""),
        "type": str(anomaly.get("type") or ""),
        "message": str(anomaly.get("message") or ""),
        "comm": str(meta.get("comm") or ""),
        "parent_comm": str(meta.get("parent_comm") or ""),
        "kind": str(meta.get("kind") or ""),
    }
    edge = f"{hay['parent_comm']}->{hay['comm']}".lower()

    for rule in rules:
        when = rule.get("when") or {}
        ok = True
        for key, expected in when.items():
            if key == "child_in":
                ok = hay["comm"].lower() in {str(x).lower() for x in expected}
            elif key == "parent_in":
                ok = hay["parent_comm"].lower() in {str(x).lower() for x in expected}
            elif key == "edge_contains":
                ok = any(str(x).lower() in edge for x in expected)
            elif key == "feature_contains":
                ok = any(str(x).lower() in hay["feature"].lower() for x in expected)
            elif key == "source_in":
                ok = hay["source"] in set(expected)
            elif key == "kind_in":
                ok = hay["kind"] in set(expected)
            else:
                ok = True
            if not ok:
                break
        if not ok:
            continue
        attack = rule.get("attack") or {}
        return {
            "family": attack.get("family", "unknown"),
            "mitre": attack.get("mitre"),
            "name": attack.get("name") or rule.get("title") or rule.get("id"),
            "label_confidence": float(attack.get("confidence", 0.85)),
            "cve": list(attack.get("cve") or []),
            "source": "sigma",
            "color": attack.get("color", "#e8a54b"),
            "why": rule.get("description") or rule.get("title") or rule.get("id"),
            "rule_id": rule.get("id"),
        }
    return None
