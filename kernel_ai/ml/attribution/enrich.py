"""Enrich ML anomaly records with Stage 7 ``attack`` attribution."""

from __future__ import annotations

import logging

from kernel_ai.ml.attribution import classifier
from kernel_ai.ml.attribution.attack_map import map_anomaly
from kernel_ai.ml.attribution.sigma_engine import load_rules, match_anomaly

logger = logging.getLogger("kernel_ai.ml.attribution")

# Below this confidence we keep the anomaly but mark family as unknown-ish
# by omitting attack (UI stays uncolored). Tunable via enrich() arg.
_DEFAULT_MIN_CONF = 0.35


def enrich_anomaly(
    anomaly: dict,
    *,
    rules: list[dict] | None = None,
    min_confidence: float = _DEFAULT_MIN_CONF,
) -> dict:
    """Attach ``attack`` + mirror into ``meta.attack`` (back-compat for DNA)."""
    if not isinstance(anomaly, dict):
        return anomaly
    if anomaly.get("attack"):
        return anomaly

    # Precedence: Sigma-lite (high precision) > heuristic map > ML classifier stub.
    attack = match_anomaly(anomaly, rules=rules)
    if attack is None:
        attack = map_anomaly(anomaly)
    if attack is None:
        attack = classifier.predict_attack(anomaly)
    if attack is None:
        return anomaly
    if float(attack.get("label_confidence") or 0.0) < min_confidence:
        return anomaly

    anomaly = dict(anomaly)
    anomaly["attack"] = attack
    meta = dict(anomaly.get("meta") or {})
    meta["attack"] = attack
    anomaly["meta"] = meta
    # Optional: prefix message once for operators curling the API.
    mitre = attack.get("mitre")
    if mitre and mitre not in str(anomaly.get("message") or ""):
        anomaly["message"] = f"[{mitre}] {anomaly.get('message') or ''}".strip()
    return anomaly


def enrich_anomalies(anomalies: list[dict], *, min_confidence: float = _DEFAULT_MIN_CONF) -> list[dict]:
    if not anomalies:
        return []
    try:
        rules = load_rules()
    except Exception as exc:  # noqa: BLE001
        logger.warning("sigma rules load failed: %s", exc)
        rules = []
    return [enrich_anomaly(a, rules=rules, min_confidence=min_confidence) for a in anomalies]
