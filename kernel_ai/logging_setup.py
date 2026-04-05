"""Application logging setup for ops/SIEM."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone


class JsonLogFormatter(logging.Formatter):
    """Compact ECS-like JSON formatter."""

    def __init__(self, service_name: str):
        super().__init__()
        self._service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "@timestamp": datetime.now(timezone.utc).isoformat(),
            "log.level": record.levelname.lower(),
            "message": record.getMessage(),
            "service.name": self._service_name,
            "logger.name": record.name,
        }
        event_data = getattr(record, "event_data", None)
        if isinstance(event_data, dict):
            payload.update(event_data)
        if record.exc_info:
            payload["error.stack_trace"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=True)


def configure_logging(app) -> None:
    """Configure process logging once (safe for create_app calls in tests)."""
    root_logger = logging.getLogger()
    level_name = str(app.config.get("LOG_LEVEL", "INFO")).upper()
    level = getattr(logging, level_name, logging.INFO)
    root_logger.setLevel(level)

    for handler in root_logger.handlers:
        if getattr(handler, "_kernel_ai_managed", False):
            handler.setLevel(level)
            return

    handler = logging.StreamHandler()
    handler._kernel_ai_managed = True  # type: ignore[attr-defined]
    handler.setLevel(level)

    log_format = str(app.config.get("LOG_FORMAT", "json")).strip().lower()
    service_name = str(app.config.get("LOG_SERVICE_NAME", "kernel-ai-backend"))
    if log_format == "json":
        handler.setFormatter(JsonLogFormatter(service_name=service_name))
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s %(name)s - %(message)s",
            )
        )
    root_logger.addHandler(handler)
