"""Worker-side reader for the Stage 6 unix-datagram syscall stream."""

from __future__ import annotations

import logging
import os
import socket
import stat
from typing import List

from kernel_ai.ml.collectors.base import SyscallEvent, decode_events

logger = logging.getLogger("kernel_ai.ml.collectors.socket")

_MAX_DATAGRAM = 65535


class SocketSyscallSource:
    """Bind ``/run/kernel-ai/ml-syscall.sock`` and drain collector datagrams.

    Push model: the privileged collector ``sendto``s this path; the ML worker
    (www-data) owns the bind. If bind fails, :meth:`drain` returns [] and
    Stage 4 stays dormant without affecting Stages 1–2.
    """

    def __init__(self, path: str, *, max_events: int = 2000) -> None:
        self.path = path
        self.max_events = max(1, max_events)
        self._sock: socket.socket | None = None
        self._warned = False

    def close(self) -> None:
        if self._sock is not None:
            try:
                self._sock.close()
            except OSError:
                pass
            self._sock = None
        try:
            if os.path.exists(self.path):
                os.unlink(self.path)
        except OSError:
            pass

    def _ensure_sock(self) -> socket.socket | None:
        if self._sock is not None:
            return self._sock
        directory = os.path.dirname(self.path) or "."
        try:
            os.makedirs(directory, mode=0o775, exist_ok=True)
        except OSError as exc:
            if not self._warned:
                logger.warning("seq socket dir %s: %s", directory, exc)
                self._warned = True
            return None
        try:
            if os.path.exists(self.path):
                os.unlink(self.path)
        except OSError:
            pass
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        sock.setblocking(False)
        try:
            sock.bind(self.path)
            os.chmod(self.path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IWGRP)
        except OSError as exc:
            sock.close()
            if not self._warned:
                logger.warning("seq socket bind failed (%s): %s", self.path, exc)
                self._warned = True
            return None
        # Enlarge recv buffer so short collector bursts are less likely to drop.
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
        except OSError:
            pass
        self._sock = sock
        self._warned = False
        logger.info("listening on seq socket %s", self.path)
        return sock

    def drain(self, max_events: int | None = None) -> List[SyscallEvent]:
        """Receive pending datagrams; return up to ``max_events`` events."""
        limit = self.max_events if max_events is None else max(1, max_events)
        sock = self._ensure_sock()
        if sock is None:
            return []
        out: list[SyscallEvent] = []
        while len(out) < limit:
            try:
                payload = sock.recv(_MAX_DATAGRAM)
            except BlockingIOError:
                break
            except OSError as exc:
                logger.warning("seq socket recv failed: %s — rebinding", exc)
                self.close()
                break
            if not payload:
                break
            for ev in decode_events(payload):
                out.append(ev)
                if len(out) >= limit:
                    break
        return out
