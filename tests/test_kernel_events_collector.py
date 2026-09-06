"""Tests for the bounded eBPF Kernel Event Inspector collector."""

import importlib.util
from pathlib import Path


PATH = Path(__file__).parents[1] / "deploy" / "ebpf" / "kernel_events_collector.py"
SPEC = importlib.util.spec_from_file_location("kernel_events_collector", PATH)
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)


def test_program_pairs_enter_exit_and_correlates_wakeup(monkeypatch):
    monkeypatch.setattr(collector, "OR_CHUNK", 2)
    program = collector.build_bpftrace_program([1, 2, 3, 4, 5])

    assert program.count("tracepoint:raw_syscalls:sys_enter") == 3
    assert program.count("tracepoint:raw_syscalls:sys_exit") == 1
    assert program.count("tracepoint:sched:sched_wakeup") == 1
    assert "@start[args->pid]" in program
    assert "delete(@start[tid])" in program
    assert "ml-syscall.sock" not in program


def test_completed_span_keeps_task_resource_and_waker(monkeypatch):
    monkeypatch.setattr(
        collector.os,
        "readlink",
        lambda path: "pipe:[8123]" if path == "/proc/3272/fd/5" else "",
    )
    line = (
        "C|5000000000|3000000000|3272|3279|1000|tokio-runtime-w|63|8|"
        "5|4096|16|0|0|0|4500000000|88|91|producer\n"
    )

    event = collector.parse_line(
        line,
        {63: "read"},
        lambda _name: "fs",
        1_700_000_000,
    )

    assert event["phase"] == "complete"
    assert event["duration_us"] == 2_000_000
    assert event["pid"] == 3272
    assert event["tid"] == 3279
    assert event["fd"] == 5
    assert event["fd_target"] == "pipe:[8123]"
    assert event["wakeup"]["waker_comm"] == "producer"
    assert event["wakeup"]["wakee_tid"] == 3279


def test_non_event_output_is_ignored():
    assert collector.parse_line(
        "Attaching 5 probes...\n",
        {},
        lambda _name: "kernel",
        0,
    ) is None
