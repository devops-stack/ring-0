"""Stage 5 detectors: per-comm EWMA baselines + parent→child lineage whitelist."""

from __future__ import annotations

from dataclasses import dataclass, field

from kernel_ai.ml.baseline import EwmaBaseline
from kernel_ai.ml.proc_features import PROC_MIN_STD, PROC_POSITION, PROC_SUBSYSTEM, ProcSample


@dataclass
class LineageWhitelist:
    """Frequency table of normal parent_comm → child_comm pairs.

    A pair becomes "normal" only after ``min_count`` observations (STIDE-style
    poison guard: a one-off attack edge never enters the whitelist).
    """

    min_count: int = 3
    min_age_sec: float = 2.0
    max_alert_age_sec: float = 120.0
    _counts: dict[tuple[str, str], int] = field(default_factory=dict)
    _pending: dict[tuple[str, str], int] = field(default_factory=dict)

    def observe(self, parent: str, child: str) -> int:
        """Increment and return the new count for this edge."""
        key = (parent or "?", child or "?")
        self._counts[key] = self._counts.get(key, 0) + 1
        self._pending[key] = self._pending.get(key, 0) + 1
        return self._counts[key]

    def is_below_threshold(self, parent: str, child: str) -> bool:
        key = (parent or "?", child or "?")
        return self._counts.get(key, 0) < self.min_count

    def drain_pending(self) -> list[tuple[str, str, int]]:
        pending = self._pending
        self._pending = {}
        return [(p, c, n) for (p, c), n in pending.items()]

    def load_counts(self, rows: list[tuple[str, str, int]]) -> None:
        for parent, child, count in rows or []:
            key = (str(parent), str(child))
            self._counts[key] = max(self._counts.get(key, 0), int(count))


