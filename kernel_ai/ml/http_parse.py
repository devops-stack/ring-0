"""Normalize nginx json_analytics and kernel_ai.http ECS lines into one event."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote_plus


@dataclass(frozen=True)
class HttpEvent:
    ts: float
    src_ip: str
    method: str
    path: str
    query: str
    status: int
    body: str
    user_agent: str
    dataset: str


def _parse_ts(raw: Any) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        value = float(raw)
        return value / 1000.0 if value > 1e12 else value
    text = str(raw).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return None


def _first_ip(*candidates: Any) -> str:
    for raw in candidates:
        if not raw:
            continue
        token = str(raw).split(",")[0].strip()
        if token and token != "-":
            return token
    return ""


def _split_uri(uri: str) -> tuple[str, str]:
    value = unquote_plus(str(uri or ""))
    if "?" not in value:
        return value or "/", ""
    path, query = value.split("?", 1)
    return path or "/", query


def parse_record(obj: dict[str, Any], *, default_ts: float | None = None) -> HttpEvent | None:
    """Accept nginx json_analytics or ECS kernel_ai.http (and Filebeat wrappers)."""
    src = obj
    if isinstance(obj.get("event_data"), dict):
        src = {**obj, **obj["event_data"]}
    if isinstance(obj.get("json"), dict):
        src = {**src, **obj["json"]}

    method = str(src.get("request_method") or src.get("http.request.method") or "GET").upper()
    status_raw = src.get("status", src.get("http.response.status_code", 0))
    try:
        status = int(status_raw)
    except (TypeError, ValueError):
        status = 0

    path = str(src.get("url.path") or "")
    query = str(src.get("url.query") or src.get("args") or "")
    if not path:
        path, uri_query = _split_uri(str(src.get("request_uri") or src.get("url.original") or "/"))
        query = query or uri_query
    path = unquote_plus(path) or "/"

    ts = _parse_ts(src.get("time_iso8601") or src.get("@timestamp") or src.get("ts"))
    if ts is None:
        ts = default_ts
    if ts is None:
        return None

    body = str(src.get("http.request.body.content") or src.get("kai_lower.body") or "")
    dataset = str(src.get("event.dataset") or ("kernel_ai.nginx" if "remote_addr" in src else "kernel_ai.http"))
    return HttpEvent(
        ts=float(ts),
        src_ip=_first_ip(src.get("http_x_forwarded_for"), src.get("source.ip"), src.get("remote_addr")),
        method=method,
        path=path[:512],
        query=query[:1024],
        status=status,
        body=body[:2048],
        user_agent=str(src.get("http_user_agent") or src.get("user_agent.original") or "")[:256],
        dataset=dataset,
    )


def parse_line(line: str, *, default_ts: float | None = None) -> HttpEvent | None:
    text = (line or "").strip()
    if not text or text[0] not in "{[":
        return None
    try:
        obj = json.loads(text)
    except ValueError:
        return None
    if not isinstance(obj, dict):
        return None
    return parse_record(obj, default_ts=default_ts)


def iter_log_lines(path: str, *, since_ts: float | None = None):
    """Yield events from a JSON-lines file. Missing file → empty."""
    try:
        handle = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with handle:
        for line in handle:
            event = parse_line(line)
            if event is None:
                continue
            if since_ts is not None and event.ts < since_ts:
                continue
            yield event
