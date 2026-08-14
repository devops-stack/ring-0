"""What one thread is waiting for, and who is on the other side of it.

Most of a machine is asleep, and the interesting question about a sleeping
thread is not that it sleeps but what would have to happen for it to wake.
Three of those answers are reachable from ``/proc``, and they are the three
this module gives.

**An epoll set.** The commonest wait on any machine, and the only one that says
out loud what it is waiting for: ``/proc/<pid>/fdinfo/<epfd>`` lists every
descriptor registered in the set together with the events asked of it. Sockets
among them get their addresses back from ``/proc/net``, which needs no
privilege at all.

**A futex.** The kernel side of a userspace lock is a single word of the
process's own memory; a thread that cannot take the lock asks the kernel to
park it until that word changes. The address of the word is the first argument
of the call, so two threads waiting on the same address are waiting for the
same thing, and that grouping is exact. What the kernel does *not* publish is
who holds the lock: for an ordinary futex the owner is never recorded anywhere
the kernel can see — userspace took it without telling the kernel, which is the
whole point of the design — and reading the word out of the process's memory
would need the ptrace access this service deliberately does not have. So the
owner is left unnamed, with the threads that could be holding it listed
instead: on a lock this contended, the answer is nearly always the one thread
of the process that is not waiting for it.

**A pipe.** An anonymous pipe has no name at all, only an inode, and two
processes are talking exactly when they hold descriptors on the same one. The
pairing is therefore a whole-machine question — every descriptor of every
process has to be looked at — which the unprivileged backend cannot do and the
root collector does for it.

The three answers come from the collectors' snapshots. Where a snapshot is
missing the answer is missing too, and says which one it needed.

A fourth thing can be said when the wakeup collector has a recent window: who
was *seen* waking this thread. That is not the holder of a lock — the kernel
still does not record one — but it is the thread that last let go, if the
window happened to catch it. The card reports the observation and leaves the
inference to the reader.
"""

from __future__ import annotations

import json
import os
import time

PROC = "/proc"
TASKS_SNAPSHOT = os.environ.get("TASKS_OUT", "/run/kernel-ai/tasks.json")
ENDPOINTS_SNAPSHOT = os.environ.get("ENDPOINTS_OUT", "/run/kernel-ai/endpoints.json")
SNAPSHOT_MAX_AGE_S = 15.0
MAX_LISTED = 8

# include/uapi/linux/futex.h
FUTEX_PRIVATE_FLAG = 128
FUTEX_CLOCK_REALTIME = 256
FUTEX_CMD_MASK = ~(FUTEX_PRIVATE_FLAG | FUTEX_CLOCK_REALTIME)

FUTEX_OPS = {
    0: ("FUTEX_WAIT", "parked until the word changes from the value it expected"),
    1: ("FUTEX_WAKE", "waking whoever waits on the word"),
    3: ("FUTEX_REQUEUE", "moving waiters to another word"),
    4: ("FUTEX_CMP_REQUEUE", "moving waiters to another word"),
    5: ("FUTEX_WAKE_OP", "waking waiters on two words at once"),
    6: ("FUTEX_LOCK_PI", "queued for a priority-inheriting mutex the kernel owns"),
    7: ("FUTEX_UNLOCK_PI", "releasing a priority-inheriting mutex"),
    8: ("FUTEX_TRYLOCK_PI", "trying a priority-inheriting mutex"),
    9: ("FUTEX_WAIT_BITSET", "parked with a deadline — how glibc waits on a condition variable"),
    10: ("FUTEX_WAKE_BITSET", "waking a selected set of waiters"),
    11: ("FUTEX_WAIT_REQUEUE_PI", "parked on a condition variable that hands over a PI mutex"),
    12: ("FUTEX_CMP_REQUEUE_PI", "handing waiters to a PI mutex"),
    13: ("FUTEX_LOCK_PI2", "queued for a priority-inheriting mutex the kernel owns"),
}

# For these the kernel is the owner of record: the futex word holds the owner's
# tid by definition, because priority inheritance needs to know whom to boost.
PI_OPS = {6, 7, 8, 11, 12, 13}

