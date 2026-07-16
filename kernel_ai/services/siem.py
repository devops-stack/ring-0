"""Read-only bridge to the Elastic SIEM on the sibling server.

The app server only *ships* logs to Elastic (Filebeat push). This module adds a
strictly read-only reverse channel: it queries the security detection alerts
index and normalizes matches into a compact shape the frontend can render as
"attack anomalies" on Kernel DNA.

Design notes:
  * No new PyPI dependency: uses urllib + ssl from the stdlib.
  * Credentials/endpoint come from /etc/kernel-ai/elastic.env (API key scoped
    read-only to .alerts-security.alerts-*). Falls back to os.environ.
  * Short TTL cache so repeated page polls don't hammer Elastic.
  * Fails soft: on any error returns {"available": False, ...} instead of
    raising, so the visualization degrades gracefully.
"""

from __future__ import annotations

import json
import os
import ssl
import threading
import time
import urllib.request
from datetime import datetime, timezone

_ENV_PATH = "/etc/kernel-ai/elastic.env"
_CACHE_TTL_SEC = 45.0

_cache_lock = threading.Lock()
_cache: dict = {}  # key -> (expires_at, payload)
_config_cache: dict | None = None

# MITRE ATT&CK tactic -> position along the helix (0..1), so scars cluster by
# attack stage. Unknown tactics fall back to a stable hash spread.
_TACTIC_POSITION = {
    "reconnaissance": 0.06,
    "resource development": 0.14,
    "initial access": 0.30,
    "execution": 0.46,
    "persistence": 0.58,
    "privilege escalation": 0.66,
    "defense evasion": 0.72,
    "credential access": 0.80,
    "discovery": 0.20,
    "lateral movement": 0.86,
    "collection": 0.90,
    "command and control": 0.94,
    "exfiltration": 0.97,
    "impact": 0.99,
}


def _load_config() -> dict:
    """Read Elastic connection settings from the env file + environment."""
    global _config_cache
    if _config_cache is not None:
        return _config_cache

    cfg: dict = {}
    try:
        with open(_ENV_PATH, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                cfg[key.strip()] = val.strip().strip('"').strip("'")
    except OSError:
        pass

    def _get(name: str, default: str = "") -> str:
        return os.environ.get(name, cfg.get(name, default))

    resolved = {
        "url": _get("KERNEL_AI_ES_URL").rstrip("/"),
        "api_key": _get("KERNEL_AI_ES_API_KEY"),
        "ca": _get("KERNEL_AI_ES_CA"),
        "index": _get("KERNEL_AI_ES_ALERTS_INDEX", ".alerts-security.alerts-*"),
        "tag": _get("KERNEL_AI_ES_TAG", "kernel-ai"),
    }
    _config_cache = resolved
    return resolved


def _ssl_context(ca_path: str) -> ssl.SSLContext:
    if ca_path and os.path.exists(ca_path):
        return ssl.create_default_context(cafile=ca_path)
    # No CA on disk: fall back to system trust (still verified).
    return ssl.create_default_context()


def _es_search(cfg: dict, body: dict, timeout: float = 6.0) -> dict:
    url = f"{cfg['url']}/{cfg['index']}/_search"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"ApiKey {cfg['api_key']}")
    ctx = _ssl_context(cfg["ca"])
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _flat(src: dict, key: str):
    """Alert docs store dotted keys flat (e.g. 'kibana.alert.severity')."""
    return src.get(key)


def _extract_mitre(src: dict) -> dict:
    threat = _flat(src, "kibana.alert.rule.threat")
    tactic_name = tactic_id = tech_id = tech_name = None
    if isinstance(threat, list) and threat:
        first = threat[0] or {}
        tactic = first.get("tactic") or {}
        tactic_name = tactic.get("name")
        tactic_id = tactic.get("id")
        techs = first.get("technique") or []
        if techs:
            tech_id = (techs[0] or {}).get("id")
            tech_name = (techs[0] or {}).get("name")
    return {
        "tactic": tactic_name,
        "tactic_id": tactic_id,
        "technique": tech_id,
        "technique_name": tech_name,
    }


