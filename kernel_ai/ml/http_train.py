"""Train the Stage 9 HTTP-attempt model with a champion/challenger gate."""

from __future__ import annotations

import argparse
import logging
import os
import tempfile

from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.http_features import HTTP_FEATURE_ORDER
from kernel_ai.ml.http_model import HttpAttemptModel, promote_artifact, rollback_artifact
from kernel_ai.ml.store import fetch_http_labels

logger = logging.getLogger("kernel_ai.ml.http_train")


def _rows_to_xy(rows: list[dict]) -> tuple[list[list[float]], list[int], list[str]]:
    matrix: list[list[float]] = []
    labels: list[int] = []
    classes: list[str] = []
    for row in rows:
        label = str(row.get("label") or "")
        if label not in {"attempt", "benign"}:
            continue
        feats = row.get("features") if isinstance(row.get("features"), dict) else {}
        matrix.append([float(feats.get(name, 0.0)) for name in HTTP_FEATURE_ORDER])
        labels.append(1 if label == "attempt" else 0)
        classes.append(str(row.get("cls") or ("anomaly" if label == "attempt" else "benign")))
    return matrix, labels, classes


def _split(matrix, labels, classes, *, holdout: float = 0.25):
    n = len(matrix)
    cut = max(1, int(n * (1.0 - holdout))) if n > 4 else n
    return (
        matrix[:cut],
        labels[:cut],
        classes[:cut],
        matrix[cut:],
        labels[cut:],
        classes[cut:],
    )


def _precision(probs: list[float], labels: list[int], *, threshold: float = 0.5) -> float:
    pred = [1 if p >= threshold else 0 for p in probs]
    tp = sum(1 for p, y in zip(pred, labels) if p == 1 and y == 1)
    fp = sum(1 for p, y in zip(pred, labels) if p == 1 and y == 0)
    return tp / (tp + fp) if (tp + fp) else 0.0


def _flag_rate(probs: list[float], *, threshold: float = 0.5) -> float:
    if not probs:
        return 0.0
    return sum(1 for p in probs if p >= threshold) / len(probs)


def train(cfg: MLConfig, *, min_samples: int, hours: int = 168, persist: bool = True) -> dict:
    rows = fetch_http_labels(cfg.dsn, hours=hours, limit=50000)
    matrix, labels, classes = _rows_to_xy(rows)
    n = len(matrix)
    n_attempt = sum(labels)
    if n < min_samples or n_attempt < 3 or (n - n_attempt) < 3:
        raise SystemExit(
            f"Not enough labeled HTTP windows: n={n} attempt={n_attempt} "
            f"(need >= {min_samples} and both classes). Run http_label first."
        )

    train_x, train_y, _, hold_x, hold_y, _ = _split(matrix, labels, classes)
    if not hold_x:
        hold_x, hold_y = train_x, train_y

    model = HttpAttemptModel()
    model.fit(train_x, train_y)
    hold_p = model.predict_matrix(hold_x)
    precision = _precision(hold_p, hold_y)
    flag_rate = _flag_rate(hold_p)
    metrics = {
        "n_samples": float(n),
        "n_attempt": float(n_attempt),
        "holdout_precision": precision,
        "holdout_flag_rate": flag_rate,
        "holdout_n": float(len(hold_y)),
    }
    model.meta.update(metrics)

    if persist:
        if precision + 1e-9 < cfg.http_min_precision:
            raise SystemExit(
                f"Refusing HTTP model: holdout_precision={precision:.3f} "
                f"< {cfg.http_min_precision}. Keeping previous artifact."
            )
        if flag_rate > cfg.http_max_flag_rate:
            raise SystemExit(
                f"Refusing HTTP model: holdout_flag_rate={flag_rate:.3f} "
                f"> {cfg.http_max_flag_rate}. Keeping previous artifact."
            )
        if os.path.exists(cfg.http_model_path):
            try:
                prev = HttpAttemptModel.load(cfg.http_model_path)
                prev_p = float(prev.meta.get("holdout_precision") or 0.0)
                if prev_p and precision + 0.02 < prev_p:
                    raise SystemExit(
                        f"Challenger worse than champion: {precision:.3f} < {prev_p:.3f}. "
                        "Keeping previous artifact."
                    )
            except SystemExit:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("could not compare champion: %s", exc)

        os.makedirs(os.path.dirname(cfg.http_model_path) or ".", exist_ok=True)
        fd, tmp = tempfile.mkstemp(suffix=".joblib", dir=os.path.dirname(cfg.http_model_path) or ".")
        os.close(fd)
        try:
            model.save(tmp)
            promote_artifact(tmp, cfg.http_model_path, cfg.http_model_prev_path)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        logger.info("saved HTTP model -> %s %s", cfg.http_model_path, metrics)

        try:
            _log_mlflow(cfg, metrics)
        except Exception as exc:  # noqa: BLE001
            logger.warning("HTTP MLflow log failed: %s", exc)
    return metrics


def _log_mlflow(cfg: MLConfig, metrics: dict) -> None:
    import mlflow

    os.makedirs(os.path.dirname(cfg.mlflow_uri.replace("sqlite:///", "")) or ".", exist_ok=True)
    mlflow.set_tracking_uri(cfg.mlflow_uri)
    mlflow.set_experiment(cfg.http_mlflow_experiment)
    with mlflow.start_run(run_name="http_attempt"):
        mlflow.log_metrics({k: float(v) for k, v in metrics.items()})
        mlflow.set_tag("stage", "9")
        mlflow.set_tag("model", cfg.http_mlflow_model)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Train Stage 9 HTTP-attempt model")
    parser.add_argument("--min-samples", type=int, default=40)
    parser.add_argument("--hours", type=int, default=168)
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args(argv)
    cfg = MLConfig()
    if args.rollback:
        ok = rollback_artifact(cfg.http_model_path, cfg.http_model_prev_path)
        print("rolled back" if ok else "no previous HTTP artifact")
        return 0 if ok else 1
    metrics = train(cfg, min_samples=args.min_samples, hours=args.hours)
    print(metrics)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
