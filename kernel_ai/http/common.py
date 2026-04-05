"""Common HTTP helpers."""

from flask import g, has_request_context, jsonify


def build_error_payload(message, code, details=None):
    """Build a stable API error envelope."""
    payload = {
        "error": str(message),
        "code": str(code),
    }
    if has_request_context():
        request_id = getattr(g, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
    if details is not None:
        payload["details"] = details
    return payload


def api_json(producer, error_status=500, error_extra=None, exception_statuses=None):
    """Execute producer and serialize response/error as JSON."""
    try:
        return jsonify(producer())
    except Exception as e:
        status = error_status
        error_code = "internal_error"
        if exception_statuses:
            for exc_type, exc_status in exception_statuses:
                if isinstance(e, exc_type):
                    status = exc_status
                    break
        if status == 400:
            error_code = "bad_request"
        elif status == 404:
            error_code = "not_found"
        elif status == 503:
            error_code = "service_unavailable"
        payload = build_error_payload(str(e), error_code)
        if error_extra:
            payload.update(error_extra)
        return jsonify(payload), status
