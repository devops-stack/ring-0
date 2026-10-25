"""ALB standby health and the visualization-only ML switch."""

import pytest

from kernel_ai.webapp import create_app


@pytest.fixture
def client():
    return create_app().test_client()


def test_health_stays_healthy_without_a_peer(client, monkeypatch):
    monkeypatch.delenv("KERNEL_AI_STANDBY_PEER", raising=False)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "healthy"
    assert "role" not in resp.get_json()


def test_standby_yields_while_the_primary_answers(client, monkeypatch):
    monkeypatch.setenv("KERNEL_AI_STANDBY_PEER", "https://172.31.25.131/health")
    monkeypatch.setattr("kernel_ai.http.pages.peer_is_up", lambda url, timeout=2.0: True)
    resp = client.get("/health")
    body = resp.get_json()
    assert resp.status_code == 503
    assert body["status"] == "standby"
    assert body["role"] == "standby"
    assert body["peer"] == "up"


def test_standby_takes_over_when_the_primary_does_not_answer(client, monkeypatch):
    monkeypatch.setenv("KERNEL_AI_STANDBY_PEER", "https://172.31.25.131/health")
    monkeypatch.setattr("kernel_ai.http.pages.peer_is_up", lambda url, timeout=2.0: False)
    resp = client.get("/health")
    body = resp.get_json()
    assert resp.status_code == 200
    assert body["status"] == "healthy"
    assert body["peer"] == "down"


def test_ml_reads_are_empty_when_disabled(client, monkeypatch):
    monkeypatch.setenv("KERNEL_AI_ML_ENABLED", "false")
    anomalies = client.get("/api/ml-anomalies")
    drift = client.get("/api/ml-drift")
    assert anomalies.status_code == 200
    assert anomalies.get_json()["available"] is False
    assert anomalies.get_json()["anomalies"] == []
    assert drift.status_code == 200
    assert drift.get_json()["available"] is False
    assert drift.get_json()["reason"] == "disabled"
