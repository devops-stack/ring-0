"""Stage 3 + Stage 4 auto-retrain orchestrator (run by a systemd timer).

    measure drift  ->  decide  ->  IsolationForest on clean data  ->  STIDE profile

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


def run(*, only_if_drift: bool, min_samples: int, stide_only: bool = False) -> int:
    cfg = MLConfig()
    metrics: dict = {}

    if stide_only:
        _refresh_stide(cfg, metrics)
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
