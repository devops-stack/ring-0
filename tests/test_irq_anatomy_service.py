"""Tests for ``kernel_ai.services.irq_anatomy``."""

from kernel_ai.services import irq_anatomy as ia
from kernel_ai.services import syscall_anatomy as sa


def _stub_machine(monkeypatch, interrupts, sysfs, procfs=None, symbols=(), online=1, tasks=()):
    """Stand in for the four files the module reads.

    ``sysfs`` and ``procfs`` are keyed by the path tail, so a test only has to
    spell out the attributes it cares about.
    """
    procfs = procfs or {}
    monkeypatch.setattr(ia, "read_interrupts", lambda: interrupts)
    monkeypatch.setattr(ia, "kernel_symbols", lambda: frozenset(symbols))
    monkeypatch.setattr(ia, "_cpus_online", lambda: online)
    monkeypatch.setattr(ia, "_threaded_handler", lambda irq: dict(tasks).get(irq))

    def fake_read(path):
        for root, table in ((ia._SYS_IRQ, sysfs), (ia._PROC_IRQ, procfs)):
            if path.startswith(root + "/"):
                return table.get(path[len(root) + 1:], "")
        return ""

    monkeypatch.setattr(ia, "_read", fake_read)


def test_a_network_line_is_followed_to_the_function_its_softirq_runs(monkeypatch):
    _stub_machine(
        monkeypatch,
        interrupts={"56": ([43168173, 0], "xen-dyn-lateeoi -event eth0")},
        sysfs={
            "56/actions": "eth0",
            "56/chip_name": "xen-dyn-lateeoi",
            "56/name": "event",
            "56/type": "edge",
        },
        procfs={"56/smp_affinity_list": "0", "56/effective_affinity_list": "0"},
        symbols={"net_rx_action"},
        online=2,
    )
    monkeypatch.setattr(ia, "read_softirqs", lambda: {"NET_RX": 16075193})

    out = ia.describe("56")
    assert out["kind"] == "line"
    assert out["device"] == "eth0"
    assert [step["stage"] for step in out["chain"]] == [
        "line", "handler", "raises", "runs", "thread",
    ]
    assert [step["symbol"] for step in out["chain"]][:4] == [
        "xen-dyn-lateeoi", "eth0", "NET_RX", "net_rx_action",
    ]
    assert out["softirq"]["vector"] == "NET_RX"
    assert out["softirq"]["total"] == 16075193
    assert out["affinity"] == {"allowed": "0", "effective": "0"}
    assert out["total"] == 43168173


def test_the_softirq_vector_is_marked_as_reasoned_not_measured(monkeypatch):
    """The kernel records no vector per line, and the card must not pretend."""
    _stub_machine(
        monkeypatch,
        interrupts={"7": ([12], "nvme0q1")},
        sysfs={"7/actions": "nvme0q1", "7/chip_name": "IR-PCI-MSI"},
        symbols={"blk_done_softirq"},
    )
    monkeypatch.setattr(ia, "read_softirqs", lambda: {"BLOCK": 4679716})

    raises = next(s for s in ia.describe("7")["chain"] if s["stage"] == "raises")
    assert raises["symbol"] == "BLOCK"
    assert raises["inferred"] is True
    assert raises["note"] == "by driver class"


def test_a_symbol_this_kernel_does_not_export_is_shown_as_unconfirmed(monkeypatch):
    _stub_machine(
        monkeypatch,
        interrupts={"56": ([9], "eth0")},
        sysfs={"56/actions": "eth0", "56/chip_name": "IR-PCI-MSI"},
        symbols=set(),
    )
    monkeypatch.setattr(ia, "read_softirqs", lambda: {})

    runs = next(s for s in ia.describe("56")["chain"] if s["stage"] == "runs")
    assert runs["confirmed"] is False
    assert runs["note"] == "not in kallsyms"


def test_an_unrecognised_device_claims_no_vector_at_all(monkeypatch):
    _stub_machine(
        monkeypatch,
        interrupts={"3": ([4], "some-odd-widget")},
        sysfs={"3/actions": "some-odd-widget", "3/chip_name": "IO-APIC"},
        symbols={"net_rx_action", "blk_done_softirq"},
    )
    monkeypatch.setattr(ia, "read_softirqs", lambda: {"NET_RX": 1})

    out = ia.describe("3")
    assert out["softirq"] is None
    assert [step["stage"] for step in out["chain"]] == ["line", "handler", "thread"]


