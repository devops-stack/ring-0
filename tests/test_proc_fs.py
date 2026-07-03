"""Unit tests for ``kernel_ai.collectors.proc_fs``."""

from pathlib import Path

import pytest

from kernel_ai.collectors import proc_fs


def test_safe_read_text_reads_file(tmp_path: Path) -> None:
    p = tmp_path / "x.txt"
    p.write_text("hello\n", encoding="utf-8")
    assert proc_fs.safe_read_text(str(p)) == "hello"


def test_safe_read_text_missing_returns_none() -> None:
    assert proc_fs.safe_read_text("/nonexistent/proc/diskstats-xyz") is None


def test_read_diskstats_skips_loop_and_ram() -> None:
    sample = (
        "   8       0 loop0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n"
        "   8       1 sda 100 0 200 0 300 0 400 0 0 0 0 0 0 0 0\n"
    )

    def fake_open(path, *args, **kwargs):
        if path == "/proc/diskstats":
            from io import StringIO

            return StringIO(sample)
        raise AssertionError(f"unexpected open: {path!r}")

    import builtins

    orig_open = builtins.open
    builtins.open = fake_open
    try:
        out = proc_fs.read_diskstats()
    finally:
        builtins.open = orig_open

    assert "loop0" not in out
    assert out.get("sda") == 200 + 400  # sectors read + write


def test_monkeypatch_proc_fs_seen_by_handlers(monkeypatch: pytest.MonkeyPatch) -> None:
    """Patching ``proc_fs`` updates behavior for network system handlers."""
    from kernel_ai.http.api_handlers import network_system

    def fake_diskstats():
        return {"mockdev": 42}

    monkeypatch.setattr(proc_fs, "read_diskstats", fake_diskstats)
    assert network_system._proc_fs.read_diskstats() == {"mockdev": 42}