STATE_LABEL = {
    "R": "on cpu or queued",
    "S": "sleeping, wakeable",
    "D": "uninterruptible wait",
    "T": "stopped",
    "t": "stopped by debugger",
    "Z": "zombie",
    "I": "idle kernel thread",
}


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _snapshot(path, max_age_s=None):
    max_age_s = SNAPSHOT_MAX_AGE_S if max_age_s is None else max_age_s
    try:
        age = max(0.0, time.time() - os.path.getmtime(path))
    except OSError:
        return None, {"available": False, "reason": "no-collector"}
    if age > max_age_s:
        return None, {"available": False, "reason": "stale", "age_s": round(age, 1)}
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None, {"available": False, "reason": "unreadable"}
    if not isinstance(data, dict):
        return None, {"available": False, "reason": "malformed"}
    return data, {"available": True, "age_s": round(age, 1)}


def _state(tid_dir):
    line = _read(f"{tid_dir}/stat")
    if not line:
        return ""
    _, _, tail = line.rpartition(") ")
    parts = tail.split()
    return parts[0] if parts else ""


def _thread_ids(pid):
    try:
        return sorted(int(t) for t in os.listdir(f"{PROC}/{pid}/task") if t.isdigit())
    except OSError:
        return []


def decode_op(raw):
    """What kind of futex wait this is, spelled out."""
    if not isinstance(raw, int):
        return None
    cmd = raw & FUTEX_CMD_MASK
    name, means = FUTEX_OPS.get(cmd, (f"FUTEX_{cmd}", "an operation this build does not name"))
    return {
        "raw": raw,
        "cmd": cmd,
        "name": name,
        "means": means,
        "private": bool(raw & FUTEX_PRIVATE_FLAG),
        "realtime": bool(raw & FUTEX_CLOCK_REALTIME),
        "pi": cmd in PI_OPS,
    }


def _owner_verdict(op):
    """Why the holder of this lock cannot be named."""
    if op and op.get("pi"):
        return {
            "known": False,
            "why": "a PI futex keeps the owner's tid in the word itself, "
                   "and reading it needs access to the process's memory",
        }
    return {
        "known": False,
        "why": "an ordinary futex is taken in userspace without telling the kernel, "
               "so no owner is recorded anywhere /proc can reach",
    }


def _futex(pid, tid, entry, parked):
    """The threads waiting on this word, and what can be said about the owner.

    Private futexes are keyed by address inside one address space, so the same
    address in another process is a different lock — the grouping never crosses
    a process. A shared futex is keyed by the physical page instead and can be
    waited on from another address entirely, which is a pairing /proc cannot
    make; that limit is reported rather than guessed around.
    """
    word = entry.get("word")
    op = decode_op(entry.get("op"))

    waiters = []
    for other_tid, other in parked.items():
        if other.get("pid") != pid or other.get("word") != word:
            continue
        waiters.append({
            "tid": int(other_tid),
            "comm": _read(f"{PROC}/{pid}/task/{other_tid}/comm") or None,
            "self": int(other_tid) == int(tid),
        })
    waiters.sort(key=lambda w: w["tid"])

    waiting_tids = {w["tid"] for w in waiters}
    others = []
    for other_tid in _thread_ids(pid):
        if other_tid in waiting_tids:
            continue
        state = _state(f"{PROC}/{pid}/task/{other_tid}")
        other = parked.get(str(other_tid)) or {}
        others.append({
            "tid": other_tid,
            "comm": _read(f"{PROC}/{pid}/task/{other_tid}/comm") or None,
            "state": state,
            "state_label": STATE_LABEL.get(state, "unknown"),
            "parked_in": other.get("name"),
        })

    # Whoever holds the lock is one of the threads not waiting for it, and in a
    # process with four threads that is nearly an answer. In one with a hundred
    # it is nothing at all, so the set is offered two ways: in full while it is
    # small, and otherwise narrowed to the threads that can be executing this
    # instant. A sleeping thread can hold a lock too — that is exactly what a
    # lock held across a blocking call looks like — so nothing is ruled out,
    # only counted.
    running = [row for row in others if row["state"] == "R"]
    candidates = {
        "total": len(others),
        "running": running[:MAX_LISTED],
        "sample": others[:MAX_LISTED],
    }

    return {
        "kind": "futex",
        "word": word,
        "op": op,
        "expected": entry.get("val"),
        "waiters": waiters[:MAX_LISTED],
        "waiter_count": len(waiters),
        "owner": _owner_verdict(op),
        "candidates": candidates,
        "scope": "this process only" if (op or {}).get("private") else "may reach other processes",
    }


