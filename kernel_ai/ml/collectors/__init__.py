"""Syscall event sources for Stage 4 / Stage 6.

Privileged collection lives outside the ML worker (see
``docs/ML_STAGE6_L2_COLLECTOR.md``). The worker only *drains* a normalized
event stream and feeds :class:`kernel_ai.ml.sequence.NgramTracker`.
"""

from kernel_ai.ml.collectors.base import ALLOWED_SYSCALLS, SyscallEvent
from kernel_ai.ml.collectors.socket_source import SocketSyscallSource

__all__ = ["ALLOWED_SYSCALLS", "SyscallEvent", "SocketSyscallSource"]
