"""Syscall / n-gram → integer id encoding (Stage 8 stub).

Future: fit a vocab on normal windows (ml_syscall_ngrams / ADFA-LD), persist
beside the model artifact, pad/truncate online windows for Markov/LSTM.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SequenceEncoder:
    """Bidirectional token ↔ id map. Untrained stub has an empty vocab."""

    unk_token: str = "<unk>"
    pad_token: str = "<pad>"
    token_to_id: dict[str, int] = field(default_factory=dict)
    id_to_token: dict[int, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.token_to_id:
            self.token_to_id = {self.pad_token: 0, self.unk_token: 1}
            self.id_to_token = {0: self.pad_token, 1: self.unk_token}

    @property
    def ready(self) -> bool:
        # More than pad/unk means a real vocab was loaded/fitted.
        return len(self.token_to_id) > 2

    def fit(self, tokens: list[str]) -> None:
        for tok in tokens:
            if tok not in self.token_to_id:
                idx = len(self.token_to_id)
                self.token_to_id[tok] = idx
                self.id_to_token[idx] = tok

    def encode(self, tokens: list[str], *, length: int | None = None) -> list[int]:
        unk = self.token_to_id[self.unk_token]
        ids = [self.token_to_id.get(t, unk) for t in tokens]
        if length is None:
            return ids
        if len(ids) >= length:
            return ids[-length:]
        pad = self.token_to_id[self.pad_token]
        return [pad] * (length - len(ids)) + ids

    def decode(self, ids: list[int]) -> list[str]:
        return [self.id_to_token.get(i, self.unk_token) for i in ids]

    def state_dict(self) -> dict:
        return {
            "unk_token": self.unk_token,
            "pad_token": self.pad_token,
            "token_to_id": dict(self.token_to_id),
        }

    @classmethod
    def from_state(cls, state: dict) -> "SequenceEncoder":
        enc = cls(
            unk_token=state.get("unk_token", "<unk>"),
            pad_token=state.get("pad_token", "<pad>"),
        )
        enc.token_to_id = dict(state.get("token_to_id") or enc.token_to_id)
        enc.id_to_token = {int(v): k for k, v in enc.token_to_id.items()}
        return enc
