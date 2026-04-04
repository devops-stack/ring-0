"""Common HTTP helpers."""

from flask import jsonify


def api_json(producer, error_status=500, error_extra=None, exception_statuses=None):
    """Execute producer and serialize response/error as JSON."""
    try:
        return jsonify(producer())
    except Exception as e:
        status = error_status
        if exception_statuses:
            for exc_type, exc_status in exception_statuses:
                if isinstance(e, exc_type):
                    status = exc_status
                    break
        payload = {"error": str(e)}
        if error_extra:
            payload.update(error_extra)
        return jsonify(payload), status
