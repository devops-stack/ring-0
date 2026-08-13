"""Tests for Stage 6 syscall event contract + n-gram stream ingest."""

from types import SimpleNamespace

from kernel_ai.ml.collectors.base import (
    AUDIT_ARCH_AARCH64,
    AUDIT_ARCH_X86_64,
    SyscallEvent,
    decode_events,
    encode_events,
    resolve_syscall_name,
)
from kernel_ai.ml.sequence import NgramTracker


def test_resolve_syscall_nr_arch_collision():
    """Same numeric id must not cross-map between x86_64 and aarch64."""
    assert resolve_syscall_name(56, AUDIT_ARCH_X86_64) == "clone"
    assert resolve_syscall_name(56, AUDIT_ARCH_AARCH64) == "openat"
    assert resolve_syscall_name(117, AUDIT_ARCH_X86_64) == "setresuid"
    assert resolve_syscall_name(117, AUDIT_ARCH_AARCH64) == "ptrace"


def test_ngrams_to_tokens_stitches_overlap():
    from kernel_ai.ml.sequence import ngrams_to_tokens

    keys = ["clone|openat|execve", "openat|execve|connect", "execve|connect|setuid"]
    assert ngrams_to_tokens(keys, n=3) == [
        "clone",
        "openat",
        "execve",
        "connect",
        "setuid",
    ]


def test_encode_decode_roundtrip():
    events = [
        SyscallEvent(ts=1.0, pid=10, uid=0, comm="bash", syscall="clone"),
        SyscallEvent(ts=1.1, pid=10, uid=0, comm="bash", syscall="execve"),
    ]
    payload = encode_events(events)
    got = decode_events(payload)
    assert len(got) == 2
    assert got[0].syscall == "clone"
    assert got[1].pid == 10


def test_ngram_tracker_update_stream_builds_trigrams():
    tracker = NgramTracker(n=3, window=50)
    events = [
        SyscallEvent(ts=1.0, pid=7, uid=0, comm="x", syscall="clone"),
        SyscallEvent(ts=1.1, pid=7, uid=0, comm="x", syscall="openat"),
        SyscallEvent(ts=1.2, pid=7, uid=0, comm="x", syscall="execve"),
        SyscallEvent(ts=1.3, pid=7, uid=0, comm="x", syscall="connect"),
    ]
    assert tracker.update_stream(events) == 4
    recent = tracker.recent()
    assert "clone|openat|execve" in recent
    assert "openat|execve|connect" in recent
    pending = tracker.drain_pending()
    assert pending["clone|openat|execve"] == 1


def test_ngram_tracker_recent_by_pid_not_diluted():
    """Hostile short chain on pid B must remain visible vs spam on pid A."""
    from kernel_ai.ml.sequence import StideModel

    tracker = NgramTracker(n=3, window=80)
    spam = [
        SyscallEvent(ts=float(i), pid=1, uid=0, comm="nginx", syscall="connect")
        for i in range(200)
    ]
    novel = [
        SyscallEvent(ts=100 + i * 0.01, pid=2, uid=0, comm="evil", syscall=name)
        for i, name in enumerate(
            ["ptrace", "memfd_create", "execve", "connect", "setuid"] * 8
        )
    ]
    tracker.update_stream(spam + novel)
    by_pid = dict(tracker.recent_by_pid(min_len=24))
    assert 2 in by_pid
    assert any(g.startswith("ptrace|") for g in by_pid[2])
    model = StideModel(n=3, ngrams={"connect|connect|connect"})
    global_m, _ = model.score_window(tracker.recent())
    pid_m, _ = model.score_window(by_pid[2])
    assert pid_m > global_m


def _events(pid, names, start=0.0):
    return [
        SyscallEvent(ts=start + i * 0.01, pid=pid, uid=0, comm="x", syscall=name)
        for i, name in enumerate(names)
    ]


def test_tracker_counts_every_ingested_sample():
    tracker = NgramTracker(n=3, window=50)
    assert tracker.ingested == 0
    tracker.update_stream(_events(7, ["clone", "openat", "execve"]))
    assert tracker.ingested == 3
    # An empty drain is what a dead feed looks like: nothing new to score.
    tracker.update_stream([])
    assert tracker.ingested == 3
    tracker.update({9: "connect"})
    assert tracker.ingested == 4


