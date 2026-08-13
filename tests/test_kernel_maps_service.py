"""Tests for ``kernel_ai.services.kernel_maps``."""

from kernel_ai.services import kernel_maps as svc


def test_bundled_table_is_the_x86_64_numbering():
    assert svc.SYSCALL_NAMES_X86_64[0] == "read"
    assert svc.SYSCALL_NAMES_X86_64[41] == "socket"


def test_running_table_comes_from_auditd(monkeypatch):
    svc.get_syscall_names.cache_clear()
    monkeypatch.setattr(svc.shutil, "which", lambda _name: "/usr/bin/ausyscall")
    monkeypatch.setattr(
        svc.subprocess, "run",
        lambda *_a, **_k: type("R", (), {"stdout": "Using aarch64 syscall table:\n0\tio_setup\n73\tppoll\n"})()
    )
    table = svc.get_syscall_names()
    # The same number means flock on x86_64: borrowing that name here would
    # mislabel every row on arm64.
    assert table == {0: "io_setup", 73: "ppoll"}
    svc.get_syscall_names.cache_clear()


def test_bundled_table_is_used_only_on_x86_64(monkeypatch):
    svc.get_syscall_names.cache_clear()
    monkeypatch.setattr(svc.shutil, "which", lambda _name: None)
    monkeypatch.setattr(svc.platform, "machine", lambda: "x86_64")
    assert svc.get_syscall_names()[73] == "flock"

    svc.get_syscall_names.cache_clear()
    monkeypatch.setattr(svc.platform, "machine", lambda: "aarch64")
    # Nothing trustworthy left: callers show syscall_<number> instead of a name
    # taken from another architecture.
    assert svc.get_syscall_names() == {}
    svc.get_syscall_names.cache_clear()


def test_unreadable_auditd_output_does_not_break_resolution(monkeypatch):
    svc.get_syscall_names.cache_clear()
    monkeypatch.setattr(svc.shutil, "which", lambda _name: "/usr/bin/ausyscall")

    def _boom(*_a, **_k):
        raise OSError("no exec")

    monkeypatch.setattr(svc.subprocess, "run", _boom)
    monkeypatch.setattr(svc.platform, "machine", lambda: "x86_64")
    assert svc.get_syscall_names()[0] == "read"
    svc.get_syscall_names.cache_clear()


def test_map_syscall_to_subsystem():
    assert svc.map_syscall_to_subsystem("read") == "fs"
    assert svc.map_syscall_to_subsystem("socket") == "net"
    assert svc.map_syscall_to_subsystem("mmap") == "mm"


def test_map_interrupt_to_subsystem():
    assert svc.map_interrupt_to_subsystem("timer0") == "sched"
    assert svc.map_interrupt_to_subsystem("eth0") == "net"
