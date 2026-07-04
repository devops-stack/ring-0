"""Tests for shared logging helpers."""

import logging

from kernel_ai import logging_helpers as lh


def test_sanitize_payload_masks_sensitive_keys():
    payload = {
        "Authorization": "Bearer abc",
        "nested": {"token": "secret-token", "ok": "x"},
    }
    out = lh.sanitize_payload(payload)
    assert out["Authorization"] == "***"
    assert out["nested"]["token"] == "***"
    assert out["nested"]["ok"] == "x"


def test_sanitize_payload_truncates_long_strings():
    long_value = "x" * 600
    out = lh.sanitize_payload({"msg": long_value})
    assert out["msg"].endswith("...<truncated>")


def test_log_event_emits_event_data(caplog):
    logger = logging.getLogger("tests.logging_helpers")
    with caplog.at_level(logging.INFO):
        lh.log_event(
            logger,
            "INFO",
            "hello",
            event_dataset="kernel_ai.app",
            component="tests",
            operation="unit",
            event_data={"password": "123", "ok": 1},
        )
    assert caplog.records
    record = caplog.records[-1]
    event_data = getattr(record, "event_data", {})
    assert event_data["event.dataset"] == "kernel_ai.app"
    assert event_data["component"] == "tests"
    assert event_data["operation"] == "unit"
    assert event_data["password"] == "***"
    assert event_data["ok"] == 1
