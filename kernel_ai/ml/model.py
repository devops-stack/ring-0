"""Stage 2 model: scikit-learn IsolationForest wrapper.

IsolationForest learns the *shape* of normal multivariate behaviour and flags
points that are easy to "isolate" (few random splits) as anomalies. Unlike the
Stage 1 per-feature z-score, it can catch anomalies that only show up as an
unusual *combination* of features (e.g. high syscalls + low CPU + high retrans).

This module is deliberately MLflow-free: it only knows how to fit / save / load /
score. Experiment tracking lives in :mod:`kernel_ai.ml.train`; the inference
worker just loads the saved artifact via joblib. Tree-based -> no feature
scaling needed, which keeps the artifact simple.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import joblib


@dataclass
class IsolationForestModel:
    feature_names: list[str]
    model: Any = None
    meta: dict = field(default_factory=dict)

    def fit(
        self,
        matrix: list[list[float]],
        *,
        contamination: float = 0.02,
        n_estimators: int = 200,
        random_state: int = 42,
    ) -> "IsolationForestModel":
        from sklearn.ensemble import IsolationForest

        clf = IsolationForest(
            n_estimators=n_estimators,
            contamination=contamination,
            random_state=random_state,
            n_jobs=1,
        )
        clf.fit(matrix)
        self.model = clf
        self.meta.update(
            {
                "contamination": contamination,
                "n_estimators": n_estimators,
                "n_samples": len(matrix),
                "n_features": len(self.feature_names),
            }
        )
        return self

    def _vectorize(self, features: dict[str, float]) -> list[float]:
        return [float(features.get(name, 0.0)) for name in self.feature_names]

    def score_one(self, features: dict[str, float]) -> tuple[bool, float]:
        """Return (is_anomaly, anomaly_score).

        anomaly_score is ``-decision_function``: higher = more anomalous, and
        crosses 0 at the model's learned normal/anomalous boundary.
        """
        if self.model is None:
            return False, 0.0
        vec = [self._vectorize(features)]
        is_anomaly = bool(self.model.predict(vec)[0] == -1)
        anomaly_score = float(-self.model.decision_function(vec)[0])
        return is_anomaly, anomaly_score

    def score_matrix(self, matrix: list[list[float]]) -> list[float]:
        if self.model is None or not matrix:
            return []
        return [float(-s) for s in self.model.decision_function(matrix)]

    def save(self, path: str) -> None:
        joblib.dump(
            {"feature_names": self.feature_names, "model": self.model, "meta": self.meta},
            path,
        )

    @classmethod
    def load(cls, path: str) -> "IsolationForestModel":
        blob = joblib.load(path)
        return cls(
            feature_names=blob["feature_names"],
            model=blob["model"],
            meta=blob.get("meta", {}),
        )
