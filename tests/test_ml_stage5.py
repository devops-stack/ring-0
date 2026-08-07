"""Stage 5 process/lineage detector unit tests."""

from kernel_ai.ml.proc_baseline import LineageWhitelist, ProcBaselineDetector
from kernel_ai.ml.proc_features import ProcSample


def _sample(**kwargs) -> ProcSample:
    base = dict(
        pid=1000,
        ppid=1,
        comm="sleep",
        parent_comm="bash",
        ruid=1000,
        euid=1000,
        age_sec=5.0,
        num_threads=1,
        fd_count=4,
        vm_rss_mb=2.0,
    )
    base.update(kwargs)
    s = ProcSample(**base)
    s.features = s.score_vector()
    return s


def test_lineage_whitelist_poison_guard():
    wl = LineageWhitelist(min_count=3)
    assert wl.observe("bash", "nc") == 1
    assert wl.is_below_threshold("bash", "nc")
    wl.observe("bash", "nc")
    assert wl.is_below_threshold("bash", "nc")
    wl.observe("bash", "nc")
    assert not wl.is_below_threshold("bash", "nc")


def test_detector_emits_novel_lineage_once_per_pid():
    det = ProcBaselineDetector(
        alpha=0.1,
        warmup_samples=0,
        z_warn=4.0,
        z_crit=7.0,
        lineage_min_count=3,
        cooldown_sec=0.0,
        max_emit_per_tick=8,
    )
    s1 = _sample(pid=42, comm="nc", parent_comm="bash", age_sec=5.0)
    out1 = det.score([s1], now=100.0)
    assert any(a["source"] == "stage5_process" and "lineage:" in a["feature"] for a in out1)
    # Same pid again: no second lineage observe/alert.
    out2 = det.score([s1], now=101.0)
    assert not any(a.get("meta", {}).get("kind") == "lineage" for a in out2)


def test_detector_privesc_rule():
    det = ProcBaselineDetector(
        alpha=0.1,
        warmup_samples=100,  # keep EWMA quiet
        z_warn=4.0,
        z_crit=7.0,
        lineage_min_count=1,
        cooldown_sec=0.0,
        max_emit_per_tick=8,
    )
    # Pre-seed lineage so the edge is already normal.
    det.lineage.load_counts([("bash", "evil-root", 10)])
    s = _sample(pid=7, comm="evil-root", parent_comm="bash", ruid=1000, euid=0, age_sec=30.0)
    out = det.score([s], now=50.0)
    assert any(a["type"] == "proc_anomaly:euid_root" for a in out)


def test_detector_privesc_allowlist_skips_sudo():
    det = ProcBaselineDetector(
        alpha=0.1,
        warmup_samples=100,
        z_warn=4.0,
        z_crit=7.0,
        lineage_min_count=1,
        cooldown_sec=0.0,
        max_emit_per_tick=8,
    )
    det.lineage.load_counts([("bash", "sudo", 10)])
    s = _sample(pid=8, comm="sudo", parent_comm="bash", ruid=1000, euid=0, age_sec=30.0)
    out = det.score([s], now=50.0)
    assert not any(a["type"] == "proc_anomaly:euid_root" for a in out)


def test_stage5_default_off(monkeypatch):
    monkeypatch.delenv("KERNEL_AI_ML_STAGE5", raising=False)
    import importlib

    import kernel_ai.ml.config as cfg_mod

    importlib.reload(cfg_mod)
    assert cfg_mod.MLConfig().enable_stage5 is False
