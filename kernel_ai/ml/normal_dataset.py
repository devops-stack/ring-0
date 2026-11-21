"""Frozen normal dataset: the sensor's security syscall stream, kept verbatim.

Every evaluation of Stages 4 and 8 needs the same normal traffic replayed
against every model version. Postgres only keeps n-gram *counts*
(``ml_syscall_ngrams``) and 48 h of tick snapshots, so the ordered stream is
gone the moment the worker has scored it. This module writes it to disk.

Layout, one directory per UTC day::

    <root>/2026-11-17/manifest.json   host, kernel, sensor sha256 at day start
    <root>/2026-11-17/14.jsonl.gz     raw KernelEventV1 lines received 14:00-14:59
    <root>/2026-11-17/14.meta.json    counts and gaps for that hour, written on close
    <root>/2026-11-17/cgroups.json    cgroup_id → cgroup path for ids seen that day

Lines are stored byte-for-byte as the sensor sent them. Normalisation belongs
to the replay side, so a later change of contract never invalidates old days.

The gzip member is sync-flushed every ``flush_sec``: a crash or a kill loses at
most that much, and :func:`iter_lines` reads a truncated last hour up to the
last flush instead of failing the whole file.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import platform
import shutil
import socket
import time
import zlib
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterator

FORMAT = "kernel-ai.normal-stream/v1"


@dataclass
class HourStats:
    hour: str
    events: int = 0
    bytes_raw: int = 0
    first_ts: float | None = None
    last_ts: float | None = None
    reconnects: int = 0
    # Sensor restarts show up as seq going backwards. Forward jumps are normal:
    # seq is shared with the latency class on the other socket.
    seq_resets: int = 0
    disconnected_sec: float = 0.0
    skipped_low_disk: int = 0
    by_syscall: dict[str, int] = field(default_factory=dict)


def _sha256(path: str) -> str | None:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
    except OSError:
        return None
    return h.hexdigest()


def day_manifest(*, sensor_socket: str, sensor_binary: str) -> dict:
    return {
        "format": FORMAT,
        "host": socket.gethostname(),
        "kernel": platform.release(),
        "machine": platform.machine(),
        "sensor_socket": sensor_socket,
        "sensor_binary": sensor_binary,
        "sensor_sha256": _sha256(sensor_binary),
        "started_at": time.time(),
    }


def dir_size(root: Path) -> int:
    total = 0
    for p in root.rglob("*"):
        try:
            if p.is_file():
                total += p.stat().st_size
        except OSError:
            pass
    return total


def enforce_budget(root: Path, max_bytes: int, *, keep: Path | None = None) -> list[Path]:
    """Delete whole oldest days until ``root`` fits ``max_bytes``.

    Whole days, not hours, so a surviving day is never silently partial. The day
    being written (``keep``) is never deleted.
    """
    removed: list[Path] = []
    days = sorted(p for p in root.iterdir() if p.is_dir()) if root.is_dir() else []
    size = dir_size(root)
    for day in days:
        if size <= max_bytes:
            break
        if keep is not None and day.resolve() == keep.resolve():
            continue
        freed = dir_size(day)
        shutil.rmtree(day, ignore_errors=True)
        size -= freed
        removed.append(day)
    return removed


class CgroupMap:
    """Resolve the sensor's ``cgroup_id`` to a cgroup path while it still exists.

    On cgroup v2 the id is the inode of the cgroup's directory, and the
    directory goes away with the unit: a restarted nginx.service comes back
    under a new id, and a finished session scope is gone for good. Replay
    needs to know which unit an event came from, so the mapping is captured
    at record time or never. Unknown ids trigger a rescan, rate-limited, and
    an id a rescan could not resolve is not retried.
    """

    def __init__(self, cgroup_root: str = "/sys/fs/cgroup", *, min_rescan_sec: float = 10.0,
                 clock=time.time) -> None:
        self.cgroup_root = cgroup_root
        self.min_rescan_sec = min_rescan_sec
        self.clock = clock
        self._known: dict[int, str] = {}
        self._unresolved: set[int] = set()
        self._last_scan: float | None = None
        self.seen: dict[int, str] = {}
        self.dirty = False
        self.scans = 0

    def _scan(self) -> None:
        self.scans += 1
        self._last_scan = self.clock()
        root_len = len(self.cgroup_root.rstrip("/")) + 1
        stack = [self.cgroup_root]
        while stack:
            path = stack.pop()
            try:
                with os.scandir(path) as it:
                    for entry in it:
                        if entry.is_dir(follow_symlinks=False):
                            try:
                                self._known[entry.inode()] = entry.path[root_len:]
                            except OSError:
                                continue
                            stack.append(entry.path)
            except OSError:
                continue
        self._known.setdefault(_root_inode(self.cgroup_root), "")

    def observe(self, cgroup_id: int) -> None:
        if cgroup_id in self.seen or cgroup_id in self._unresolved:
            return
        path = self._known.get(cgroup_id)
        if path is None:
            now = self.clock()
            if self._last_scan is not None and now - self._last_scan < self.min_rescan_sec:
                return
            self._scan()
            path = self._known.get(cgroup_id)
            if path is None:
                self._unresolved.add(cgroup_id)
                return
        self.seen[cgroup_id] = path
        self.dirty = True

    def new_day(self) -> None:
        self.seen = {}
        self._unresolved = set()
        self.dirty = False

    def save(self, day_dir: Path) -> None:
        if not self.dirty:
            return
        out = day_dir / "cgroups.json"
        merged = load_cgroups(day_dir)
        merged.update(self.seen)
        tmp = out.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({str(k): v for k, v in sorted(merged.items())}, indent=0))
        os.replace(tmp, out)
        self.dirty = False


def _root_inode(path: str) -> int:
    try:
        return os.stat(path).st_ino
    except OSError:
        return -1


def load_cgroups(day_dir: str | os.PathLike) -> dict[int, str]:
    try:
        raw = json.loads((Path(day_dir) / "cgroups.json").read_text())
    except (OSError, ValueError):
        return {}
    return {int(k): str(v) for k, v in raw.items()}


class HourlyRecorder:
    """Append raw event lines into ``<day>/<HH>.jsonl.gz`` (UTC)."""

    def __init__(
        self,
        root: str | os.PathLike,
        *,
        sensor_socket: str,
        sensor_binary: str,
        flush_sec: float = 30.0,
        max_bytes: int = 3 << 30,
        min_free_bytes: int = 4 << 30,
        clock=time.time,
        cgroups: CgroupMap | None = None,
    ) -> None:
        self.root = Path(root)
        self.cgroups = cgroups
        self.sensor_socket = sensor_socket
        self.sensor_binary = sensor_binary
        self.flush_sec = flush_sec
        self.max_bytes = max_bytes
        self.min_free_bytes = min_free_bytes
        self.clock = clock
        self._fh: gzip.GzipFile | None = None
        self._hour_key: str | None = None
        self._day_dir: Path | None = None
        self._last_flush = 0.0
        self._last_seq: int | None = None
        self._disconnected_at: float | None = None
        self._low_disk = False
        self.stats: HourStats | None = None
        self.removed_days: list[Path] = []

    # -- hour rotation -------------------------------------------------

    def _key(self, now: float) -> tuple[str, str]:
        t = time.gmtime(now)
        return time.strftime("%Y-%m-%d", t), time.strftime("%H", t)

    def _free_ok(self) -> bool:
        try:
            return shutil.disk_usage(self.root).free >= self.min_free_bytes
        except OSError:
            return False

    def _open(self, now: float) -> None:
        day, hour = self._key(now)
        self.root.mkdir(parents=True, exist_ok=True)
        day_dir = self.root / day
        day_dir.mkdir(exist_ok=True)
        manifest = day_dir / "manifest.json"
        if not manifest.exists():
            manifest.write_text(
                json.dumps(
                    day_manifest(
                        sensor_socket=self.sensor_socket,
                        sensor_binary=self.sensor_binary,
                    ),
                    indent=1,
                )
            )
        if self.cgroups is not None and (self._day_dir is None or self._day_dir != day_dir):
            self.cgroups.new_day()
        self.removed_days.extend(enforce_budget(self.root, self.max_bytes, keep=day_dir))
        self._low_disk = not self._free_ok()
        # Append mode: a restart within the hour adds a second gzip member,
        # which gzip readers concatenate transparently.
        self._fh = gzip.open(day_dir / f"{hour}.jsonl.gz", "ab", compresslevel=6)
        self._day_dir = day_dir
        self._hour_key = f"{day}T{hour}"
        self._last_flush = now
        self.stats = HourStats(hour=self._hour_key)
        if self._disconnected_at is not None:
            self._disconnected_at = now

    def _close(self, now: float) -> None:
        if self._fh is None:
            return
        if self._disconnected_at is not None and self.stats is not None:
            self.stats.disconnected_sec += max(0.0, now - self._disconnected_at)
        self._fh.close()
        self._fh = None
        if self.cgroups is not None and self._day_dir is not None:
            self.cgroups.save(self._day_dir)
        if self.stats is not None and self._day_dir is not None:
            hour = self._hour_key.split("T")[1] if self._hour_key else "xx"
            meta = self._day_dir / f"{hour}.meta.json"
            # A restart within the hour must add to, not overwrite, the first run.
            if meta.exists():
                try:
                    prev = json.loads(meta.read_text())
                    for k in ("events", "bytes_raw", "reconnects", "seq_resets", "skipped_low_disk"):
                        setattr(self.stats, k, getattr(self.stats, k) + int(prev.get(k, 0)))
                    self.stats.disconnected_sec += float(prev.get("disconnected_sec", 0.0))
                    for name, n in (prev.get("by_syscall") or {}).items():
                        self.stats.by_syscall[name] = self.stats.by_syscall.get(name, 0) + int(n)
                    if prev.get("first_ts") is not None:
                        self.stats.first_ts = min(
                            float(prev["first_ts"]), self.stats.first_ts or float("inf")
                        )
                except (OSError, ValueError, TypeError):
                    pass
            meta.write_text(json.dumps(asdict(self.stats), indent=1, sort_keys=True))

    def _rotate_if_needed(self, now: float) -> None:
        day, hour = self._key(now)
        if self._hour_key != f"{day}T{hour}":
            self._close(now)
            self._open(now)

    # -- public API ----------------------------------------------------

    def write(self, line: bytes) -> None:
        now = self.clock()
        self._rotate_if_needed(now)
        assert self._fh is not None and self.stats is not None
        line = line.rstrip(b"\n")
        if not line:
            return
        if self._low_disk:
            self.stats.skipped_low_disk += 1
            return
        self._fh.write(line + b"\n")
        st = self.stats
        st.events += 1
        st.bytes_raw += len(line) + 1
        if st.first_ts is None:
            st.first_ts = now
        st.last_ts = now
        # Cheap field sniffing, not json.loads: this sits on the receive path
        # and the sensor drops events for any client slower than 64 messages.
        seq = _int_field(line, b'"seq":')
        if seq is not None:
            if self._last_seq is not None and seq < self._last_seq:
                st.seq_resets += 1
            self._last_seq = seq
        name = _str_field(line, b'"name":"')
        if name is not None:
            st.by_syscall[name] = st.by_syscall.get(name, 0) + 1
        if self.cgroups is not None:
            cid = _int_field(line, b'"cgroup_id":')
            if cid is not None:
                self.cgroups.observe(cid)
        if now - self._last_flush >= self.flush_sec:
            self._fh.flush()
            self._last_flush = now
            self._low_disk = not self._free_ok()
            if self.cgroups is not None and self._day_dir is not None:
                self.cgroups.save(self._day_dir)

    def tick(self) -> None:
        """Rotate and flush on an idle stream, so hours close on time."""
        now = self.clock()
        self._rotate_if_needed(now)
        if self._fh is not None and now - self._last_flush >= self.flush_sec:
            self._fh.flush()
            self._last_flush = now
            if self.cgroups is not None and self._day_dir is not None:
                self.cgroups.save(self._day_dir)

    def disconnected(self) -> None:
        if self._disconnected_at is None:
            self._disconnected_at = self.clock()

    def connected(self) -> None:
        now = self.clock()
        self._rotate_if_needed(now)
        if self._disconnected_at is not None and self.stats is not None:
            self.stats.disconnected_sec += max(0.0, now - self._disconnected_at)
            self.stats.reconnects += 1
        self._disconnected_at = None

    def close(self) -> None:
        self._close(self.clock())


def _int_field(line: bytes, key: bytes) -> int | None:
    i = line.find(key)
    if i < 0:
        return None
    i += len(key)
    j = i
    while j < len(line) and 48 <= line[j] <= 57:
        j += 1
    return int(line[i:j]) if j > i else None


def _str_field(line: bytes, key: bytes) -> str | None:
    i = line.find(key)
    if i < 0:
        return None
    i += len(key)
    j = line.find(b'"', i)
    return line[i:j].decode("ascii", "replace") if j > i else None


# -- replay side -------------------------------------------------------


def hour_files(root: str | os.PathLike, *, days: list[str] | None = None) -> list[Path]:
    base = Path(root)
    out: list[Path] = []
    for day in sorted(p for p in base.iterdir() if p.is_dir()):
        if days is not None and day.name not in days:
            continue
        out.extend(sorted(day.glob("*.jsonl.gz")))
    return out


def iter_lines(path: str | os.PathLike) -> Iterator[bytes]:
    """Yield raw lines; a truncated tail (crash mid-hour) ends the file quietly."""
    try:
        with gzip.open(path, "rb") as fh:
            for line in fh:
                if line.endswith(b"\n"):
                    yield line[:-1]
    except (EOFError, zlib.error, gzip.BadGzipFile):
        return


def iter_events(root: str | os.PathLike, *, days: list[str] | None = None) -> Iterator[dict]:
    for path in hour_files(root, days=days):
        for line in iter_lines(path):
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if isinstance(obj, dict):
                yield obj
