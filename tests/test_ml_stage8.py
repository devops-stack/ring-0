"""Stage 8 deep-sequence tests (Markov train + scorer)."""

from types import SimpleNamespace

import joblib

from kernel_ai.ml.config import MLConfig
from kernel_ai.ml.sequence_deep.encode import SequenceEncoder
from kernel_ai.ml.sequence_deep.markov import MarkovScorer
from kernel_ai.ml.sequence_deep.scorer import DeepSequenceScorer
from kernel_ai.ml.sequence_deep.train_markov import train_markov


def test_stage8_default_off():
    assert MLConfig().enable_stage8 is False


def test_encoder_fit_encode_roundtrip():
    enc = SequenceEncoder()
    assert not enc.ready
    enc.fit(["read", "write", "close"])
    assert enc.ready
    ids = enc.encode(["read", "write", "unknown"], length=4)
    assert ids[0] == enc.token_to_id["<pad>"]
    assert enc.decode(ids)[-2] == "write"


def test_markov_scores_after_observe():
    m = MarkovScorer()
    assert m.score_window(["a", "b"]) is None
    m.observe(["read", "write", "close", "read", "write", "close"])
    assert m.ready
    normal = m.score_window(["read", "write", "close"])
    weird = m.score_window(["read", "execve", "connect"])
    assert normal is not None and weird is not None
    assert weird["neg_avg_logprob"] >= normal["neg_avg_logprob"]


def test_train_markov_synthetic_and_reload(tmp_path):
    out = tmp_path / "markov_latest.joblib"
    cfg = MLConfig()
    # dataclass is frozen — build a tiny namespace with required fields
    ns = SimpleNamespace(
        dsn=cfg.dsn,
        seq_n=cfg.seq_n,
        seq_min_ngram_count=cfg.seq_min_ngram_count,
        stage8_markov_path=str(out),
    )
    metrics = train_markov(ns, use_synthetic=True, use_ngrams=False, min_transitions=50)
    assert out.is_file()
    assert metrics["n_transitions"] >= 50
    assert metrics["weird_neg_avg_logprob"] >= metrics["normal_neg_avg_logprob"]

    scorer_cfg = SimpleNamespace(
        stage8_markov_path=str(out),
        stage8_lstm_path=str(tmp_path / "no.pt"),
        stage8_backend="markov",
        stage8_window=16,
        stage8_score_warn=3.0,
        stage8_score_crit=5.0,
    )
    scorer = DeepSequenceScorer(scorer_cfg)
    assert scorer.ready
    score = scorer.score_tokens(["openat", "execve", "connect"])
    assert score is not None
    assert score["model"] == "markov"


def test_deep_scorer_noop_without_artifact():
    cfg = SimpleNamespace(
        stage8_markov_path="/tmp/kai-no-such-markov.joblib",
        stage8_lstm_path="/tmp/kai-no-such-lstm.pt",
        stage8_backend="markov",
        stage8_window=16,
        stage8_score_warn=3.0,
        stage8_score_crit=5.0,
    )
    scorer = DeepSequenceScorer(cfg)
    assert not scorer.ready
    assert scorer.score_tokens(["read", "write"]) is None


def test_build_anomaly_contract():
    cfg = SimpleNamespace(
        stage8_markov_path="/tmp/kai-no-such-markov.joblib",
        stage8_lstm_path="/tmp/no.pt",
        stage8_backend="markov",
        stage8_window=16,
        stage8_score_warn=3.0,
        stage8_score_crit=5.0,
    )
    scorer = DeepSequenceScorer(cfg)
    anom = scorer.build_anomaly(
        {
            "model": "markov",
            "neg_avg_logprob": 4.2,
            "worst_tokens": ["read", "execve"],
            "window_len": 10,
        },
        cfg,
    )
    assert anom["source"] == "stage8_sequence"
    assert anom["type"] == "syscall_sequence_deep"
    assert anom["meta"]["stage"] == 8
    assert anom["severity"] == "medium"


