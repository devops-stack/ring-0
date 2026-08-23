"""What an interrupt line is on the machine that is running right now.

The panel at the bottom lists the lines that are firing. This module answers the
next question about one of them: what device registered it, which chip delivers
it, which CPU is allowed to take it and which one actually did, and what runs
afterwards in softirq context.

The facts come from four places the kernel keeps for exactly this purpose:
``/sys/kernel/irq/<n>`` for the identity of the line, ``/proc/irq/<n>`` for its
affinity, ``/proc/interrupts`` for the per-CPU counters, and ``/proc/softirqs``
for the deferred half. All four are readable unprivileged, so the hardened
backend needs no help from a collector here.

One link in the chain is an inference rather than a measurement, and is labelled
as one: the kernel does not record which softirq vector a given line raises, so
that is concluded from the class of the device. The *rate* of the vector is
measured; only the attribution is reasoned. Everything else is either read off
the running kernel or left out.

Rates are deliberately absent from this module. The panel already computes them
over its polling interval, which is a far steadier window than anything a
one-shot request could sample, so the card takes them from there.
"""

from __future__ import annotations

import os
import re

from .syscall_anatomy import kernel_symbols

_SYS_IRQ = "/sys/kernel/irq"
_PROC_IRQ = "/proc/irq"

# How many event channels the hypervisor card lists. Past the sixth the shares
# are rounding error, and the card is a card, not a table.
_MAX_CHANNELS = 6

# The function each softirq vector runs. These are the entries of the kernel's
# own softirq_vec table, so the name is fixed by the vector, not guessed; it is
# still confirmed against kallsyms before being shown.
VECTOR_SYMBOL = {
    "HI": "tasklet_hi_action",
    "TIMER": "run_timer_softirq",
    "NET_TX": "net_tx_action",
    "NET_RX": "net_rx_action",
    "BLOCK": "blk_done_softirq",
    "IRQ_POLL": "irq_poll_softirq",
    "TASKLET": "tasklet_action",
    "SCHED": "run_rebalance_domains",
    "HRTIMER": "hrtimer_run_queues",
    "RCU": "rcu_core",
}

# Which vector a line's bottom half lands in, concluded from the driver that
# registered the handler. Ordered longest-match-first so "virtio-blk" is not
# read as a network device by the "vir" of nothing in particular.
_DEVICE_VECTOR = (
    (("nvme", "blkif", "ahci", "scsi", "sata", "virtio-blk", "vblk", "xvd", "mmc"), "BLOCK"),
    (("eth", "ens", "enp", "eno", "wlan", "wl", "virtio-net", "ena", "mlx", "ixgbe", "e1000",
      "igb", "bnxt", "vif"), "NET_RX"),
    (("timer", "hrtimer"), "TIMER"),
)

# One line of prose per class of device, describing what the interrupt means.
# Only classes where the sentence is true of every member get one; a line whose
# device is not recognised simply goes without.
_DEVICE_SUMMARY = {
    "BLOCK": "the storage device reports that a request finished",
    "NET_RX": "the network interface reports that a frame arrived",
    "TIMER": "the periodic tick that drives scheduling and timers",
}


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read().strip()
    except OSError:
        return ""


def _cpus_online():
    try:
        return os.sysconf("SC_NPROCESSORS_ONLN")
    except (ValueError, OSError, AttributeError):
        return os.cpu_count() or 1


def read_interrupts():
    """Every row of /proc/interrupts as {name: (per_cpu_counts, description)}.

    Both the numbered device lines and the lettered kernel counters (HYP, MCP,
    RES and friends) come back, because the panel shows both and either can be
    clicked.
    """
    rows = {}
    try:
        with open("/proc/interrupts", "r", encoding="utf-8", errors="ignore") as fh:
            lines = fh.readlines()
    except OSError:
        return rows
    for raw in lines[1:]:
        if ":" not in raw:
            continue
        left, right = raw.split(":", 1)
        name = left.strip()
        tokens = right.split()
        counts = []
        idx = 0
        while idx < len(tokens) and tokens[idx].isdigit():
            counts.append(int(tokens[idx]))
            idx += 1
        if not counts:
            continue
        rows[name] = (counts, " ".join(tokens[idx:]).strip())
    return rows


