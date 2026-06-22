"""Stage 1 detector loop.

    collect features -> score vs baseline -> emit anomalies -> persist

Runs as its own process so it is fully isolated from the Flask request path.
Anomalies are written to Postgres in a shape that maps directly onto Kernel DNA
mutations (type / severity / message / position), enriched with the statistical
evidence (z-score, baseline) that triggered them.
"""

from __future__ import annotations

import logging
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


class MLWorker:
    def __init__(self, cfg: MLConfig | None = None) -> None:
        self.cfg = cfg or MLConfig()
        self.extractor = FeatureExtractor()
        self.baseline = EwmaBaseline(alpha=self.cfg.alpha, warmup_samples=self.cfg.warmup_samples)
        self.store = PostgresStore(self.cfg.dsn)
        self._running = True
        self._min_std = {n: s.min_std for n, s in FEATURE_SPECS.items()}

    def stop(self, *_args) -> None:
        self._running = False

    def _tick(self) -> int:
        features = self.extractor.collect()
        if not features:
            return 0
        scores = self.baseline.update_and_score(features, self._min_std)
        anomalies = _build_anomalies(scores, self.cfg)
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
