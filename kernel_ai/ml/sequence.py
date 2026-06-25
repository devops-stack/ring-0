"""Stage 4: syscall *sequence* anomaly detection (STIDE-style n-grams).

Stages 1-3 score the system on aggregate *features* (rates, pressures). They are
blind to the **order** of operations. A classic host-IDS insight (Forrest et al.,
"A Sense of Self for Unix Processes") is that normal programs emit a small, stable
vocabulary of short syscall *sequences*; intrusions produce sequences never seen
during normal operation. STIDE (Sequence TIme-Delay Embedding) learns the set of
normal n-grams and flags windows with a high fraction of unseen n-grams.

Data source (honesty note): we don't have a continuous syscall tracer here, so we
*sample* ``/proc/<pid>/syscall`` each worker tick (the syscall a task is currently
in). This is a coarse L0 signal -- it misses fast transitions -- but it needs zero
privileges/deps and demonstrates the sequence approach end to end. Swapping in an
eBPF/auditd tracer (L2) later only changes the sampler, not the model.

Components:
    SyscallSampler  - read current syscall per pid from procfs
    NgramTracker    - per-pid rolling deques -> stream of syscall n-grams
    StideModel      - set of "normal" n-grams + window mismatch scoring
"""

from __future__ import annotations

import logging
import os
from collections import deque
from dataclasses import dataclass, field

from kernel_ai.services.kernel_maps import SYSCALL_NAMES

logger = logging.getLogger("kernel_ai.ml.sequence")

# Separator for serialising an n-gram tuple into a stable string key.
_SEP = "|"


class SyscallSampler:
    """Sample the current syscall of running processes from procfs."""

    def __init__(self, max_pids: int = 160) -> None:
        self.max_pids = max_pids

    def sample(self) -> dict[int, str]:
        """Return ``{pid: syscall_name}`` for tasks currently in a syscall."""
        out: dict[int, str] = {}
        try:
            pids = sorted((int(d) for d in os.listdir("/proc") if d.isdigit()))
        except OSError:
            return out
        for pid in pids[: self.max_pids]:
            path = f"/proc/{pid}/syscall"
            try:
                with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                    line = fh.read().strip()
            except (OSError, PermissionError):
                continue
            if not line or line == "-1" or line.startswith("running"):
                continue
            head = line.split(" ", 1)[0]
            try:
                num = int(head)
            except ValueError:
                continue
            if num < 0:
                continue
            out[int(pid)] = SYSCALL_NAMES.get(num, f"sys_{num}")
        return out


class NgramTracker:
    """Maintain per-pid syscall histories and emit n-grams as they complete.

    A new n-gram is produced whenever a pid's rolling history reaches length ``n``.
    Consecutive identical samples (a task parked in one syscall) naturally form
    homogeneous n-grams -- those are normal and end up in the profile.
    """

    def __init__(self, n: int = 3, window: int = 400, max_pids: int = 4096) -> None:
        self.n = max(2, n)
        self.window = window
        self.max_pids = max_pids
        self._hist: dict[int, deque[str]] = {}
        # Rolling window of recent n-gram keys used for live scoring.
        self._recent: deque[str] = deque(maxlen=window)
        # Counts of every n-gram observed since the last flush (profile growth).
        self._pending: dict[str, int] = {}

    def update(self, samples: dict[int, str]) -> None:
        # Drop histories for pids that vanished to bound memory.
        if len(self._hist) > self.max_pids:
            for dead in [p for p in self._hist if p not in samples]:
                self._hist.pop(dead, None)

        for pid, name in samples.items():
            hist = self._hist.get(pid)
            if hist is None:
                hist = deque(maxlen=self.n)
                self._hist[pid] = hist
            hist.append(name)
            if len(hist) == self.n:
                key = _SEP.join(hist)
                self._recent.append(key)
                self._pending[key] = self._pending.get(key, 0) + 1

    def recent(self) -> list[str]:
        return list(self._recent)

    def drain_pending(self) -> dict[str, int]:
        """Return + clear n-gram counts accumulated since the last drain."""
        pending = self._pending
        self._pending = {}
        return pending


@dataclass
class StideModel:
    """A "normal" n-gram vocabulary with window-mismatch scoring."""

    n: int
    ngrams: set[str] = field(default_factory=set)
    meta: dict = field(default_factory=dict)

    def score_window(self, window: list[str]) -> tuple[float, int]:
        """Return ``(mismatch_rate, n_mismatches)`` for a window of n-gram keys.

        mismatch_rate = fraction of n-grams in the window not present in the
        learned normal vocabulary. High rate -> the system is doing things in an
        order it never did while the profile was learned.
        """
        if not window:
            return 0.0, 0
        misses = sum(1 for g in window if g not in self.ngrams)
        return misses / len(window), misses

    def top_unseen(self, window: list[str], limit: int = 3) -> list[str]:
        """Most frequent unseen n-grams in the window (for an explainable cause)."""
        counts: dict[str, int] = {}
        for g in window:
            if g not in self.ngrams:
                counts[g] = counts.get(g, 0) + 1
        ordered = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
        return [g.replace(_SEP, "→") for g, _ in ordered[:limit]]

    def save(self, path: str) -> None:
        import joblib

        os.makedirs(os.path.dirname(path), exist_ok=True)
        joblib.dump({"n": self.n, "ngrams": self.ngrams, "meta": self.meta}, path)

    @classmethod
    def load(cls, path: str) -> "StideModel":
        import joblib

        obj = joblib.load(path)
        return cls(n=int(obj["n"]), ngrams=set(obj["ngrams"]), meta=dict(obj.get("meta", {})))


def build_profile(cfg) -> dict:
    """(Re)build the STIDE normal profile from accumulated n-gram counts.

    Frequency-based poison guard: only n-grams seen at least ``seq_min_ngram_count``
    times enter the profile, so a one-off attack sequence never becomes "normal".
    Returns a small metrics dict; raises SystemExit if there isn't enough data yet.
    """
    from kernel_ai.ml.store import fetch_ngram_counts

    counts = fetch_ngram_counts(cfg.dsn, n=cfg.seq_n)
    total = len(counts)
    if total < cfg.seq_min_vocab:
        raise SystemExit(
            f"Not enough syscall n-grams to build STIDE profile "
            f"(have {total}, need >={cfg.seq_min_vocab})"
        )

    kept = {g for g, c in counts.items() if c >= cfg.seq_min_ngram_count}
    if not kept:
        raise SystemExit("STIDE profile empty after frequency filter; lower SEQ_MIN_COUNT or collect more data")

    meta = {
        "stage": 4,
        "n": cfg.seq_n,
        "vocab_total": total,
        "vocab_kept": len(kept),
        "min_count": cfg.seq_min_ngram_count,
    }
    model = StideModel(n=cfg.seq_n, ngrams=kept, meta=meta)
    model.save(cfg.seq_model_path)
    logger.info(
        "saved STIDE profile -> %s (kept %d/%d n-grams, n=%d)",
        cfg.seq_model_path, len(kept), total, cfg.seq_n,
    )
    return meta


def main() -> None:
    import logging as _logging

    from kernel_ai.ml.config import MLConfig

    _logging.basicConfig(level=_logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    meta = build_profile(MLConfig())
    logger.info("STIDE build done: %s", meta)


if __name__ == "__main__":
    main()
