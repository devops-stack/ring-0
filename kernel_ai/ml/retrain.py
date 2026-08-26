"""Stage 3 + Stage 4 + Stage 8 auto-retrain orchestrator (run by a systemd timer).

    measure drift -> decide -> IsolationForest on clean data -> STIDE -> Markov

Decision:
  * default: always retrain IsolationForest (the timer cadence IS the schedule).
  * --only-if-drift: skip IsolationForest when the drift monitor is quiet.
  * STIDE (``stide_latest.joblib``) is always refreshed from ``ml_syscall_ngrams``
    when Stage 4 is on — including ``--stide-only`` and IF soft-skips — so the
    audit/L2 vocabulary does not wait on feature drift.

Safety:
  * IF training excludes high-severity anomaly windows (poison guard), and
  * a degenerate model (flags ~nothing/~everything) is rejected, keeping the
    previous one. Both live in train.py; this just orchestrates and logs.
  * STIDE uses a frequency poison guard inside ``build_profile``.
"""

from __future__ import annotations

import argparse
import logging
import os

from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.drift import compute_drift
from kernel_ai.ml import train as train_mod

logger = logging.getLogger("kernel_ai.ml.retrain")


def _refresh_stide(cfg: MLConfig, metrics: dict) -> None:
    """Best-effort STIDE rebuild from accumulated audit/socket n-grams."""
    if not cfg.enable_stage4:
        return
    # train() already rebuilt STIDE on a successful IF pass — skip duplicate work.
    if metrics.get("seq_vocab_kept") is not None:
        return
    try:
        from kernel_ai.ml.sequence import build_profile

        seq_meta = build_profile(cfg)
        metrics["seq_vocab_kept"] = float(seq_meta.get("vocab_kept", 0))
        logger.info("STIDE profile refreshed: %s", seq_meta)
    except SystemExit as exc:
        logger.info("STIDE profile not rebuilt: %s", exc)
    except Exception as exc:  # noqa: BLE001 - sequence profile is optional
        logger.warning("STIDE profile build failed: %s", exc)


def _refresh_markov(cfg: MLConfig, metrics: dict) -> None:
    """Best-effort Stage 8 rebuild from the same n-gram corpus as STIDE.

    Without this the transition model freezes on the day it was trained while the
    vocabulary underneath it keeps growing. Note that a rebuild can move the score
    scale, and ``KERNEL_AI_ML_STAGE8_SCORE_WARN`` is tuned against a scale — the
    numbers below are logged so a drift away from the tuned thresholds is visible
    (the worker's periodic window-score line is the other half of that check).
    """
    if not getattr(cfg, "enable_stage8", False):
        return
    if (getattr(cfg, "stage8_backend", "markov") or "markov") != "markov":
        return
    try:
        from kernel_ai.ml.sequence_deep.train_markov import train_markov

        seq_meta = train_markov(cfg, use_ngrams=True)
        metrics["stage8_transitions"] = float(seq_meta.get("n_transitions") or 0)
        logger.info(
            "Stage 8 Markov refreshed: transitions=%s vocab=%s common=%s rare=%s",
            seq_meta.get("n_transitions"),
            seq_meta.get("vocab"),
            seq_meta.get("corpus_common_neg_avg_logprob"),
            seq_meta.get("corpus_rare_neg_avg_logprob"),
        )
    except SystemExit as exc:
        logger.info("Stage 8 Markov not rebuilt: %s", exc)
    except Exception as exc:  # noqa: BLE001 - deep sequence model is optional
        logger.warning("Stage 8 Markov build failed: %s", exc)


def _label_http(cfg: MLConfig, metrics: dict) -> None:
    """Walk local nginx/app logs into ml_http_labels before champion/challenger."""
    paths = [p for p in (cfg.http_nginx_log, cfg.http_app_log) if p]
    readable = [p for p in paths if os.path.isfile(p) and os.access(p, os.R_OK)]
    if not readable:
        logger.info("HTTP label skipped: no readable log in %s", paths)
        return
    try:
        from kernel_ai.ml.http_label import label_paths
        from kernel_ai.ml.store import PostgresStore

        store = PostgresStore(cfg.dsn)
        try:
            stats = label_paths(readable, hours=24.0, store=store)
        finally:
            store.close()
        metrics["http_label_windows"] = float(stats.get("windows") or 0)
        metrics["http_label_attempts"] = float(stats.get("attempts") or 0)
        logger.info("HTTP labels refreshed: %s", stats)
    except Exception as exc:  # noqa: BLE001
        logger.warning("HTTP label failed: %s", exc)


def _refresh_http(cfg: MLConfig, metrics: dict) -> None:
    """Best-effort Stage 9 retrain. Guardrails live in http_train (keep previous)."""
    if os.getenv("KERNEL_AI_ML_HTTP_RETRAIN", "true").lower() != "true":
        return
    _label_http(cfg, metrics)
    try:
        from kernel_ai.ml.http_train import train as train_http

        http_metrics = train_http(cfg, min_samples=40, persist=True)
        metrics["http_precision"] = float(http_metrics.get("holdout_precision") or 0)
        metrics["http_flag_rate"] = float(http_metrics.get("holdout_flag_rate") or 0)
        logger.info("HTTP attempt model refreshed: %s", http_metrics)
    except SystemExit as exc:
        logger.info("HTTP retrain skipped: %s", exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("HTTP retrain failed: %s", exc)


def run(*, only_if_drift: bool, min_samples: int, stide_only: bool = False) -> int:
    cfg = MLConfig()
    metrics: dict = {}

    if stide_only:
        _refresh_stide(cfg, metrics)
        _refresh_markov(cfg, metrics)
        _refresh_http(cfg, metrics)
        logger.info("stide-only retrain complete: %s", metrics)
        return 0

    drift = compute_drift(cfg, persist=True)
    skip_if = bool(only_if_drift and drift.get("available") and not drift.get("drifted"))

    if skip_if:
        logger.info(
            "no drift detected (flag_rate=%s) - skipping IsolationForest retrain",
            drift.get("flag_rate"),
        )
    else:
        try:
            metrics = train_mod.train(
                cfg,
                min_samples=min_samples,
                contamination=cfg.if_contamination,
                trees=cfg.if_n_estimators,
                exclude_anomalous=True,
                enforce_guardrails=True,
            )
        except SystemExit as exc:
            # Soft-skip (not enough clean data, or guardrail tripped): keep previous
            # IsolationForest and still try STIDE below.
            logger.warning("IsolationForest retrain skipped: %s", exc)
            metrics = {}

    _refresh_stide(cfg, metrics)
    _refresh_markov(cfg, metrics)
    _refresh_http(cfg, metrics)
    logger.info("retrain complete: %s", metrics)
    return 0


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Drift-aware auto-retrain (IF + STIDE)")
    parser.add_argument("--only-if-drift", action="store_true")
    parser.add_argument("--min-samples", type=int, default=100)
    parser.add_argument(
        "--stide-only",
        action="store_true",
        help="only rebuild stide_latest.joblib from ml_syscall_ngrams (no IsolationForest)",
    )
    args = parser.parse_args()
    raise SystemExit(
        run(
            only_if_drift=args.only_if_drift,
            min_samples=args.min_samples,
            stide_only=args.stide_only,
        )
    )


if __name__ == "__main__":
    main()
