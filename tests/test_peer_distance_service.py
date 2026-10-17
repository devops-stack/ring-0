"""Tests for the peer-distance service."""
import json

from kernel_ai.services import peer_distance as svc


def _open_module(files):
    def _open(path, *_args, **_kwargs):
        if path not in files:
            raise OSError(f"no such file: {path}")

        class _Handle:
            def __enter__(self_inner):
                return self_inner

            def __exit__(self_inner, *_exc):
                return False

            def read(self_inner):
                return files[path]

        return _Handle()

    return _open


def test_missing_snapshot_reads_as_empty_rather_than_raising():
    snapshot = svc.read_snapshot("/run/nowhere.json", open_module=_open_module({}))
    assert snapshot == {"generated_at": None, "peers": []}


def test_truncated_snapshot_reads_as_empty():
    # The sensor renames into place, but a reader that finds a half-written
    # file must not take the whole page down with it.
    files = {"/run/peer.json": '{"peers": [{"address"'}
    assert svc.read_snapshot("/run/peer.json", open_module=_open_module(files))["peers"] == []


def test_stub_resolver_is_nearer_than_the_router():
    ip_map = {
        "neigh": [{"ip": "172.31.16.1", "mac": "02:f3:09:f3:f0:62", "iface": "ens5"}],
        "routes": [{"destination": "default", "gateway": "172.31.16.1", "iface": "ens5", "default": True}],
    }
    ladder = svc.build_ladder(ip_map, "nameserver 127.0.0.53\n", "nameserver 172.31.0.2\n", ["172.31.16.1"])
    by_role = {rung["role"]: rung for rung in ladder}

    assert by_role["stub resolver"]["hops"] == 0
    assert by_role["default router"]["hops"] == 1
    assert by_role["upstream resolver"]["hops"] == 1
    # The DHCP server here is also the link neighbour, so it is on the wire.
    assert by_role["lease server"]["hops"] == 0


def test_an_unseen_visitor_says_so_instead_of_reporting_zero():
    visitor = svc.describe_visitor("203.0.113.9", {"peers": []})
    assert visitor["measured"] is False
    assert visitor["hops"] is None
    assert visitor["why_absent"]


def test_a_seen_visitor_carries_both_distances():
    snapshot = {
        "peers": [
            {
                "address": "203.0.113.9",
                "ttl": 53,
                "hops": 11,
                "initial_ttl": 64,
                "family": "Linux, macOS or Android",
                "connections": 4,
            }
        ]
    }
    visitor = svc.describe_visitor(
        "203.0.113.9", snapshot, rtt={"found": True, "rtt_ms": 66.4, "min_rtt_ms": 65.9}
    )
    assert visitor["hops"] == 11
    assert visitor["min_rtt_ms"] == 65.9
    assert visitor["measured"] is True


def test_dhcp_server_is_read_from_the_lease():
    lease = "ADDRESS=172.31.25.131\nSERVER_ADDRESS=172.31.16.1\nROUTER=172.31.16.1\n"
    assert svc.dhcp_servers([lease]) == ["172.31.16.1"]
    assert svc.dhcp_servers(["ADDRESS=10.0.0.1\n"]) == []


def test_nameservers_keep_resolver_order_without_duplicates():
    text = "nameserver 127.0.0.53\noptions edns0\nnameserver 1.1.1.1\nnameserver 127.0.0.53\n"
    assert svc.nameservers(text) == ["127.0.0.53", "1.1.1.1"]


def test_neighbourhood_reports_the_sensor_being_absent():
    """A dev box with no sensor must render, and must not claim a distance."""
    result = svc.get_neighbourhood(
        "203.0.113.9",
        {"neigh": [], "routes": []},
        snapshot_path="/run/nowhere.json",
        os_module=type("_OS", (), {"listdir": staticmethod(lambda _p: [])}),
        open_module=_open_module({}),
    )
    assert result["sensor_publishing"] is False
    assert result["visitor"]["measured"] is False
    assert result["ladder"] == []


def test_snapshot_shape_matches_what_the_sensor_writes():
    """Guards the contract between the Go writer and this reader."""
    written = json.dumps(
        {
            "generated_at": "2026-10-03T09:55:11Z",
            "peers": [
                {
                    "address": "203.0.113.9",
                    "ttl": 53,
                    "hops": 11,
                    "initial_ttl": 64,
                    "family": "Linux, macOS or Android",
                    "connections": 3,
                    "last_seen": "2026-10-03T09:55:05Z",
                }
            ],
        }
    )
    snapshot = svc.read_snapshot("/run/peer.json", open_module=_open_module({"/run/peer.json": written}))
    assert snapshot["peers"][0]["hops"] == 11
    assert svc.describe_visitor("203.0.113.9", snapshot)["family"] == "Linux, macOS or Android"
