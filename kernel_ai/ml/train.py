"""Stage 2 training: fit IsolationForest on collected feature snapshots.

Flow:
    Postgres ml_feature_snapshots  ->  matrix  ->  IsolationForest
        -> evaluate (flag rate, score distribution)
        -> log params/metrics/model to MLflow  (sqlite backend = tracking + registry)
        -> save artifact to models/isoforest_latest.joblib  (what the worker loads)

MLflow runs in a *file-light* sqlite store, so there's no always-on server.
Inspect runs on demand with:  mlflow ui --backend-store-uri sqlite:///mlflow.db

Usage:
    python -m kernel_ai.ml.train [--min-samples N] [--contamination C] [--trees T]
"""

from __future__ import annotations

import argparse
import logging
import os
import statistics

from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.features import FEATURE_SPECS
from kernel_ai.ml.model import IsolationForestModel
from kernel_ai.ml.store import fetch_training_snapshots

logger = logging.getLogger("kernel_ai.ml.train")

# Canonical feature ordering shared by training and inference.
FEATURE_ORDER = list(FEATURE_SPECS.keys())


def _dicts_to_matrix(rows: list[dict]) -> list[list[float]]:
    return [[float(r.get(name, 0.0)) for name in FEATURE_ORDER] for r in rows]


def _feature_stats(matrix: list[list[float]]) -> dict[str, dict]:
    """Per-feature mean/std over the training set, stored in the model meta so
    the drift monitor can later compare live data against the trained 'normal'."""
    stats: dict[str, dict] = {}
    for col, name in enumerate(FEATURE_ORDER):
        values = [row[col] for row in matrix]
        mean = statistics.fmean(values) if values else 0.0
        std = statistics.pstdev(values) if len(values) > 1 else 0.0
        stats[name] = {"mean": mean, "std": std}
    return stats


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[k]


def train(
    cfg: MLConfig,
    *,
    min_samples: int,
    contamination: float,
    trees: int,
    exclude_anomalous: bool = True,
    enforce_guardrails: bool = True,
) -> dict:
    rows = fetch_training_snapshots(
        cfg.dsn,
        exclude_anomalous=exclude_anomalous,
        guard_sec=cfg.poison_guard_sec,
    )
    matrix = _dicts_to_matrix(rows)
    n = len(matrix)
    if n < min_samples:
        raise SystemExit(
            f"Not enough clean samples to train: have {n}, need >= {min_samples}. "
            f"Let the worker collect more (it runs every {cfg.interval_sec:.0f}s)."
        )

    model = IsolationForestModel(feature_names=FEATURE_ORDER)
    model.fit(matrix, contamination=contamination, n_estimators=trees)
    # Stash training distribution so drift can be measured against it later.
    model.meta["feature_stats"] = _feature_stats(matrix)

    # Evaluate on the training set: how the score is distributed and what
    # fraction would be flagged (should sit near `contamination`).
    scores = model.score_matrix(matrix)
    preds = model.model.predict(matrix)
    flagged = sum(1 for p in preds if p == -1)
    flag_rate = flagged / n if n else 0.0
    metrics = {
        "n_samples": float(n),
        "n_features": float(len(FEATURE_ORDER)),
        "flag_rate": flag_rate,
        "score_mean": statistics.fmean(scores) if scores else 0.0,
        "score_p95": _percentile(scores, 95),
        "score_max": max(scores) if scores else 0.0,
        "excluded_anomalous": 1.0 if exclude_anomalous else 0.0,
    }

    # Guardrail: refuse to promote a degenerate model (flags ~nothing or
    # ~everything). The previously saved artifact is left untouched.
    if enforce_guardrails and not (cfg.retrain_min_flag_rate <= flag_rate <= cfg.retrain_max_flag_rate):
        raise SystemExit(
            f"Refusing to save model: flag_rate={flag_rate:.3f} outside sane band "
            f"[{cfg.retrain_min_flag_rate}, {cfg.retrain_max_flag_rate}]. Keeping previous model."
        )

    # Persist the artifact the worker loads (independent of MLflow availability).
    os.makedirs(os.path.dirname(cfg.model_path), exist_ok=True)
    model.save(cfg.model_path)
    logger.info("saved model artifact -> %s (flag_rate=%.3f, n=%d)", cfg.model_path, flag_rate, n)

    # MLflow tracking + registry (best-effort: training must not hard-fail if
    # MLflow has a hiccup, the artifact is already saved above).
    #
    # MLflow's sqlite store unconditionally mkdir's its default artifact root
    # (``./mlruns``) relative to the *current working directory* at store-init
    # time. Under systemd the cwd is the (read-only-to-www-data) project root,
    # so we run the whole MLflow block from inside the writable data dir.
    data_dir = os.path.dirname(cfg.model_path)
    prev_cwd = os.getcwd()
    try:
        os.chdir(data_dir)
        import mlflow
        import mlflow.sklearn

        mlflow.set_tracking_uri(cfg.mlflow_uri)
        # Ensure the experiment stores artifacts in the service-writable data dir.
        if mlflow.get_experiment_by_name(cfg.mlflow_experiment) is None:
            mlflow.create_experiment(cfg.mlflow_experiment, artifact_location=cfg.mlflow_artifact_uri)
        mlflow.set_experiment(cfg.mlflow_experiment)
        with mlflow.start_run() as run:
            mlflow.log_params(
                {
                    "contamination": contamination,
                    "n_estimators": trees,
                    "n_samples": n,
                    "n_features": len(FEATURE_ORDER),
                    "baseline_window": cfg.baseline_window,
                    "feature_order": ",".join(FEATURE_ORDER),
                }
            )
            mlflow.log_metrics(metrics)
            mlflow.sklearn.log_model(
                model.model,
                artifact_path="isoforest",
                registered_model_name=cfg.mlflow_model_name,
            )
            logger.info("logged MLflow run %s (experiment=%s)", run.info.run_id, cfg.mlflow_experiment)
    except Exception as exc:  # noqa: BLE001 - tracking is optional
        logger.warning("MLflow logging skipped: %s", exc)
    finally:
        os.chdir(prev_cwd)

    # Stage 4: rebuild the syscall-sequence (STIDE) profile from the n-grams the
    # worker has accumulated. Best-effort: a missing/young vocabulary must not
    # block IsolationForest training (which is already saved above).
    if cfg.enable_stage4:
        try:
            from kernel_ai.ml.sequence import build_profile

            seq_meta = build_profile(cfg)
            metrics["seq_vocab_kept"] = float(seq_meta.get("vocab_kept", 0))
        except SystemExit as exc:
            logger.info("STIDE profile not rebuilt: %s", exc)
        except Exception as exc:  # noqa: BLE001 - sequence profile is optional
            logger.warning("STIDE profile build failed: %s", exc)

    return metrics


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    cfg = MLConfig()
    parser = argparse.ArgumentParser(description="Train Stage 2 IsolationForest")
    parser.add_argument("--min-samples", type=int, default=100)
    parser.add_argument("--contamination", type=float, default=cfg.if_contamination)
    parser.add_argument("--trees", type=int, default=cfg.if_n_estimators)
    args = parser.parse_args()

    metrics = train(
        cfg,
        min_samples=args.min_samples,
        contamination=args.contamination,
        trees=args.trees,
    )
    logger.info("training done: %s", metrics)


if __name__ == "__main__":
    main()
