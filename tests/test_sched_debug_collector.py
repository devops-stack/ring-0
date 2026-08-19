"""Tests for the root sched_debug collector.

The collector is a standalone script run by systemd, not part of the package,
so it is loaded by path the same way the syscall collector loads the modules it
shares with the app.

Every line in the fixture below is copied verbatim from
``/sys/kernel/debug/sched/debug`` on the production host (kernel 6.8, EEVDF),
including the two rows that break naive parsing: the task on the CPU, which the
kernel prefixes with ">R" instead of a space and a state letter, and rsyslog's
thread, whose name contains spaces.
"""

import importlib.util
import os

_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "deploy", "ebpf", "sched_debug_collector.py",
)
_spec = importlib.util.spec_from_file_location("sched_debug_collector", _PATH)
collector = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(collector)


DEBUG_TEXT = """cpu#0, 2299.918 MHz
  .nr_running                    : 3
  .nr_switches                   : 1254336106

cfs_rq[0]:/system.slice/kernel-ai.service
  .left_vruntime                 : 0.000001
  .avg_vruntime                  : 17852.068599
  .nr_running                    : 1

cfs_rq[0]:/user.slice
  .avg_vruntime                  : 1049460.510581
  .nr_running                    : 1

runnable tasks:
 S            task   PID         tree-key  switches  prio     wait-time             sum-exec        sum-sleep
-------------------------------------------------------------------------------------------------------------
 Spool_workqueue_     3      1428.137431 E      1428.824774         0.700000         0.025650         4   120         0.000000         0.025650         0.000000         0.000000 0 0 /
 S  rs:main Q:Reg 40319     11788.388078 E     11789.071062         0.700000     13523.318844    352958   120         0.000000     13523.318844         0.000000         0.000000 0 0 /system.slice/rsyslog.service
 S       gunicorn 160967     17852.182045 E     17852.768599         0.700000      4439.487427     37447   120         0.000000      4439.487427         0.000000         0.000000 0 0 /system.slice/kernel-ai.service
 N       gunicorn 160968     17853.000000 N     17853.700000         0.700000      4192.098178     33313   120         0.000000      4192.098178         0.000000         0.000000 0 0 /system.slice/kernel-ai.service
>R            cat 164270   1049460.510581 E   1049460.842993         0.700000         2.771451        16   120         0.000000         2.771451         0.000000         0.000000 0 0 /user.slice

"""


def _parsed():
    return collector.parse(DEBUG_TEXT)


def test_the_task_holding_the_cpu_is_not_dropped():
    """">R" replaces the state letter, so the row needs positional parsing."""
    tasks, cpus = _parsed()

    assert "164270" in tasks
    assert tasks["164270"]["current"] is True
    assert tasks["164270"]["comm"] == "cat"
    assert cpus["0"]["current_tid"] == 164270


def test_only_the_running_task_carries_the_flag():
    tasks, _ = _parsed()

    assert [tid for tid, row in tasks.items() if row.get("current")] == ["164270"]


def test_a_thread_whose_name_contains_spaces_is_kept():
    tasks, _ = _parsed()

    assert tasks["40319"]["comm"] == "rs:main Q:Reg"
    assert tasks["40319"]["cgroup"] == "/system.slice/rsyslog.service"


def test_a_name_that_fills_the_field_does_not_swallow_the_state():
    tasks, _ = _parsed()

    assert tasks["3"]["comm"] == "pool_workqueue_"
    assert tasks["3"]["state"] == "S"


def test_the_kernels_own_eligibility_verdict_is_carried_through():
    tasks, _ = _parsed()

    assert tasks["160967"]["eligible"] is True
    assert tasks["160968"]["eligible"] is False


def test_lag_is_measured_against_the_fair_clock_of_the_same_cgroup():
    tasks, _ = _parsed()

    row = tasks["160967"]
    assert row["avg_vruntime"] == 17852.069
    # V - vruntime: this thread is a hair ahead of fair, so it owes time.
    assert row["vlag_ms"] == round(17852.068599 - 17852.182045, 3)
    assert row["vlag_ms"] < 0


def test_the_deadline_and_the_slice_come_from_the_row():
    tasks, _ = _parsed()

    row = tasks["160967"]
    assert row["deadline_v"] == 17852.769
    assert row["slice_ms"] == 0.7
    assert row["prio"] == 120


def test_the_runqueue_depth_is_the_one_printed_above_the_cfs_queues():
    """The cpu banner's nr_running counts every class, and comes first."""
    _, cpus = _parsed()

    assert cpus["0"]["nr_running"] == 3


def test_the_table_header_is_not_read_as_a_task():
    tasks, _ = _parsed()

    assert "task" not in {row["comm"] for row in tasks.values()}
    assert len(tasks) == 5


def test_a_row_from_a_kernel_without_eevdf_is_refused():
    """Pre-6.6 rows have no eligibility column, so there is nothing to report."""
    old = " S        systemd     1     53191.075522     314688   120         0.000000 /"

    assert collector.parse_row(old) is None
