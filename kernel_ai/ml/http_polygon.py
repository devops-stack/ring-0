"""Dev-only HTTP polygon: wordlist attempt vs join-to-exec success."""

from __future__ import annotations

import time

from kernel_ai.ml.http_features import build_windows
from kernel_ai.ml.http_join import join_success
from kernel_ai.ml.http_model import HttpAttemptModel
from kernel_ai.ml.http_parse import HttpEvent


def _event(ts: float, ip: str, path: str, status: int = 404, method: str = "GET", query: str = "", body: str = "") -> HttpEvent:
    return HttpEvent(
        ts=ts,
        src_ip=ip,
        method=method,
        path=path,
        query=query,
        status=status,
        body=body,
        user_agent="polygon",
        dataset="kernel_ai.nginx",
    )


def wordlist_events(now: float | None = None) -> list[HttpEvent]:
    now = now or time.time()
    ip = "203.0.113.9"
    paths = [
        "/.env", "/.git/config", "/admin", "/wp-admin", "/phpmyadmin",
        "/etc/passwd", "/.aws/credentials", "/backup.sql", "/id_rsa",
        "/api/../etc/passwd", "/hidden", "/secret", "/.htaccess",
    ]
    return [_event(now - 10 + i, ip, path) for i, path in enumerate(paths)]


def benign_events(now: float | None = None) -> list[HttpEvent]:
    now = now or time.time()
    ip = "198.51.100.4"
    return [
        _event(now - 5, ip, "/", 200),
        _event(now - 4, ip, "/api/isolation-context", 200),
        _event(now - 3, ip, "/api/ml-anomalies", 200),
    ]


def run_http_wordlist() -> dict:
    now = time.time()
    attack = build_windows(wordlist_events(now), label=True)
    quiet = build_windows(benign_events(now), label=True)
    teacher_ok = any(w.label == "attempt" for w in attack) and all(w.label == "benign" for w in quiet)

    matrix = [w.vector() for w in attack + quiet]
    labels = [1 if w.label == "attempt" else 0 for w in attack + quiet]
    # Duplicate so logreg can fit a tiny set.
    matrix = matrix * 8
    labels = labels * 8
    model = HttpAttemptModel()
    model.fit(matrix, labels)
    att_p = model.predict_one(attack[0].features) if attack else (False, 0.0)
    ben_p = model.predict_one(quiet[0].features) if quiet else (True, 1.0)
    model_ok = att_p[0] is True and ben_p[0] is False
    return {
        "pass": teacher_ok and model_ok,
        "teacher_attempt": teacher_ok,
        "model_attempt": att_p,
        "model_benign": ben_p,
        "attack_cls": attack[0].cls if attack else None,
        "attack_why": attack[0].why if attack else None,
    }


def run_http_rce() -> dict:
    now = time.time()
    attempt = {
        "ts": now - 8,
        "src_ip": "203.0.113.9",
        "cls": "sqli",
        "source": "stage9_http",
    }
    kernel = {
        "ts": now - 2,
        "source": "stage5_process",
        "feature": "lineage:nginx->bash",
        "meta": {"comm": "bash", "parent_comm": "nginx", "pid": 4242},
    }
    hits = join_success([attempt], [kernel], slack_sec=30)
    control = join_success([], [kernel], slack_sec=30)
    quiet_kernel = {
        "ts": now - 2,
        "source": "stage2_isoforest",
        "feature": "ctxt_per_sec",
        "meta": {},
    }
    no_web = join_success([attempt], [quiet_kernel], slack_sec=30)
    return {
        "pass": bool(hits) and not control and not no_web,
        "joined": len(hits),
        "feature": hits[0]["feature"] if hits else None,
        "control_empty": len(control) == 0,
        "host_spike_ignored": len(no_web) == 0,
    }
