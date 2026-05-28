"""Global Flask hooks (CORS, cache headers, request id)."""

import logging
import time
from uuid import uuid4

from flask import current_app, g, request

_http_access_logger = logging.getLogger("kernel_ai.http.access")


def register_hooks(app):
    """Register after_request handler for CORS and static/HTML cache control."""

    @app.before_request
    def assign_request_id():
        incoming = (request.headers.get("X-Request-ID") or "").strip()
        g.request_id = incoming or uuid4().hex
        g.request_started_ns = time.time_ns()

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
        _http_access_logger.info(
            "http_request",
            extra={
                "event_data": {
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
            },
        )
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
