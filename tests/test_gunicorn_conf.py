"""The child_exit hook runs on every worker exit, including the ones systemd
triggers on restart, so anything raised here lands in the journal of a healthy
box and looks like a crash."""

import importlib.util
from pathlib import Path

import pytest

_CONF = Path(__file__).resolve().parents[1] / "gunicorn.conf.py"


def _load():
    spec = importlib.util.spec_from_file_location("gunicorn_conf", _CONF)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class _Worker:
    pid = 4242


def test_no_multiproc_dir_means_nothing_to_clean_up(monkeypatch):
    # prometheus_client joins the directory with the pid, so an unset variable
    # used to raise TypeError on the None path.
    monkeypatch.delenv("PROMETHEUS_MULTIPROC_DIR", raising=False)
    _load().child_exit(None, _Worker())


def test_a_blank_multiproc_dir_counts_as_unset(monkeypatch):
    monkeypatch.setenv("PROMETHEUS_MULTIPROC_DIR", "   ")
    _load().child_exit(None, _Worker())


def test_configured_multiproc_dir_still_reaps_the_worker(monkeypatch, tmp_path):
    multiprocess = pytest.importorskip("prometheus_client.multiprocess")
    monkeypatch.setenv("PROMETHEUS_MULTIPROC_DIR", str(tmp_path))
    reaped = []
    monkeypatch.setattr(multiprocess, "mark_process_dead", reaped.append)

    _load().child_exit(None, _Worker())

    assert reaped == [_Worker.pid]
