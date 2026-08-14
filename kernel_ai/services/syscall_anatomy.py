"""What a syscall is inside the kernel that is running right now.

The left panel lists the calls tasks are parked in. This module answers the
next question: what *is* that call. It gives the number the running
architecture assigns it, the prototype userspace calls it with, and the chain
of kernel symbols the call travels through on the way to the function the task
is currently sleeping in.

Nothing here is guessed at. Every symbol in the chain is confirmed against
``/proc/kallsyms`` of the running kernel, and the sleeping function is whatever
the kernel itself reports in ``/proc/<pid>/wchan``. Symbol names in kallsyms
are readable unprivileged (only the addresses are zeroed for us, and addresses
are not shown), so this works from the unprivileged backend.

A call the prototype table does not describe still gets its number, its chain
and its waiters. It just goes without a prototype, which is better than
printing a made-up one.
"""

from __future__ import annotations

import json
import os
import platform

_SYMBOLS_SNAPSHOT = os.environ.get("KSYMS_OUT", "/run/kernel-ai/ksyms.json")
_SYMBOL_CACHE = {"names": None}

_X86 = ("x86_64", "amd64")
_ARM64 = ("aarch64", "arm64")

# Only these families of symbols can appear in a syscall chain, so kallsyms is
# filtered down to them once instead of being held in memory whole.
_INTERESTING_PREFIXES = (
    "__x64_sys_",
    "__arm64_sys_",
    "__se_sys_",
    "__do_sys_",
    "ksys_",
    "do_",
    "core_sys_",
    "vfs_",
    "sys_call_table",
    "x64_sys_call",
)

_ENTRY_SYMBOLS = {
    "x86_64": ("entry_SYSCALL_64", "syscall instruction, number in rax"),
    "arm64": ("el0t_64_sync_handler", "svc instruction, number in x8"),
}
_DISPATCH_SYMBOLS = {
    "x86_64": ("do_syscall_64", "picks the handler by number"),
    "arm64": ("invoke_syscall", "picks the handler by number"),
}
_ABI = {
    "x86_64": "nr in rax · args in rdi rsi rdx r10 r8 r9",
    "arm64": "nr in x8 · args in x0 x1 x2 x3 x4 x5",
}

# Softirq handlers, kept on the interrupt card's behalf. They are listed here
# rather than in irq_anatomy because this module owns the kallsyms filter and
# has to stay import-free: the root collector loads it by path, outside the
# package, so a relative import would not resolve. A test holds this set and
# irq_anatomy.VECTOR_SYMBOL to each other so the two cannot drift apart.
_SOFTIRQ_SYMBOLS = frozenset({
    "tasklet_hi_action",
    "run_timer_softirq",
    "net_tx_action",
    "net_rx_action",
    "blk_done_softirq",
    "irq_poll_softirq",
    "tasklet_action",
    "run_rebalance_domains",
    "hrtimer_run_queues",
    "rcu_core",
})

_ALL_ENTRY_NAMES = frozenset(
    [sym for sym, _note in _ENTRY_SYMBOLS.values()]
    + [sym for sym, _note in _DISPATCH_SYMBOLS.values()]
) | _SOFTIRQ_SYMBOLS


def _arch():
    machine = platform.machine().lower()
    if machine in _X86:
        return "x86_64"
    if machine in _ARM64:
        return "arm64"
    return machine or "unknown"


def _handler_prefix(arch):
    if arch == "x86_64":
        return "__x64_sys_"
    if arch == "arm64":
        return "__arm64_sys_"
    return ""


def _symbols_from_snapshot():
    """The set the root collector published, for when kallsyms is walled off.

    ``ProtectKernelTunables=yes`` closes /proc/kallsyms to the hardened backend,
    and that option is worth more than this list is. The collector reads the
    table on the app's behalf and writes the filtered names next to its sample.
    """
    try:
        with open(_SYMBOLS_SNAPSHOT, "r", encoding="utf-8", errors="replace") as fh:
            names = json.load(fh)
    except (OSError, ValueError):
        return frozenset()
    if not isinstance(names, list):
        return frozenset()
    return frozenset(str(name) for name in names)


