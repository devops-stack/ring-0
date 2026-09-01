"""Stage 7 attribution enricher tests."""

from kernel_ai.ml.attribution.attack_map import map_anomaly
from kernel_ai.ml.attribution.enrich import enrich_anomaly, enrich_anomalies
from kernel_ai.ml.attribution.sigma_engine import load_rules, match_anomaly


def test_sigma_rules_load():
    rules = load_rules()
    ids = {r["id"] for r in rules}
    assert "shell_from_web" in ids
    assert "reverse_shell_lineage" in ids


def test_sigma_reverse_shell_rule():
    anom = {
        "source": "stage5_process",
        "feature": "lineage:bash->nc",
        "type": "lineage:bash->nc",
        "message": "Unusual process lineage",
        "meta": {"kind": "lineage", "comm": "nc", "parent_comm": "bash"},
    }
    hit = match_anomaly(anom)
    assert hit is not None
    assert hit["mitre"] == "T1071"
    assert hit["source"] == "sigma"


def test_heuristic_host_chatter_stays_unattributed():
    attack = map_anomaly(
        {
            "source": "stage1_baseline",
            "feature": "pgfault_per_sec",
            "type": "baseline_spike:pgfault_per_sec",
            "message": "minor faults spike",
        }
    )
    assert attack is None
    assert map_anomaly(
        {
            "source": "stage1_baseline",
            "feature": "ctxt_per_sec",
            "type": "baseline_spike:ctxt_per_sec",
            "message": "context switches/s spike",
        }
    ) is None
    assert map_anomaly(
        {
            "source": "stage2_isoforest",
            "feature": "tcp_outseg_per_sec",
            "type": "isoforest:tcp_outseg_per_sec",
            "message": "IsolationForest flagged an unusual system state",
        }
    ) is None


def test_heuristic_miner_hint_still_maps():
    attack = map_anomaly(
        {
            "source": "stage1_baseline",
            "feature": "cpu_busy_pct",
            "type": "baseline_spike:cpu_busy_pct",
            "message": "cpu busy with xmrig",
        }
    )
    assert attack is not None
    assert attack["mitre"] == "T1496"


def test_enrich_writes_meta_and_message_prefix():
    anom = {
        "source": "stage5_process",
        "feature": "lineage:nginx->bash",
        "type": "lineage:nginx->bash",
        "message": "Unusual process lineage: nginx → bash",
        "meta": {"kind": "lineage", "comm": "bash", "parent_comm": "nginx"},
    }
    out = enrich_anomaly(anom, min_confidence=0.3)
    assert out["attack"]["mitre"] == "T1059"
    assert out["meta"]["attack"]["mitre"] == "T1059"
    assert out["message"].startswith("[T1059]")


def test_enrich_batch_respects_min_confidence():
    weak = {
        "source": "stage2_isoforest",
        "feature": "vector",
        "type": "isoforest:vector",
        "message": "IsolationForest",
        "meta": {},
    }
    # heuristic confidence for bare isoforest is 0.30 → filtered at 0.35
    out = enrich_anomalies([weak], min_confidence=0.35)
    assert "attack" not in out[0]
