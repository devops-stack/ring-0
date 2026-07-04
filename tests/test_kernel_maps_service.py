"""Tests for ``kernel_ai.services.kernel_maps``."""

from kernel_ai.services import kernel_maps as svc


def test_syscall_names_contains_common_entries():
    assert svc.SYSCALL_NAMES[0] == "read"
    assert svc.SYSCALL_NAMES[41] == "socket"


def test_map_syscall_to_subsystem():
    assert svc.map_syscall_to_subsystem("read") == "fs"
    assert svc.map_syscall_to_subsystem("socket") == "net"
    assert svc.map_syscall_to_subsystem("mmap") == "mm"


def test_map_interrupt_to_subsystem():
    assert svc.map_interrupt_to_subsystem("timer0") == "sched"
    assert svc.map_interrupt_to_subsystem("eth0") == "net"
