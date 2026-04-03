"""Prometheus metrics registration (optional dependency)."""
import os
import time

from flask import Response, g, jsonify, request

try:
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
        Counter,
        Histogram,
        generate_latest,
        multiprocess,
    )

    _PROMETHEUS_AVAILABLE = True
except ImportError:
    _PROMETHEUS_AVAILABLE = False
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"


def init_prometheus(app):
    """Register before/after request hooks and /metrics on the given Flask app."""
    if not _PROMETHEUS_AVAILABLE:

        @app.route("/metrics")
        def prometheus_metrics_disabled():
            return jsonify(
                {"error": "prometheus_client not installed; pip install prometheus-client"}
            ), 503

        return

    request_count = Counter(
        "http_requests_total",
        "Total HTTP requests",
        ["method", "endpoint", "status"],
    )
    request_latency = Histogram(
        "http_request_duration_seconds",
        "HTTP request latency in seconds",
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, float("inf")),
    )

    @app.before_request
    def _prometheus_before_request():
        g._prom_start = time.perf_counter()

    @app.after_request
    def _prometheus_after_request(response):
        start = getattr(g, "_prom_start", None)
        if start is not None:
            request_latency.observe(time.perf_counter() - start)
        ep = request.endpoint
        rule = request.url_rule.rule if request.url_rule else None
        endpoint_label = ep or rule or "unmatched"
        try:
            request_count.labels(
                method=request.method,
                endpoint=endpoint_label,
                status=str(response.status_code),
            ).inc()
        except Exception:
            pass
        return response

    @app.route("/metrics")
    def prometheus_metrics():
        if os.environ.get("PROMETHEUS_MULTIPROC_DIR", "").strip():
            registry = CollectorRegistry()
            multiprocess.MultiProcessCollector(registry)
            data = generate_latest(registry)
        else:
            data = generate_latest()
        return Response(data, mimetype=CONTENT_TYPE_LATEST)
