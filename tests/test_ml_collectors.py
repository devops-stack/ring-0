"""Tests for Stage 6 syscall event contract + n-gram stream ingest."""

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
