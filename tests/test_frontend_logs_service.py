"""Tests for ``kernel_ai.services.frontend_logs``."""

from threading import Lock

from kernel_ai.services import frontend_logs as svc


def test_safe_trim_truncates():
    out = svc.safe_trim("abcdefghij", limit=4)
    assert out == "abcd...[truncated]"


def test_write_frontend_event_writes_jsonl(tmp_path):
    log_file = tmp_path / "frontend-events.jsonl"
    svc.write_frontend_event(
        event_payload={"level": "INFO", "message": "hello"},
        frontend_log_file=str(log_file),
        write_lock=Lock(),
    )
    data = log_file.read_text(encoding="utf-8")
    assert "hello" in data
    assert "kernel-ai-frontend" in data


def test_ingest_frontend_logs_payload_rejects_non_json():
    payload, status = svc.ingest_frontend_logs_payload(
        payload=None,
        write_event_fn=lambda _event: None,
    )
    assert status == 400
    assert "Invalid JSON payload" in payload["error"]


def test_ingest_frontend_logs_payload_accepts_dict_and_list():
    seen = []

    payload, status = svc.ingest_frontend_logs_payload(
        payload={"events": [{"message": "a"}, {"message": "b"}, "skip-me"]},
        write_event_fn=lambda event: seen.append(event),
    )
    assert status == 200
    assert payload["accepted"] == 2
    assert seen == [{"message": "a"}, {"message": "b"}]
