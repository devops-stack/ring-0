"""Follow a JSON-lines HTTP log without loading the whole file each tick."""

from __future__ import annotations

import os

from kernel_ai.ml.http_parse import HttpEvent, parse_line


class HttpLogTail:
    def __init__(self, path: str, *, start: str = "end") -> None:
        self.path = path
        self._offset = 0
        self._inode: int | None = None
        # Default is follow: do not replay the whole nginx log on every restart.
        if start == "end":
            try:
                stat = os.stat(path)
            except OSError:
                pass
            else:
                self._offset = stat.st_size
                self._inode = stat.st_ino

    def read_new(self, *, now: float | None = None) -> list[HttpEvent]:
        try:
            stat = os.stat(self.path)
        except OSError:
            return []
        inode = stat.st_ino
        if self._inode is not None and inode != self._inode:
            self._offset = 0
        self._inode = inode
        if stat.st_size < self._offset:
            self._offset = 0
        out: list[HttpEvent] = []
        try:
            with open(self.path, "r", encoding="utf-8", errors="replace") as handle:
                handle.seek(self._offset)
                for line in handle:
                    event = parse_line(line, default_ts=now)
                    if event is not None:
                        out.append(event)
                self._offset = handle.tell()
        except OSError:
            return []
        return out
