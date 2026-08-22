"""Per-IP windows over HTTP events. No raw body and no home paths leave here."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from urllib.parse import unquote_plus

from kernel_ai.ml.http_parse import HttpEvent
from kernel_ai.ml.http_rules import (
    _CMDI,
    _JNDI,
    _LFI,
    _SQLI,
    _XSS,
    _UNUSUAL_METHOD,
    classify_window,
)

WINDOW_SEC = 60

# Fixed order shared by train and the worker.
HTTP_FEATURE_ORDER = [
    "count",
    "rate_per_sec",
    "uniq_paths",
    "mean_path_len",
    "max_path_len",
    "frac_404",
    "frac_4xx",
    "frac_5xx",
    "frac_2xx",
    "has_dotfile",
    "has_traversal",
    "has_sqli",
    "has_xss",
    "has_cmdi",
    "has_jndi",
    "unusual_method",
    "mean_query_len",
]

_DOTFILE = (".env", ".git", ".svn", ".htaccess", ".htpasswd", ".aws")


@dataclass
class HttpWindow:
    ts: float
    src_ip: str
    window_sec: int
    events: list[HttpEvent] = field(default_factory=list)
    features: dict[str, float] = field(default_factory=dict)
    label: str = "benign"
    cls: str = "benign"
    why: str = ""

    def vector(self) -> list[float]:
        return [float(self.features.get(name, 0.0)) for name in HTTP_FEATURE_ORDER]


def _flags(events: list[HttpEvent]) -> dict[str, float]:
    has_dot = 0.0
    has_trav = 0.0
    has_sqli = 0.0
    has_xss = 0.0
    has_cmdi = 0.0
    has_jndi = 0.0
    unusual = 0.0
    for event in events:
        hay = f"{event.path} {unquote_plus(event.query or '')} {event.body}"
        path_l = event.path.lower()
        if any(token in path_l for token in _DOTFILE):
            has_dot = 1.0
        if _LFI.search(hay):
            has_trav = 1.0
        if _SQLI.search(hay):
            has_sqli = 1.0
        if _XSS.search(hay):
            has_xss = 1.0
        if _CMDI.search(hay):
            has_cmdi = 1.0
        if _JNDI.search(hay):
            has_jndi = 1.0
        if event.method in _UNUSUAL_METHOD:
            unusual = 1.0
    return {
        "has_dotfile": has_dot,
        "has_traversal": has_trav,
        "has_sqli": has_sqli,
        "has_xss": has_xss,
        "has_cmdi": has_cmdi,
        "has_jndi": has_jndi,
        "unusual_method": unusual,
    }


def features_of(events: list[HttpEvent], *, window_sec: int = WINDOW_SEC) -> dict[str, float]:
    n = len(events)
    if n == 0:
        return {name: 0.0 for name in HTTP_FEATURE_ORDER}
    paths = [event.path for event in events]
    lens = [len(event.path) for event in events]
    qlens = [len(event.query) for event in events]
    n404 = sum(1 for event in events if event.status == 404)
    n4xx = sum(1 for event in events if 400 <= event.status < 500)
    n5xx = sum(1 for event in events if event.status >= 500)
    n2xx = sum(1 for event in events if 200 <= event.status < 300)
    flags = _flags(events)
    out = {
        "count": float(n),
        "rate_per_sec": n / max(1.0, float(window_sec)),
        "uniq_paths": float(len(set(paths))),
        "mean_path_len": sum(lens) / n,
        "max_path_len": float(max(lens)),
        "frac_404": n404 / n,
        "frac_4xx": n4xx / n,
        "frac_5xx": n5xx / n,
        "frac_2xx": n2xx / n,
        "mean_query_len": sum(qlens) / n,
    }
    out.update(flags)
    return out


def build_windows(
    events: list[HttpEvent],
    *,
    window_sec: int = WINDOW_SEC,
    label: bool = True,
) -> list[HttpWindow]:
    """Bucket events by src_ip and floor(ts / window). Empty IP is dropped."""
    buckets: dict[tuple[str, int], list[HttpEvent]] = defaultdict(list)
    for event in events:
        if not event.src_ip:
            continue
        slot = int(event.ts // window_sec)
        buckets[(event.src_ip, slot)].append(event)

    windows: list[HttpWindow] = []
    for (src_ip, slot), rows in sorted(buckets.items(), key=lambda item: item[0][1]):
        feats = features_of(rows, window_sec=window_sec)
        win = HttpWindow(
            ts=float(slot * window_sec),
            src_ip=src_ip,
            window_sec=window_sec,
            events=rows,
            features=feats,
        )
        if label:
            win.label, win.cls, win.why = classify_window(rows, feats)
        windows.append(win)
    return windows
