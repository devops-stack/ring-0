"""Frontend logs normalization and persistence helpers."""

from __future__ import annotations

import json
import os
from datetime import datetime


def safe_trim(value, limit=2048):
    """Trim large strings to keep log payload size bounded."""
    if value is None:
        return ""
    text = str(value)
    if len(text) <= limit:
        return text
    return text[:limit] + "...[truncated]"


def write_frontend_event(event_payload, frontend_log_file, write_lock):
    """Write one frontend event as JSON line for Elastic Agent tail input."""
    event = {
        "@timestamp": datetime.utcnow().isoformat() + "Z",
        "service.name": "kernel-ai-frontend",
        "event.dataset": "kernel_ai.frontend",
        "event.kind": "event",
        "log.level": safe_trim(event_payload.get("level", "info"), 16).lower(),
        "message": safe_trim(event_payload.get("message", "")),
        "url.path": safe_trim(event_payload.get("path", ""), 512),
        "url.full": safe_trim(event_payload.get("url", ""), 2048),
        "user_agent.original": safe_trim(event_payload.get("userAgent", ""), 1024),
        "session.id": safe_trim(event_payload.get("sessionId", ""), 128),
        "error.stack_trace": safe_trim(event_payload.get("stack", ""), 12000),
        "event.module": safe_trim(event_payload.get("module", "frontend"), 128),
        "tags": event_payload.get("tags", []),
        "meta": event_payload.get("meta", {}),
    }
    os.makedirs(os.path.dirname(frontend_log_file), exist_ok=True)
    line = json.dumps(event, ensure_ascii=False)
    with write_lock:
        with open(frontend_log_file, "a", encoding="utf-8") as f:
            f.write(line + "\n")


def ingest_frontend_logs_payload(payload, write_event_fn, max_batch=100):
    """Validate frontend log payload and persist accepted events.

    Returns ``(response_payload, status_code)`` for HTTP layer serialization.
    """
    if payload is None:
        return {"error": "Invalid JSON payload"}, 400

    events = payload.get("events", payload if isinstance(payload, list) else [payload])
    if not isinstance(events, list):
        return {"error": "Expected event object or list of events"}, 400
    if len(events) > max_batch:
        return {"error": "Batch too large"}, 413

    accepted = 0
    for raw in events:
        if not isinstance(raw, dict):
            continue
        write_event_fn(raw)
        accepted += 1

    return {"status": "ok", "accepted": accepted}, 200
