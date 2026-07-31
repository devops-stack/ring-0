"""Stage 6 local end-to-end: unix-datagram collector → NgramTracker → STIDE/Markov.

No root / auditd required. Uses the same socket contract as PROD
(``SocketSyscallSource`` bind + collector ``sendto``).
"""

from __future__ import annotations

import os
import tempfile
import threading
import time
from pathlib import Path

from kernel_ai.ml.collectors.socket_source import SocketSyscallSource
from kernel_ai.ml.sequence import NgramTracker, StideModel
from kernel_ai.ml.sequence_deep.markov import MarkovScorer


def _token_ngrams(tokens: list[str], n: int = 3) -> list[str]:
    if len(tokens) < n:
        return []
    return ["|".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


def run_stream_e2e(
    *,
    bursts: int = 9,
    demo_every: float = 0.05,
    socket_path: str | None = None,
) -> dict:
    """Drive demo emitter → socket → tracker; score STIDE + Markov.

    Returns a result dict with ``pass`` True when the socket path delivered
    events and Markov (trained on *normal* demo chains only) separates
    normal vs mimicry windows.
    """
    # Import demo helpers from the collector script module.
    import importlib.util

    collector_path = Path(__file__).resolve().parents[3] / "deploy" / "ebpf" / "syscall_stream_collector.py"
    spec = importlib.util.spec_from_file_location("kai_syscall_collector", collector_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load collector from {collector_path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    tmp_dir = tempfile.mkdtemp(prefix="kai-seq-")
    path = socket_path or os.path.join(tmp_dir, "ml-syscall.sock")

    source = SocketSyscallSource(path, max_events=5000)
    # Force bind before emitter starts.
    assert source._ensure_sock() is not None, f"failed to bind {path}"

    emitter = mod.DatagramEmitter(path)
    stop = threading.Event()

    def _emit() -> None:
        old = mod.DEMO_EVERY
        mod.DEMO_EVERY = demo_every
        try:
            mod.run_demo(emitter, bursts=bursts)
        finally:
            mod.DEMO_EVERY = old
            stop.set()

    thread = threading.Thread(target=_emit, name="seq-demo-emit", daemon=True)
    thread.start()

    tracker = NgramTracker(n=3, window=800)
    raw_tokens: list[str] = []
    normal_tokens: list[str] = []
    deadline = time.time() + max(5.0, bursts * demo_every + 2.0)
    while time.time() < deadline:
        events = source.drain()
        if events:
            tracker.update_stream(events)
            raw_tokens.extend(ev.syscall for ev in events)
            # Train only on quiet host-like bursts (comm=demo).
            normal_tokens.extend(ev.syscall for ev in events if ev.comm == "demo")
        if stop.is_set() and not events:
            time.sleep(0.05)
            events = source.drain()
            if events:
                tracker.update_stream(events)
                raw_tokens.extend(ev.syscall for ev in events)
                normal_tokens.extend(ev.syscall for ev in events if ev.comm == "demo")
            break
        time.sleep(0.02)

    thread.join(timeout=2)
    source.close()
    emitter.close()

    window = tracker.recent()
    markov = MarkovScorer(meta={"source": "stream_e2e"})
    for i in range(0, max(0, len(normal_tokens) - 4), 4):
        chunk = normal_tokens[i : i + 8]
        if len(chunk) >= 2:
            markov.observe(chunk)

    stide = StideModel(n=3, ngrams=set(window), meta={"source": "stream_e2e"})

    normal = list(mod.DEMO_NORMAL_CHAINS[0]) * 4
    mimic = list(mod.DEMO_MIMICRY_CHAIN) * 4
    n_score = (markov.score_window(normal) or {}).get("neg_avg_logprob", 0.0)
    m_score = (markov.score_window(mimic) or {}).get("neg_avg_logprob", 0.0)
    # STIDE on mimicry using vocab that includes mimicry n-grams (mimicry gap).
    mimic_grams = _token_ngrams(mimic, 3)
    stide_poisoned = StideModel(n=3, ngrams=set(window) | set(mimic_grams))
    mimic_mismatch, _ = stide_poisoned.score_window(mimic_grams)

    passed = (
        len(raw_tokens) >= 20
        and len(normal_tokens) >= 12
        and markov.ready
        and float(m_score) > float(n_score)
        and float(mimic_mismatch) < 0.05
    )
    return {
        "pass": passed,
        "socket": path,
        "events": len(raw_tokens),
        "normal_events": len(normal_tokens),
        "ngrams_window": len(window),
        "markov_ready": markov.ready,
        "markov_normal": n_score,
        "markov_mimicry": m_score,
        "stide_mimicry_mismatch": round(float(mimic_mismatch), 4),
        "stide_live_vocab": len(stide.ngrams),
    }
