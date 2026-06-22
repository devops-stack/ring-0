"""Stage 1 detector: online EWMA baseline + robust z-score.

For every feature we keep a slowly-adapting estimate of its *normal* value
(EWMA mean) and its *normal* spread (EWMA variance, West's incremental form).
A live value far above the baseline (high positive z-score) is what we treat as
an attack-shaped mutation: a sudden burst of processes, syscalls, retransmits,
page faults, IRQs, etc.

Pure Python on purpose — O(1) memory per feature, no numpy/sklearn — so it runs
comfortably inside a tight memory budget. Heavier models arrive at Stage 2.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class _Stat:
    mean: float = 0.0
    var: float = 0.0
    count: int = 0


@dataclass(frozen=True)
class Score:
    name: str
    value: float
    mean: float
    std: float
    z: float
    warm: bool


class EwmaBaseline:
    """Per-feature exponentially-weighted mean/variance with z-score scoring."""

    def __init__(self, alpha: float, warmup_samples: int) -> None:
        self.alpha = alpha
        self.warmup = warmup_samples
        self._stats: dict[str, _Stat] = {}

    def _update(self, st: _Stat, x: float) -> None:
        if st.count == 0:
            st.mean = x
            st.var = 0.0
        else:
            diff = x - st.mean
            incr = self.alpha * diff
            st.mean += incr
            # West's incremental EWMA variance.
            st.var = (1.0 - self.alpha) * (st.var + diff * incr)
        st.count += 1

    def update_and_score(self, features: dict[str, float], min_std: dict[str, float]) -> dict[str, Score]:
        """Score the current values against the baseline, *then* fold them in.

        Scoring before updating means a real spike is measured against the
        pre-spike baseline (it hasn't yet been absorbed), which is what we want.
        """
        scores: dict[str, Score] = {}
        for name, value in features.items():
            st = self._stats.setdefault(name, _Stat())
            warm = st.count < self.warmup
            std = math.sqrt(max(0.0, st.var))
            floor = max(min_std.get(name, 0.0), 1e-9)
            std_eff = max(std, floor)
            z = (value - st.mean) / std_eff if st.count > 0 else 0.0
            scores[name] = Score(name=name, value=value, mean=st.mean, std=std, z=z, warm=warm)
            self._update(st, value)
        return scores

    # --- warm-restart support: snapshot / restore baseline across restarts ---

    def export_state(self) -> list[dict]:
        return [
            {"name": n, "mean": s.mean, "var": s.var, "count": s.count}
            for n, s in self._stats.items()
        ]

    def load_state(self, rows: list[dict]) -> None:
        for row in rows or []:
            try:
                self._stats[row["name"]] = _Stat(
                    mean=float(row["mean"]),
                    var=float(row["var"]),
                    count=int(row["count"]),
                )
            except (KeyError, TypeError, ValueError):
                continue
