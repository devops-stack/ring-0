"""Facade used by the ML worker for Stage 8 online scoring (stub-safe)."""

from __future__ import annotations

import logging
import os
from typing import Any

from kernel_ai.ml.sequence_deep.encode import SequenceEncoder
from kernel_ai.ml.sequence_deep.markov import MarkovScorer

logger = logging.getLogger("kernel_ai.ml.sequence_deep")


class DeepSequenceScorer:
    """Hot-reloadable Stage 8 scorer.

    Prefer Markov artifact when present; LSTM path is wired but stubbed.
    If nothing is trained, :meth:`score_tokens` returns None (no mutations).
    """

    def __init__(self, cfg: Any) -> None:
        self.cfg = cfg
        self.encoder = SequenceEncoder()
        self.markov = MarkovScorer()
        self.lstm = None
        self._markov_mtime: float | None = None
        self._lstm_mtime: float | None = None
        self.maybe_reload()

    def maybe_reload(self) -> None:
        path = getattr(self.cfg, "stage8_markov_path", "") or ""
        if path:
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                mtime = None
            if mtime is not None and (self._markov_mtime is None or mtime > self._markov_mtime):
                try:
                    import joblib

                    state = joblib.load(path)
                    if isinstance(state, dict) and "encoder" in state:
                        self.encoder = SequenceEncoder.from_state(state["encoder"])
                        self.markov = MarkovScorer.from_state(state.get("markov") or {})
                    else:
                        self.markov = MarkovScorer.from_state(state if isinstance(state, dict) else {})
                    self._markov_mtime = mtime
                    logger.info("loaded Stage 8 Markov artifact: %s", path)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Stage 8 Markov load failed: %s", exc)

        lstm_path = getattr(self.cfg, "stage8_lstm_path", "") or ""
        if lstm_path and os.path.exists(lstm_path):
            try:
                mtime = os.path.getmtime(lstm_path)
            except OSError:
                return
            if self._lstm_mtime is not None and mtime <= self._lstm_mtime:
                return
            try:
                from kernel_ai.ml.sequence_deep.lstm import LstmScorer

                scorer = LstmScorer(backend=getattr(self.cfg, "stage8_backend", "lstm"))
                scorer.load(lstm_path)
                self.lstm = scorer
                self._lstm_mtime = mtime
            except Exception as exc:  # noqa: BLE001
                logger.info("Stage 8 LSTM idle (stub/untrained): %s", exc)

    @property
    def ready(self) -> bool:
        return self.markov.ready or (self.lstm is not None and self.lstm.ready)

    def score_tokens(self, tokens: list[str]) -> dict | None:
        """Score an ordered token window (syscall names or n-gram keys)."""
        self.maybe_reload()
        if not tokens:
            return None
        if self.markov.ready:
            return self.markov.score_window(tokens)
        if self.lstm is not None and self.lstm.ready:
            ids = self.encoder.encode(tokens, length=getattr(self.cfg, "stage8_window", 64))
            return self.lstm.score_window(ids)
        return None

    def build_anomaly(self, score: dict, cfg: Any) -> dict:
        """Map a Stage 8 score dict onto the shared mutation contract."""
        neg = float(score.get("neg_avg_logprob") or score.get("perplexity") or 0.0)
        warn = float(getattr(cfg, "stage8_score_warn", 3.0))
        crit = float(getattr(cfg, "stage8_score_crit", 5.0))
        severity = "high" if neg >= crit else "medium"
        worst = score.get("worst_tokens") or []
        why = " → ".join(str(t) for t in worst) if worst else score.get("model", "deep-seq")
        pid = score.get("pid")
        pid_bit = f" pid={pid}" if pid else ""
        return {
            "source": "stage8_sequence",
            "feature": "syscall_seq_deep",
            "subsystem": "sched",
            "type": "syscall_sequence_deep",
            "severity": severity,
            "score": round(neg, 4),
            "value": float(score.get("window_len") or 0),
            "baseline_mean": None,
            "baseline_std": None,
            "position": 0.18,
            "message": (
                f"Deep sequence model ({score.get('model', '?')}){pid_bit}: "
                f"neg_avg_logprob={neg:.2f} (warn={warn}); unlikely transition near {why}"
            ),
            "meta": {
                "stage": 8,
                "pid": pid,
                "model": score.get("model"),
                "perplexity": score.get("perplexity"),
                "neg_avg_logprob": neg,
                "worst_index": score.get("worst_index"),
                "worst_tokens": worst,
            },
        }
