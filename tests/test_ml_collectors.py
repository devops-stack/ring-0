"""Tests for Stage 6 syscall event contract + n-gram stream ingest."""

from kernel_ai.ml.collectors.base import SyscallEvent, decode_events, encode_events
from kernel_ai.ml.sequence import NgramTracker


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
