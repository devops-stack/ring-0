"""Stage 1 detector loop.

    collect features -> score vs baseline -> emit anomalies -> persist

Runs as its own process so it is fully isolated from the Flask request path.
Anomalies are written to Postgres in a shape that maps directly onto Kernel DNA
mutations (type / severity / message / position), enriched with the statistical
evidence (z-score, baseline) that triggered them.
"""

from __future__ import annotations

import logging
import os
import signal
import time

from kernel_ai.ml.baseline import EwmaBaseline, Score
from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.features import FEATURE_SPECS, FeatureExtractor
from kernel_ai.ml.store import PostgresStore

logger = logging.getLogger("kernel_ai.ml.worker")

# Persist baseline state / prune old rows every N ticks (not every tick).
_HOUSEKEEPING_EVERY = 30


def _build_anomalies(scores: dict[str, Score], cfg: MLConfig) -> list[dict]:
    """Turn high positive z-scores into Kernel DNA mutation records."""
    out: list[dict] = []
    for name, sc in scores.items():
        if sc.warm:
            continue
        # Attacks present as bursts: we flag upward deviations only.
        if sc.z < cfg.z_warn or sc.value <= sc.mean:
            continue
        spec = FEATURE_SPECS.get(name)
        severity = "high" if sc.z >= cfg.z_crit else "medium"
        out.append(
            {
                "source": "stage1_baseline",
                "feature": name,
                "subsystem": spec.subsystem if spec else None,
                "type": f"baseline_spike:{name}",
                "severity": severity,
                "score": round(sc.z, 3),
                "value": round(sc.value, 3),
                "baseline_mean": round(sc.mean, 3),
                "baseline_std": round(sc.std, 3),
                "position": spec.position if spec else 0.5,
                "message": (
                    f"{(spec.label if spec else name)} spike: "
                    f"{sc.value:.1f} vs baseline {sc.mean:.1f}±{sc.std:.1f} (z={sc.z:.1f})"
                ),
                "meta": {"stage": 1, "z": round(sc.z, 3), "alpha": round(cfg.alpha, 4)},
            }
        )
    return out


def _build_isoforest_anomaly(score: float, scores: dict[str, Score], cfg: MLConfig) -> dict:
    """Build a mutation from an IsolationForest verdict.

    The forest judges the whole feature vector, so we borrow the Stage 1
    z-scores to point at the single most-deviating feature for the helix
    position / subsystem and a human-readable cause.
    """
    top = max(scores.values(), key=lambda s: abs(s.z), default=None)
    feature = top.name if top else "vector"
    spec = FEATURE_SPECS.get(feature)
    severity = "high" if score > 0.1 else "medium"
    label = spec.label if spec else feature
    return {
        "source": "stage2_isoforest",
        "feature": feature,
        "subsystem": spec.subsystem if spec else None,
        "type": f"isoforest:{feature}",
        "severity": severity,
        "score": round(score, 4),
        "value": round(top.value, 3) if top else None,
        "baseline_mean": round(top.mean, 3) if top else None,
        "baseline_std": round(top.std, 3) if top else None,
        "position": spec.position if spec else 0.5,
        "message": (
            f"IsolationForest flagged an unusual system state "
            f"(top deviation: {label}, z={top.z:.1f}, if_score={score:.3f})"
            if top else
            f"IsolationForest flagged an unusual system state (if_score={score:.3f})"
        ),
        "meta": {"stage": 2, "if_score": round(score, 4)},
    }


class MLWorker:
    def __init__(self, cfg: MLConfig | None = None) -> None:
        self.cfg = cfg or MLConfig()
        self.extractor = FeatureExtractor()
        self.baseline = EwmaBaseline(alpha=self.cfg.alpha, warmup_samples=self.cfg.warmup_samples)
        self.store = PostgresStore(self.cfg.dsn)
        self._running = True
        self._min_std = {n: s.min_std for n, s in FEATURE_SPECS.items()}
        # Stage 2 model (loaded lazily; absent until train.py has produced it).
        self.model = None
        self._model_mtime: float | None = None
        self._last_if_emit = 0.0
        self._maybe_load_model()

    def _maybe_load_model(self) -> None:
        """Load / hot-reload the IsolationForest artifact if present and changed.

        Importing sklearn/joblib only happens once a model file exists, so a
        Stage-1-only deployment never pays the memory cost.
        """
        if not self.cfg.enable_stage2:
            return
        path = self.cfg.model_path
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return  # no model yet -> Stage 2 stays dormant
        if self._model_mtime is not None and mtime <= self._model_mtime:
            return
        try:
            from kernel_ai.ml.model import IsolationForestModel

            self.model = IsolationForestModel.load(path)
            self._model_mtime = mtime
            logger.info("loaded Stage 2 model: %s (%s)", path, self.model.meta)
        except Exception as exc:  # noqa: BLE001 - keep running on Stage 1 only
            logger.warning("failed to load Stage 2 model: %s", exc)

    def stop(self, *_args) -> None:
        self._running = False

    def _tick(self) -> int:
        features = self.extractor.collect()
        if not features:
            return 0
        scores = self.baseline.update_and_score(features, self._min_std)
        anomalies = _build_anomalies(scores, self.cfg)

        # Stage 2 second opinion: the forest can catch unusual *combinations*
        # the per-feature z-score misses. Rate-limited so a sustained anomaly
        # doesn't spam one mutation per tick.
        if self.model is not None:
            try:
                is_anom, if_score = self.model.score_one(features)
            except Exception as exc:  # noqa: BLE001
                is_anom, if_score = False, 0.0
                logger.warning("isoforest scoring failed: %s", exc)
            now = time.time()
            if is_anom and (now - self._last_if_emit) >= self.cfg.if_cooldown_sec:
                anomalies.append(_build_isoforest_anomaly(if_score, scores, self.cfg))
                self._last_if_emit = now

        if self.cfg.store_features:
            self.store.insert_feature_snapshot(features)
        if anomalies:
            self.store.insert_anomalies(anomalies)
        return len(anomalies)

    def run(self) -> None:
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)

        restored = self.store.load_baseline()
        if restored:
            self.baseline.load_state(restored)
            logger.info("restored baseline state for %d features", len(restored))

        logger.info(
            "ML worker started: interval=%.1fs window=%d warmup=%d z_warn=%.1f z_crit=%.1f",
            self.cfg.interval_sec, self.cfg.baseline_window, self.cfg.warmup_samples,
            self.cfg.z_warn, self.cfg.z_crit,
        )

        ticks = 0
        while self._running:
            start = time.time()
            try:
                n = self._tick()
                ticks += 1
                if n:
                    logger.info("tick %d: emitted %d anomalies", ticks, n)
                if ticks % _HOUSEKEEPING_EVERY == 0:
                    self.store.save_baseline(self.baseline.export_state())
                    self.store.prune(self.cfg.retain_features_hours, self.cfg.retain_anomalies_hours)
                    # Pick up a freshly retrained model without a restart.
                    self._maybe_load_model()
            except Exception as exc:  # noqa: BLE001 - keep the loop alive
                logger.exception("tick failed: %s", exc)
                # Reconnect on DB hiccups rather than dying.
                try:
                    self.store = PostgresStore(self.cfg.dsn)
                except Exception:  # noqa: BLE001
                    time.sleep(2.0)

            elapsed = time.time() - start
            time.sleep(max(0.0, self.cfg.interval_sec - elapsed))

        # Graceful shutdown: persist what we learned.
        try:
            self.store.save_baseline(self.baseline.export_state())
        finally:
            self.store.close()
        logger.info("ML worker stopped after %d ticks", ticks)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    MLWorker().run()
