"""Tests for ``kernel_ai.services.network``."""

from kernel_ai.services import network as svc


def test_tcp_state_name_mapping():
    assert svc._tcp_state_name("01") == "ESTABLISHED"
    assert svc._tcp_state_name("ff") == "FF"


def test_traceroute_invalid_ip_raises_value_error():
    try:
        svc.get_traceroute_info("not-an-ip")
        assert False, "Expected ValueError for invalid IP"
    except ValueError:
        assert True


_SS_HEADER = (
    "ESTAB 0 0 172.31.25.131:443 185.115.4.162:26547 "
    "timer:(keepalive,34sec,0) uid:33 ino:41231 cgroup:/system.slice/nginx.service"
)
_SS_DETAILS = (
    " ts sack cubic wscale:7,6 rto:204 rtt:3.512/1.75 ato:40 mss:1448 pmtu:1500 "
    "rcvmss:536 advmss:1460 cwnd:10 bytes_sent:52144 bytes_acked:52144 "
    "bytes_received:9214 segs_out:71 segs_in:44 send 33.0Mbps lastsnd:912 "
    "lastrcv:940 lastack:912 delivery_rate 12.1Mbps busy:2140ms "
    "snd_wnd:64128 rcv_space:14480 minrtt:3.204"
)


def test_flow_row_reads_session_life_counters():
    row = svc._parse_ss_flow_row(_SS_HEADER, _SS_DETAILS, "TCP")
    assert row["local"] == "172.31.25.131:443"
    assert row["remote"] == "185.115.4.162:26547"
    assert row["state"] == "ESTAB"
    assert row["bytes_sent"] == 52144
    assert row["bytes_received"] == 9214
    assert row["segs_out"] == 71
    assert row["cwnd"] == 10
    assert row["rtt_ms"] == 3.512
    assert row["cc"] == "cubic"
    assert row["owner"] == "nginx"
