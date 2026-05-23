"""Sentry initialization helpers for Flask app."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def init_sentry(app) -> bool:
    """Initialize Sentry from app config.

    Returns True when initialization succeeds and False otherwise.
    """
    dsn = str(app.config.get("SENTRY_DSN", "") or "").strip()
    if not dsn:
        logger.info("Sentry disabled: SENTRY_DSN is empty")
        return False

    try:
        import sentry_sdk
        from sentry_sdk.integrations.flask import FlaskIntegration
    except Exception as exc:  # pragma: no cover - import failure is deployment issue
        logger.warning("Sentry SDK not available: %s", exc)
        return False

    sentry_sdk.init(
        dsn=dsn,
        integrations=[FlaskIntegration()],
        environment=app.config.get("SENTRY_ENVIRONMENT"),
        release=app.config.get("SENTRY_RELEASE"),
        send_default_pii=bool(app.config.get("SENTRY_SEND_DEFAULT_PII", False)),
        traces_sample_rate=float(app.config.get("SENTRY_TRACES_SAMPLE_RATE", 0.0)),
    )
    logger.info("Sentry initialized")
    return True
