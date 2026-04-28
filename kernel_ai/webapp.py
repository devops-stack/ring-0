#!/usr/bin/env python3
"""
Linux Kernel Visualization Backend
Thin Flask bootstrap module.
"""

import os
import logging
from flask import Flask, jsonify

from kernel_ai.config import Config
from kernel_ai.hooks import register_hooks
from kernel_ai.http.common import build_error_payload
from kernel_ai.http.register import register_http_routes
from kernel_ai.logging_helpers import log_event
from kernel_ai.logging_setup import configure_logging
from kernel_ai.prometheus_setup import init_prometheus
from kernel_ai.sentry_setup import init_sentry
from kernel_ai.state import attach_state_container

logger = logging.getLogger(__name__)

def _ensure_prometheus_mpdir():
    # Gunicorn -w N: set PROMETHEUS_MULTIPROC_DIR before workers import this module.
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR", "").strip():
        _prom_mpdir = os.environ["PROMETHEUS_MULTIPROC_DIR"].strip()
        os.makedirs(_prom_mpdir, exist_ok=True)


def _register_error_handlers(app):
    @app.errorhandler(404)
    def not_found(error):
        return jsonify(build_error_payload("Not found", "not_found")), 404

    @app.errorhandler(500)
    def internal_error(error):
        return jsonify(build_error_payload("Internal server error", "internal_error")), 500


def create_app():
    """Application factory that builds and configures a Flask instance."""
    _ensure_prometheus_mpdir()
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    app = Flask(
        __name__,
        static_folder=os.path.join(root, "static"),
        template_folder=os.path.join(root, "templates"),
    )
    app.config.from_object(Config)
    configure_logging(app)
    sentry_enabled = init_sentry(app)
    log_event(
        logger,
        "INFO",
        "app_startup",
        event_dataset="kernel_ai.app",
        component="webapp",
        operation="create_app",
        event_data={
            "service.environment": app.config.get("ENV", "production"),
            "debug": bool(app.config.get("DEBUG", False)),
            "api_prefix": app.config.get("API_PREFIX", "/api"),
            "prometheus_multiproc_enabled": bool(
                os.environ.get("PROMETHEUS_MULTIPROC_DIR", "").strip()
            ),
            "log_level": app.config.get("LOG_LEVEL"),
            "log_format": app.config.get("LOG_FORMAT"),
            "sentry_enabled": sentry_enabled,
        },
    )
    attach_state_container(app)
    init_prometheus(app)
    register_hooks(app)
    register_http_routes(app)
    _register_error_handlers(app)
    return app


# Keep module-level app for Gunicorn and backward-compatible imports.
app = create_app()
