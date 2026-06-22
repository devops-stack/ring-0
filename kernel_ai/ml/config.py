"""Configuration for the ML anomaly pipeline.

Everything is driven by environment variables so the same code runs locally
(local Postgres) and on PROD (managed Postgres) by only swapping the DSN.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Project root (parent of the ``kernel_ai`` package), used for default paths.
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


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

    # --- Stage 2 (IsolationForest) ---
    # Enable the second-opinion model in the worker. If the model file is
    # missing, Stage 2 stays dormant regardless of this flag.
    enable_stage2: bool = os.getenv("KERNEL_AI_ML_STAGE2", "true").lower() == "true"
    # Saved model artifact the worker loads (decoupled from MLflow).
    model_path: str = os.getenv(
        "KERNEL_AI_ML_MODEL_PATH",
        str(_PROJECT_ROOT / "models" / "isoforest_latest.joblib"),
    )
    # MLflow tracking store. sqlite gives both tracking + a model registry while
    # staying file-light (no always-on server). Override on PROD if desired.
    mlflow_uri: str = os.getenv(
        "KERNEL_AI_MLFLOW_URI",
        f"sqlite:///{_PROJECT_ROOT / 'mlflow.db'}",
    )
    mlflow_experiment: str = os.getenv("KERNEL_AI_MLFLOW_EXPERIMENT", "kernel_dna_anomaly")
    mlflow_model_name: str = os.getenv("KERNEL_AI_MLFLOW_MODEL", "kernel_dna_isoforest")
    # IsolationForest training defaults.
    if_contamination: float = _env_float("KERNEL_AI_ML_IF_CONTAMINATION", 0.02)
    if_n_estimators: int = _env_int("KERNEL_AI_ML_IF_TREES", 200)
    # Min seconds between IsolationForest mutations (avoid per-tick spam during a
    # sustained anomaly).
    if_cooldown_sec: float = _env_float("KERNEL_AI_ML_IF_COOLDOWN_SEC", 15.0)

    @property
    def alpha(self) -> float:
        return 2.0 / (max(2, self.baseline_window) + 1.0)
