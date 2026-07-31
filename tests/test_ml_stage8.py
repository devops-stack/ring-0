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
