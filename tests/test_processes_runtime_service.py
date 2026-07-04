"""Tests for realtime process semantic operation builders."""

from kernel_ai.services import processes_runtime as svc


def test_build_semantic_ops_uses_procfs_evidence():
    node_pool = {
        100: {
            "pid": 100,
            "ppid": 1,
            "name": "nginx",
            "syscall_pressure": 55,
            "fd_count": 24,
            "num_threads": 4,
            "seccomp_mode": "filter",
            "connections": 2,
            "unique_peers": 1,
            "fd_semantics": {
                "socket": 2,
                "regular": 3,
                "eventpoll": 1,
                "pipe": 1,
                "eventfd": 1,
                "sampled": 12,
            },
        }
    }
    network_tracing = [
        {
            "pid": 100,
            "name": "nginx",
            "connections": 2,
            "unique_peers": 1,
            "peer_sample": ["10.0.0.5"],
            "top_state": "ESTABLISHED",
        }
    ]
    security_hooks = [{"name": "LSM stack", "status": "active", "detail": "apparmor"}]

    rows = svc._build_semantic_ops(
        node_pool,
        network_tracing,
        security_hooks,
        {"RetransSegs": 7},
    )

    assert rows[0]["pid"] == 100
    labels = {op["label"] for op in rows[0]["ops"]}
    assert "socket()" in labels
    assert "epoll_wait()" in labels
    assert "nf_conntrack" in labels
    assert "tcp retransmission" in labels
    assert "sendfile()/splice()" in labels
    assert rows[0]["source"] == "procfs+psutil-derived"
