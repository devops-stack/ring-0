"""Stage 3 auto-retrain orchestrator (run by a systemd timer).

    measure drift  ->  decide  ->  retrain on clean recent data  ->  register

Decision:
  * default: always retrain (the timer cadence IS the schedule).
  * --only-if-drift: retrain only when the drift monitor trips (use with a
    more frequent timer to react faster without needless refits).

Safety:
  * training excludes high-severity anomaly windows (poison guard), and
  * a degenerate model (flags ~nothing/~everything) is rejected, keeping the
    previous one. Both live in train.py; this just orchestrates and logs.
"""

from __future__ import annotations

import argparse
import logging

from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.drift import compute_drift
from kernel_ai.ml import train as train_mod

logger = logging.getLogger("kernel_ai.ml.retrain")


def run(*, only_if_drift: bool, min_samples: int) -> int:
    cfg = MLConfig()
    drift = compute_drift(cfg, persist=True)

    if only_if_drift and drift.get("available") and not drift.get("drifted"):
        logger.info("no drift detected (flag_rate=%s) - skipping retrain", drift.get("flag_rate"))
        return 0

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
        # model and don't mark the timer run as failed.
        logger.warning("retrain skipped: %s", exc)
        return 0

    logger.info("retrain complete: %s", metrics)
    return 0


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    parser = argparse.ArgumentParser(description="Drift-aware auto-retrain")
    parser.add_argument("--only-if-drift", action="store_true")
    parser.add_argument("--min-samples", type=int, default=100)
    args = parser.parse_args()
    raise SystemExit(run(only_if_drift=args.only_if_drift, min_samples=args.min_samples))


if __name__ == "__main__":
    main()