def _position_for(mitre: dict, rule: str, ip: str) -> float:
    tactic = (mitre.get("tactic") or "").strip().lower()
    if tactic in _TACTIC_POSITION:
        return _TACTIC_POSITION[tactic]
    # Stable spread for anything unmapped.
    seed = f"{rule}|{ip}"
    h = 0
    for ch in seed:
        h = (h * 131 + ord(ch)) & 0xFFFFFFFF
    return round((h % 1000) / 1000.0, 3)


def _severity_norm(sev) -> str:
    s = str(sev or "").lower()
    if s in ("critical", "high", "medium", "low"):
        return s
    return "medium"


def _normalize_hit(hit: dict) -> dict:
    src = hit.get("_source", {}) or {}
    mitre = _extract_mitre(src)
    rule = _flat(src, "kibana.alert.rule.name") or "web attack"
    ip = _flat(src, "source.ip") or ""
    sev = _severity_norm(_flat(src, "kibana.alert.severity"))
    query = _flat(src, "url.query")
    if isinstance(query, str) and len(query) > 140:
        query = query[:139] + "\u2026"
    return {
        "id": hit.get("_id"),
        "time": _flat(src, "@timestamp"),
        "rule": rule,
        "severity": sev,
        "risk": _flat(src, "kibana.alert.risk_score"),
        "source_ip": ip,
        "url_path": _flat(src, "url.path"),
        "url_query": query,
        "method": _flat(src, "http.request.method"),
        "status": _flat(src, "http.response.status_code"),
        "dataset": _flat(src, "event.dataset"),
        "tactic": mitre["tactic"],
        "tactic_id": mitre["tactic_id"],
        "technique": mitre["technique"],
        "technique_name": mitre["technique_name"],
        "position": _position_for(mitre, rule, ip),
    }


def _empty(hours: int, reason: str = "") -> dict:
    return {
        "available": False,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "window_hours": hours,
        "total": 0,
        "count": 0,
        "by_severity": {},
        "by_tactic": {},
        "alerts": [],
        "reason": reason,
    }


def get_siem_alerts(hours: int = 24, limit: int = 120) -> dict:
    """Return recent SIEM detection alerts, normalized and cached.

    Fails soft: returns available=False on any misconfiguration or error.
    """
    hours = max(1, min(int(hours), 24 * 30))
    limit = max(1, min(int(limit), 500))
    cache_key = (hours, limit)

    now = time.monotonic()
    with _cache_lock:
        entry = _cache.get(cache_key)
        if entry and entry[0] > now:
            return entry[1]

    cfg = _load_config()
    if not cfg["url"] or not cfg["api_key"]:
        return _empty(hours, "elastic not configured")

    body = {
        "size": limit,
        "track_total_hits": True,
        "sort": [{"@timestamp": {"order": "desc"}}],
        "query": {
            "bool": {
                "filter": [
                    {"range": {"@timestamp": {"gte": f"now-{hours}h"}}},
                    {"term": {"kibana.alert.rule.tags": cfg["tag"]}},
                ]
            }
        },
        "_source": [
            "@timestamp",
            "kibana.alert.rule.name",
            "kibana.alert.severity",
            "kibana.alert.risk_score",
            "kibana.alert.rule.threat",
            "source.ip",
            "url.path",
            "url.query",
            "http.request.method",
            "http.response.status_code",
            "event.dataset",
        ],
    }

    try:
        res = _es_search(cfg, body)
    except Exception as exc:  # noqa: BLE001 - fail soft, never break the page
        return _empty(hours, f"query failed: {type(exc).__name__}")

    hits = (res.get("hits", {}) or {}).get("hits", []) or []
    total_obj = (res.get("hits", {}) or {}).get("total", {}) or {}
    total = total_obj.get("value", len(hits)) if isinstance(total_obj, dict) else len(hits)

    alerts = [_normalize_hit(h) for h in hits]

    by_sev: dict = {}
    by_tactic: dict = {}
    for a in alerts:
        by_sev[a["severity"]] = by_sev.get(a["severity"], 0) + 1
        t = a["tactic"] or "unmapped"
        by_tactic[t] = by_tactic.get(t, 0) + 1

    payload = {
        "available": True,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "window_hours": hours,
        "total": total,
        "count": len(alerts),
        "by_severity": by_sev,
        "by_tactic": by_tactic,
        "alerts": alerts,
    }

    with _cache_lock:
        _cache[cache_key] = (now + _CACHE_TTL_SEC, payload)
    return payload
