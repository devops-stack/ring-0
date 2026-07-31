"""LSTM / Transformer language-model scorer (Stage 8 stub).

Heavy deps (``torch``) must stay lazy — never import at module top level.
Untrained stub always reports ``ready=False`` and refuses to score.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class LstmScorer:
    """Placeholder for a small causal LM over syscall tokens."""

    backend: str = "lstm"  # lstm | transformer
    meta: dict = field(default_factory=dict)
    _loaded: bool = False

    @property
    def ready(self) -> bool:
        return self._loaded

    def load(self, _path: str) -> None:
        """Load a torch checkpoint. Stub: marks not ready, no torch import."""
        # Future:
        #   import torch
        #   self._model = torch.load(path, map_location="cpu")
        #   self._loaded = True
        self._loaded = False
        raise FileNotFoundError(
            f"Stage 8 {self.backend} artifact not available (stub). "
            "Train offline after Stage 6 data exists — docs/ML_STAGE8.md"
        )

    def score_window(self, _token_ids: list[int]) -> dict | None:
        if not self.ready:
            return None
        return None


def train_lstm_stub(_cfg) -> dict:
    raise SystemExit(
        "Stage 8 LSTM/Transformer training not implemented yet. "
        "Requires torch (lazy), normal-only corpora, and Stage 6 fidelity. "
        "See docs/ML_STAGE8.md."
    )
