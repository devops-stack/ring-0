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


def _build_sequence_anomaly(
    mismatch: float,
    misses: int,
    window_len: int,
    top_unseen: list[str],
    cfg: MLConfig,
    *,
    pid: int | None = None,
) -> dict:
    """Build a mutation from a STIDE syscall-sequence verdict (Stage 4).

    Unlike Stages 1-2 (which judge *magnitudes*), this fires when the recent
    *order* of syscalls contains a high fraction of sequences never seen while
    the normal profile was learned -- the classic signature of an intrusion.
    """
    severity = "high" if mismatch >= cfg.seq_mismatch_crit else "medium"
    cause = ("; novel: " + ", ".join(top_unseen)) if top_unseen else ""
    pid_bit = f" pid={pid}" if pid is not None else ""
    meta = {"stage": 4, "mismatch": round(mismatch, 4), "window": window_len}
    if pid is not None:
        meta["pid"] = int(pid)
    return {
        "source": "stage4_sequence",
        "feature": "syscall_seq",
        "subsystem": "scheduler",
        "type": "syscall_sequence",
        "severity": severity,
        "score": round(mismatch, 4),
        "value": float(misses),
        "baseline_mean": None,
        "baseline_std": None,
        "position": 0.22,
        "message": (
            f"Unusual syscall sequencing{pid_bit}: {mismatch * 100:.0f}% of recent "
            f"{window_len} n-grams are novel ({misses} unseen){cause}"
        ),
        "meta": meta,
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

        # Stage 4 (syscall sequence / STIDE). Source is selectable:
        #   procfs — L0 /proc/<pid>/syscall sampler (default)
        #   socket — L2 Stage 6 collector (docs/ML_STAGE6_L2_COLLECTOR.md)
        #   off    — disable sequence path entirely
        self.seq_sampler = None
        self.seq_socket_source = None
        self.seq_tracker = None
        self.seq_model = None
        self._seq_model_mtime: float | None = None
        self._last_seq_emit = 0.0
        self._last_seq_flush = 0.0
        # Ingest counter at the last scoring, and when evidence last arrived.
        self._seq_scored_at = -1
        self._seq_last_event_at = 0.0
        self._seq_stale_logged = False
        self._seq_pid_marks: dict[int, int] = {}
        self._seq_source = (self.cfg.seq_source or "procfs").strip().lower()
        if self.cfg.enable_stage4 and self._seq_source != "off":
            from kernel_ai.ml.sequence import NgramTracker, SyscallSampler

            self.seq_tracker = NgramTracker(n=self.cfg.seq_n, window=self.cfg.seq_window)
            if self._seq_source == "socket":
                from kernel_ai.ml.collectors.socket_source import SocketSyscallSource

                self.seq_socket_source = SocketSyscallSource(
                    self.cfg.seq_socket,
                    max_events=self.cfg.seq_socket_max_events,
                )
                logger.info("Stage 4 source=socket (%s)", self.cfg.seq_socket)
            else:
                self.seq_sampler = SyscallSampler(max_pids=self.cfg.seq_max_pids)
                logger.info("Stage 4 source=procfs")
            self._maybe_load_seq_model()

        # Stage 5 — per-process L1 features + lineage (off by default).
        self.proc_extractor = None
        self.proc_detector = None
        self._last_proc_flush = 0.0
        if self.cfg.enable_stage5:
            from kernel_ai.ml.proc_baseline import ProcBaselineDetector
            from kernel_ai.ml.proc_features import ProcFeatureExtractor

            self.proc_extractor = ProcFeatureExtractor(max_pids=self.cfg.proc_max_pids)
            self.proc_detector = ProcBaselineDetector(
                alpha=self.cfg.alpha,
                warmup_samples=self.cfg.warmup_samples,
                z_warn=self.cfg.z_warn,
                z_crit=self.cfg.z_crit,
                lineage_min_count=self.cfg.proc_lineage_min_count,
                cooldown_sec=self.cfg.proc_cooldown_sec,
                max_emit_per_tick=self.cfg.proc_max_emit,
            )
            try:
                self.proc_detector.lineage.load_counts(self.store.load_lineage_counts())
            except Exception as exc:  # noqa: BLE001
                logger.warning("failed to load lineage whitelist: %s", exc)
            logger.info(
                "Stage 5 enabled: max_pids=%d lineage_min=%d",
                self.cfg.proc_max_pids,
                self.cfg.proc_lineage_min_count,
            )

        # Stage 8 — deep sequence stub (Markov/LSTM). No-op without artifact.
        self.deep_scorer = None
        self._last_stage8_emit = 0.0
        self._last_stage8_log = 0.0
        self._stage8_scored_at = -1
        self._stage8_pid_marks: dict[int, int] = {}
        if self.cfg.enable_stage8:
            from kernel_ai.ml.sequence_deep import DeepSequenceScorer

            self.deep_scorer = DeepSequenceScorer(self.cfg)
            logger.info(
                "Stage 8 enabled (backend=%s, ready=%s)",
                self.cfg.stage8_backend,
                self.deep_scorer.ready,
            )

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

    def _maybe_load_seq_model(self) -> None:
        """Load / hot-reload the STIDE profile artifact if present and changed."""
        if not self.cfg.enable_stage4:
            return
        path = self.cfg.seq_model_path
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return  # no profile yet -> sequence scoring stays dormant
        if self._seq_model_mtime is not None and mtime <= self._seq_model_mtime:
            return
        try:
            from kernel_ai.ml.sequence import StideModel

            self.seq_model = StideModel.load(path)
            self._seq_model_mtime = mtime
            logger.info("loaded Stage 4 STIDE profile: %s (%s)", path, self.seq_model.meta)
        except Exception as exc:  # noqa: BLE001 - keep running without Stage 4
            logger.warning("failed to load STIDE profile: %s", exc)

    def _sequence_evidence_is_fresh(self, now: float) -> bool:
        """True when syscalls arrived since the last time a window was scored.

        The rolling windows outlive their source: when the stream stops they keep
        their last contents, so re-scoring them produces the same verdict forever —
        one anomaly per cooldown, indefinitely. That is what happened while the
        kernel audit switch was off on 2026-08-11: for 30 hours with zero events
        Stage 4 reported a steady 120 anomalies an hour about a frozen window.
        """
        ingested = self.seq_tracker.ingested
        if self._seq_last_event_at == 0.0:
            self._seq_last_event_at = now
        if ingested != self._seq_scored_at:
            self._seq_scored_at = ingested
            self._seq_last_event_at = now
            if self._seq_stale_logged:
                logger.info("syscall stream resumed (source=%s)", self._seq_source)
                self._seq_stale_logged = False
            return True
        silence = now - self._seq_last_event_at
        if silence >= self.cfg.seq_stale_warn_sec and not self._seq_stale_logged:
            # Said once per outage, and filebeat ships it: a silent feed should
            # look like a problem rather than like a calm system.
            logger.warning(
                "syscall stream silent for %.0fs (source=%s): sequence scoring "
                "paused until events resume",
                silence,
                self._seq_source,
            )
            self._seq_stale_logged = True
        return False

    def _fresh_pid_windows(
        self,
        entries: list[tuple[int, list[str]]],
        marks: dict[int, int],
        stamps: dict[int, int],
    ) -> list[tuple[int, list[str]]]:
        """Keep only pid windows that changed since this scorer last looked.

        The per-pid twin of the stream guard. A window outlives its process, so a
        short-lived pid that ended on an odd chain stays the loudest thing on the
        host and gets re-reported every cooldown — the same anomaly, forever, about
        a process that no longer exists.
        """
        fresh: list[tuple[int, list[str]]] = []
        for pid, window in entries:
            stamp = stamps.get(pid)
            if stamp is None or marks.get(pid) == stamp:
                continue
            marks[pid] = stamp
            fresh.append((pid, window))
        for gone in [pid for pid in marks if pid not in stamps]:
            marks.pop(gone, None)
        return fresh

    def _tick_sequence(self) -> dict | None:
        """Ingest syscalls, grow the n-gram vocabulary, and score the window."""
        if self.seq_tracker is None:
            return None

        if self.seq_socket_source is not None:
            events = self.seq_socket_source.drain()
            if events:
                self.seq_tracker.update_stream(events)
        elif self.seq_sampler is not None:
            # Burst of rapid sub-samples: parked daemons still yield X,X,X (normal),
            # while actively-working processes reveal real syscall transitions.
            bursts = max(1, self.cfg.seq_subsamples)
            gap = max(0.0, self.cfg.seq_subsample_gap_ms / 1000.0)
            for i in range(bursts):
                samples = self.seq_sampler.sample()
                if samples:
                    self.seq_tracker.update(samples)
                if i < bursts - 1 and gap:
                    time.sleep(gap)
        else:
            return None

        # Periodically persist newly observed n-grams so the profile can grow.
        now = time.time()
        if (now - self._last_seq_flush) >= self.cfg.seq_flush_sec:
            pending = self.seq_tracker.drain_pending()
            if pending:
                self.store.upsert_ngram_counts(self.cfg.seq_n, pending)
            self.seq_tracker.evict_idle(older_than=self.cfg.seq_pid_idle_events)
            self._last_seq_flush = now

        if self.seq_model is None:
            return None

        if not self._sequence_evidence_is_fresh(now):
            return None

        # Prefer per-pid windows (classic STIDE): high-volume connect/setuid
        # spam from one process must not dilute a hostile chain on another.
        best: tuple[float, int, list[str], int | None] | None = None
        stamps = self.seq_tracker.pid_stamps()
        for pid, window in self._fresh_pid_windows(
            self.seq_tracker.recent_by_pid(min_len=self.cfg.seq_pid_min_window),
            self._seq_pid_marks,
            stamps,
        ):
            mismatch, misses = self.seq_model.score_window(window)
            if best is None or mismatch > best[0]:
                best = (mismatch, misses, window, pid)
        if best is None:
            window = self.seq_tracker.recent()
            if len(window) >= self.cfg.seq_min_window:
                mismatch, misses = self.seq_model.score_window(window)
                best = (mismatch, misses, window, None)
        if best is None:
            return None
        mismatch, misses, window, pid = best
        if mismatch < self.cfg.seq_mismatch_warn:
            return None
        if (now - self._last_seq_emit) < self.cfg.seq_cooldown_sec:
            return None
        self._last_seq_emit = now
        top = self.seq_model.top_unseen(window, limit=3)
        return _build_sequence_anomaly(
            mismatch, misses, len(window), top, self.cfg, pid=pid
        )

    def _tick_stage8(self) -> dict | None:
        """Stage 8: score reconstructed syscall tokens if a Markov model is ready."""
        if self.deep_scorer is None or self.seq_tracker is None:
            return None
        self.deep_scorer.maybe_reload()
        if not self.deep_scorer.ready:
            return None
        # Same frozen-window trap as Stage 4, and Stage 8 keeps its own mark because
        # both stages read the tracker in the same tick.
        ingested = self.seq_tracker.ingested
        if ingested == self._stage8_scored_at:
            return None
        self._stage8_scored_at = ingested

        # Score per pid and keep the least likely one; the global mix is only a
        # fallback for hosts where no single pid has enough history yet.
        min_tokens = max(8, self.cfg.stage8_window // 4)
        best: tuple[float, dict, int | None] | None = None
        for pid, tokens in self._fresh_pid_windows(
            self.seq_tracker.recent_tokens_by_pid(min_len=min_tokens),
            self._stage8_pid_marks,
            self.seq_tracker.pid_stamps(),
        ):
            score = self.deep_scorer.score_tokens(tokens[-self.cfg.stage8_window :])
            if not score:
                continue
            neg = float(score.get("neg_avg_logprob") or score.get("perplexity") or 0.0)
            if best is None or neg > best[0]:
                best = (neg, score, pid)
        if best is None:
            tokens = self.seq_tracker.recent_tokens()
            if len(tokens) < min_tokens:
                return None
            score = self.deep_scorer.score_tokens(tokens[-self.cfg.stage8_window :])
            if not score:
                return None
            best = (
                float(score.get("neg_avg_logprob") or score.get("perplexity") or 0.0),
                score,
                None,
            )
        neg, score, pid = best
        score["pid"] = pid
        now = time.time()
        # A heartbeat of the score itself: thresholds for a fresh host should be read
        # off the live distribution, not guessed, and later it shows the model is
        # still scoring rather than quietly dormant.
        if (now - self._last_stage8_log) >= self.cfg.stage8_log_every_sec:
            self._last_stage8_log = now
            logger.info(
                "Stage 8 window score: pid=%s neg_avg_logprob=%.3f (warn=%.2f crit=%.2f) worst=%s",
                pid,
                neg,
                self.cfg.stage8_score_warn,
                self.cfg.stage8_score_crit,
                ",".join(str(t) for t in (score.get("worst_tokens") or [])[:3]),
            )
        if neg < self.cfg.stage8_score_warn:
            return None
        if (now - self._last_stage8_emit) < self.cfg.stage8_cooldown_sec:
            return None
        self._last_stage8_emit = now
        return self.deep_scorer.build_anomaly(score, self.cfg)

    def _tick_process(self) -> list[dict]:
        """Stage 5: sample processes, score lineage/baselines, persist whitelist."""
        if self.proc_extractor is None or self.proc_detector is None:
            return []
        samples = self.proc_extractor.collect()
        now = time.time()
        anomalies = self.proc_detector.score(samples, now=now)

        if self.cfg.proc_store_snapshots and samples and (now - self._last_proc_flush) >= self.cfg.proc_flush_sec:
            # Persist a compact interesting subset (already interest-ranked).
            rows = [
                {
                    "pid": s.pid,
                    "ppid": s.ppid,
                    "comm": s.comm,
                    "features": {
                        **s.features,
                        "parent_comm": s.parent_comm,
                        "age_sec": round(s.age_sec, 2),
                        "ruid": s.ruid,
                        "euid": s.euid,
                    },
                }
                for s in samples[:16]
            ]
            try:
                self.store.insert_proc_snapshots(rows)
            except Exception as exc:  # noqa: BLE001
                logger.warning("proc snapshot insert failed: %s", exc)
            pending = self.proc_detector.lineage.drain_pending()
            if pending:
                try:
                    self.store.upsert_lineage_counts(pending)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("lineage upsert failed: %s", exc)
            self._last_proc_flush = now
        return anomalies

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

        # Stage 4 second opinion: anomalous *ordering* of syscalls.
        if self.cfg.enable_stage4:
            try:
                seq_anom = self._tick_sequence()
                if seq_anom is not None:
                    anomalies.append(seq_anom)
            except Exception as exc:  # noqa: BLE001 - never let Stage 4 kill the tick
                logger.warning("sequence scoring failed: %s", exc)

        # Stage 5: which *process* looks odd (lineage / per-comm baselines).
        if self.cfg.enable_stage5:
            try:
                anomalies.extend(self._tick_process())
            except Exception as exc:  # noqa: BLE001 - never let Stage 5 kill the tick
                logger.warning("process scoring failed: %s", exc)

        # Stage 8: deep sequence (Markov/LSTM) — stub no-op without artifact.
        if self.cfg.enable_stage8:
            try:
                deep_anom = self._tick_stage8()
                if deep_anom is not None:
                    anomalies.append(deep_anom)
            except Exception as exc:  # noqa: BLE001
                logger.warning("stage8 scoring failed: %s", exc)

        # Stage 7: ATT&CK / Sigma-lite labels on whatever Stages 1–5 emitted.
        if self.cfg.enable_stage7 and anomalies:
            try:
                from kernel_ai.ml.attribution import enrich_anomalies

                anomalies = enrich_anomalies(
                    anomalies,
                    min_confidence=self.cfg.attack_min_confidence,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("attribution enrich failed: %s", exc)

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
                    self._maybe_load_seq_model()
                    if self.deep_scorer is not None:
                        self.deep_scorer.maybe_reload()
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
