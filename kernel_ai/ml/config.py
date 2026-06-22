"""Configuration for the ML anomaly pipeline.

Everything is driven by environment variables so the same code runs locally
(local Postgres) and on PROD (managed Postgres) by only swapping the DSN.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class MLConfig:
    """Resolved ML pipeline settings (read once at process start)."""

    # Postgres connection string. On deploy, override with the PROD value.
    # Example: postgresql://user:pass@host:5432/dbname
    dsn: str = os.getenv(
        "KERNEL_AI_ML_DSN",
        "postgresql://kernel_ai:kernel_ai_dev_pw@127.0.0.1:5432/kernel_ai_ml",
    )

    # Sampling cadence of the detector loop (seconds between feature snapshots).
    interval_sec: float = _env_float("KERNEL_AI_ML_INTERVAL_SEC", 2.0)

    # EWMA smoothing: alpha = 2 / (window + 1). Larger window = slower, calmer
    # baseline. ~60 gives a baseline that adapts over a couple of minutes.
    baseline_window: int = _env_int("KERNEL_AI_ML_BASELINE_WINDOW", 60)

    # Samples to observe before we start emitting anomalies (let the baseline
    # settle so we don't fire on the cold-start transient).
    warmup_samples: int = _env_int("KERNEL_AI_ML_WARMUP", 30)

    # Robust z-score thresholds. A feature whose current value sits this many
    # standard deviations above its baseline becomes a mutation.
    z_warn: float = _env_float("KERNEL_AI_ML_Z_WARN", 4.0)
    z_crit: float = _env_float("KERNEL_AI_ML_Z_CRIT", 7.0)

    # Persist the raw feature snapshot each tick (useful for later training /
    # drift analysis). Disable to keep the DB tiny.
    store_features: bool = os.getenv("KERNEL_AI_ML_STORE_FEATURES", "true").lower() == "true"

    # How long to keep rows (hours). The worker prunes older data each cycle.
    retain_features_hours: int = _env_int("KERNEL_AI_ML_RETAIN_FEATURES_H", 48)
    retain_anomalies_hours: int = _env_int("KERNEL_AI_ML_RETAIN_ANOMALIES_H", 168)

    @property
    def alpha(self) -> float:
        return 2.0 / (max(2, self.baseline_window) + 1.0)