class ProcBaselineDetector:
    """Score process samples → Stage 5 anomaly records."""

    def __init__(
        self,
        *,
        alpha: float,
        warmup_samples: int,
        z_warn: float,
        z_crit: float,
        lineage_min_count: int = 3,
        cooldown_sec: float = 20.0,
        max_emit_per_tick: int = 4,
    ) -> None:
        self.z_warn = z_warn
        self.z_crit = z_crit
        self.cooldown_sec = cooldown_sec
        self.max_emit = max_emit_per_tick
        self.baseline = EwmaBaseline(alpha=alpha, warmup_samples=warmup_samples)
        self.lineage = LineageWhitelist(min_count=lineage_min_count)
        self._last_emit: dict[str, float] = {}
        self._seen_pids: set[int] = set()

    def _cooldown_ok(self, key: str, now: float) -> bool:
        last = self._last_emit.get(key, 0.0)
        if (now - last) < self.cooldown_sec:
            return False
        self._last_emit[key] = now
        return True

    def _meta(self, sample: ProcSample, kind: str) -> dict:
        return {
            "stage": 5,
            "kind": kind,
            "pid": sample.pid,
            "ppid": sample.ppid,
            "comm": sample.comm,
            "parent_comm": sample.parent_comm,
            "ruid": sample.ruid,
            "euid": sample.euid,
        }

    def score(self, samples: list[ProcSample], *, now: float) -> list[dict]:
        out: list[dict] = []
        if not samples:
            return out

        # --- lineage (observe each pid once, after it is old enough to score) ---
        if len(self._seen_pids) > 20000:
            self._seen_pids.clear()
        for sample in samples:
            if sample.pid in self._seen_pids:
                continue
            if sample.age_sec < self.lineage.min_age_sec:
                continue  # wait until the child settles; don't mark seen yet
            self._seen_pids.add(sample.pid)
            count = self.lineage.observe(sample.parent_comm, sample.comm)
            if sample.age_sec > self.lineage.max_alert_age_sec:
                continue  # learn long-lived edges silently
            if count >= self.lineage.min_count:
                continue
            # Prefer the more specific privesc signal when both apply.
            if sample.euid == 0 and sample.ruid != 0:
                continue
            ckey = f"lineage:{sample.parent_comm}->{sample.comm}"
            if not self._cooldown_ok(ckey, now):
                continue
            out.append(
                {
                    "source": "stage5_process",
                    "feature": f"lineage:{sample.parent_comm}->{sample.comm}",
                    "subsystem": PROC_SUBSYSTEM,
                    "type": f"lineage:{sample.parent_comm}->{sample.comm}",
                    "severity": "high" if sample.euid == 0 or sample.age_sec < 15 else "medium",
                    "score": float(count),
                    "value": float(sample.age_sec),
                    "baseline_mean": None,
                    "baseline_std": None,
                    "position": PROC_POSITION,
                    "message": (
                        f"Unusual process lineage: {sample.parent_comm} → {sample.comm} "
                        f"(pid={sample.pid}, age={sample.age_sec:.1f}s, seen={count})"
                    ),
                    "meta": self._meta(sample, "lineage"),
                }
            )
            if len(out) >= self.max_emit:
                return out

        # --- euid root / ruid non-root ---
        for sample in samples:
            if not (sample.euid == 0 and sample.ruid != 0):
                continue
            ckey = f"privesc:{sample.comm}"
            if not self._cooldown_ok(ckey, now):
                continue
            out.append(
                {
                    "source": "stage5_process",
                    "feature": f"privesc:{sample.comm}",
                    "subsystem": PROC_SUBSYSTEM,
                    "type": "proc_anomaly:euid_root",
                    "severity": "high",
                    "score": 1.0,
                    "value": float(sample.euid),
                    "baseline_mean": float(sample.ruid),
                    "baseline_std": None,
                    "position": PROC_POSITION,
                    "message": (
                        f"Privilege anomaly: {sample.comm} pid={sample.pid} "
                        f"euid=0 ruid={sample.ruid}"
                    ),
                    "meta": self._meta(sample, "privesc"),
                }
            )
            if len(out) >= self.max_emit:
                return out

        # --- per-comm EWMA (fd / threads / rss) ---
        vectors: dict[str, float] = {}
        owners: dict[str, ProcSample] = {}
        min_std: dict[str, float] = {}
        for sample in samples:
            for feat, value in sample.score_vector().items():
                key = f"{sample.comm}::{feat}"
                vectors[key] = value
                owners[key] = sample
                min_std[key] = PROC_MIN_STD.get(feat, 1.0)

        scores = self.baseline.update_and_score(vectors, min_std)
        ranked = sorted(scores.values(), key=lambda s: s.z, reverse=True)
        for sc in ranked:
            if sc.warm or sc.z < self.z_warn or sc.value <= sc.mean:
                continue
            sample = owners.get(sc.name)
            if sample is None:
                continue
            feat = sc.name.split("::", 1)[-1]
            ckey = f"proc:{sample.comm}:{feat}"
            if not self._cooldown_ok(ckey, now):
                continue
            severity = "high" if sc.z >= self.z_crit else "medium"
            out.append(
                {
                    "source": "stage5_process",
                    "feature": f"proc:{sample.comm}:{feat}",
                    "subsystem": PROC_SUBSYSTEM,
                    "type": f"proc_anomaly:{feat}",
                    "severity": severity,
                    "score": round(sc.z, 3),
                    "value": round(sc.value, 3),
                    "baseline_mean": round(sc.mean, 3),
                    "baseline_std": round(sc.std, 3),
                    "position": PROC_POSITION,
                    "message": (
                        f"Process {feat} spike: {sample.comm} pid={sample.pid} "
                        f"{sc.value:.1f} vs baseline {sc.mean:.1f}±{sc.std:.1f} (z={sc.z:.1f})"
                    ),
                    "meta": {**self._meta(sample, "baseline"), "feature": feat, "z": round(sc.z, 3)},
                }
            )
            if len(out) >= self.max_emit:
                break
        return out
