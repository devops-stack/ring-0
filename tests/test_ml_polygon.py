"""Local Stage 5/7/8 polygon tests."""

from kernel_ai.ml.collectors.stream_e2e import run_stream_e2e
from kernel_ai.ml.polygon import run_dry, run_mimicry


def test_polygon_dry_run_all_pass():
    results = run_dry(
        [
            "reverse_shell",
            "web_shell",
            "miner_stub",
            "scanner",
            "privesc",
            "lineage_shell",
        ],
        write_labels=False,
    )
    failed = [r["scenario"] for r in results if not r["pass"]]
    assert not failed, failed


def test_polygon_mimicry_stide_miss_markov_hit():
    result = run_mimicry()
    assert result["stide"]["misses_mimicry"] is True
    assert result["stide"]["mimicry_mismatch"] == 0.0
    assert result["markov"]["catches_mimicry"] is True
    assert result["markov"]["mimicry_neg_avg_logprob"] > result["markov"]["normal_neg_avg_logprob"]
    assert result["stide"]["catches_novel"] is True
    assert result["pass"] is True


def test_stage6_stream_e2e_socket():
    result = run_stream_e2e(bursts=9, demo_every=0.02)
    assert result["events"] >= 20, result
    assert result["markov_ready"] is True
    assert result["markov_mimicry"] > result["markov_normal"]
    assert result["pass"] is True