def read_softirqs():
    """Per-vector totals from /proc/softirqs, summed over CPUs."""
    totals = {}
    try:
        with open("/proc/softirqs", "r", encoding="utf-8", errors="ignore") as fh:
            lines = fh.readlines()
    except OSError:
        return totals
    for raw in lines[1:]:
        if ":" not in raw:
            continue
        left, right = raw.split(":", 1)
        totals[left.strip().upper()] = sum(int(t) for t in right.split() if t.isdigit())
    return totals


def vector_for(device, chip=""):
    """The softirq vector this line's bottom half runs in, by device class.

    An inference, not a reading — the kernel keeps no per-line record of it —
    so every caller presents the answer as one. None means the device is not
    recognised, and then nothing is claimed at all.
    """
    haystack = f"{device} {chip}".lower()
    for needles, vector in _DEVICE_VECTOR:
        if any(needle in haystack for needle in needles):
            return vector
    return None


def _threaded_handler(irq):
    """The kthread that runs this handler, when the driver asked for one.

    A threaded IRQ shows up as a task named ``irq/<n>-<device>``. There is no
    other index for them, so /proc is walked; it is a click-driven lookup, and
    the comm files are one read each.
    """
    prefix = f"irq/{irq}-"
    try:
        entries = os.listdir("/proc")
    except OSError:
        return None
    for entry in entries:
        if not entry.isdigit():
            continue
        comm = _read(f"/proc/{entry}/comm")
        if comm.startswith(prefix):
            return {"pid": int(entry), "comm": comm}
    return None


def _xen_event_channels(interrupts):
    """The numbered lines that arrive through the hypervisor callback.

    On a Xen guest every event channel is delivered as one HYP callback, so the
    HYP counter is not a device line at all — it is the door the lines below it
    come through. That relationship is visible in the arithmetic, and the card
    shows it instead of pretending HYP is a device.
    """
    children = []
    for name, (counts, desc) in interrupts.items():
        if not name.isdigit():
            continue
        chip = _read(f"{_SYS_IRQ}/{name}/chip_name")
        if not chip.startswith("xen-"):
            continue
        total = sum(counts)
        # A guest is wired with a dozen channels it never uses — spinlock0,
        # floppy, rtc0. A channel that has not fired has brought nothing
        # through the door, and a bar of zero says nothing worth its row.
        if total:
            children.append({"irq": name, "device": _read(f"{_SYS_IRQ}/{name}/actions") or desc,
                             "total": total})
    children.sort(key=lambda row: row["total"], reverse=True)
    return children


def _chain_for_line(device, chip, vector, symbols, thread):
    """The path from the wire to the deferred work, stage by stage."""
    chain = []
    if chip:
        chain.append({"stage": "line", "symbol": chip, "note": "chip", "confirmed": True})
    if device:
        chain.append({"stage": "handler", "symbol": device, "note": "from driver", "confirmed": True})
    if vector:
        chain.append({
            "stage": "raises",
            "symbol": vector,
            "note": "by driver class",
            "confirmed": True,
            "inferred": True,
        })
        symbol = VECTOR_SYMBOL.get(vector)
        if symbol:
            confirmed = symbol in symbols if symbols else False
            chain.append({
                "stage": "runs",
                "symbol": symbol,
                "note": "in kallsyms" if confirmed else "not in kallsyms",
                "confirmed": confirmed,
            })
    if thread:
        chain.append({
            "stage": "thread",
            "symbol": f"{thread['comm']}  pid {thread['pid']}",
            "note": "threaded handler",
            "confirmed": True,
        })
    else:
        chain.append({
            "stage": "thread",
            "symbol": "none — handled in softirq",
            "note": "",
            "confirmed": False,
        })
    return chain


def _uptime_s():
    try:
        with open("/proc/uptime", "r", encoding="utf-8", errors="ignore") as fh:
            return float(fh.read().split()[0])
    except (OSError, ValueError, IndexError):
        return None


