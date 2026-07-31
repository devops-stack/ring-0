"""Stage 8 — deep sequence models (HMM → LSTM/Transformer). Stub package.

Real training/inference lands later; this module locks the API so Stage 4/6
windows can plug in without reshaping the worker. See ``docs/ML_STAGE8.md``.
"""

from kernel_ai.ml.sequence_deep.scorer import DeepSequenceScorer

__all__ = ["DeepSequenceScorer"]
