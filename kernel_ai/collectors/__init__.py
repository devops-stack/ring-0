from kernel_ai.collectors.proc_fs import (
    read_diskstats,
    read_interrupt_lines,
    read_tty_irq_total,
    safe_read_text,
)

__all__ = [
    "read_diskstats",
    "read_interrupt_lines",
    "read_tty_irq_total",
    "safe_read_text",
]
