"""Tests for ``kernel_ai.services.crypto.security_pipeline``."""

from types import SimpleNamespace

from kernel_ai.services.crypto import security_pipeline as svc


def test_collect_security_realtime_with_empty_sources():
    psutil_module = SimpleNamespace(
        Error=Exception,
        NoSuchProcess=Exception,
        AccessDenied=Exception,
        ZombieProcess=Exception,
        process_iter=lambda _attrs: [],
        net_connections=lambda kind="inet": [],
    )
    random_module = SimpleNamespace(randint=lambda _a, _b: 10)
    os_module = SimpleNamespace(
        path=SimpleNamespace(exists=lambda _p: False),
        scandir=lambda _p: [],
    )

    out = svc.collect_security_realtime(
        security_prev={"timestamp": None, "events": 0},
        psutil_module=psutil_module,
        random_module=random_module,
        os_module=os_module,
    )
    assert "pipeline" in out
    assert "security_tools" in out


def test_setuid_binaries_are_counted_without_a_shell():
    """The count used to come from `find | wc -l` via shell=True.

    That spawned /bin/sh under gunicorn on every request reaching this panel,
    which the eBPF collector flags as a suspicious web-stack child and the SIEM
    chain rule then escalated to critical. The count must stay correct without it.
    """
    psutil_module = SimpleNamespace(
        Error=Exception,
        NoSuchProcess=Exception,
        AccessDenied=Exception,
        ZombieProcess=Exception,
        process_iter=lambda _attrs: [],
        net_connections=lambda kind="inet": [],
    )

    def _entry(name, *, mode, is_file=True):
        return SimpleNamespace(
            name=name,
            is_file=lambda follow_symlinks=True: is_file,
            stat=lambda follow_symlinks=True: SimpleNamespace(st_mode=mode),
        )

    # 0o4755 carries the setuid bit, 0o755 does not.
    listings = {
        "/usr/bin": [
            _entry("sudo", mode=0o104755),
            _entry("ls", mode=0o100755),
            # A setuid directory must not be counted: find had -type f.
            _entry("X11", mode=0o104755, is_file=False),
        ],
        "/usr/sbin": [_entry("unix_chkpwd", mode=0o104755)],
    }
    os_module = SimpleNamespace(
        path=SimpleNamespace(exists=lambda _p: False),
        scandir=lambda p: listings[p],
    )

    out = svc.collect_security_realtime(
        security_prev={"timestamp": None, "events": 0},
        psutil_module=psutil_module,
        random_module=SimpleNamespace(randint=lambda _a, _b: 10),
        os_module=os_module,
    )
    surface = {item["name"]: item["value"] for item in out["attack_surface"]}
    assert surface["setuid-binaries"] == 2


def test_setuid_count_survives_an_unreadable_directory():
    """A denied scandir must yield 0, not a 500 on the security page."""
    psutil_module = SimpleNamespace(
        Error=Exception,
        NoSuchProcess=Exception,
        AccessDenied=Exception,
        ZombieProcess=Exception,
        process_iter=lambda _attrs: [],
        net_connections=lambda kind="inet": [],
    )

    def _boom(_p):
        raise PermissionError("denied")

    out = svc.collect_security_realtime(
        security_prev={"timestamp": None, "events": 0},
        psutil_module=psutil_module,
        random_module=SimpleNamespace(randint=lambda _a, _b: 10),
        os_module=SimpleNamespace(
            path=SimpleNamespace(exists=lambda _p: False), scandir=_boom
        ),
    )
    surface = {item["name"]: item["value"] for item in out["attack_surface"]}
    assert surface["setuid-binaries"] == 0
