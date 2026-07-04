"""Tests for ``kernel_ai.services.infra_utils``."""

from kernel_ai.services import infra_utils as svc


def test_resolve_binary_returns_none_for_missing():
    out = svc.resolve_binary("definitely-not-a-real-binary-xyz")
    assert out is None
