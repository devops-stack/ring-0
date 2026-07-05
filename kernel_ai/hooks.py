"""Global Flask hooks (CORS, cache headers, request id, access log)."""

import json
import logging
import re
import time
from uuid import uuid4

from flask import current_app, g, request

_http_access_logger = logging.getLogger("kernel_ai.http.access")

# --- Request body capture (for web-attack detection) -----------------------
# Only bodies of these methods are inspected.
_BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Never read more than this many bytes into memory (skip large/binary uploads).
_MAX_BODY_READ = 64 * 1024
# Truncate the logged (masked) body to this many characters.
_BODY_LOG_MAX = 2048
# Only inspect textual payloads where attack signatures are meaningful.
_BODY_CONTENT_TYPES = ("json", "x-www-form-urlencoded", "text/")
# Keys whose values must never reach the SIEM in clear text.
_SENSITIVE_KEYS = (
    "password", "passwd", "pwd", "token", "secret", "api_key", "apikey",
    "authorization", "auth", "cookie", "session", "access_token",
    "refresh_token", "client_secret", "private_key", "credit", "card",
    "cvv", "ssn", "otp",
)
_MASK = "***MASKED***"
# Masks `key=value` / `"key": "value"` pairs in raw/form bodies.
_SENSITIVE_RE = re.compile(
    r'(?i)((?:password|passwd|pwd|token|secret|api[_-]?key|authorization|'
    r'cookie|session|access[_-]?token|refresh[_-]?token|client[_-]?secret|'
    r'private[_-]?key|cvv|ssn|otp)["\']?\s*[:=]\s*["\']?)([^&"\'\s,}]+)'
)


def _is_sensitive_key(key):
    lowered = str(key).lower()
    return any(token in lowered for token in _SENSITIVE_KEYS)


def _mask_structure(obj):
    """Recursively mask sensitive values in decoded JSON structures."""
    if isinstance(obj, dict):
        return {
            k: (_MASK if _is_sensitive_key(k) else _mask_structure(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_mask_structure(v) for v in obj]
    return obj


def _mask_text(text):
    return _SENSITIVE_RE.sub(lambda m: m.group(1) + _MASK, text)


def _capture_body():
    """Return (masked_body_str_or_None, original_size_or_None).

    Reads and caches the raw body so downstream views keep working, masks
    secrets, and truncates. Any failure yields (None, size) — logging must
    never break request handling.
    """
    if request.method not in _BODY_METHODS:
        return None, None
    size = request.content_length or 0
    if size <= 0 or size > _MAX_BODY_READ:
        return None, (size or None)
    ctype = (request.content_type or "").lower()
    if not any(t in ctype for t in _BODY_CONTENT_TYPES):
        return None, size
    raw = request.get_data(cache=True, as_text=False) or b""
    if not raw:
        return None, size
    text = raw.decode("utf-8", errors="replace")
    if "json" in ctype:
        try:
            masked = json.dumps(_mask_structure(json.loads(text)), ensure_ascii=False)
        except Exception:
            masked = _mask_text(text)
    else:
        masked = _mask_text(text)
    if len(masked) > _BODY_LOG_MAX:
        masked = masked[:_BODY_LOG_MAX] + "...[truncated]"
    return masked, len(raw)


def register_hooks(app):
    """Register after_request handler for CORS and static/HTML cache control."""

    @app.before_request
    def assign_request_id():
        incoming = (request.headers.get("X-Request-ID") or "").strip()
        g.request_id = incoming or uuid4().hex
        g.request_started_ns = time.time_ns()
        # Capture body here: the stream is still available and gets cached
        # for the view. Guarded so it can never break the request.
        g.req_body_content = None
        g.req_body_bytes = None
        try:
            g.req_body_content, g.req_body_bytes = _capture_body()
        except Exception:  # pragma: no cover - defensive
            pass

    @app.after_request
    def add_headers(response):
        request_id = getattr(g, "request_id", None)
        if request_id:
            response.headers["X-Request-ID"] = request_id

        started_ns = getattr(g, "request_started_ns", None)
        duration_ns = (time.time_ns() - started_ns) if started_ns else None
        source_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
        if source_ip and "," in source_ip:
            source_ip = source_ip.split(",")[0].strip()

        event_data = {
            "@timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "event.category": "web",
            "event.type": "access",
            "event.dataset": "kernel_ai.http",
            "request.id": request_id,
            "source.ip": source_ip,
            "http.request.method": request.method,
            "http.version": request.environ.get("SERVER_PROTOCOL", ""),
            "host.name": request.host,
            "url.path": request.path,
            "url.query": (request.query_string or b"").decode("utf-8", errors="ignore"),
            "user_agent.original": request.headers.get("User-Agent"),
            "http.response.status_code": response.status_code,
            "service.environment": current_app.config.get("ENV", "production"),
            "event.duration": duration_ns,
        }
        body_content = getattr(g, "req_body_content", None)
        if body_content:
            event_data["http.request.body.content"] = body_content
        body_bytes = getattr(g, "req_body_bytes", None)
        if body_bytes:
            event_data["http.request.body.bytes"] = body_bytes

        _http_access_logger.info("http_request", extra={"event_data": event_data})

        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"

        if response.content_type and "text/html" in response.content_type:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
            return response

        if response.content_type and (
            "text/javascript" in response.content_type
            or "application/javascript" in response.content_type
            or "text/css" in response.content_type
            or "image/" in response.content_type
        ):
            if current_app.config["DEBUG"]:
                response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
                response.headers["Pragma"] = "no-cache"
                response.headers["Expires"] = "0"
            else:
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
                if "Pragma" in response.headers:
                    del response.headers["Pragma"]
        return response