def test_a_threaded_handler_ends_the_chain_on_a_real_pid(monkeypatch):
    _stub_machine(
        monkeypatch,
        interrupts={"9": ([0], "acpi")},
        sysfs={"9/actions": "acpi", "9/chip_name": "xen-pirq"},
        tasks=[("9", {"pid": 34, "comm": "irq/9-acpi"})],
    )
    monkeypatch.setattr(ia, "read_softirqs", lambda: {})

    last = ia.describe("9")["chain"][-1]
    assert last["stage"] == "thread"
    assert last["confirmed"] is True
    assert "pid 34" in last["symbol"]


def test_a_lettered_row_is_a_counter_and_gets_no_invented_chain(monkeypatch):
    _stub_machine(
        monkeypatch,
        interrupts={"MCP": ([8131], "Machine check polls")},
        sysfs={},
    )
    monkeypatch.setattr(ia, "read_softirqs", lambda: {})

    out = ia.describe("MCP")
    assert out["kind"] == "aggregate"
    assert out["chain"] == []
    assert out["summary"] == "machine check polls"
    assert "children" not in out


def test_the_hypervisor_counter_shows_the_channels_that_came_through_it(monkeypatch):
    """On Xen, HYP is the door every event channel enters by, not a device."""
    _stub_machine(
        monkeypatch,
        interrupts={
            "HYP": ([737233233], "Hypervisor callback interrupts"),
            "48": ([691592800], "xen-percpu -virq timer0"),
            "56": ([43168173], "xen-dyn-lateeoi -event eth0"),
            "31": ([50], "IO-APIC 31-edge not-a-channel"),
        },
        sysfs={
            "48/chip_name": "xen-percpu", "48/actions": "timer0",
            "56/chip_name": "xen-dyn-lateeoi", "56/actions": "eth0",
            "31/chip_name": "IO-APIC", "31/actions": "not-a-channel",
        },
    )
    monkeypatch.setattr(ia, "read_softirqs", lambda: {})

    out = ia.describe("HYP")
    assert [child["irq"] for child in out["children"]] == ["48", "56"]
    assert out["children"][0]["device"] == "timer0"
    assert out["children_total"] == 691592800 + 43168173


def test_channels_that_never_fired_are_left_off_the_hypervisor_card(monkeypatch):
    """A guest is wired with channels it never uses; a zero bar earns no row."""
    interrupts = {"HYP": ([100], "Hypervisor callback interrupts")}
    sysfs = {}
    for index in range(9):
        irq = str(40 + index)
        interrupts[irq] = ([10 - index], f"xen-dyn -event dev{index}")
        sysfs[f"{irq}/chip_name"] = "xen-dyn"
        sysfs[f"{irq}/actions"] = f"dev{index}"
    interrupts["70"] = ([0], "xen-dyn -event spinlock0")
    sysfs["70/chip_name"] = "xen-dyn"
    sysfs["70/actions"] = "spinlock0"

    _stub_machine(monkeypatch, interrupts=interrupts, sysfs=sysfs)
    monkeypatch.setattr(ia, "read_softirqs", lambda: {})

    out = ia.describe("HYP")
    assert "spinlock0" not in [child["device"] for child in out["children"]]
    assert len(out["children"]) == ia._MAX_CHANNELS
    # The nine that did fire, minus the six shown.
    assert out["children_hidden"] == 3
    # The total still covers every channel, shown or not.
    assert out["children_total"] == sum(range(2, 11))


def test_a_line_the_machine_does_not_have_has_no_answer(monkeypatch):
    _stub_machine(monkeypatch, interrupts={"56": ([1], "eth0")}, sysfs={})
    monkeypatch.setattr(ia, "read_softirqs", lambda: {})
    assert ia.describe("4096") is None


def test_a_path_cannot_be_smuggled_in_through_the_irq_name(monkeypatch):
    _stub_machine(monkeypatch, interrupts={"56": ([1], "eth0")}, sysfs={})
    monkeypatch.setattr(ia, "read_softirqs", lambda: {})
    assert ia.describe("../../etc/passwd") is None
    assert ia.describe("56/../55") is None


def test_the_kallsyms_filter_keeps_every_symbol_the_irq_card_asks_about():
    """The filter lives in syscall_anatomy, which cannot import this module.

    If a vector is added here without being added there, the collector would
    stop publishing its symbol and the card would quietly report it missing.
    """
    assert set(ia.VECTOR_SYMBOL.values()) <= sa._SOFTIRQ_SYMBOLS


def test_the_softirq_vectors_of_this_machine_are_all_described():
    """Every vector /proc/softirqs prints should have a function to name."""
    for vector in ia.read_softirqs():
        assert vector in ia.VECTOR_SYMBOL, vector
