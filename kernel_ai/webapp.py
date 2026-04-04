#!/usr/bin/env python3
"""
Linux Kernel Visualization Backend
Thin Flask bootstrap module.
"""

import os
from flask import Flask, jsonify

from kernel_ai.collectors import proc_fs as _proc_fs
from kernel_ai.config import Config
from kernel_ai.hooks import register_hooks
from kernel_ai.http.register import register_http_routes
from kernel_ai.prometheus_setup import init_prometheus

# Gunicorn -w N: set PROMETHEUS_MULTIPROC_DIR before workers import this module (e.g. in gunicorn.conf.py).
if os.environ.get("PROMETHEUS_MULTIPROC_DIR", "").strip():
    _prom_mpdir = os.environ["PROMETHEUS_MULTIPROC_DIR"].strip()
    os.makedirs(_prom_mpdir, exist_ok=True)

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
app = Flask(
    __name__,
    static_folder=os.path.join(_ROOT, "static"),
    template_folder=os.path.join(_ROOT, "templates"),
)
app.config.from_object(Config)
init_prometheus(app)
register_hooks(app)


register_http_routes(app)


@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({"error": "Internal server error"}), 500


def create_app():
    """Application factory that returns the module singleton ``app``."""
    return app
