"""Global Flask hooks (CORS, cache headers)."""
from flask import current_app


def register_hooks(app):
    """Register after_request handler for CORS and static/HTML cache control."""

    @app.after_request
    def add_headers(response):
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
