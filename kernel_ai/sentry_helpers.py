"""Lightweight helpers for optional Sentry reporting."""

from __future__ import annotations

from collections.abc import Mapping


def capture_exception(exc: BaseException, *, where: str | None = None, extra: Mapping | None = None) -> None:
    """Send an exception to Sentry if SDK is available/initialized.

    This helper never raises to keep exception paths safe.
    """
    try:
        import sentry_sdk
    except Exception:
        return

    try:
        with sentry_sdk.push_scope() as scope:
            if where:
                scope.set_tag("where", str(where))
            if extra:
                for key, value in extra.items():
                    scope.set_extra(str(key), value)
            sentry_sdk.capture_exception(exc)
    except Exception:
        return
