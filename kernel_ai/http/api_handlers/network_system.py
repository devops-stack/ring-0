"""Network/system API handlers."""

from flask import current_app, request

from kernel_ai.collectors import proc_fs as _proc_fs
from kernel_ai.http.common import api_json
from kernel_ai.services import devices as _devices_service
from kernel_ai.services import network as _network_service
from kernel_ai.services import system_view as _system_view_service
from kernel_ai.state import get_state_container


def active_connections():
    return api_json(lambda: {"connections": _network_service.get_active_connections()})


def ip_entry():
    def _payload():
        kind = request.args.get("kind", "").strip()
        if kind not in {"neigh", "route"}:
            raise ValueError("kind must be neigh or route")
        return _network_service.get_ip_entry(
            kind=kind,
            ip=request.args.get("ip"),
            destination=request.args.get("destination"),
            gateway=request.args.get("gateway"),
            iface=request.args.get("iface"),
        )

    return api_json(_payload, exception_statuses=[(ValueError, 400)])


def flow_history():
    def _payload():
        local = request.args.get("local", "").strip()
        remote = request.args.get("remote", "").strip()
        proto = request.args.get("proto", "TCP").strip()
        if not local or not remote:
            raise ValueError("Missing 'local' or 'remote' query parameter")
        return _network_service.get_flow_history(local=local, remote=remote, proto=proto)

    return api_json(_payload, exception_statuses=[(ValueError, 400)])


def traceroute_info():
    def _payload():
        state = get_state_container(current_app)
        remote_ip = request.args.get("ip", "").strip()
        if not remote_ip:
            raise ValueError("Missing 'ip' query parameter")
        return _network_service.get_traceroute_info(
            remote_ip,
            traceroute_cache=state.traceroute_cache,
            cache_ttl_seconds=state.traceroute_cache_ttl_seconds,
        )

    return api_json(_payload, exception_statuses=[(ValueError, 400)])


def network_stack_realtime():
    return api_json(
        lambda: _network_service.get_network_stack_realtime(
            network_stack_prev=get_state_container(current_app).network_stack_prev,
            prefer_local=request.args.get("local"),
            prefer_remote=request.args.get("remote"),
        )
    )


def devices_realtime():
    return api_json(
        lambda: _devices_service.get_devices_realtime(
            devices_prev=get_state_container(current_app).devices_prev,
            read_diskstats_fn=_proc_fs.read_diskstats,
            read_interrupt_lines_fn=_proc_fs.read_interrupt_lines,
            read_tty_irq_total_fn=_proc_fs.read_tty_irq_total,
        )
    )


def filesystem_blocks():
    return api_json(
        lambda: _system_view_service.get_filesystem_blocks(
            filesystem_prev=get_state_container(current_app).filesystem_prev
        )
    )


def isolation_context():
    return api_json(_system_view_service.get_isolation_context)


def ext4_anatomy():
    return api_json(lambda: _system_view_service.get_ext4_file_anatomy(request.args.get("path")))


def ext4_journal():
    return api_json(_system_view_service.get_ext4_journal)


def hot_files():
    return api_json(_system_view_service.get_hot_files)


def path_walk():
    return api_json(lambda: _system_view_service.get_path_walk(request.args.get("path")))
