"""Placeholder for a future supervised ATT&CK classifier (GB / sklearn).

v1 Stage 7 uses heuristics + Sigma-lite only. This module exists so the
roadmap file layout stays stable when polygon-labeled training lands.
"""

from __future__ import annotations


def predict_attack(_anomaly: dict) -> dict | None:
    """Return attack dict or None. Untrained stub always returns None."""
    return None
