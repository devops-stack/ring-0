"""Markov / HMM sequence scorer (Stage 8).

Order-1 transition table over syscall / n-gram tokens. Offline training lives
in :mod:`kernel_ai.ml.sequence_deep.train_markov`. Pure Python (no hmmlearn yet).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class MarkovScorer:
    """Order-1 transition table. Untrained → :meth:`score_window` returns None."""

    order: int = 1
    meta: dict = field(default_factory=dict)
    # counts[prev][nxt] = count
    _counts: dict[str, dict[str, int]] = field(default_factory=dict)
    _row_totals: dict[str, int] = field(default_factory=dict)
    # How often each token appears as a destination, and the grand total. Used to
    # back off when the *source* token was never seen at all.
    _token_totals: dict[str, int] = field(default_factory=dict)
    _total: int = 0

    @property
    def ready(self) -> bool:
        return bool(self._counts)

    def observe(self, tokens: list[str], *, weight: int = 1) -> None:
        """Fold a sequence into the table; ``weight`` is how often it was seen.

        Weights matter: the corpus is a table of n-grams with counts spanning five
        orders of magnitude (``accept4|accept4|accept4`` 256k vs a chain seen three
        times). Materialising repeats to represent that is wasteful, and capping them
        flattens the model into "everything is roughly equally likely" — which is the
        one thing a transition model must not believe.
        """
        if len(tokens) < 2 or weight <= 0:
            return
        for a, b in zip(tokens, tokens[1:]):
            row = self._counts.setdefault(a, {})
            row[b] = row.get(b, 0) + weight
            self._row_totals[a] = self._row_totals.get(a, 0) + weight
            self._token_totals[b] = self._token_totals.get(b, 0) + weight
            self._total += weight

    def score_window(self, tokens: list[str]) -> dict | None:
        """Return neg-avg-logprob style score, or None if untrained / too short."""
        if not self.ready or len(tokens) < 2:
            return None
        total = 0.0
        n = 0
        worst_i = 1
        worst_lp = 0.0
        for i in range(1, len(tokens)):
            prev, nxt = tokens[i - 1], tokens[i]
            row_total = self._row_totals.get(prev, 0)
            # Laplace-ish smoothing so unseen transitions are finite but rare.
            vocab = max(1, len(self._counts))
            if row_total:
                cnt = (self._counts.get(prev) or {}).get(nxt, 0)
                prob = (cnt + 1.0) / (row_total + vocab)
            else:
                # This syscall was never seen as a source at all. Backing off to
                # ``1/vocab`` made such a step look *certain* in a small model (and
                # cheap in a large one); score it against the whole corpus instead,
                # so a chain of never-seen syscalls reads as the surprise it is.
                prob = (self._token_totals.get(nxt, 0) + 1.0) / (self._total + vocab)
            lp = math.log(max(prob, 1e-12))
            total += lp
            n += 1
            if lp < worst_lp:
                worst_lp = lp
                worst_i = i
        if n <= 0:
            return None
        avg_lp = total / n
        return {
            "model": "markov",
            "neg_avg_logprob": round(-avg_lp, 4),
            "avg_logprob": round(avg_lp, 4),
            "worst_index": worst_i,
            "worst_tokens": tokens[max(0, worst_i - 1) : worst_i + 1],
            "window_len": len(tokens),
        }

    def state_dict(self) -> dict:
        return {
            "order": self.order,
            "meta": dict(self.meta),
            "counts": self._counts,
            "row_totals": self._row_totals,
            "token_totals": self._token_totals,
            "total": self._total,
        }

    @classmethod
    def from_state(cls, state: dict) -> "MarkovScorer":
        m = cls(order=int(state.get("order") or 1), meta=dict(state.get("meta") or {}))
        m._counts = {k: dict(v) for k, v in (state.get("counts") or {}).items()}
        m._row_totals = {k: int(v) for k, v in (state.get("row_totals") or {}).items()}
        token_totals = state.get("token_totals")
        if token_totals is None:
            # Artifact from before the back-off was added: derive it from the table.
            token_totals = {}
            for row in m._counts.values():
                for nxt, cnt in row.items():
                    token_totals[nxt] = token_totals.get(nxt, 0) + int(cnt)
        m._token_totals = {k: int(v) for k, v in token_totals.items()}
        m._total = int(state.get("total") or sum(m._row_totals.values()))
        return m


def train_markov_stub(cfg) -> dict:
    """Backward-compatible name → real trainer (prefer ``train_markov``)."""
    from kernel_ai.ml.sequence_deep.train_markov import train_markov

    return train_markov(cfg, use_synthetic=True)
