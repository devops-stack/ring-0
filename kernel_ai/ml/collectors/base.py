"""Shared syscall-event contract for Stage 6 L2 collectors."""

from __future__ import annotations

import json
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

# Linux x86_64 syscall numbers for the allowlist (audit logs emit numbers).
ALLOWED_SYSCALL_NR: frozenset[int] = frozenset(
    {
        56,  # clone
        57,  # fork
        58,  # vfork
        59,  # execve
        322,  # execveat
        435,  # clone3
        41,  # socket (not scored alone; kept out — connect/accept matter more)
        42,  # connect
        43,  # accept
        49,  # bind
        50,  # listen
        288,  # accept4
        2,  # open
        257,  # openat
        85,  # creat
        263,  # unlinkat
        264,  # renameat
        316,  # renameat2
        9,  # mmap
        10,  # mprotect
        330,  # pkey_mprotect
        105,  # setuid
        113,  # setreuid
        117,  # setresuid
        106,  # setgid
        114,  # setregid
        119,  # setresgid
        101,  # ptrace
        310,  # process_vm_writev
        319,  # memfd_create
        323,  # userfaultfd
    }
)

# Minimal nr → name map for allowlisted calls (collector / audit parser).
SYSCALL_NR_TO_NAME: dict[int, str] = {
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