def _pipe(pid, entry, endpoints):
    """The far end of an anonymous pipe, found by matching inodes."""
    target = entry.get("fd_target") or ""
    if not target.startswith("pipe:["):
        return None
    inode = target[6:-1]
    pipes = (endpoints or {}).get("pipes") or {}
    ends = pipes.get(inode) or {}
    readers = ends.get("readers") or []
    writers = ends.get("writers") or []

    fd = entry.get("fd")
    reading = any(r.get("pid") == pid and r.get("fd") == fd for r in readers)
    writing = any(w.get("pid") == pid and w.get("fd") == fd for w in writers)
    direction = "reading" if reading else ("writing" if writing else None)

    far = writers if reading else readers
    near = readers if reading else writers
    return {
        "kind": "pipe",
        "inode": inode,
        "fd": fd,
        "direction": direction,
        "other_end": [r for r in far if not (r.get("pid") == pid and r.get("fd") == fd)],
        "same_end": [r for r in near if not (r.get("pid") == pid and r.get("fd") == fd)],
    }


def _hex_addr(field):
    """``0100007F:1F90`` as the kernel writes it — bytes reversed, port in hex."""
    try:
        raw, _, port = field.partition(":")
        port = int(port, 16)
    except ValueError:
        return None
    if len(raw) == 8:
        octets = [int(raw[i:i + 2], 16) for i in range(0, 8, 2)][::-1]
        return f"{'.'.join(str(o) for o in octets)}:{port}"
    if len(raw) == 32:
        # An IPv6 address here is only ever shown as its port and family; the
        # full form adds nothing a reader of this card wants.
        return f"[::]:{port}"
    return None


def socket_labels():
    """Socket inode to something a person can read, from world-readable files."""
    labels = {}
    for line in _read("/proc/net/unix").splitlines()[1:]:
        fields = line.split()
        if len(fields) < 7 or not fields[6].isdigit():
            continue
        path = fields[7] if len(fields) > 7 else None
        labels[fields[6]] = f"unix {path}" if path else "unix socket, unnamed"
    for line in _read("/proc/net/netlink").splitlines()[1:]:
        fields = line.split()
        if len(fields) >= 10 and fields[9].isdigit():
            labels[fields[9]] = "netlink to the kernel"
    for path, kind in (("/proc/net/tcp", "tcp"), ("/proc/net/tcp6", "tcp"),
                       ("/proc/net/udp", "udp"), ("/proc/net/udp6", "udp")):
        for line in _read(path).splitlines()[1:]:
            fields = line.split()
            if len(fields) < 10 or not fields[9].isdigit():
                continue
            local = _hex_addr(fields[1])
            remote = _hex_addr(fields[2])
            listening = kind == "tcp" and fields[3] == "0A"
            if listening:
                labels[fields[9]] = f"{kind} listening on {local}"
            elif remote and not remote.endswith(":0"):
                labels[fields[9]] = f"{kind} {local} to {remote}"
            else:
                labels[fields[9]] = f"{kind} {local}"
    return labels


# What a descriptor is, taken from the name the kernel gives it in /proc/<pid>/fd.
FD_KINDS = (
    ("socket:[", "socket"),
    ("pipe:[", "pipe"),
    ("anon_inode:[timerfd]", "timer"),
    ("anon_inode:[signalfd]", "signals"),
    ("anon_inode:[eventfd]", "eventfd"),
    ("anon_inode:inotify", "file changes"),
    ("anon_inode:[eventpoll]", "epoll set"),
    ("/dev/", "device"),
)

EVENT_BITS = ((0x1, "data"), (0x4, "room to write"), (0x2, "urgent data"),
              (0x2000, "the peer hanging up"), (0x10, "a hangup"), (0x8, "an error"))


def _fd_kind(target):
    for prefix, kind in FD_KINDS:
        if target.startswith(prefix):
            return kind
    return "file" if target.startswith("/") else "other"


def _events(mask):
    if not isinstance(mask, int):
        return None
    named = [name for bit, name in EVENT_BITS if mask & bit]
    return ", ".join(named[:2]) if named else None


