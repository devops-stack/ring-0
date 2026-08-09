"""Shared syscall-event contract for Stage 6 L2 collectors."""

from __future__ import annotations

import json
import os
import platform
from dataclasses import asdict, dataclass
from typing import Iterable, Iterator


# Security-relevant allowlist for v1 (keep CPU bounded on small hosts).
ALLOWED_SYSCALLS: frozenset[str] = frozenset(
    {
        "execve",
        "execveat",
        "clone",
        "clone3",
        "fork",
        "vfork",
        "connect",
        "accept",
        "accept4",
        "bind",
        "listen",
        "open",
        "openat",
        "creat",
        "unlinkat",
        "renameat",
        "renameat2",
        "mmap",
        "mprotect",
        "pkey_mprotect",
        "setuid",
        "setreuid",
        "setresuid",
        "setgid",
        "setregid",
        "setresgid",
        "ptrace",
        "process_vm_writev",
        "memfd_create",
        "userfaultfd",
    }
)

# audit ARCH_* bitmasks (see linux/audit.h) — numbers collide across arches
# (e.g. x86_64 56=clone vs aarch64 56=openat), so maps must stay separate.
AUDIT_ARCH_X86_64 = 0xC000003E
AUDIT_ARCH_AARCH64 = 0xC00000B7

# Linux x86_64 syscall numbers for the allowlist (audit logs emit numbers).
SYSCALL_NR_TO_NAME_X86_64: dict[int, str] = {
    56: "clone",
    57: "fork",
    58: "vfork",
    59: "execve",
    322: "execveat",
    435: "clone3",
    42: "connect",
    43: "accept",
    49: "bind",
    50: "listen",
    288: "accept4",
    2: "open",
    257: "openat",
    85: "creat",
    263: "unlinkat",
    264: "renameat",
    316: "renameat2",
    9: "mmap",
    10: "mprotect",
    330: "pkey_mprotect",
    105: "setuid",
    113: "setreuid",
    117: "setresuid",
    106: "setgid",
    114: "setregid",
    119: "setresgid",
    101: "ptrace",
    310: "process_vm_writev",
    319: "memfd_create",
    323: "userfaultfd",
}

# Linux aarch64 — fork/vfork/open/creat are not separate syscalls.
SYSCALL_NR_TO_NAME_AARCH64: dict[int, str] = {
    220: "clone",
    221: "execve",
    281: "execveat",
    435: "clone3",
    203: "connect",
    202: "accept",
    200: "bind",
    201: "listen",
    242: "accept4",
    56: "openat",
    35: "unlinkat",
    38: "renameat",
    276: "renameat2",
    222: "mmap",
    226: "mprotect",
    288: "pkey_mprotect",
    146: "setuid",
    145: "setreuid",
    147: "setresuid",
    144: "setgid",
    143: "setregid",
    149: "setresgid",
    117: "ptrace",
    271: "process_vm_writev",
    279: "memfd_create",
    282: "userfaultfd",
}


def _host_nr_map() -> dict[int, str]:
    machine = (platform.machine() or os.uname().machine or "").lower()
    if machine in {"aarch64", "arm64"}:
        return SYSCALL_NR_TO_NAME_AARCH64
    return SYSCALL_NR_TO_NAME_X86_64


def nr_map_for_audit_arch(arch: int | None) -> dict[int, str]:
    """Pick nr→name table from audit ``arch=`` field (or host default)."""
    if arch == AUDIT_ARCH_AARCH64:
        return SYSCALL_NR_TO_NAME_AARCH64
    if arch == AUDIT_ARCH_X86_64:
        return SYSCALL_NR_TO_NAME_X86_64
    return _host_nr_map()


def resolve_syscall_name(nr: int, arch: int | None = None) -> str | None:
    """Return allowlisted name for ``nr``, or None if not in the arch map."""
    return nr_map_for_audit_arch(arch).get(nr)


# Back-compat: host-arch map + union of known numbers (filter only; name via resolve).
SYSCALL_NR_TO_NAME: dict[int, str] = dict(_host_nr_map())
ALLOWED_SYSCALL_NR: frozenset[int] = frozenset(
    set(SYSCALL_NR_TO_NAME_X86_64) | set(SYSCALL_NR_TO_NAME_AARCH64)
)


@dataclass(frozen=True)
class SyscallEvent:
    """Normalized L2 syscall event (collector → ML worker)."""

    ts: float
    pid: int
    uid: int
    comm: str
    syscall: str

    def to_json(self) -> str:
        return json.dumps(asdict(self), separators=(",", ":"))

    @classmethod
    def from_mapping(cls, data: dict) -> "SyscallEvent | None":
        try:
            syscall = str(data.get("syscall") or "").strip()
            if not syscall:
                return None
            return cls(
                ts=float(data.get("ts") or 0.0),
                pid=int(data.get("pid")),
                uid=int(data.get("uid") or 0),
                comm=str(data.get("comm") or "?")[:64],
                syscall=syscall[:64],
            )
        except (TypeError, ValueError):
            return None


def encode_events(events: Iterable[SyscallEvent]) -> bytes:
    """Pack one or more events into a single datagram payload."""
    body = "\n".join(ev.to_json() for ev in events)
    return (body + "\n").encode("utf-8")


def decode_events(payload: bytes) -> list[SyscallEvent]:
    """Parse a datagram that may contain multiple NDJSON lines."""
    out: list[SyscallEvent] = []
    try:
        text = payload.decode("utf-8", errors="ignore")
    except Exception:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(data, dict):
            continue
        ev = SyscallEvent.from_mapping(data)
        if ev is not None:
            out.append(ev)
    return out


def iter_allowed(events: Iterable[SyscallEvent]) -> Iterator[SyscallEvent]:
    for ev in events:
        if ev.syscall in ALLOWED_SYSCALLS or ev.syscall.startswith("sys_"):
            yield ev