def test_demo_events_are_scored_but_never_learned():
    """A wiring demo must not be able to teach the profile that ptrace is normal."""
    tracker = NgramTracker(n=3, window=50)
    tracker.update_stream(
        [
            SyscallEvent(ts=i * 0.01, pid=99, uid=0, comm="novel", syscall=name)
            for i, name in enumerate(["ptrace", "memfd_create", "userfaultfd", "connect"])
        ]
    )
    assert "ptrace|memfd_create|userfaultfd" in tracker.recent()
    assert tracker.drain_pending() == {}

    tracker.update_stream(_events(7, ["clone", "openat", "execve"]))
    assert tracker.drain_pending() == {"clone|openat|execve": 1}


def _guard_worker(stale_after=300.0):
    """A worker stripped to the fields the freshness guard touches (no DB)."""
    from kernel_ai.ml.worker import MLWorker

    worker = MLWorker.__new__(MLWorker)
    worker.cfg = SimpleNamespace(seq_stale_warn_sec=stale_after)
    worker.seq_tracker = NgramTracker(n=3, window=50)
    worker._seq_scored_at = -1
    worker._seq_last_event_at = 0.0
    worker._seq_stale_logged = False
    worker._seq_source = "socket"
    return worker


def test_a_frozen_window_is_scored_only_once():
    worker = _guard_worker()
    worker.seq_tracker.update_stream(_events(7, ["clone", "openat", "execve"]))

    assert worker._sequence_evidence_is_fresh(1000.0) is True
    # The stream stopped. The window still holds those three syscalls, and before
    # the guard it was re-reported once per cooldown for as long as the feed was down.
    assert worker._sequence_evidence_is_fresh(1002.0) is False
    assert worker._sequence_evidence_is_fresh(1004.0) is False

    worker.seq_tracker.update_stream(_events(7, ["connect"], start=5.0))
    assert worker._sequence_evidence_is_fresh(1006.0) is True


def test_a_dead_pid_window_is_not_reported_again():
    """A short-lived pid that ended on an odd chain must not be re-reported forever."""
    worker = _guard_worker()
    tracker = worker.seq_tracker
    tracker.update_stream(_events(42, ["ptrace", "memfd_create", "execve", "connect"]))
    tracker.update_stream(_events(7, ["accept4", "accept4", "accept4"], start=1.0))

    marks: dict[int, int] = {}
    first = worker._fresh_pid_windows(
        tracker.recent_by_pid(min_len=1), marks, tracker.pid_stamps()
    )
    assert {pid for pid, _ in first} == {42, 7}

    # The live pid keeps working, the dead one does not: only the live one returns.
    tracker.update_stream(_events(7, ["accept4"], start=2.0))
    second = worker._fresh_pid_windows(
        tracker.recent_by_pid(min_len=1), marks, tracker.pid_stamps()
    )
    assert [pid for pid, _ in second] == [7]

    # Nothing new at all: nobody is scored.
    assert worker._fresh_pid_windows(
        tracker.recent_by_pid(min_len=1), marks, tracker.pid_stamps()
    ) == []


def test_idle_pids_are_evicted():
    tracker = NgramTracker(n=3, window=50)
    tracker.update_stream(_events(42, ["ptrace", "memfd_create", "execve"]))
    tracker.update_stream(_events(7, ["accept4"] * 20, start=1.0))

    assert tracker.evict_idle(older_than=10) == 1
    assert set(tracker.pid_stamps()) == {7}
    assert [pid for pid, _ in tracker.recent_by_pid(min_len=1)] == [7]


def test_a_silent_stream_is_reported_once_and_on_recovery(caplog):
    worker = _guard_worker(stale_after=300.0)
    worker.seq_tracker.update_stream(_events(7, ["clone", "openat", "execve"]))
    worker._sequence_evidence_is_fresh(1000.0)

    with caplog.at_level("INFO", logger="kernel_ai.ml.worker"):
        # Inside the grace period the silence is not worth a line yet.
        worker._sequence_evidence_is_fresh(1200.0)
        assert not caplog.records

        worker._sequence_evidence_is_fresh(1400.0)
        assert [r.levelname for r in caplog.records] == ["WARNING"]
        assert "silent for 400s" in caplog.records[0].getMessage()

        # Still silent: one line per outage, not one per tick.
        worker._sequence_evidence_is_fresh(1500.0)
        assert len(caplog.records) == 1

        worker.seq_tracker.update_stream(_events(7, ["connect"], start=9.0))
        worker._sequence_evidence_is_fresh(1502.0)
        assert [r.levelname for r in caplog.records] == ["WARNING", "INFO"]
        assert "resumed" in caplog.records[1].getMessage()