def _epoll(entry):
    """What an epoll set is watching, named where the name is knowable."""
    watch = entry.get("watching")
    if not watch:
        return None
    labels = socket_labels()
    kinds = {}
    rows = []
    for item in watch.get("watched") or []:
        target = item.get("target") or ""
        kind = _fd_kind(target) if target else "gone"
        kinds[kind] = kinds.get(kind, 0) + 1
        label = target
        if kind == "socket":
            label = labels.get(target[8:-1], target)
        elif kind == "pipe":
            label = f"pipe:[{target[6:-1]}]"
        elif target.startswith("anon_inode:"):
            label = kind
        rows.append({"fd": item.get("fd"), "kind": kind, "label": label,
                     "waiting_for": _events(item.get("events"))})

    # A set often holds the same thing many times over — four sockets to the
    # journal, a dozen connections to one service. Listing them one by one says
    # less than saying how many there are.
    merged = {}
    for row in rows:
        key = (row["label"], row["waiting_for"])
        seen = merged.get(key)
        if seen:
            seen["count"] += 1
        else:
            merged[key] = dict(row, count=1)
    grouped = sorted(merged.values(), key=lambda r: (-r["count"], r["fd"] or 0))

    return {
        "kind": "epoll",
        "epfd": entry.get("fd"),
        "total": watch.get("total"),
        "shown": len(rows),
        "kinds": kinds,
        "watched": grouped,
    }


def _locks_for(pid, endpoints):
    rows = (endpoints or {}).get("locks") or []
    return [r for r in rows if r.get("pid") == pid]


def _seen_waking(tids):
    """Who the last window saw waking any of these threads.

    A thread that is still parked has not been woken for *this* wait, so a
    waker named here is the one that released an earlier hold — or that woke a
    sibling still grouped on the same word. Either way it is an observation,
    not a claim that they hold the lock now.
    """
    from kernel_ai.services import wakeups as wakeups_service

    merged = {}
    source = {"available": False, "reason": "no-collector"}
    window_s = None
    available = False
    for tid in tids:
        found = wakeups_service.for_thread(tid)
        source = found.get("source") or source
        window_s = found.get("window_s")
        available = bool(found.get("available"))
        for row in found.get("wakers") or []:
            waker = row.get("waker") or {}
            key = waker.get("tid")
            if key is None:
                continue
            seen = merged.get(key)
            if seen is None:
                seen = merged[key] = {
                    "tid": waker.get("tid"),
                    "comm": waker.get("comm"),
                    "pid": waker.get("pid"),
                    "idle": bool(waker.get("idle")),
                    "kernel": bool(waker.get("kernel")),
                    "count": 0,
                    "of": [],
                    "contexts": {},
                }
            seen["count"] += int(row.get("count") or 0)
            if tid not in seen["of"]:
                seen["of"].append(tid)
            for name, n in (row.get("contexts") or {}).items():
                seen["contexts"][name] = seen["contexts"].get(name, 0) + n
    wakers = sorted(merged.values(), key=lambda row: -row["count"])
    return {
        "available": available,
        "source": source,
        "window_s": window_s,
        "wakers": wakers[:MAX_LISTED],
    }


def describe(pid, tid=None):
    """What this thread waits for, as far as /proc can honestly say."""
    pid = int(pid)
    tid = int(tid) if tid is not None else pid
    if not os.path.isdir(f"{PROC}/{pid}/task/{tid}"):
        return {"pid": pid, "tid": tid, "error": "no such thread"}

    tasks, tasks_src = _snapshot(TASKS_SNAPSHOT)
    endpoints, endpoints_src = _snapshot(ENDPOINTS_SNAPSHOT)
    parked = (tasks or {}).get("tasks") or {}
    entry = parked.get(str(tid)) or {}

    out = {
        "pid": pid,
        "tid": tid,
        "comm": _read(f"{PROC}/{pid}/task/{tid}/comm") or None,
        "process": _read(f"{PROC}/{pid}/comm") or None,
        "state": _state(f"{PROC}/{pid}/task/{tid}"),
        "call": entry.get("name"),
        "wchan": entry.get("wchan"),
        "fd_target": entry.get("fd_target"),
        "locks": _locks_for(pid, endpoints),
        "sources": {"parked_in": tasks_src, "endpoints": endpoints_src},
    }
    out["state_label"] = STATE_LABEL.get(out["state"], "unknown")

    if entry.get("name", "").startswith("futex"):
        out["waiting_on"] = _futex(pid, tid, entry, parked)
    elif entry.get("watching"):
        out["waiting_on"] = _epoll(entry)
    else:
        out["waiting_on"] = _pipe(pid, entry, endpoints)

    # Look up this thread, and on a futex the others waiting on the same word:
    # whoever woke any of them released or signaled that word.
    looked = [tid]
    on = out.get("waiting_on") or {}
    if on.get("kind") == "futex":
        looked = [w["tid"] for w in (on.get("waiters") or [])] or [tid]
    out["seen_waking"] = _seen_waking(looked)
    out["sources"]["wakeups"] = out["seen_waking"].get("source")
    return out
