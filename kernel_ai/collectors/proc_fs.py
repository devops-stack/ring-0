"""
Filesystem collectors for kernel introspection.

Tests should patch functions in ``kernel_ai.collectors.proc_fs`` (or this module's
attributes) rather than the whole webapp.
"""

from __future__ import annotations


def safe_read_text(path: str) -> str | None:
    """Read a small text file; return None on error."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    except (OSError, PermissionError, UnicodeError):
        return None


def read_diskstats() -> dict:
    """Parse /proc/diskstats into name -> combined sectors (read+write) counters."""
    stats: dict[str, int] = {}
    try:
        with open("/proc/diskstats", "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 14:
                    continue
                name = parts[2]
                if name.startswith("loop") or name.startswith("ram"):
                    continue
                try:
                    sectors_read = int(parts[5])
                    sectors_written = int(parts[9])
                    stats[name] = sectors_read + sectors_written
                except ValueError:
                    continue
    except OSError:
        pass
    return stats


def read_tty_irq_total() -> int:
    """Rough TTY/serial IRQ activity from /proc/interrupts."""
    total = 0
    try:
        with open("/proc/interrupts", "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                lower = line.lower()
                if "tty" not in lower and "serial" not in lower:
                    continue
                parts = line.split()
                for token in parts[1:9]:
                    if token.isdigit():
                        total += int(token)
    except OSError:
        pass
    return total


def read_interrupt_lines():
    """Return list of (line_lower, irq_sum_per_line) for /proc/interrupts."""
    out = []
    try:
        with open("/proc/interrupts", "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                if ":" not in line:
                    continue
                raw = line.strip()
                parts = raw.split()
                if len(parts) < 2:
                    continue
                irq_sum = 0
                for token in parts[1:]:
                    if token.isdigit():
                        irq_sum += int(token)
                    else:
                        break
                out.append((raw.lower(), irq_sum))
    except OSError:
        pass
    return out
