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

# All ML runtime data (model artifacts, MLflow sqlite + artifacts) lives in one
# directory owned by the service user (www-data), so the worker and the retrain
# job can both read/write it. Override with KERNEL_AI_ML_DATA_DIR.
_DATA_DIR = Path(os.getenv("KERNEL_AI_ML_DATA_DIR", str(_PROJECT_ROOT / "mldata")))


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
        str(_DATA_DIR / "isoforest_latest.joblib"),
    )
    # MLflow tracking store. sqlite gives both tracking + a model registry while
    # staying file-light (no always-on server). Override on PROD if desired.
    mlflow_uri: str = os.getenv(
        "KERNEL_AI_MLFLOW_URI",
        f"sqlite:///{_DATA_DIR / 'mlflow.db'}",
    )
    # Artifact root for MLflow runs (must be writable by the service user).
    mlflow_artifact_uri: str = os.getenv(
        "KERNEL_AI_MLFLOW_ARTIFACT_URI",
        f"file:{_DATA_DIR / 'mlruns'}",
    )
    mlflow_experiment: str = os.getenv("KERNEL_AI_MLFLOW_EXPERIMENT", "kernel_dna_anomaly")
    mlflow_model_name: str = os.getenv("KERNEL_AI_MLFLOW_MODEL", "kernel_dna_isoforest")
    # IsolationForest training defaults.
    if_contamination: float = _env_float("KERNEL_AI_ML_IF_CONTAMINATION", 0.02)
    if_n_estimators: int = _env_int("KERNEL_AI_ML_IF_TREES", 200)
    # Min seconds between IsolationForest mutations (avoid per-tick spam during a
    # sustained anomaly).
    if_cooldown_sec: float = _env_float("KERNEL_AI_ML_IF_COOLDOWN_SEC", 15.0)

    # --- Stage 3 (drift + auto-retrain) ---
    # Window of recent snapshots used to measure drift (minutes).
    drift_window_min: int = _env_int("KERNEL_AI_ML_DRIFT_WINDOW_MIN", 30)
    # Minimum recent samples before drift verdicts are trusted (avoid declaring
    # drift off one or two noisy snapshots right after a worker restart).
    drift_min_recent: int = _env_int("KERNEL_AI_ML_DRIFT_MIN_RECENT", 20)
    # Drift trips when the live flag rate exceeds expected (contamination) by
    # this multiple, or when the mean per-feature distribution shift (in train
    # std units) exceeds the z threshold.
    drift_rate_mult: float = _env_float("KERNEL_AI_ML_DRIFT_RATE_MULT", 5.0)
    drift_feature_z: float = _env_float("KERNEL_AI_ML_DRIFT_FEATURE_Z", 3.0)
    # Poison guard: exclude snapshots within +/- this many seconds of a
    # high-severity anomaly from the retraining set (don't learn the attack).
    poison_guard_sec: int = _env_int("KERNEL_AI_ML_POISON_GUARD_SEC", 120)
    # A retrained model is rejected (kept previous) if its training flag rate is
    # outside this sane band (degenerate model: flags nothing or everything).
    retrain_min_flag_rate: float = _env_float("KERNEL_AI_ML_RETRAIN_MIN_FLAG", 0.001)
    retrain_max_flag_rate: float = _env_float("KERNEL_AI_ML_RETRAIN_MAX_FLAG", 0.30)

    # --- Stage 4 (syscall sequence model: STIDE n-grams) ---
    # Detects anomalous *sequences* of syscalls rather than per-feature spikes.
    # Default source is L0 procfs sampling. PROD Stage 6 uses SEQ_SOURCE=socket
    # fed by deploy/ebpf/syscall_stream_collector.py (no caps on this worker).
    enable_stage4: bool = os.getenv("KERNEL_AI_ML_STAGE4", "true").lower() == "true"
    # procfs | socket | off  — see docs/ML_STAGE6_L2_COLLECTOR.md
    seq_source: str = os.getenv("KERNEL_AI_ML_SEQ_SOURCE", "procfs").strip().lower()
    seq_socket: str = os.getenv(
        "KERNEL_AI_ML_SEQ_SOCKET",
        "/run/kernel-ai/ml-syscall.sock",
    )
    seq_socket_max_events: int = _env_int("KERNEL_AI_ML_SEQ_SOCKET_MAX", 2000)
    seq_model_path: str = os.getenv(
        "KERNEL_AI_ML_SEQ_MODEL_PATH",
        str(_DATA_DIR / "stide_latest.joblib"),
    )
    seq_n: int = _env_int("KERNEL_AI_ML_SEQ_N", 3)                  # n-gram size
    seq_max_pids: int = _env_int("KERNEL_AI_ML_SEQ_MAX_PIDS", 512)  # pids sampled/tick
    seq_window: int = _env_int("KERNEL_AI_ML_SEQ_WINDOW", 400)      # rolling n-grams scored
    seq_min_window: int = _env_int("KERNEL_AI_ML_SEQ_MIN_WINDOW", 120)  # before scoring
    # 2s tick sampling only catches processes *parked* in a syscall. A short burst
    # of sub-samples per tick captures real syscall transitions (better sequences).
    seq_subsamples: int = _env_int("KERNEL_AI_ML_SEQ_SUBSAMPLES", 4)
    seq_subsample_gap_ms: int = _env_int("KERNEL_AI_ML_SEQ_SUBSAMPLE_GAP_MS", 40)
    # Minimum distinct n-grams required before a STIDE profile is built (a profile
    # learned from too little data would flag almost everything).
    seq_min_vocab: int = _env_int("KERNEL_AI_ML_SEQ_MIN_VOCAB", 50)
    # Window mismatch fraction (unseen n-grams) that counts as a sequence anomaly.
    seq_mismatch_warn: float = _env_float("KERNEL_AI_ML_SEQ_MISMATCH_WARN", 0.30)
    seq_mismatch_crit: float = _env_float("KERNEL_AI_ML_SEQ_MISMATCH_CRIT", 0.55)
    seq_cooldown_sec: float = _env_float("KERNEL_AI_ML_SEQ_COOLDOWN_SEC", 30.0)
    # Flush newly observed n-grams to the store every N seconds (profile growth).
    seq_flush_sec: float = _env_float("KERNEL_AI_ML_SEQ_FLUSH_SEC", 30.0)
    # Training keeps n-grams seen at least this many times (frequency-based poison
    # guard: a one-off attack sequence never enters the "normal" profile).
    seq_min_ngram_count: int = _env_int("KERNEL_AI_ML_SEQ_MIN_COUNT", 3)

    # --- Stage 5 (per-process L1 features + lineage) ---
    # Default off until explicitly enabled locally / after soak — keeps PROD safe
    # if code is synced without a deliberate cutover.
    enable_stage5: bool = os.getenv("KERNEL_AI_ML_STAGE5", "false").lower() == "true"
    proc_max_pids: int = _env_int("KERNEL_AI_ML_PROC_MAX_PIDS", 80)
    proc_lineage_min_count: int = _env_int("KERNEL_AI_ML_PROC_LINEAGE_MIN", 3)
    proc_cooldown_sec: float = _env_float("KERNEL_AI_ML_PROC_COOLDOWN_SEC", 20.0)
    proc_max_emit: int = _env_int("KERNEL_AI_ML_PROC_MAX_EMIT", 4)
    proc_store_snapshots: bool = (
        os.getenv("KERNEL_AI_ML_PROC_STORE", "true").lower() == "true"
    )
    proc_flush_sec: float = _env_float("KERNEL_AI_ML_PROC_FLUSH_SEC", 30.0)

    # --- Stage 7 (ATT&CK / Sigma-lite attribution) ---
    # Pure enrichment of anomalies already emitted — safe default ON locally.
    # Does not change detection thresholds; only adds attack.* metadata.
    enable_stage7: bool = os.getenv("KERNEL_AI_ML_STAGE7", "true").lower() == "true"
    attack_min_confidence: float = _env_float("KERNEL_AI_ML_ATTACK_MIN_CONF", 0.35)

    # --- Stage 8 (deep sequence: Markov/HMM → LSTM/Transformer) ---
    # Stub: safe default OFF. Requires trained artifact + preferably Stage 6
    # stream; without a model file the worker path is a no-op.
    enable_stage8: bool = os.getenv("KERNEL_AI_ML_STAGE8", "false").lower() == "true"
    stage8_backend: str = os.getenv("KERNEL_AI_ML_STAGE8_BACKEND", "markov").strip().lower()
    stage8_markov_path: str = os.getenv(
        "KERNEL_AI_ML_STAGE8_MARKOV_PATH",
        str(_DATA_DIR / "markov_latest.joblib"),
    )
    stage8_lstm_path: str = os.getenv(
        "KERNEL_AI_ML_STAGE8_LSTM_PATH",
        str(_DATA_DIR / "lstm_latest.pt"),
    )
    stage8_window: int = _env_int("KERNEL_AI_ML_STAGE8_WINDOW", 64)
    stage8_score_warn: float = _env_float("KERNEL_AI_ML_STAGE8_SCORE_WARN", 3.0)
    stage8_score_crit: float = _env_float("KERNEL_AI_ML_STAGE8_SCORE_CRIT", 5.0)
    stage8_cooldown_sec: float = _env_float("KERNEL_AI_ML_STAGE8_COOLDOWN_SEC", 30.0)

    @property
    def alpha(self) -> float:
        return 2.0 / (max(2, self.baseline_window) + 1.0)
