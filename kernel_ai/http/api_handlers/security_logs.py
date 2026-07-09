"""Security/crypto/frontend-log API handlers."""

from flask import current_app, jsonify, request

from kernel_ai.http.common import api_json
from kernel_ai.services import crypto_security as _crypto_security_service
from kernel_ai.services import frontend_logs as _frontend_logs_service
from kernel_ai.state import get_state_container


def _write_frontend_event(event_payload):
    state = get_state_container(current_app)
    _frontend_logs_service.write_frontend_event(
        event_payload=event_payload,
        frontend_log_file=state.frontend_log_file,
        write_lock=state.frontend_log_write_lock,
    )


def crypto_realtime():
    state = get_state_container(current_app)
    return api_json(
        lambda: _crypto_security_service.collect_crypto_realtime(
            crypto_prev=state.crypto_prev,
            entropy_prev=state.entropy_prev,
        )
    )


def crypto_aes_demo():
    return api_json(lambda: _crypto_security_service.collect_aes_demo())


def security_realtime():
    state = get_state_container(current_app)
    return api_json(
        lambda: _crypto_security_service.collect_security_realtime(
            security_prev=state.security_prev
        )
    )


def ingest_frontend_logs():
    if request.method == "OPTIONS":
        return ("", 204)
    response_payload, status_code = _frontend_logs_service.ingest_frontend_logs_payload(
        payload=request.get_json(silent=True),
        write_event_fn=_write_frontend_event,
    )
    return jsonify(response_payload), status_code