def test_observe_weight_shapes_the_distribution():
    """A chain seen 1000x must not look as likely as one seen 3x."""
    hot = MarkovScorer()
    hot.observe(["accept4", "accept4", "accept4"], weight=1000)
    hot.observe(["accept4", "execve", "connect"], weight=3)

    common = hot.score_window(["accept4", "accept4", "accept4"])
    rare = hot.score_window(["accept4", "execve", "connect"])
    assert rare["neg_avg_logprob"] > common["neg_avg_logprob"] * 2

    # Same two chains without weights: the model believes both are ordinary.
    flat = MarkovScorer()
    flat.observe(["accept4", "accept4", "accept4"])
    flat.observe(["accept4", "execve", "connect"])
    flat_common = flat.score_window(["accept4", "accept4", "accept4"])
    flat_rare = flat.score_window(["accept4", "execve", "connect"])
    assert abs(flat_rare["neg_avg_logprob"] - flat_common["neg_avg_logprob"]) < 0.2


def test_ngram_corpus_carries_counts_as_weights(monkeypatch):
    from kernel_ai.ml.sequence_deep import train_markov as tm

    monkeypatch.setattr(
        "kernel_ai.ml.store.fetch_ngram_counts",
        lambda dsn, n: {"accept4|accept4|accept4": 2500, "clone|execve|connect": 4},
    )
    corpus = tm.load_corpus_ngrams("dsn", n=3, min_count=3)
    assert sorted(w for _, w in corpus) == [4, 2500]
    assert tm._count_transitions(corpus) == 2 * 2500 + 2 * 4


def test_per_pid_token_windows_isolate_a_short_chain():
    """A hostile burst on one pid must be scored on its own, not averaged into noise."""
    from kernel_ai.ml.collectors.base import SyscallEvent
    from kernel_ai.ml.sequence import NgramTracker

    tracker = NgramTracker(n=3, window=200)
    tracker.update_stream(
        [SyscallEvent(ts=i * 0.01, pid=1, uid=0, comm="nginx", syscall="accept4") for i in range(300)]
        + [
            SyscallEvent(ts=100 + i * 0.01, pid=2, uid=0, comm="evil", syscall=name)
            for i, name in enumerate(["memfd_create", "execve", "connect", "ptrace"] * 5)
        ]
    )
    by_pid = dict(tracker.recent_tokens_by_pid(min_len=8))
    assert set(by_pid) == {1, 2}
    assert set(by_pid[1]) == {"accept4"}
    assert "ptrace" in by_pid[2]

    m = MarkovScorer()
    m.observe(["accept4"] * 50, weight=1000)
    hostile = m.score_window(by_pid[2])["neg_avg_logprob"]
    mixed = m.score_window(tracker.recent_tokens())["neg_avg_logprob"]
    assert hostile > mixed


def test_nightly_retrain_refreshes_markov_only_when_stage8_is_on(monkeypatch):
    from kernel_ai.ml import retrain

    calls = []
    monkeypatch.setattr(
        "kernel_ai.ml.sequence_deep.train_markov.train_markov",
        lambda cfg, **kw: calls.append(kw) or {"n_transitions": 1234, "vocab": 21},
    )

    off = SimpleNamespace(enable_stage8=False, stage8_backend="markov")
    retrain._refresh_markov(off, {})
    assert calls == []

    metrics: dict = {}
    on = SimpleNamespace(enable_stage8=True, stage8_backend="markov")
    retrain._refresh_markov(on, metrics)
    assert calls == [{"use_ngrams": True}]
    assert metrics["stage8_transitions"] == 1234


def test_corpus_file_train(tmp_path):
    corpus = tmp_path / "norm.txt"
    corpus.write_text(
        "\n".join(["read write close"] * 30 + ["futex futex poll"] * 20) + "\n",
        encoding="utf-8",
    )
    out = tmp_path / "m.joblib"
    ns = SimpleNamespace(dsn="", seq_n=3, seq_min_ngram_count=1, stage8_markov_path=str(out))
    metrics = train_markov(ns, corpus_path=str(corpus), use_ngrams=False, min_transitions=40)
    assert metrics["source"].startswith("file:")
    blob = joblib.load(out)
    assert "markov" in blob and "encoder" in blob


