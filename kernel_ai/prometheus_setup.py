"""Prometheus metrics registration (optional dependency)."""
import os
import threading
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

_REQUEST_COUNT = None
_REQUEST_LATENCY = None
_REQUEST_ERRORS = None
_METRICS_LOCK = threading.Lock()


def _get_or_create_http_metrics():
    """Create Prometheus metric objects once per process."""
    global _REQUEST_COUNT, _REQUEST_LATENCY, _REQUEST_ERRORS
    if _REQUEST_COUNT is not None and _REQUEST_LATENCY is not None and _REQUEST_ERRORS is not None:
        return _REQUEST_COUNT, _REQUEST_LATENCY, _REQUEST_ERRORS
    with _METRICS_LOCK:
        if _REQUEST_COUNT is None:
            _REQUEST_COUNT = Counter(
                "http_requests_total",
                "Total HTTP requests",
                ["method", "endpoint", "status"],
            )
        if _REQUEST_LATENCY is None:
            _REQUEST_LATENCY = Histogram(
                "http_request_duration_seconds",
                "HTTP request latency in seconds",
                buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, float("inf")),
            )
        if _REQUEST_ERRORS is None:
            _REQUEST_ERRORS = Counter(
                "http_errors_total",
                "Total HTTP error responses",
                ["method", "endpoint", "status"],
            )
    return _REQUEST_COUNT, _REQUEST_LATENCY, _REQUEST_ERRORS


def init_prometheus(app):
    """Register before/after request hooks and /metrics on the given Flask app."""
    if not _PROMETHEUS_AVAILABLE:

        @app.route("/metrics")
        def prometheus_metrics_disabled():
            return jsonify(
                {"error": "prometheus_client not installed; pip install prometheus-client"}
            ), 503

        return

    request_count, request_latency, request_errors = _get_or_create_http_metrics()

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
            if response.status_code >= 400:
                request_errors.labels(
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
