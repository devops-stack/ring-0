"""Offline Markov training for Stage 8.

Corpus sources (first that yields enough transitions wins, unless forced):
  1. ``--corpus`` text file — one sequence per line (tokens separated by space or ``|``)
  2. Postgres ``ml_syscall_ngrams`` — expand n-gram keys by their counts
  3. ``--synthetic`` — built-in “normal” hostish sequences (local demo / CI)

Writes ``cfg.stage8_markov_path`` joblib: ``{encoder, markov}`` for worker hot-reload.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import joblib

from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.sequence_deep.encode import SequenceEncoder
from kernel_ai.ml.sequence_deep.markov import MarkovScorer

logger = logging.getLogger("kernel_ai.ml.sequence_deep.train")

# Quiet, repetitive patterns a normal host tends to emit (demo prior only).
_SYNTHETIC_NORMAL = [
    ["read", "read", "write", "read", "close"],
    ["futex", "futex", "poll", "futex"],
    ["recvfrom", "recvfrom", "sendto", "recvfrom"],
    ["epoll_wait", "epoll_wait", "read", "write", "epoll_wait"],
    ["mmap", "munmap", "mmap", "munmap"],
    ["openat", "read", "read", "close"],
    ["openat", "fstat", "read", "close"],
    ["clone", "futex", "futex", "exit"],
    ["rt_sigaction", "rt_sigprocmask", "nanosleep"],
    ["getpid", "gettid", "clock_gettime"],
    ["stat", "openat", "read", "close", "stat"],
    ["write", "write", "fdatasync"],
]


def _parse_line(line: str) -> list[str]:
    line = line.strip()
    if not line or line.startswith("#"):
        return []
    if "|" in line and " " not in line.split("|")[0]:
        return [t for t in line.split("|") if t]
    return [t for t in line.split() if t]


def load_corpus_file(path: str | Path) -> list[list[str]]:
    sequences: list[list[str]] = []
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            seq = _parse_line(line)
            if len(seq) >= 2:
                sequences.append(seq)
    return sequences


def load_corpus_ngrams(dsn: str, *, n: int, min_count: int = 1) -> list[tuple[list[str], int]]:
    """Return ``(tokens, weight)`` where the weight is the observed n-gram count."""
    from kernel_ai.ml.store import fetch_ngram_counts

    counts = fetch_ngram_counts(dsn, n=n)
    sequences: list[tuple[list[str], int]] = []
    for key, cnt in counts.items():
        if cnt < min_count:
            continue
        toks = [t for t in str(key).split("|") if t]
        if len(toks) < 2:
            continue
        sequences.append((toks, int(cnt)))
    return sequences


def load_corpus_synthetic(*, repeats: int = 40) -> list[list[str]]:
    sequences: list[list[str]] = []
    for _ in range(max(1, repeats)):
        sequences.extend(seq[:] for seq in _SYNTHETIC_NORMAL)
    return sequences


def _count_transitions(sequences: list[tuple[list[str], int]]) -> int:
    return sum(max(0, len(s) - 1) * w for s, w in sequences)


def train_markov(
    cfg: MLConfig | None = None,
    *,
    corpus_path: str | None = None,
    use_ngrams: bool = True,
    use_synthetic: bool = False,
    min_transitions: int = 50,
) -> dict:
    """Fit Markov + encoder and persist artifact. Returns metrics dict."""
    cfg = cfg or MLConfig()
    sequences: list[tuple[list[str], int]] = []
    source = "empty"

    if corpus_path:
        sequences = [(seq, 1) for seq in load_corpus_file(corpus_path)]
        source = f"file:{corpus_path}"
    elif use_synthetic:
        sequences = [(seq, 1) for seq in load_corpus_synthetic()]
        source = "synthetic"
    elif use_ngrams:
        try:
            sequences = load_corpus_ngrams(cfg.dsn, n=cfg.seq_n, min_count=cfg.seq_min_ngram_count)
            source = "ml_syscall_ngrams"
        except Exception as exc:  # noqa: BLE001
            logger.warning("ngram corpus unavailable (%s) — falling back to synthetic", exc)
            sequences = [(seq, 1) for seq in load_corpus_synthetic()]
            source = "synthetic_fallback"

    n_trans = _count_transitions(sequences)
    if n_trans < min_transitions:
        raise SystemExit(
            f"Not enough transitions to train Markov (have {n_trans}, need >={min_transitions}, source={source}). "
            "Provide --corpus, accumulate Stage 4/6 n-grams, or pass --synthetic."
        )

    encoder = SequenceEncoder()
    markov = MarkovScorer(order=1, meta={"stage": 8, "source": source})
    for seq, weight in sequences:
        encoder.fit(seq)
        markov.observe(seq, weight=weight)

    artifact = {
        "encoder": encoder.state_dict(),
        "markov": markov.state_dict(),
    }
    out_path = cfg.stage8_markov_path
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    joblib.dump(artifact, out_path)

    # Self-check against the corpus itself. The synthetic probes below stay for
    # continuity, but they are meaningless for an audit-sourced model: they are made
    # of tokens (read/write/close) the audit allowlist never emits, so they only
    # measure the unknown-token penalty. The corpus probes compare the most and the
    # least frequent real sequences, which is what separation actually means here.
    ranked = sorted(sequences, key=lambda sw: sw[1], reverse=True)
    common_score = markov.score_window(ranked[0][0]) if ranked else None
    rare_score = markov.score_window(ranked[-1][0]) if ranked else None
    normal_score = markov.score_window(_SYNTHETIC_NORMAL[0])
    weird_score = markov.score_window(["openat", "execve", "connect", "dup2"])
    metrics = {
        "source": source,
        "n_sequences": len(sequences),
        "n_transitions": n_trans,
        "vocab": len(encoder.token_to_id),
        "states": len(markov._counts),
        "path": out_path,
        "corpus_common": "|".join(ranked[0][0]) if ranked else None,
        "corpus_common_neg_avg_logprob": (common_score or {}).get("neg_avg_logprob"),
        "corpus_rare_neg_avg_logprob": (rare_score or {}).get("neg_avg_logprob"),
        "normal_neg_avg_logprob": (normal_score or {}).get("neg_avg_logprob"),
        "weird_neg_avg_logprob": (weird_score or {}).get("neg_avg_logprob"),
    }
    logger.info(
        "saved Stage 8 Markov → %s (source=%s transitions=%d vocab=%d)",
        out_path,
        source,
        n_trans,
        metrics["vocab"],
    )
    return metrics
