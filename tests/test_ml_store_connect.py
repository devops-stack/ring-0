"""Gunicorn + ProtectHome must not make libpq open ~/.postgresql/*.crt."""

from kernel_ai.ml.store import (
    _NO_CLIENT_CERT,
    _NO_CLIENT_KEY,
    connect,
    connect_kwargs,
)


def test_connect_kwargs_do_not_use_home_client_cert():
    kwargs = connect_kwargs(autocommit=True)
    assert kwargs["autocommit"] is True
    assert kwargs["sslcert"] == _NO_CLIENT_CERT
    assert kwargs["sslkey"] == _NO_CLIENT_KEY
    assert "/home/" not in kwargs["sslcert"]
    assert "/home/" not in kwargs["sslkey"]


def test_connect_passes_non_home_cert_paths(monkeypatch):
    seen = {}

    def fake_connect(dsn, **kwargs):
        seen["dsn"] = dsn
        seen["kwargs"] = kwargs
        return object()

    monkeypatch.setattr("kernel_ai.ml.store.psycopg.connect", fake_connect)
    connect("postgresql://example/db")
    assert seen["dsn"] == "postgresql://example/db"
    assert seen["kwargs"]["sslcert"] == _NO_CLIENT_CERT
    assert seen["kwargs"]["sslkey"] == _NO_CLIENT_KEY
