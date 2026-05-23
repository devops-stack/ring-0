"""Shared backend logging helpers."""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence

try:
    from flask import g, has_request_context
except ImportError:  # pragma: no cover
    g = None

    def has_request_context() -> bool:  # type: ignore[override]
        return False


_SENSITIVE_KEYS = {"authorization", "cookie", "set-cookie", "password", "passwd", "secret", "token", "api_key"}
_MASK = "***"
_MAX_STR_LEN = 512


def _truncate_string(value: str, max_len: int = _MAX_STR_LEN) -> str:
    if len(value) <= max_len:
        return value
    return value[:max_len] + "...<truncated>"


def sanitize_payload(value):
    """Recursively mask sensitive fields and cap string lengths."""
    if isinstance(value, str):
        return _truncate_string(value)
    if isinstance(value, Mapping):
        out = {}
        for key, val in value.items():
            key_str = str(key)
            if key_str.lower() in _SENSITIVE_KEYS:
                out[key_str] = _MASK
            else:
                out[key_str] = sanitize_payload(val)
        return out
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray, str)):
        return [sanitize_payload(x) for x in value]
    return value


def log_event(
    logger: logging.Logger,
    level: int | str,
    message: str,
    *,
    event_dataset: str | None = None,
    component: str | None = None,
    operation: str | None = None,
    event_data: dict | None = None,
) -> None:
    """Emit structured event with sanitized context."""
    if isinstance(level, str):
        level_int = getattr(logging, level.upper(), logging.INFO)
    else:
        level_int = int(level)

    payload = sanitize_payload(event_data or {})
    if event_dataset:
        payload.setdefault("event.dataset", event_dataset)
    if component:
        payload.setdefault("component", component)
    if operation:
        payload.setdefault("operation", operation)
    if has_request_context() and g is not None:
        request_id = getattr(g, "request_id", None)
        if request_id:
            payload.setdefault("request.id", request_id)

    logger.log(level_int, message, extra={"event_data": payload})
