"""Tests for the root wakeup collector.

The fixture is shaped exactly like ``trace`` in a tracing instance: a header of
comment lines, the latency flags in their fixed columns, and one awkward line
whose waker name contains a space, which is what breaks naive parsing.
"""

import importlib.util
import os

_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "deploy", "ebpf", "wakeup_collector.py",
)
_spec = importlib.util.spec_from_file_location("wakeup_collector", _PATH)
collector = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(collector)


TRACE = """# tracer: nop
#
#                                _-----=> irqs-off/BH-disabled
#                               / _----=> need-resched
#                              | / _---=> hardirq/softirq
            bash-171012  [000] dN... 2741591.914644: sched_wakeup: comm=kauditd pid=22 prio=120 target_cpu=000
         kauditd-22      [000] d.... 2741591.914654: sched_wakeup: comm=systemd-journal pid=128826 prio=119 target_cpu=000
         kauditd-22      [000] d.... 2741591.915189: sched_wakeup: comm=systemd-journal pid=128826 prio=119 target_cpu=000
   rs:main Q:Reg-40318   [000] dNs.. 2741591.915046: sched_wakeup: comm=rcu_sched pid=16 prio=120 target_cpu=000
          <idle>-0       [000] dNh.. 2741591.915446: sched_wakeup: comm=auditd pid=75798 prio=116 target_cpu=000
            bash-171012  [000] d.... 2741591.916000: sched_wakeup_new: comm=sleep pid=171015 prio=120 target_cpu=000
"""


def test_an_edge_counts_every_time_it_happens():
    edges, contexts, events, lost = collector.parse(TRACE)

    assert events == 6 and lost == 0
    edge = edges[(22, 128826)]
    assert edge["count"] == 2
    assert edge["waker_comm"] == "kauditd"
    assert edge["comm"] == "systemd-journal"


def test_a_waker_whose_name_has_a_space_is_still_read():
    edges, _, _, _ = collector.parse(TRACE)

    assert edges[(40318, 16)]["waker_comm"] == "rs:main Q:Reg"


def test_the_context_of_each_wakeup_comes_from_the_latency_flags():
    edges, contexts, _, _ = collector.parse(TRACE)

    # 'h' in the third column is a hard interrupt, 's' a softirq, '.' task code.
    assert edges[(0, 75798)]["contexts"] == {"hardirq": 1}
    assert edges[(40318, 16)]["contexts"] == {"softirq": 1}
    assert edges[(171012, 22)]["contexts"] == {"task": 1}
    assert contexts == {"task": 4, "softirq": 1, "hardirq": 1}


def test_a_task_waking_for_the_first_time_is_marked():
    edges, _, _, _ = collector.parse(TRACE)

    assert edges[(171012, 171015)]["new"] is True
    assert edges[(171012, 22)]["new"] is False


def test_events_the_kernel_dropped_are_counted_not_hidden():
    text = TRACE + "CPU:0 [LOST 4231 EVENTS]\n"

    _, _, events, lost = collector.parse(text)

    assert lost == 4231
    assert events == 6


def test_the_header_and_anything_unparsable_are_skipped():
    _, _, events, _ = collector.parse("# tracer: nop\nnot a trace line at all\n")

    assert events == 0


def test_the_busiest_ends_are_rolled_up_over_all_edges():
    edges, _, _, _ = collector.parse(TRACE)
    wakers = {}
    for edge in edges.values():
        row = wakers.setdefault(edge["waker_tid"],
                                {"tid": edge["waker_tid"], "comm": edge["waker_comm"],
                                 "count": 0, "partners": 0})
        row["count"] += edge["count"]
        row["partners"] += 1

    top = {row["tid"]: row for row in collector._top(wakers)}

    # kauditd woke one task twice; bash woke two different tasks once each.
    assert (top[22]["count"], top[22]["partners"]) == (2, 1)
    assert (top[171012]["count"], top[171012]["partners"]) == (2, 2)
    assert (top[0]["count"], top[0]["partners"]) == (1, 1)
