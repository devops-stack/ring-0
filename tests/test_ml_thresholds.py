"""Live-host calibration for Stage 1 z and Stage 2 IsolationForest emit."""

from types import SimpleNamespace

from kernel_ai.ml.baseline import Score
from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.worker import _build_anomalies


def _score(name: str, z: float) -> Score:
    return Score(name=name, value=100.0 + z, mean=100.0, std=1.0, z=z, warm=False)


def test_calibrated_defaults():
    cfg = MLConfig()
    assert cfg.z_warn == 6.0
    assert cfg.z_crit == 7.0
    assert cfg.if_cooldown_sec == 45.0
    assert cfg.if_min_score == 0.10


def test_stage1_drops_poll_band_keeps_real_spikes():
    cfg = SimpleNamespace(z_warn=6.0, z_crit=7.0, alpha=0.03)
    scores = {
        "ctxt_per_sec": _score("ctxt_per_sec", 4.5),
        "tcp_retrans_per_sec": _score("tcp_retrans_per_sec", 5.2),
        "pgfault_per_sec": _score("pgfault_per_sec", 10.2),
        "cpu_busy_pct": _score("cpu_busy_pct", 6.5),
    }
    out = _build_anomalies(scores, cfg)
    features = {row["feature"] for row in out}
    assert features == {"cpu_busy_pct"}
    assert out[0]["severity"] == "medium"

    scores["pgfault_per_sec"] = _score("pgfault_per_sec", 16.4)
    scores["ctxt_per_sec"] = _score("ctxt_per_sec", 11.2)
    out = _build_anomalies(scores, cfg)
    by_feat = {row["feature"]: row for row in out}
    assert set(by_feat) >= {"cpu_busy_pct", "pgfault_per_sec", "ctxt_per_sec"}
    assert by_feat["pgfault_per_sec"]["severity"] == "high"
    assert by_feat["ctxt_per_sec"]["severity"] == "medium"
