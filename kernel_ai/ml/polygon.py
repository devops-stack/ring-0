"""Local simulation polygon for Stage 5 / 7 / 8 (dev only — never for PROD).

Modes:
  dry-run  — synthetic ProcSamples → Stage 5 detector → Stage 7 enricher
  live     — spawn short-lived safe processes for a running STAGE5 worker
  mimicry  — Stage 8 vs STIDE: known-token odd order (STIDE misses, Markov hits)
  stream   — Stage 6 e2e: demo collector → unix socket → n-grams → STIDE/Markov

Examples:
  python -m kernel_ai.ml.polygon dry-run
  python -m kernel_ai.ml.polygon live --scenario reverse_shell
  python -m kernel_ai.ml.polygon mimicry
  python -m kernel_ai.ml.polygon stream
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from kernel_ai.ml.attribution.enrich import enrich_anomalies
from kernel_ai.ml.proc_baseline import ProcBaselineDetector
from kernel_ai.ml.proc_features import ProcSample

logger = logging.getLogger("kernel_ai.ml.polygon")

# Labels written for a future supervised Stage 7 classifier.
_LABELS_DIR = Path(os.getenv("KERNEL_AI_ML_DATA_DIR", "mldata")) / "polygon"


SCENARIOS: dict[str, dict] = {
    "reverse_shell": {
        "technique": "T1071",
        "family": "command_and_control",
        "description": "bash → nc (sleep binary renamed)",
        "live": True,
    },
    "web_shell": {
        "technique": "T1059",
        "family": "execution",
        "description": "nginx → bash (fake nginx wrapper)",
        "live": True,
    },
    "miner_stub": {
        "technique": "T1496",
        "family": "impact",
        "description": "bash → xmrig (sleep binary renamed)",
        "live": True,
    },
    "scanner": {
        "technique": "T1046",
        "family": "discovery",
        "description": "bash → nmap (sleep binary renamed)",
        "live": True,
    },
    "privesc": {
        "technique": "T1548",
        "family": "privilege_escalation",
        "description": "synthetic euid=0 / ruid≠0 (dry-run only)",
        "live": False,
    },
    "lineage_shell": {
        "technique": "T1059",
        "family": "execution",
        "description": "bash → sleep (generic unusual child)",
        "live": True,
    },
}


def _sample(**kwargs) -> ProcSample:
    base = dict(
        pid=9000,
        ppid=1,
        comm="sleep",
        parent_comm="bash",
        ruid=1000,
        euid=1000,
        age_sec=5.0,
        num_threads=1,
        fd_count=8,
        vm_rss_mb=3.0,
    )
    base.update(kwargs)
    s = ProcSample(**base)
    s.features = s.score_vector()
    return s


def _synthetic_samples(scenario: str) -> list[ProcSample]:
    if scenario == "reverse_shell":
        return [_sample(pid=9101, comm="nc", parent_comm="bash", age_sec=4.0)]
    if scenario == "web_shell":
        return [_sample(pid=9102, comm="bash", parent_comm="nginx", age_sec=3.0)]
    if scenario == "miner_stub":
        return [_sample(pid=9103, comm="xmrig", parent_comm="bash", age_sec=6.0)]
    if scenario == "scanner":
        return [_sample(pid=9104, comm="nmap", parent_comm="bash", age_sec=5.0)]
    if scenario == "privesc":
        return [_sample(pid=9105, comm="sudo", parent_comm="bash", ruid=1000, euid=0, age_sec=20.0)]
    if scenario == "lineage_shell":
        return [_sample(pid=9106, comm="sleep", parent_comm="bash", age_sec=4.0)]
    raise KeyError(scenario)


def _detector() -> ProcBaselineDetector:
    return ProcBaselineDetector(
        alpha=0.2,
        warmup_samples=0,
        z_warn=4.0,
        z_crit=7.0,
        lineage_min_count=3,
        cooldown_sec=0.0,
        max_emit_per_tick=16,
    )


def run_dry(scenarios: list[str], *, write_labels: bool = True) -> list[dict]:
    """Score synthetic samples and print Stage 5 + 7 results."""
    results = []
    det = _detector()
    # Pre-seed common noise edges so only attack-like edges stay novel.
    det.lineage.load_counts(
        [
            ("systemd", "sshd", 20),
            ("systemd", "nginx", 20),
            ("bash", "grep", 20),
        ]
    )

    for name in scenarios:
        samples = _synthetic_samples(name)
        # Unique pids per scenario so lineage observe fires.
        anoms = det.score(samples, now=time.time())
        enriched = enrich_anomalies(anoms, min_confidence=0.3)
        expected = SCENARIOS[name]
        attributed = [a for a in enriched if a.get("attack")]
        match = next(
            (a for a in attributed if a["attack"].get("mitre") == expected["technique"]),
            None,
        )
        hit = match or (attributed[0] if attributed else None)
        got_mitre = (hit or {}).get("attack", {}).get("mitre")
        ok = match is not None
        row = {
            "scenario": name,
            "expected_mitre": expected["technique"],
            "got_mitre": got_mitre,
            "pass": ok,
            "anomalies": enriched,
        }
        results.append(row)
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name}: expected {expected['technique']} got {got_mitre}")
        if hit:
            atk = hit["attack"]
            print(f"         {hit.get('message', '')[:100]}")
            print(
                f"         attack={atk.get('mitre')} family={atk.get('family')} "
                f"src={atk.get('source')} conf={atk.get('label_confidence')}"
            )
        elif anoms:
            print(f"         stage5 fired but no attack above confidence: {anoms[0].get('type')}")
        else:
            print("         no Stage 5 anomaly emitted")

    if write_labels:
        _LABELS_DIR.mkdir(parents=True, exist_ok=True)
        path = _LABELS_DIR / f"labels_{int(time.time())}.jsonl"
        with path.open("w", encoding="utf-8") as fh:
            for row in results:
                for anom in row["anomalies"]:
                    fh.write(
                        json.dumps(
                            {
                                "scenario": row["scenario"],
                                "expected_mitre": row["expected_mitre"],
                                "anomaly": {
                                    k: anom.get(k)
                                    for k in (
                                        "source",
                                        "feature",
                                        "type",
                                        "severity",
                                        "message",
                                        "meta",
                                        "attack",
                                    )
                                },
                            }
                        )
                        + "\n"
                    )
        print(f"\nlabels → {path}")
    return results


def _spawn_renamed_sleep(name: str, duration: float, *, via_bash: bool = True) -> subprocess.Popen:
    """Copy ``sleep`` to a temp binary named ``name`` and run it (short-lived)."""
    tmp = tempfile.mkdtemp(prefix="kai-poly-")
    binary = os.path.join(tmp, name)
    sleep_bin = shutil.which("sleep") or "/bin/sleep"
    shutil.copy(sleep_bin, binary)
    os.chmod(binary, 0o755)
    sec = max(1, int(duration))
    if via_bash:
        # parent_comm should be bash for sigma reverse_shell / miner heuristics
        return subprocess.Popen(
            ["bash", "-c", f'exec "{binary}" {sec}'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return subprocess.Popen(
        [binary, str(sec)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _spawn_fake_nginx_shell(duration: float) -> subprocess.Popen:
    """Wrapper named nginx that starts bash -c sleep (web_shell lineage)."""
    tmp = tempfile.mkdtemp(prefix="kai-poly-")
    wrapper = os.path.join(tmp, "nginx")
    with open(wrapper, "w", encoding="utf-8") as fh:
        fh.write("#!/bin/bash\nexec bash -c 'sleep %d'\n" % max(1, int(duration)))
    os.chmod(wrapper, 0o755)
    return subprocess.Popen(
        [wrapper],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def run_live(scenarios: list[str], *, duration: float = 6.0) -> None:
    """Spawn safe processes for a running ML worker (STAGE5=true) to observe."""
    procs: list[subprocess.Popen] = []
    print("LIVE polygon — ensure ML worker runs with KERNEL_AI_ML_STAGE5=true")
    print(f"holding processes ~{duration}s so the worker can sample them\n")
    try:
        for name in scenarios:
            meta = SCENARIOS[name]
            if not meta.get("live"):
                print(f"[skip] {name}: dry-run only ({meta['description']})")
                continue
            if name == "reverse_shell":
                procs.append(_spawn_renamed_sleep("nc", duration))
            elif name == "miner_stub":
                procs.append(_spawn_renamed_sleep("xmrig", duration))
            elif name == "scanner":
                procs.append(_spawn_renamed_sleep("nmap", duration))
            elif name == "lineage_shell":
                procs.append(
                    subprocess.Popen(
                        ["bash", "-c", f"sleep {max(1, int(duration))}"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                )
            elif name == "web_shell":
                procs.append(_spawn_fake_nginx_shell(duration))
            print(f"[spawn] {name}: {meta['description']} (expect {meta['technique']})")
        time.sleep(duration + 0.5)
    finally:
        for p in procs:
            try:
                p.wait(timeout=2)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass
    print("\ndone — check /api/ml-anomalies or Kernel DNA for stage5_process + attack.*")


def _token_ngrams(tokens: list[str], n: int = 3) -> list[str]:
    if len(tokens) < n:
        return []
    return ["|".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


# Known-token adversarial order (all tokens appear in synthetic normal corpus,
# but transitions are vanishingly rare) — classic STIDE mimicry gap.
_MIMICRY_WINDOW = (
    ["openat", "clone", "sendto", "mmap", "write", "futex", "exit"] * 6
)
_NORMAL_WINDOW = (
    ["openat", "read", "read", "close", "openat", "fstat", "read", "close"] * 5
)
# Truly novel tokens — STIDE should fire here too.
_NOVEL_WINDOW = (
    ["openat", "execve", "connect", "dup2", "socket", "execve"] * 5
)


def run_mimicry(*, stide_warn: float = 0.30, markov_warn: float = 2.5) -> dict:
    """Compare STIDE vs Markov on a mimicry window. Returns a result dict."""
    from kernel_ai.ml.sequence import StideModel
    from kernel_ai.ml.sequence_deep.train_markov import (
        _SYNTHETIC_NORMAL,
        load_corpus_synthetic,
    )
    from kernel_ai.ml.sequence_deep.encode import SequenceEncoder
    from kernel_ai.ml.sequence_deep.markov import MarkovScorer

    sequences = load_corpus_synthetic(repeats=40)
    encoder = SequenceEncoder()
    markov = MarkovScorer(order=1, meta={"stage": 8, "source": "polygon_mimicry"})
    for seq in sequences:
        encoder.fit(seq)
        markov.observe(seq)

    # STIDE profile: trigrams from normal training + the held-out normal window
    # + mimicry trigrams (attacker only used eventually-"known" n-grams).
    stide_vocab: set[str] = set()
    for seq in list(_SYNTHETIC_NORMAL) + [_NORMAL_WINDOW]:
        stide_vocab.update(_token_ngrams(seq, 3))
    stide_vocab.update(_token_ngrams(_MIMICRY_WINDOW, 3))
    stide = StideModel(n=3, ngrams=stide_vocab, meta={"poison": "mimicry_demo"})

    normal_m = markov.score_window(_NORMAL_WINDOW)
    mimic_m = markov.score_window(_MIMICRY_WINDOW)
    novel_m = markov.score_window(_NOVEL_WINDOW)

    normal_s, _ = stide.score_window(_token_ngrams(_NORMAL_WINDOW, 3))
    mimic_s, mimic_misses = stide.score_window(_token_ngrams(_MIMICRY_WINDOW, 3))
    novel_s, novel_misses = stide.score_window(_token_ngrams(_NOVEL_WINDOW, 3))

    n_score = float((normal_m or {}).get("neg_avg_logprob") or 0.0)
    m_score = float((mimic_m or {}).get("neg_avg_logprob") or 0.0)
    v_score = float((novel_m or {}).get("neg_avg_logprob") or 0.0)

    stide_misses_mimicry = mimic_s < stide_warn
    markov_catches_mimicry = m_score >= markov_warn and m_score > n_score * 1.25
    stide_catches_novel = novel_s >= stide_warn
    passed = stide_misses_mimicry and markov_catches_mimicry

    result = {
        "pass": passed,
        "stide": {
            "normal_mismatch": round(normal_s, 4),
            "mimicry_mismatch": round(mimic_s, 4),
            "mimicry_misses": mimic_misses,
            "novel_mismatch": round(novel_s, 4),
            "novel_misses": novel_misses,
            "misses_mimicry": stide_misses_mimicry,
            "catches_novel": stide_catches_novel,
        },
        "markov": {
            "normal_neg_avg_logprob": n_score,
            "mimicry_neg_avg_logprob": m_score,
            "novel_neg_avg_logprob": v_score,
            "catches_mimicry": markov_catches_mimicry,
            "worst_mimicry": (mimic_m or {}).get("worst_tokens"),
        },
        "thresholds": {"stide_warn": stide_warn, "markov_warn": markov_warn},
    }

    print("Stage 8 mimicry demo (STIDE vs Markov)")
    print(f"  STIDE  normal_mismatch={normal_s:.3f}  mimicry={mimic_s:.3f}  novel={novel_s:.3f}")
    print(f"  Markov normal_neg_lp={n_score:.3f}  mimicry={m_score:.3f}  novel={v_score:.3f}")
    print(f"  STIDE misses mimicry (<{stide_warn}): {stide_misses_mimicry}")
    print(f"  Markov catches mimicry (≥{markov_warn} & >1.25×normal): {markov_catches_mimicry}")
    print(f"  STIDE catches novel (≥{stide_warn}): {stide_catches_novel}")
    if (mimic_m or {}).get("worst_tokens"):
        print(f"  Markov worst transition: {' → '.join(mimic_m['worst_tokens'])}")
    print(f"\n[{'PASS' if passed else 'FAIL'}] mimicry case")
    return result


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Stage 5/7/8 local polygon (dev only)")
    parser.add_argument("mode", choices=("dry-run", "live", "list", "mimicry", "stream"))
    parser.add_argument(
        "--scenario",
        action="append",
        choices=sorted(SCENARIOS),
        help="scenario id (repeatable); default: all dry-run / all live-capable",
    )
    parser.add_argument("--all", action="store_true", help="all scenarios for this mode")
    parser.add_argument("--duration", type=float, default=6.0, help="live hold seconds")
    parser.add_argument("--no-labels", action="store_true")
    parser.add_argument("--bursts", type=int, default=9, help="stream mode demo bursts")
    args = parser.parse_args(argv)

    if args.mode == "list":
        for name, meta in SCENARIOS.items():
            live = "live+dry" if meta["live"] else "dry-only"
            print(f"{name:16} {meta['technique']:8} [{live}] {meta['description']}")
        print(f"{'mimicry':16} {'T1106':8} [dry-only] STIDE miss / Markov hit (Stage 8)")
        print(f"{'stream':16} {'L2':8} [dry-only] Stage 6 socket e2e (demo collector)")
        return 0

    if args.mode == "mimicry":
        result = run_mimicry()
        return 0 if result["pass"] else 1

    if args.mode == "stream":
        from kernel_ai.ml.collectors.stream_e2e import run_stream_e2e

        result = run_stream_e2e(bursts=args.bursts, demo_every=0.05)
        print("Stage 6 stream e2e (demo collector → socket → n-grams)")
        for k, v in result.items():
            if k == "pass":
                continue
            print(f"  {k}: {v}")
        print(f"\n[{'PASS' if result['pass'] else 'FAIL'}] stream e2e")
        return 0 if result["pass"] else 1

    if args.scenario:
        scenarios = list(dict.fromkeys(args.scenario))
    elif args.all or args.mode == "dry-run":
        scenarios = list(SCENARIOS)
    else:
        scenarios = [n for n, m in SCENARIOS.items() if m.get("live")]

    if args.mode == "dry-run":
        results = run_dry(scenarios, write_labels=not args.no_labels)
        failed = sum(1 for r in results if not r["pass"])
        print(f"\n{len(results) - failed}/{len(results)} scenarios attributed as expected")
        return 1 if failed else 0

    run_live(scenarios, duration=args.duration)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
