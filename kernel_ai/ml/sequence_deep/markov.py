"""Markov / HMM sequence scorer (Stage 8).

Order-1 transition table over syscall / n-gram tokens. Offline training lives
in :mod:`kernel_ai.ml.sequence_deep.train_markov`. Pure Python (no hmmlearn yet).
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

_DIGITS = re.compile(r"\d+")


def comm_context(comm: str | None) -> str | None:
    """Context key for a process: its comm with numbers dropped.

    ``kworker/0:1`` and ``kworker/1:2`` are one kind of process; keying them
    apart would split their history into rows too thin to learn from. systemd
    names a unit's child ``(python)`` until it execs, so the same program shows
    up under both spellings: on PROD a day trained with ``(python)`` doing
    ``connect→setregid`` flagged ``python3`` doing it 390 times the next day.
    """
    if not comm:
        return None
    return _DIGITS.sub("", str(comm)).strip("()") or None


_UNIT_SUFFIXES = (".service", ".scope", ".socket", ".mount", ".swap", ".slice")


def unit_context(cgroup_path: str | None) -> str | None:
    """Context key from a cgroup path: the innermost systemd unit.

    Unlike comm, a process cannot leave its unit without privileges, so a shell
    spawned by nginx is still ``nginx.service``. Instances fold into their
    template (``ssh@12-1.2.3.4:22-….service`` → ``ssh@.service``) and numbers
    are dropped (``session-41.scope`` → ``session-.scope``).
    """
    if cgroup_path is None:
        return None
    parts = [p for p in str(cgroup_path).split("/") if p]
    for name in reversed(parts):
        if name.endswith(_UNIT_SUFFIXES):
            if "@" in name:
                name = name.split("@", 1)[0] + "@" + name[name.rindex(".") :]
            return "unit:" + _DIGITS.sub("", name)
    return "unit:-.slice" if not parts else "unit:" + _DIGITS.sub("", parts[-1])


@dataclass
class MarkovScorer:
    """Order-1 transition table. Untrained → :meth:`score_window` returns None.

    Optionally conditioned on the process (``context``). One table for the whole
    host misjudges whoever is outnumbered: on PROD 99% of ``accept4`` are
    followed by ``bind``, so systemd's per-connection ``accept4→clone`` scored
    11.6 nats and set the normal floor near 6. Per-context rows are smoothed
    towards the global row with weight ``ctx_prior``, so a context with little
    history scores like the global model and a context never seen scores
    exactly like it.
    """

    order: int = 1
    meta: dict = field(default_factory=dict)
    ctx_prior: float = 20.0
    # counts[prev][nxt] = count
    _counts: dict[str, dict[str, int]] = field(default_factory=dict)
    _row_totals: dict[str, int] = field(default_factory=dict)
    # How often each token appears as a destination, and the grand total. Used to
    # back off when the *source* token was never seen at all.
    _token_totals: dict[str, int] = field(default_factory=dict)
    _total: int = 0
    # ctx_counts[context][prev][nxt] = count
    _ctx_counts: dict[str, dict[str, dict[str, int]]] = field(default_factory=dict)
    _ctx_row_totals: dict[str, dict[str, int]] = field(default_factory=dict)

    @property
    def ready(self) -> bool:
        return bool(self._counts)

    @property
    def contextual(self) -> bool:
        return bool(self._ctx_counts)

    def observe_pair(self, a: str, b: str, context: str | None = None, weight: int = 1) -> None:
        row = self._counts.setdefault(a, {})
        row[b] = row.get(b, 0) + weight
        self._row_totals[a] = self._row_totals.get(a, 0) + weight
        self._token_totals[b] = self._token_totals.get(b, 0) + weight
        self._total += weight
        if context:
            crow = self._ctx_counts.setdefault(context, {}).setdefault(a, {})
            crow[b] = crow.get(b, 0) + weight
            totals = self._ctx_row_totals.setdefault(context, {})
            totals[a] = totals.get(a, 0) + weight

    def _global_prob(self, prev: str, nxt: str, vocab: int) -> float:
        row_total = self._row_totals.get(prev, 0)
        # Laplace-ish smoothing so unseen transitions are finite but rare.
        if row_total:
            cnt = (self._counts.get(prev) or {}).get(nxt, 0)
            return (cnt + 1.0) / (row_total + vocab)
        # This syscall was never seen as a source at all. Backing off to
        # ``1/vocab`` made such a step look *certain* in a small model (and
        # cheap in a large one); score it against the whole corpus instead,
        # so a chain of never-seen syscalls reads as the surprise it is.
        return (self._token_totals.get(nxt, 0) + 1.0) / (self._total + vocab)

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
            self.observe_pair(a, b, weight=weight)

    def score_window(self, tokens: list[str], context: str | None = None) -> dict | None:
        """Return neg-avg-logprob style score, or None if untrained / too short."""
        if not self.ready or len(tokens) < 2:
            return None
        vocab = max(1, len(self._counts))
        ctx_rows = self._ctx_counts.get(context) if context else None
        ctx_totals = self._ctx_row_totals.get(context) if context else None
        total = 0.0
        n = 0
        worst_i = 1
        worst_lp = 0.0
        for i in range(1, len(tokens)):
            prev, nxt = tokens[i - 1], tokens[i]
            prob = self._global_prob(prev, nxt, vocab)
            if ctx_rows is not None:
                row_total = ctx_totals.get(prev, 0)
                if row_total:
                    cnt = (ctx_rows.get(prev) or {}).get(nxt, 0)
                    prob = (cnt + self.ctx_prior * prob) / (row_total + self.ctx_prior)
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
            # The average dilutes one wrong step among sixty ordinary ones to
            # nothing; the single least likely transition does not.
            "worst_neg_logprob": round(-worst_lp, 4),
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
            "ctx_prior": self.ctx_prior,
            "ctx_counts": self._ctx_counts,
            "ctx_row_totals": self._ctx_row_totals,
        }

    @classmethod
    def from_state(cls, state: dict) -> "MarkovScorer":
        m = cls(
            order=int(state.get("order") or 1),
            meta=dict(state.get("meta") or {}),
            ctx_prior=float(state.get("ctx_prior") or 20.0),
        )
        m._ctx_counts = {
            c: {a: dict(r) for a, r in rows.items()}
            for c, rows in (state.get("ctx_counts") or {}).items()
        }
        m._ctx_row_totals = {c: dict(t) for c, t in (state.get("ctx_row_totals") or {}).items()}
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
