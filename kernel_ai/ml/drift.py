"""Stage 3 drift monitor.

Measures, without any labels, whether the live system has drifted away from the
"normal" the current model was trained on. Two complementary signals:

  1. flag_rate  - fraction of recent snapshots the model flags as anomalous.
                  If this sits far above the model's `contamination` for a
                  sustained period (without a real incident), normal has moved.
  2. feature_drift - mean per-feature shift of recent data vs the training
                  distribution, measured in training-std units (a PSI-like z).

Either signal crossing its threshold marks `drifted = True`, which the retrain
orchestrator uses to decide whether to refit.
"""

from __future__ import annotations

import logging
import statistics

from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.features import FEATURE_SPECS
from kernel_ai.ml.model import IsolationForestModel
from kernel_ai.ml.store import fetch_recent_feature_dicts, insert_drift

logger = logging.getLogger("kernel_ai.ml.drift")

# Cap each feature's drift z so a single quiet, near-constant metric can't
# dominate the aggregate (a tiny absolute move on a ~0-variance feature would
# otherwise blow up to astronomical z).
_MAX_FEATURE_Z = 25.0


def _feature_drift(recent: list[dict], feature_stats: dict[str, dict]) -> tuple[float, dict]:
    """Mean absolute shift of recent feature means vs training means, in train
    std units. Returns (aggregate_score, per_feature_detail).

    The denominator floor uses the same per-feature noise floor as the Stage 1
    z-score (FEATURE_SPECS[...].min_std), so quiet features need a *meaningful*
    move — not a microscopic one — to register as drift.
    """
    if not recent or not feature_stats:
        return 0.0, {}
    per_feature = {}
    z_values = []
    for name, st in feature_stats.items():
        vals = [float(r.get(name, 0.0)) for r in recent]
        if not vals:
            continue
        recent_mean = statistics.fmean(vals)
        train_mean = float(st.get("mean", 0.0))
        train_std = float(st.get("std", 0.0))
        spec = FEATURE_SPECS.get(name)
        noise_floor = spec.min_std if spec else 0.0
        floor = max(train_std, noise_floor, abs(train_mean) * 0.05, 1e-6)
        z = min(_MAX_FEATURE_Z, abs(recent_mean - train_mean) / floor)
        per_feature[name] = round(z, 3)
        z_values.append(z)
    aggregate = statistics.fmean(z_values) if z_values else 0.0
    return aggregate, per_feature


def compute_drift(cfg: MLConfig | None = None, *, persist: bool = True) -> dict:
    cfg = cfg or MLConfig()
    try:
        model = IsolationForestModel.load(cfg.model_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("drift: no model to compare against (%s)", exc)
        return {"available": False, "reason": "no_model"}

    recent = fetch_recent_feature_dicts(cfg.dsn, minutes=cfg.drift_window_min)
    n = len(recent)
    contamination = float(model.meta.get("contamination", cfg.if_contamination))

    if n == 0:
        result = {
            "available": True, "n_recent": 0, "flag_rate": 0.0,
            "expected_rate": contamination, "feature_drift": 0.0, "drifted": False,
            "detail": {"reason": "no_recent_data"},
        }
        if persist:
            insert_drift(cfg.dsn, result)
        return result

    matrix = [[float(r.get(name, 0.0)) for name in model.feature_names] for r in recent]
    preds = model.model.predict(matrix)
    flagged = sum(1 for p in preds if p == -1)
    flag_rate = flagged / n

    feature_drift, per_feature = _feature_drift(recent, model.meta.get("feature_stats", {}))

    rate_drift = flag_rate > contamination * cfg.drift_rate_mult
    dist_drift = feature_drift > cfg.drift_feature_z
    drifted = bool(rate_drift or dist_drift)

    # Surface the biggest-shifting features for explainability.
    top = sorted(per_feature.items(), key=lambda kv: kv[1], reverse=True)[:5]

    result = {
        "available": True,
        "n_recent": n,
        "flag_rate": round(flag_rate, 4),
        "expected_rate": round(contamination, 4),
        "feature_drift": round(feature_drift, 4),
        "drifted": drifted,
        "detail": {
            "rate_drift": rate_drift,
            "dist_drift": dist_drift,
            "rate_mult_threshold": cfg.drift_rate_mult,
            "feature_z_threshold": cfg.drift_feature_z,
            "top_features": dict(top),
        },
    }
    if persist:
        insert_drift(cfg.dsn, result)
    logger.info(
        "drift: n=%d flag_rate=%.3f (exp %.3f) feature_drift=%.2f drifted=%s",
        n, flag_rate, contamination, feature_drift, drifted,
    )
    return result


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    import json

    print(json.dumps(compute_drift(), indent=2))


if __name__ == "__main__":
    main()