def _stage8_worker(tracker, score_by_pid, *, warn=3.0):
    """A worker stripped to the fields _tick_stage8 touches (no DB, no model)."""
    from kernel_ai.ml.worker import MLWorker

    worker = MLWorker.__new__(MLWorker)
    worker.cfg = SimpleNamespace(
        stage8_window=64,
        stage8_score_warn=warn,
        stage8_score_crit=warn + 2.0,
        stage8_cooldown_sec=30.0,
        stage8_log_every_sec=0.0,
    )
    worker.seq_tracker = tracker
    worker.deep_scorer = SimpleNamespace(
        maybe_reload=lambda: None,
        ready=True,
        warn_crit=lambda cfg: (cfg.stage8_score_warn, cfg.stage8_score_crit),
        score_tokens=lambda tokens: {
            "model": "markov",
            "neg_avg_logprob": score_by_pid(tokens),
            "worst_tokens": tokens[:2],
        },
        build_anomaly=lambda score, cfg: {"stage": 8, "pid": score.get("pid")},
    )
    worker._stage8_scored_at = -1
    worker._stage8_pid_marks = {}
    worker._last_stage8_log = 0.0
    worker._last_stage8_emit = 0.0
    return worker


def test_stage8_quarantines_the_pid_it_flagged():
    """Stage 4 is not the only stage whose verdict must gate learning."""
    from kernel_ai.ml.collectors.base import SyscallEvent
    from kernel_ai.ml.sequence import NgramTracker

    tracker = NgramTracker(n=3, window=200)
    hostile = ["ptrace", "memfd_create", "execve", "connect"] * 5
    tracker.update_stream(
        [SyscallEvent(ts=i * 0.01, pid=41, uid=0, comm="evil", syscall=s)
         for i, s in enumerate(hostile)]
    )
    # The window reached the profile's waiting room, as any window does.
    assert sum(sum(b.values()) for b in tracker._pending.values()) > 0

    worker = _stage8_worker(tracker, lambda tokens: 9.0)
    anomaly = worker._tick_stage8()

    assert anomaly == {"stage": 8, "pid": 41}
    # Nothing that pid contributed may reach the profile.
    assert tracker.drain_pending() == {}
    assert tracker.quarantined_pids() == 1


def test_stage8_quarantines_even_when_the_cooldown_eats_the_report():
    """A swallowed report is still a verdict; the profile must not learn anyway."""
    from kernel_ai.ml.collectors.base import SyscallEvent
    from kernel_ai.ml.sequence import NgramTracker

    tracker = NgramTracker(n=3, window=200)
    worker = _stage8_worker(tracker, lambda tokens: 9.0)
    import time as _time

    worker._last_stage8_emit = _time.time()  # cooldown wide open

    tracker.update_stream(
        [SyscallEvent(ts=i * 0.01, pid=41, uid=0, comm="evil", syscall=s)
         for i, s in enumerate(["ptrace", "memfd_create", "execve", "connect"] * 5)]
    )
    assert worker._tick_stage8() is None
    assert tracker.quarantined_pids() == 1
    assert tracker.drain_pending() == {}


def test_stage8_leaves_a_quiet_pid_learning():
    """The quarantine must not fire on windows that scored below warn."""
    from kernel_ai.ml.collectors.base import SyscallEvent
    from kernel_ai.ml.sequence import NgramTracker

    tracker = NgramTracker(n=3, window=200)
    tracker.update_stream(
        [SyscallEvent(ts=i * 0.01, pid=7, uid=0, comm="nginx", syscall="accept4")
         for i in range(40)]
    )
    worker = _stage8_worker(tracker, lambda tokens: 0.2)

    assert worker._tick_stage8() is None
    assert tracker.quarantined_pids() == 0
    assert tracker.drain_pending() == {"accept4|accept4|accept4": 38}


def test_stage8_announces_a_quarantine_once_not_once_per_tick():
    """A long-lived hostile pid clears warn on every tick; the log must not."""
    from kernel_ai.ml.collectors.base import SyscallEvent
    from kernel_ai.ml.sequence import NgramTracker

    tracker = NgramTracker(n=3, window=200)
    worker = _stage8_worker(tracker, lambda tokens: 9.0)
    hostile = ["ptrace", "memfd_create", "execve", "connect"] * 5

    for round_no in range(3):
        tracker.update_stream(
            [SyscallEvent(ts=round_no * 10 + i * 0.01, pid=41, uid=0, comm="evil", syscall=s)
             for i, s in enumerate(hostile)]
        )
        worker._last_stage8_emit = 0.0
        worker._tick_stage8()

    assert tracker.quarantined_pids() == 1
    assert tracker.is_quarantined(41) is True
    # Still not learning from it after the first verdict.
    assert tracker.drain_pending() == {}