def history(irq):
    """Biography of one interrupt line: lifetime count versus the host's age.

    The anatomy card is the path into the kernel. This is how that line has
    lived since boot — how many times it rang, what share of every interrupt
    that is, which CPU took most of them, and the mean rate over uptime.
    A wall-clock of the first fire is not something the kernel keeps.
    """
    irq = str(irq).strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,16}", irq):
        return {"found": False, "irq": irq}

    interrupts = read_interrupts()
    if irq not in interrupts:
        return {"found": False, "irq": irq}

    counts, desc = interrupts[irq]
    total = sum(counts)
    host_total = sum(sum(row_counts) for row_counts, _ in interrupts.values())
    uptime = _uptime_s()
    online = _cpus_online()
    per_cpu = counts[:online] if len(counts) >= online else counts
    top_cpu = None
    top_count = 0
    if per_cpu:
        top_cpu = max(range(len(per_cpu)), key=lambda i: per_cpu[i])
        top_count = int(per_cpu[top_cpu])

    payload = {
        "found": True,
        "irq": irq,
        "label": desc,
        "kind": "line" if irq.isdigit() else "aggregate",
        "total": total,
        "host_total": host_total,
        "share": round(total / host_total, 5) if host_total else None,
        "uptime_s": uptime,
        "lifetime_per_sec": round(total / uptime, 4) if uptime and uptime > 0 else None,
        "top_cpu": top_cpu,
        "top_cpu_count": top_count,
        "top_cpu_share": round(top_count / total, 4) if total else None,
        "device": None,
        "chip": None,
        "softirq": None,
        "source": "/proc/interrupts · /proc/uptime",
    }

    if irq.isdigit():
        device = _read(f"{_SYS_IRQ}/{irq}/actions")
        chip = _read(f"{_SYS_IRQ}/{irq}/chip_name")
        payload["device"] = device or None
        payload["chip"] = chip or None
        vector = vector_for(device or desc, chip)
        if vector:
            softirqs = read_softirqs()
            payload["softirq"] = {
                "vector": vector,
                "total": softirqs.get(vector),
                "basis": "driver class",
            }
    else:
        payload["device"] = desc.lower() if desc else None

    return payload


def describe(irq):
    """Everything the card shows about one line, or None if there is no such line."""
    irq = str(irq).strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,16}", irq):
        return None

    interrupts = read_interrupts()
    if irq not in interrupts:
        return None
    counts, desc = interrupts[irq]

    symbols = kernel_symbols()
    softirqs = read_softirqs()
    online = _cpus_online()
    per_cpu = counts[:online] if len(counts) >= online else counts

    payload = {
        "irq": irq,
        "label": desc,
        "total": sum(counts),
        "per_cpu": per_cpu,
        "cpus_online": online,
    }

    if not irq.isdigit():
        # A lettered row is a kernel-side counter, not a device line. The
        # kernel prints its own description, which beats anything invented.
        payload.update({
            "kind": "aggregate",
            "device": None,
            "chip": None,
            "summary": desc.lower() if desc else None,
            "chain": [],
            "affinity": None,
            "thread": None,
            "softirq": None,
        })
        if irq == "HYP":
            children = _xen_event_channels(interrupts)
            payload["children_total"] = sum(row["total"] for row in children)
            payload["children"] = children[:_MAX_CHANNELS]
            payload["children_hidden"] = max(0, len(children) - _MAX_CHANNELS)
        return payload

    device = _read(f"{_SYS_IRQ}/{irq}/actions")
    chip = _read(f"{_SYS_IRQ}/{irq}/chip_name")
    vector = vector_for(device or desc, chip)
    thread = _threaded_handler(irq)

    payload.update({
        "kind": "line",
        "device": device or None,
        "chip": chip or None,
        "name": _read(f"{_SYS_IRQ}/{irq}/name") or None,
        "hwirq": _read(f"{_SYS_IRQ}/{irq}/hwirq") or None,
        "type": _read(f"{_SYS_IRQ}/{irq}/type") or None,
        "wakeup": _read(f"{_SYS_IRQ}/{irq}/wakeup") or None,
        "summary": _DEVICE_SUMMARY.get(vector),
        "affinity": {
            "allowed": _read(f"{_PROC_IRQ}/{irq}/smp_affinity_list") or None,
            "effective": _read(f"{_PROC_IRQ}/{irq}/effective_affinity_list") or None,
        },
        "thread": thread,
        "chain": _chain_for_line(device, chip, vector, symbols, thread),
    })

    if vector:
        symbol = VECTOR_SYMBOL.get(vector)
        payload["softirq"] = {
            "vector": vector,
            "total": softirqs.get(vector),
            "symbol": symbol,
            "confirmed": bool(symbols) and symbol in symbols,
            "basis": "driver class",
        }
    else:
        payload["softirq"] = None

    return payload
