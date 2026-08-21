"""Supervised HTTP-attempt model. MLflow-free; the worker only loads joblib."""

from __future__ import annotations

import os
import shutil
from dataclasses import dataclass, field
from typing import Any

import joblib

from kernel_ai.ml.http_features import HTTP_FEATURE_ORDER


@dataclass
class HttpAttemptModel:
    feature_names: list[str] = field(default_factory=lambda: list(HTTP_FEATURE_ORDER))
    model: Any = None
    meta: dict = field(default_factory=dict)

    def fit(self, matrix: list[list[float]], labels: list[int], *, random_state: int = 42) -> "HttpAttemptModel":
        from sklearn.linear_model import LogisticRegression

        clf = LogisticRegression(
            max_iter=400,
            class_weight="balanced",
            random_state=random_state,
        )
        clf.fit(matrix, labels)
        self.model = clf
        self.meta.update(
            {
                "n_samples": len(matrix),
                "n_features": len(self.feature_names),
                "n_attempt": int(sum(labels)),
                "n_benign": int(len(labels) - sum(labels)),
                "algo": "logreg",
            }
        )
        return self

    def _vectorize(self, features: dict[str, float]) -> list[float]:
        return [float(features.get(name, 0.0)) for name in self.feature_names]

    def predict_one(self, features: dict[str, float]) -> tuple[bool, float]:
        """Return (is_attempt, probability of attempt)."""
        if self.model is None:
            return False, 0.0
        vec = [self._vectorize(features)]
        proba = float(self.model.predict_proba(vec)[0][1])
        return proba >= 0.5, proba

    def predict_matrix(self, matrix: list[list[float]]) -> list[float]:
        if self.model is None or not matrix:
            return []
        return [float(p[1]) for p in self.model.predict_proba(matrix)]

    def save(self, path: str) -> None:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        joblib.dump(
            {"feature_names": self.feature_names, "model": self.model, "meta": self.meta},
            path,
        )

    @classmethod
    def load(cls, path: str) -> "HttpAttemptModel":
        blob = joblib.load(path)
        return cls(
            feature_names=list(blob.get("feature_names") or HTTP_FEATURE_ORDER),
            model=blob.get("model"),
            meta=dict(blob.get("meta") or {}),
        )


def promote_artifact(new_path: str, latest_path: str, prev_path: str) -> None:
    """Keep the previous latest as rollback, then replace latest."""
    if os.path.exists(latest_path):
        os.makedirs(os.path.dirname(prev_path) or ".", exist_ok=True)
        shutil.copy2(latest_path, prev_path)
    os.makedirs(os.path.dirname(latest_path) or ".", exist_ok=True)
    shutil.copy2(new_path, latest_path)


def rollback_artifact(latest_path: str, prev_path: str) -> bool:
    if not os.path.exists(prev_path):
        return False
    shutil.copy2(prev_path, latest_path)
    return True
