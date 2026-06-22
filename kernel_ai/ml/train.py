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
from kernel_ai.ml.store import connect

logger = logging.getLogger("kernel_ai.ml.train")

# Canonical feature ordering shared by training and inference.
FEATURE_ORDER = list(FEATURE_SPECS.keys())


def load_matrix(dsn: str, limit: int = 50000) -> list[list[float]]:
    """Load feature snapshots into a dense matrix in canonical column order."""
    with connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT features FROM ml_feature_snapshots ORDER BY ts DESC LIMIT %s",
            (limit,),
        )
        rows = cur.fetchall()
    matrix = []
    for (features,) in rows:
        if not isinstance(features, dict):
            continue
        matrix.append([float(features.get(name, 0.0)) for name in FEATURE_ORDER])
    return matrix


def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = max(0, min(len(ordered) - 1, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return ordered[k]


def train(cfg: MLConfig, *, min_samples: int, contamination: float, trees: int) -> dict:
    matrix = load_matrix(cfg.dsn)
    n = len(matrix)
    if n < min_samples:
        raise SystemExit(
            f"Not enough samples to train: have {n}, need >= {min_samples}. "
            f"Let the worker collect more (it runs every {cfg.interval_sec:.0f}s)."
        )

    model = IsolationForestModel(feature_names=FEATURE_ORDER)
    model.fit(matrix, contamination=contamination, n_estimators=trees)

    # Evaluate on the training set: how the score is distributed and what
    # fraction would be flagged (should sit near `contamination`).
    scores = model.score_matrix(matrix)
    preds = model.model.predict(matrix)
    flagged = sum(1 for p in preds if p == -1)
    metrics = {
        "n_samples": float(n),
        "n_features": float(len(FEATURE_ORDER)),
        "flag_rate": flagged / n if n else 0.0,
        "score_mean": statistics.fmean(scores) if scores else 0.0,
        "score_p95": _percentile(scores, 95),
        "score_max": max(scores) if scores else 0.0,
    }

    # Persist the artifact the worker loads (independent of MLflow availability).
    os.makedirs(os.path.dirname(cfg.model_path), exist_ok=True)
    model.save(cfg.model_path)
    logger.info("saved model artifact -> %s", cfg.model_path)

    # MLflow tracking + registry (best-effort: training must not hard-fail if
    # MLflow has a hiccup, the artifact is already saved above).
    try:
        import mlflow
        import mlflow.sklearn

        mlflow.set_tracking_uri(cfg.mlflow_uri)
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