def _symbols_from_kallsyms():
    found = set()
    try:
        with open("/proc/kallsyms", "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                parts = line.split(None, 2)
                if len(parts) < 3:
                    continue
                name = parts[2].strip()
                # Module symbols are printed as "name\t[module]"; keep the name.
                name = name.split("\t", 1)[0].strip()
                if name.startswith(_INTERESTING_PREFIXES) or name in _ALL_ENTRY_NAMES:
                    found.add(name)
    except OSError:
        return frozenset()
    return frozenset(found)


def kernel_symbols():
    """Names of the kernel symbols a syscall chain can be built from.

    Returns an empty set when neither source can be read; the chain then shows
    only the stages there is other evidence for. Only a non-empty answer is
    kept, so a backend that started before the collector picks the list up on
    the next question instead of staying blind until it restarts.
    """
    if _SYMBOL_CACHE["names"]:
        return _SYMBOL_CACHE["names"]
    names = _symbols_from_snapshot() or _symbols_from_kallsyms()
    if names:
        _SYMBOL_CACHE["names"] = names
    return names


def publish_symbols(path):
    """Write the filtered symbol set for the hardened backend to read."""
    names = sorted(_symbols_from_kallsyms())
    if not names:
        return 0
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(names, fh)
    os.replace(tmp, path)
    os.chmod(path, 0o644)
    return len(names)


# Prototype, one line of prose, and the file the call is implemented in. Only
# calls a task can actually be found parked in are worth describing; the rest
# never reach this card. ``fd_arg`` marks an argument the collector can resolve
# into the file it points at.
SYSCALL_DOC = {
    "read": {
        "signature": "ssize_t read(int fd, void *buf, size_t count)",
        "summary": "waits for up to count bytes to arrive on a descriptor",
        "source": "fs/read_write.c",
        "inner": ("ksys_read", "vfs_read"),
        "fd_arg": 0,
    },
    "pread64": {
        "signature": "ssize_t pread64(int fd, void *buf, size_t count, off_t offset)",
        "summary": "reads at a fixed offset without moving the file position",
        "source": "fs/read_write.c",
        "inner": ("ksys_pread64", "vfs_read"),
        "fd_arg": 0,
    },
    "write": {
        "signature": "ssize_t write(int fd, const void *buf, size_t count)",
        "summary": "hands bytes to a descriptor and waits for room to take them",
        "source": "fs/read_write.c",
        "inner": ("ksys_write", "vfs_write"),
        "fd_arg": 0,
    },
    "pwrite64": {
        "signature": "ssize_t pwrite64(int fd, const void *buf, size_t count, off_t offset)",
        "summary": "writes at a fixed offset without moving the file position",
        "source": "fs/read_write.c",
        "inner": ("ksys_pwrite64", "vfs_write"),
        "fd_arg": 0,
    },
    "readv": {
        "signature": "ssize_t readv(int fd, const struct iovec *iov, int iovcnt)",
        "summary": "reads into several buffers in one call",
        "source": "fs/read_write.c",
        "inner": ("do_readv", "vfs_readv"),
        "fd_arg": 0,
    },
    "writev": {
        "signature": "ssize_t writev(int fd, const struct iovec *iov, int iovcnt)",
        "summary": "writes several buffers in one call",
        "source": "fs/read_write.c",
        "inner": ("do_writev", "vfs_writev"),
        "fd_arg": 0,
    },
    "openat": {
        "signature": "int openat(int dirfd, const char *path, int flags, mode_t mode)",
        "summary": "resolves a path and opens it, waiting on the filesystem",
        "source": "fs/open.c",
        "inner": ("do_sys_openat2", "do_filp_open"),
    },
    "fsync": {
        "signature": "int fsync(int fd)",
        "summary": "waits until the file's data reaches the storage device",
        "source": "fs/sync.c",
        "inner": ("do_fsync", "vfs_fsync"),
        "fd_arg": 0,
    },
    "fdatasync": {
        "signature": "int fdatasync(int fd)",
        "summary": "waits for the data, but not the metadata, to reach the device",
        "source": "fs/sync.c",
        "inner": ("do_fsync", "vfs_fsync"),
        "fd_arg": 0,
    },
    "flock": {
        "signature": "int flock(int fd, int operation)",
        "summary": "waits for an advisory lock on an open file",
        "source": "fs/locks.c",
        "inner": ("do_flock",),
        "fd_arg": 0,
    },
    "fcntl": {
        "signature": "int fcntl(int fd, int cmd, ... /* arg */)",
        "summary": "descriptor housekeeping; F_SETLKW waits for a lock",
        "source": "fs/fcntl.c",
        "inner": ("do_fcntl",),
        "fd_arg": 0,
    },
    "ioctl": {
        "signature": "int ioctl(int fd, unsigned long request, ...)",
        "summary": "device-specific request, handled by the driver behind the fd",
        "source": "fs/ioctl.c",
        "inner": ("do_vfs_ioctl",),
        "fd_arg": 0,
    },
    "epoll_wait": {
        "signature": "int epoll_wait(int epfd, struct epoll_event *events, int maxevents, int timeout)",
        "summary": "sleeps until one of the watched descriptors is ready",
        "source": "fs/eventpoll.c",
        "inner": ("do_epoll_wait", "ep_poll"),
        "fd_arg": 0,
    },
    "epoll_pwait": {
        "signature": "int epoll_pwait(int epfd, struct epoll_event *events, int maxevents, int timeout, const sigset_t *sigmask)",
        "summary": "epoll_wait with the signal mask swapped for the duration",
        "source": "fs/eventpoll.c",
        "inner": ("do_epoll_pwait", "do_epoll_wait", "ep_poll"),
        "fd_arg": 0,
    },
    "poll": {
        "signature": "int poll(struct pollfd *fds, nfds_t nfds, int timeout)",
        "summary": "sleeps until one of the listed descriptors reports an event",
        "source": "fs/select.c",
        "inner": ("do_sys_poll",),
    },
    "ppoll": {
        "signature": "int ppoll(struct pollfd *fds, nfds_t nfds, const struct timespec *tmo, const sigset_t *sigmask)",
        "summary": "poll with a nanosecond timeout and a swapped signal mask",
        "source": "fs/select.c",
        "inner": ("do_sys_poll",),
    },
    "select": {
        "signature": "int select(int nfds, fd_set *r, fd_set *w, fd_set *e, struct timeval *timeout)",
        "summary": "the original readiness wait, over three descriptor sets",
        "source": "fs/select.c",
        "inner": ("core_sys_select", "do_select"),
    },
    "pselect6": {
        "signature": "int pselect6(int nfds, fd_set *r, fd_set *w, fd_set *e, struct timespec *tmo, void *sig)",
        "summary": "select with a nanosecond timeout and a swapped signal mask",
        "source": "fs/select.c",
        "inner": ("core_sys_select", "do_select"),
    },
    "futex": {
        "signature": "long futex(uint32_t *uaddr, int op, uint32_t val, const struct timespec *timeout, ...)",
        "summary": "the wait half of every userspace lock: sleeps on an address",
        "source": "kernel/futex/",
        "inner": ("do_futex", "futex_wait", "futex_wait_queue"),
    },
    "accept": {
        "signature": "int accept(int sockfd, struct sockaddr *addr, socklen_t *addrlen)",
        "summary": "sleeps until a connection lands in the listen queue",
        "source": "net/socket.c",
        "inner": ("__sys_accept4", "do_accept"),
        "fd_arg": 0,
    },
    "accept4": {
        "signature": "int accept4(int sockfd, struct sockaddr *addr, socklen_t *addrlen, int flags)",
        "summary": "accept that sets the flags of the new socket in one call",
        "source": "net/socket.c",
        "inner": ("__sys_accept4", "do_accept"),
        "fd_arg": 0,
    },
    "connect": {
        "signature": "int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen)",
        "summary": "waits for the handshake with the other side to finish",
        "source": "net/socket.c",
        "inner": ("__sys_connect",),
        "fd_arg": 0,
    },
    "recvfrom": {
        "signature": "ssize_t recvfrom(int sockfd, void *buf, size_t len, int flags, struct sockaddr *src, socklen_t *addrlen)",
        "summary": "waits for a datagram or stream bytes to arrive on a socket",
        "source": "net/socket.c",
        "inner": ("__sys_recvfrom", "sock_recvmsg"),
        "fd_arg": 0,
    },
    "recvmsg": {
        "signature": "ssize_t recvmsg(int sockfd, struct msghdr *msg, int flags)",
        "summary": "receives one message, control data included",
        "source": "net/socket.c",
        "inner": ("__sys_recvmsg", "sock_recvmsg"),
        "fd_arg": 0,
    },
    "recvmmsg": {
        "signature": "int recvmmsg(int sockfd, struct mmsghdr *msgvec, unsigned vlen, int flags, struct timespec *timeout)",
        "summary": "waits for a batch of messages in one call",
        "source": "net/socket.c",
        "inner": ("__sys_recvmmsg", "sock_recvmsg"),
        "fd_arg": 0,
    },
    "sendto": {
        "signature": "ssize_t sendto(int sockfd, const void *buf, size_t len, int flags, const struct sockaddr *dst, socklen_t addrlen)",
        "summary": "hands bytes to a socket, waiting for room in its buffer",
        "source": "net/socket.c",
        "inner": ("__sys_sendto", "sock_sendmsg"),
        "fd_arg": 0,
    },
    "sendmsg": {
        "signature": "ssize_t sendmsg(int sockfd, const struct msghdr *msg, int flags)",
        "summary": "sends one message, control data included",
        "source": "net/socket.c",
        "inner": ("__sys_sendmsg", "sock_sendmsg"),
        "fd_arg": 0,
    },
    "wait4": {
        "signature": "pid_t wait4(pid_t pid, int *wstatus, int options, struct rusage *rusage)",
        "summary": "sleeps until a child changes state, then reaps it",
        "source": "kernel/exit.c",
        "inner": ("kernel_wait4", "do_wait"),
    },
    "waitid": {
        "signature": "int waitid(idtype_t idtype, id_t id, siginfo_t *info, int options, struct rusage *ru)",
        "summary": "waits for a child without necessarily reaping it",
        "source": "kernel/exit.c",
        "inner": ("kernel_waitid", "do_wait"),
    },
    "nanosleep": {
        "signature": "int nanosleep(const struct timespec *req, struct timespec *rem)",
        "summary": "sleeps for a stated interval and nothing else",
        "source": "kernel/time/hrtimer.c",
        "inner": ("hrtimer_nanosleep", "do_nanosleep"),
    },
    "clock_nanosleep": {
        "signature": "int clock_nanosleep(clockid_t id, int flags, const struct timespec *req, struct timespec *rem)",
        "summary": "sleeps against a named clock, absolute or relative",
        "source": "kernel/time/posix-timers.c",
        "inner": ("common_nsleep", "hrtimer_nanosleep", "do_nanosleep"),
    },
    "rt_sigtimedwait": {
        "signature": "int rt_sigtimedwait(const sigset_t *set, siginfo_t *info, const struct timespec *timeout, size_t sigsetsize)",
        "summary": "blocks until one of the listed signals is delivered",
        "source": "kernel/signal.c",
        "inner": ("do_sigtimedwait",),
    },
    "rt_sigsuspend": {
        "signature": "int rt_sigsuspend(const sigset_t *mask, size_t sigsetsize)",
        "summary": "swaps the signal mask and sleeps until a signal arrives",
        "source": "kernel/signal.c",
        "inner": ("sigsuspend",),
    },
    "pause": {
        "signature": "int pause(void)",
        "summary": "sleeps until any signal arrives",
        "source": "kernel/signal.c",
        "inner": (),
    },
    "io_getevents": {
        "signature": "int io_getevents(aio_context_t ctx, long min_nr, long nr, struct io_event *events, struct timespec *timeout)",
        "summary": "waits for queued asynchronous I/O to complete",
        "source": "fs/aio.c",
        "inner": ("do_io_getevents", "read_events"),
    },
    "io_uring_enter": {
        "signature": "int io_uring_enter(int fd, unsigned to_submit, unsigned min_complete, unsigned flags, const void *arg, size_t argsz)",
        "summary": "submits and/or waits on an io_uring ring",
        "source": "io_uring/io_uring.c",
        "inner": ("io_cqring_wait",),
        "fd_arg": 0,
    },
    "splice": {
        "signature": "ssize_t splice(int fd_in, off_t *off_in, int fd_out, off_t *off_out, size_t len, unsigned flags)",
        "summary": "moves bytes between descriptors without copying to userspace",
        "source": "fs/splice.c",
        "inner": ("do_splice",),
        "fd_arg": 0,
    },
    "msgrcv": {
        "signature": "ssize_t msgrcv(int msqid, void *msgp, size_t msgsz, long msgtyp, int msgflg)",
        "summary": "waits for a System V message of the requested type",
        "source": "ipc/msg.c",
        "inner": ("do_msgrcv",),
    },
    "semop": {
        "signature": "int semop(int semid, struct sembuf *sops, size_t nsops)",
        "summary": "waits on a System V semaphore set",
        "source": "ipc/sem.c",
        "inner": ("do_semtimedop",),
    },
    "mq_timedreceive": {
        "signature": "ssize_t mq_timedreceive(mqd_t mqdes, char *msg, size_t len, unsigned *prio, const struct timespec *abs_timeout)",
        "summary": "waits for a POSIX message queue to have something in it",
        "source": "ipc/mqueue.c",
        "inner": ("do_mq_timedreceive",),
    },
    "exit_group": {
        "signature": "void exit_group(int status)",
        "summary": "tears the whole thread group down",
        "source": "kernel/exit.c",
        "inner": ("do_group_exit", "do_exit"),
    },
    "membarrier": {
        "signature": "int membarrier(int cmd, unsigned flags, int cpu_id)",
        "summary": "orders memory across cores, sometimes by waiting for a grace period",
        "source": "kernel/sched/membarrier.c",
        "inner": (),
    },
}


def describe(name, nr=None, subsystem=None, wchans=None, sampled=None):
    """The anatomy of one syscall on the kernel that is running.

    ``wchans`` is the live evidence: an ordered list of ``(symbol, count)``
    pairs taken from ``/proc/<pid>/wchan`` of the tasks parked in this call.
    The dominant one closes the chain, because that is the function they are
    actually sleeping in.

    ``sampled`` is how many tasks those counts were taken from. A busy call has
    far more waiters than the sample keeps, so the note says "3 of 12 sampled"
    rather than implying the tally covers everyone parked in the call.
    """
    arch = _arch()
    doc = SYSCALL_DOC.get(name, {})
    symbols = kernel_symbols()
    chain = []

    def stage(kind, symbol, note="", confirmed=True):
        chain.append({"stage": kind, "symbol": symbol, "note": note, "confirmed": confirmed})

    # Userspace is the one stage no kernel table can confirm: the call may come
    # from a libc wrapper or straight from a syscall instruction.
    stage("user", f"{name}()", "userspace", confirmed=False)

    entry_sym, entry_note = _ENTRY_SYMBOLS.get(arch, (None, ""))
    if entry_sym and (not symbols or entry_sym in symbols):
        stage("entry", entry_sym, entry_note)

    dispatch_sym, dispatch_note = _DISPATCH_SYMBOLS.get(arch, (None, ""))
    if dispatch_sym and (not symbols or dispatch_sym in symbols):
        note = dispatch_note if nr is None else f"{dispatch_note} ({nr})"
        stage("dispatch", dispatch_sym, note)

    handler = f"{_handler_prefix(arch)}{name}" if _handler_prefix(arch) else ""
    if handler and handler in symbols:
        stage("handler", handler, "the syscall's own entry point")

    seen = {c["symbol"] for c in chain}
    for candidate in doc.get("inner", ()):  # only the ones this kernel really has
        if candidate in symbols and candidate not in seen:
            stage("inner", candidate)
            seen.add(candidate)

    live = [(str(sym), int(count)) for sym, count in (wchans or []) if sym]
    for sym, count in live:
        note = f"{count} of {sampled} sampled" if sampled else f"{count} task{'s' if count != 1 else ''}"
        if sym in seen:
            # Already on the chain — mark that one instead of repeating it.
            for entry in chain:
                if entry["symbol"] == sym:
                    entry["stage"] = "sleep"
                    entry["note"] = note
            continue
        stage("sleep", sym, note)
        seen.add(sym)

    return {
        "name": name,
        "nr": nr,
        "arch": arch,
        "abi": _ABI.get(arch, ""),
        "subsystem": subsystem,
        "signature": doc.get("signature", ""),
        "summary": doc.get("summary", ""),
        "source": doc.get("source", ""),
        "chain": chain,
        "symbols_confirmed": bool(symbols),
    }


def fd_argument(name):
    """Index of the argument that is a descriptor, or None."""
    doc = SYSCALL_DOC.get(name)
    if not doc:
        return None
    return doc.get("fd_arg")
