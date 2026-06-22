"""Kernel-AI anomaly detection pipeline (Stage 1: statistical baselines).

This package is intentionally decoupled from the Flask request path:

    collect features -> update baseline -> score -> persist anomalies

The long-running detector lives in :mod:`kernel_ai.ml.worker` and runs as a
separate process (``python -m kernel_ai.ml``). The Flask app only *reads*
already-computed anomalies from the shared store, so a fault in the ML side can
never block or crash the main service.

Stages (see docs/KERNEL_DNA_AIML_ROADMAP.md):
    Stage 1 (this code) - online EWMA baselines + robust z-score, pure-Python.
    Stage 2+            - scikit-learn models, MLflow tracking (added later).
"""

from kernel_ai.ml.config import MLConfig

__all__ = ["MLConfig"]
