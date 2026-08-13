"""Tests for ``kernel_ai.services.syscall_anatomy``."""

import json

from kernel_ai.services import syscall_anatomy as sa


def _pretend_x86(monkeypatch, symbols):
    monkeypatch.setattr(sa.platform, "machine", lambda: "x86_64")
    monkeypatch.setattr(sa, "kernel_symbols", lambda: frozenset(symbols))


def test_the_chain_follows_the_call_from_userspace_to_where_it_sleeps(monkeypatch):
    _pretend_x86(monkeypatch, {
        "entry_SYSCALL_64", "do_syscall_64", "__x64_sys_epoll_wait", "do_epoll_wait", "ep_poll",
    })
    out = sa.describe("epoll_wait", nr=232, subsystem="net", wchans=[("ep_poll", 11)], sampled=12)
    assert [c["symbol"] for c in out["chain"]] == [
        "epoll_wait()",
        "entry_SYSCALL_64",
        "do_syscall_64",
        "__x64_sys_epoll_wait",
        "do_epoll_wait",
        "ep_poll",
    ]
    assert out["chain"][-1]["stage"] == "sleep"
    # The tally covers the sample, not everyone parked in a busy call.
    assert out["chain"][-1]["note"] == "11 of 12 sampled"
    assert out["abi"].startswith("nr in rax")


def test_a_symbol_this_kernel_does_not_have_is_left_out(monkeypatch):
    # do_epoll_wait is inlined on some builds; the card must not claim it.
    _pretend_x86(monkeypatch, {"entry_SYSCALL_64", "do_syscall_64", "__x64_sys_epoll_wait"})
    out = sa.describe("epoll_wait", nr=232, subsystem="net", wchans=[])
    assert [c["symbol"] for c in out["chain"]] == [
        "epoll_wait()", "entry_SYSCALL_64", "do_syscall_64", "__x64_sys_epoll_wait",
    ]


def test_the_sleeping_function_marks_a_symbol_already_on_the_chain(monkeypatch):
    _pretend_x86(monkeypatch, {"entry_SYSCALL_64", "do_syscall_64", "__x64_sys_select", "do_select"})
    out = sa.describe("select", nr=23, subsystem="fs", wchans=[("do_select", 4)])
    sleeping = [c for c in out["chain"] if c["stage"] == "sleep"]
    assert [c["symbol"] for c in sleeping] == ["do_select"]
    # …and it is not repeated further down the chain.
    assert [c["symbol"] for c in out["chain"]].count("do_select") == 1


def test_an_undocumented_call_still_gets_its_number_and_its_chain(monkeypatch):
    _pretend_x86(monkeypatch, {"entry_SYSCALL_64", "do_syscall_64", "__x64_sys_landlock_add_rule"})
    out = sa.describe("landlock_add_rule", nr=445, subsystem="kernel", wchans=[])
    assert out["nr"] == 445
    assert out["signature"] == ""
    assert "__x64_sys_landlock_add_rule" in [c["symbol"] for c in out["chain"]]


def test_userspace_is_the_one_stage_no_table_can_confirm(monkeypatch):
    _pretend_x86(monkeypatch, {"entry_SYSCALL_64", "do_syscall_64"})
    out = sa.describe("read", nr=0, subsystem="fs", wchans=[])
    assert out["chain"][0]["confirmed"] is False
    assert all(c["confirmed"] for c in out["chain"][1:])


def test_without_kallsyms_the_chain_keeps_only_what_it_can_stand_behind(monkeypatch):
    _pretend_x86(monkeypatch, set())
    out = sa.describe("read", nr=0, subsystem="fs", wchans=[("pipe_read", 2)])
    assert out["symbols_confirmed"] is False
    # The entry and dispatch stages are architecture facts, and the sleeping
    # function came from the kernel itself; the handler symbol did not.
    assert [c["symbol"] for c in out["chain"]] == [
        "read()", "entry_SYSCALL_64", "do_syscall_64", "pipe_read",
    ]


def _forget_symbols(monkeypatch):
    monkeypatch.setitem(sa._SYMBOL_CACHE, "names", None)


def test_the_published_set_is_used_when_kallsyms_is_walled_off(tmp_path, monkeypatch):
    # ProtectKernelTunables=yes closes /proc/kallsyms to the backend; the root
    # collector reads it and leaves the names where the backend can get them.
    _forget_symbols(monkeypatch)
    path = tmp_path / "ksyms.json"
    path.write_text(json.dumps(["__x64_sys_read", "ksys_read"]), encoding="utf-8")
    monkeypatch.setattr(sa, "_SYMBOLS_SNAPSHOT", str(path))
    monkeypatch.setattr(sa, "_symbols_from_kallsyms", lambda: frozenset())
    assert sa.kernel_symbols() == frozenset({"__x64_sys_read", "ksys_read"})


def test_kallsyms_answers_when_nothing_was_published(tmp_path, monkeypatch):
    _forget_symbols(monkeypatch)
    monkeypatch.setattr(sa, "_SYMBOLS_SNAPSHOT", str(tmp_path / "absent.json"))
    monkeypatch.setattr(sa, "_symbols_from_kallsyms", lambda: frozenset({"do_syscall_64"}))
    assert sa.kernel_symbols() == frozenset({"do_syscall_64"})


def test_an_empty_answer_is_not_cached_as_the_truth(tmp_path, monkeypatch):
    # A backend that started before the collector must not stay blind until it
    # is restarted.
    _forget_symbols(monkeypatch)
    monkeypatch.setattr(sa, "_SYMBOLS_SNAPSHOT", str(tmp_path / "absent.json"))
    monkeypatch.setattr(sa, "_symbols_from_kallsyms", lambda: frozenset())
    assert sa.kernel_symbols() == frozenset()
    monkeypatch.setattr(sa, "_symbols_from_kallsyms", lambda: frozenset({"do_syscall_64"}))
    assert sa.kernel_symbols() == frozenset({"do_syscall_64"})


def test_publishing_writes_a_readable_list(tmp_path, monkeypatch):
    monkeypatch.setattr(sa, "_symbols_from_kallsyms", lambda: frozenset({"ksys_read", "do_select"}))
    path = tmp_path / "ksyms.json"
    assert sa.publish_symbols(str(path)) == 2
    assert json.loads(path.read_text(encoding="utf-8")) == ["do_select", "ksys_read"]


def test_descriptor_arguments_are_named_only_where_they_exist():
    assert sa.fd_argument("read") == 0
    assert sa.fd_argument("poll") is None
    assert sa.fd_argument("nothing_like_this") is None
