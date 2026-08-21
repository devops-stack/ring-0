"""Weak labels: the same ideas as Elastic kernelai-* rules, run on a local file.

Teacher only. Inference does not call Elasticsearch.
"""

from __future__ import annotations

import re
from typing import Iterable
from urllib.parse import unquote_plus

from kernel_ai.ml.http_parse import HttpEvent

# Classes the DNA feature name uses: http_attempt:<cls>
CLS_SCANNER = "scanner"
CLS_FLOOD = "flood"
CLS_LFI = "lfi"
CLS_SQLI = "sqli"
CLS_XSS = "xss"
CLS_CMDI = "cmdi"
CLS_SENSITIVE = "sensitive"
CLS_JNDI = "jndi"
CLS_METHOD = "method"
CLS_ANOMALY = "anomaly"

_SQLI = re.compile(
    r"(union\s+select|'[\s]*or[\s]*'|or\s+1=1|sleep\s*\(|information_schema|waitfor\s+delay)",
    re.I,
)
_XSS = re.compile(r"(<\s*script|onerror\s*=|javascript:|<\s*img)", re.I)
_CMDI = re.compile(
    r"(;|\||`|\$\()\s*(wget|curl|bash|sh|nc|python|perl|chmod)\b"
    r"|/bin/(ba)?sh|cmd\.exe",
    re.I,
)
_LFI = re.compile(r"(\.\./|\.\.\\|/etc/passwd|/proc/self|/windows/win\.ini)", re.I)
_JNDI = re.compile(r"\$\{jndi:", re.I)
_SENSITIVE = re.compile(
    r"(/\.(env|git|svn|htpasswd|htaccess)\b"
    r"|/wp-admin|/phpmyadmin|/adminer"
    r"|/(id_rsa|shadow|credentials)\b"
    r"|/\.aws/|\.sql(\.gz)?$)",
    re.I,
)
# Classic probes that never belong on this host. One hit is enough to name
# the window; do not wait for the 404-scanner threshold.
_PROBE = re.compile(
    r"(eval-stdin\.php|/vendor/phpunit|/wp-login\.php|/xmlrpc\.php"
    r"|/cgi-bin/|/actuator/|/manager/html)",
    re.I,
)
_UNUSUAL_METHOD = {"TRACE", "TRACK", "CONNECT", "DEBUG"}

# Window thresholds (mirror kernelai-flood / 404-scanner orders of magnitude,
# scaled down so a one-minute window on this host still fires).
# 12 missed an 11×404 phpunit sweep; 8 still ignores a handful of broken links.
SCANNER_404 = 8
FLOOD_COUNT = 80


def _hay(event: HttpEvent) -> str:
    query = unquote_plus(event.query or "").replace("+", " ")
    return f"{event.path} {query} {event.body}"


def classify_event(event: HttpEvent) -> str | None:
    """Single-request teacher class, or None if the request is unremarkable."""
    hay = _hay(event)
    if _JNDI.search(hay):
        return CLS_JNDI
    if _LFI.search(hay):
        return CLS_LFI
    if _SQLI.search(hay):
        return CLS_SQLI
    if _CMDI.search(hay):
        return CLS_CMDI
    if _XSS.search(hay):
        return CLS_XSS
    if _SENSITIVE.search(event.path) or _SENSITIVE.search(event.query):
        return CLS_SENSITIVE
    if _PROBE.search(event.path):
        return CLS_SCANNER
    if event.method in _UNUSUAL_METHOD:
        return CLS_METHOD
    return None


def named_attempt_class(label: str, cls: str) -> str | None:
    """DNA may only show a class the teacher can name.

    The logistic model treats raw ``count`` as flood-like, so a dashboard
    polling /api/* at ~75 req/min scores as attempt while the teacher says
    quiet. That is not a fact for the helix.
    """
    if label != "attempt":
        return None
    if not cls or cls in {"benign", CLS_ANOMALY}:
        return None
    return cls


def classify_window(events: Iterable[HttpEvent], flags: dict[str, float]) -> tuple[str, str, str]:
    """Return (label, cls, why) for one IP window.

    label is attempt or benign. cls is the DNA feature suffix.
    """
    rows = list(events)
    n = len(rows)
    n404 = sum(1 for event in rows if event.status == 404)
    per_event = [classify_event(event) for event in rows]
    hit = next((cls for cls in per_event if cls), None)

    if n >= FLOOD_COUNT:
        return "attempt", CLS_FLOOD, f"flood:{n} req in window"
    if n404 >= SCANNER_404:
        return "attempt", CLS_SCANNER, f"scanner:{n404} x404"
    if hit:
        return "attempt", hit, f"pattern:{hit}"
    if flags.get("has_traversal") or flags.get("has_sqli") or flags.get("has_cmdi"):
        cls = CLS_LFI if flags.get("has_traversal") else (CLS_SQLI if flags.get("has_sqli") else CLS_CMDI)
        return "attempt", cls, f"flag:{cls}"
    return "benign", "benign", "quiet"
