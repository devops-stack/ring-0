"""Tests for the parsing the root syscall collector does.

The collector is a standalone script run by systemd, not part of the package,
so it is loaded by path. Every fixture here is shaped like the real file it
stands for: ``/proc/locks`` with a blocked waiter, the ``tfd:`` lines of an
epoll set, and the octal open flags of a pipe's two ends.
"""

import importlib.util
import os

_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "deploy", "ebpf", "syscall_snapshot_collector.py",
)
_spec = importlib.util.spec_from_file_location("syscall_snapshot_collector", _PATH)
collector = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(collector)


LOCKS_TEXT = """1: POSIX  ADVISORY  WRITE 166 00:19:144 0 EOF
2: FLOCK  ADVISORY  WRITE 151877 ca:01:71958 0 EOF
2: -> FLOCK  ADVISORY  WRITE 151999 ca:01:71958 0 EOF
"""

# /proc/<pid>/fdinfo/<epfd> of a systemd epoll set, trimmed to three entries.
EPOLL_TEXT = """pos:\t0
flags:\t02000002
mnt_id:\t16
ino:\t294
tfd:       99 events:       18 data:     6546d479d470  pos:0 ino:826 sdev:8
tfd:       24 events:        1 data:     6546d471bde0  pos:0 ino:fc9be38 sdev:8
tfd:      133 events:    80000019 data:     6546d47b90b0  pos:0 ino:e47c349 sdev:8
"""


def _fake_reads(monkeypatch, files):
    monkeypatch.setattr(collector, "_read", lambda path: files.get(path, ""))


def test_a_blocked_waiter_is_read_as_one(monkeypatch):
    """The "->" of a blocked task shifts every field after it by one."""
    _fake_reads(monkeypatch, {"/proc/locks": LOCKS_TEXT,
                              "/proc/166/comm": "multipathd",
                              "/proc/151877/comm": "snapd",
                              "/proc/151999/comm": "snap"})

    rows = collector._locks()

    assert [(r["pid"], r["waiting"]) for r in rows] == [
        (166, False), (151877, False), (151999, True)]
    assert rows[0]["kind"] == "POSIX" and rows[0]["mode"] == "WRITE"
    # The holder and the task blocked behind it name the same file.
    assert rows[1]["inode"] == rows[2]["inode"] == "ca:01:71958"
    assert rows[2]["comm"] == "snap"


def test_the_descriptors_an_epoll_set_watches_are_listed(monkeypatch):
    _fake_reads(monkeypatch, {"/proc/1/fdinfo/4": EPOLL_TEXT})
    links = {"/proc/1/fd/99": "socket:[826]", "/proc/1/fd/24": "anon_inode:[timerfd]"}

    def readlink(path):
        if path not in links:
            raise OSError(2, "No such file or directory")
        return links[path]

    monkeypatch.setattr(collector.os, "readlink", readlink)

    watch = collector._epoll_watch("1", 4)

    assert watch["total"] == 3
    assert [w["fd"] for w in watch["watched"]] == [99, 24, 133]
    # events are hex, and the third entry carries the edge-triggered bit.
    assert [w["events"] for w in watch["watched"]] == [0x18, 0x1, 0x80000019]
    assert watch["watched"][0]["target"] == "socket:[826]"
    # A descriptor whose link cannot be read is kept, without a target.
    assert watch["watched"][2]["target"] is None


def test_a_set_larger_than_the_cap_still_reports_its_size(monkeypatch):
    lines = "\n".join(
        f"tfd:{i:9d} events:        1 data: 0 pos:0 ino:1 sdev:8" for i in range(60))
    _fake_reads(monkeypatch, {"/proc/1/fdinfo/4": lines})
    monkeypatch.setattr(collector.os, "readlink", lambda path: "socket:[1]")

    watch = collector._epoll_watch("1", 4)

    assert watch["total"] == 60
    assert len(watch["watched"]) == collector.MAX_WATCHED


def test_a_thread_with_no_epoll_set_gets_nothing(monkeypatch):
    _fake_reads(monkeypatch, {})

    assert collector._epoll_watch("1", 4) is None


def test_the_two_ends_of_a_pipe_are_told_apart_by_open_flags(monkeypatch):
    """The low two bits of the octal flags are the access mode."""
    _fake_reads(monkeypatch, {
        "/proc/100/fdinfo/3": "pos:\t0\nflags:\t0100000\nmnt_id:\t14\n",
        "/proc/200/fdinfo/1": "pos:\t0\nflags:\t0100001\nmnt_id:\t14\n",
    })

    assert collector._access_mode("100", "3") == "read"
    assert collector._access_mode("200", "1") == "write"
