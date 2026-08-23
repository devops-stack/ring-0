"""Process inspection and IPC graph services."""

from __future__ import annotations

import os
import re
import time

import psutil

from kernel_ai.services import system_view as _system_view_service
from kernel_ai.sentry_helpers import capture_exception


def _parse_proc_net_socket_inodes():
    """Map socket inodes to coarse transport families available from /proc/net."""
    socket_kinds = {}

    try:
        with open("/proc/net/unix", "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 7 or parts[0] == "Num":
                    continue
                if parts[6].isdigit():
                    socket_kinds[int(parts[6])] = "unix"
    except (OSError, PermissionError):
        pass

    for path, kind in (
        ("/proc/net/tcp", "tcp"),
        ("/proc/net/tcp6", "tcp"),
        ("/proc/net/udp", "udp"),
        ("/proc/net/udp6", "udp"),
    ):
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) < 10 or parts[0] == "sl":
                        continue
                    if parts[9].isdigit():
                        socket_kinds[int(parts[9])] = kind
        except (OSError, PermissionError):
            continue

    return socket_kinds


def _collect_local_tcp_pairs(proc_names_by_pid):
    """Return local process-name pairs connected through TCP loopback/local sockets."""
    endpoints = {}
    try:
        connections = psutil.net_connections(kind="tcp")
    except (psutil.AccessDenied, OSError):
        return []

    for conn in connections:
        pid = getattr(conn, "pid", None)
        laddr = getattr(conn, "laddr", None)
        raddr = getattr(conn, "raddr", None)
        if not pid or not laddr or not raddr:
            continue
        if not hasattr(laddr, "ip") or not hasattr(raddr, "ip"):
            continue
        endpoints[(laddr.ip, int(laddr.port), raddr.ip, int(raddr.port))] = int(pid)

    pairs = set()
    for (local_ip, local_port, remote_ip, remote_port), left_pid in endpoints.items():
        right_pid = endpoints.get((remote_ip, remote_port, local_ip, local_port))
        if not right_pid or right_pid == left_pid:
            continue
        left_name = proc_names_by_pid.get(left_pid)
        right_name = proc_names_by_pid.get(right_pid)
        if not left_name or not right_name:
            continue
        pairs.add(tuple(sorted((left_name, right_name))))

    return sorted(pairs)


def _is_ipc_shared_mapping(path):
    """A shared mapping that is actually a channel, not a file two processes both mapped.

    ``/proc/pid/maps`` marks GPU buffers, font caches and Chromium pack files
    ``s`` as well. Those are not pipes. The orbit only keeps POSIX shm, memfd
    and System V segments — the things a process creates to talk to another.
    """
    if not path:
        return False
    if path.startswith("/dev/shm/") or path.startswith("/run/shm/"):
        return True
    if path.startswith("/memfd:") or path.startswith("memfd:"):
        return True
    if path.startswith("/SYSV") or path.startswith("/dev/shm"):
        return True
    return False


def get_ipc_links_summary(max_pairs=120, max_nodes=24):
    """Collect IPC relationships by shared sockets, pipes and real shared memory.

    A pair is two processes that hold the same pipe, unix or tcp socket inode,
    or the same POSIX/memfd/SYSV segment. Namespaces and shared file mappings
    (fonts, GPU nodes, pack files) are not channels and do not make a pair.
    """
    socket_inode_re = re.compile(r"^socket:\[(\d+)\]$")
    pipe_inode_re = re.compile(r"^pipe:\[(\d+)\]$")
    socket_kinds = _parse_proc_net_socket_inodes()
    socket_owners = {}
    other_socket_owners = {}
    unix_socket_owners = {}
    tcp_socket_owners = {}
    pipe_owners = {}
    shm_owners = {}
    namespace_keys = ["mnt", "pid", "net", "ipc", "uts", "user"]
    namespace_owners = {}
    proc_names_by_pid = {}

    for proc_dir in os.listdir("/proc"):
        if not proc_dir.isdigit():
            continue
        pid = int(proc_dir)
        try:
            with open(f"/proc/{pid}/comm", "r", encoding="utf-8", errors="replace") as f:
                proc_name = f.read().strip()
        except (OSError, PermissionError):
            continue
        if not proc_name:
            continue
        proc_names_by_pid[pid] = proc_name

        fd_dir = f"/proc/{pid}/fd"
        try:
            fd_entries = os.listdir(fd_dir)
        except (OSError, PermissionError):
            continue

        for fd_entry in fd_entries:
            fd_path = f"{fd_dir}/{fd_entry}"
            try:
                target = os.readlink(fd_path)
            except (OSError, PermissionError):
                continue

            sm = socket_inode_re.match(target)
            if sm:
                inode = int(sm.group(1))
                socket_owners.setdefault(inode, set()).add((pid, proc_name))
                socket_kind = socket_kinds.get(inode)
                if socket_kind == "unix":
                    unix_socket_owners.setdefault(inode, set()).add((pid, proc_name))
                elif socket_kind == "tcp":
                    tcp_socket_owners.setdefault(inode, set()).add((pid, proc_name))
                else:
                    other_socket_owners.setdefault(inode, set()).add((pid, proc_name))
                continue

            pm = pipe_inode_re.match(target)
            if pm:
                inode = int(pm.group(1))
                pipe_owners.setdefault(inode, set()).add((pid, proc_name))

        maps_path = f"/proc/{pid}/maps"
        try:
            with open(maps_path, "r", encoding="utf-8", errors="replace") as maps_file:
                for map_line in maps_file:
                    parts = map_line.strip().split(None, 5)
                    if len(parts) < 5:
                        continue
                    perms = parts[1]
                    dev = parts[3]
                    inode_text = parts[4]
                    map_path = parts[5] if len(parts) > 5 else ""

                    if len(perms) < 4 or perms[3] != "s":
                        continue
                    if not inode_text.isdigit():
                        continue
                    inode = int(inode_text)
                    if inode <= 0:
                        continue
                    if not map_path:
                        continue
                    if map_path.startswith("["):
                        continue
                    if not _is_ipc_shared_mapping(map_path):
                        continue

                    shm_key = f"{dev}:{inode}:{map_path}"
                    shm_owners.setdefault(shm_key, set()).add((pid, proc_name))
        except (OSError, PermissionError):
            continue

        for ns_name in namespace_keys:
            ns_inode = _system_view_service.read_namespace_inode(pid, ns_name)
            if not ns_inode:
                continue
            ns_key = f"{ns_name}:{ns_inode}"
            namespace_owners.setdefault(ns_key, set()).add((pid, proc_name))

    pair_totals = {}
    pair_socket = {}
    pair_unix_socket = {}
    pair_tcp = {}
    pair_pipe = {}
    pair_shm = {}
    pair_namespace = {}
    degree_total = {}
    degree_socket = {}
    degree_unix_socket = {}
    degree_tcp = {}
    degree_pipe = {}
    degree_shm = {}
    degree_namespace = {}

    def add_pair_counts(name_a, name_b, kind):
        if name_a == name_b:
            key = (name_a, name_b)
        else:
            key = tuple(sorted((name_a, name_b)))
        pair_totals[key] = pair_totals.get(key, 0) + 1
        if kind == "socket":
            pair_socket[key] = pair_socket.get(key, 0) + 1
        elif kind == "unix_socket":
            pair_socket[key] = pair_socket.get(key, 0) + 1
            pair_unix_socket[key] = pair_unix_socket.get(key, 0) + 1
        elif kind == "tcp":
            pair_socket[key] = pair_socket.get(key, 0) + 1
            pair_tcp[key] = pair_tcp.get(key, 0) + 1
        elif kind == "pipe":
            pair_pipe[key] = pair_pipe.get(key, 0) + 1
        elif kind == "shm":
            pair_shm[key] = pair_shm.get(key, 0) + 1
        elif kind == "namespace":
            pair_namespace[key] = pair_namespace.get(key, 0) + 1

        for nm in (name_a, name_b):
            degree_total[nm] = degree_total.get(nm, 0) + 1
            if kind == "socket":
                degree_socket[nm] = degree_socket.get(nm, 0) + 1
            elif kind == "unix_socket":
                degree_socket[nm] = degree_socket.get(nm, 0) + 1
                degree_unix_socket[nm] = degree_unix_socket.get(nm, 0) + 1
            elif kind == "tcp":
                degree_socket[nm] = degree_socket.get(nm, 0) + 1
                degree_tcp[nm] = degree_tcp.get(nm, 0) + 1
            elif kind == "pipe":
                degree_pipe[nm] = degree_pipe.get(nm, 0) + 1
            elif kind == "shm":
                degree_shm[nm] = degree_shm.get(nm, 0) + 1
            elif kind == "namespace":
                degree_namespace[nm] = degree_namespace.get(nm, 0) + 1

    def consume_inode_owners(owner_map, kind):
        for _inode, owners in owner_map.items():
            unique = sorted({(pid, name) for pid, name in owners})
            if len(unique) < 2:
                continue
            for i in range(len(unique)):
                for j in range(i + 1, len(unique)):
                    add_pair_counts(unique[i][1], unique[j][1], kind)

    consume_inode_owners(other_socket_owners, "socket")
    consume_inode_owners(unix_socket_owners, "unix_socket")
    consume_inode_owners(tcp_socket_owners, "tcp")
    consume_inode_owners(pipe_owners, "pipe")
    consume_inode_owners(shm_owners, "shm")
    # Sharing a mount or net namespace is not a channel. The orbit would
    # otherwise pair every process on the box with every other.
    local_tcp_pairs = _collect_local_tcp_pairs(proc_names_by_pid)
    for left_name, right_name in local_tcp_pairs:
        add_pair_counts(left_name, right_name, "tcp")

    sorted_pairs = sorted(pair_totals.items(), key=lambda kv: kv[1], reverse=True)[:max_pairs]
    pair_links = []
    for (left, right), weight in sorted_pairs:
        pair_links.append(
            {
                "left": left,
                "right": right,
                "weight": int(weight),
                "socket_weight": int(pair_socket.get((left, right), pair_socket.get((right, left), 0))),
                "unix_socket_weight": int(pair_unix_socket.get((left, right), pair_unix_socket.get((right, left), 0))),
                "tcp_weight": int(pair_tcp.get((left, right), pair_tcp.get((right, left), 0))),
                "pipe_weight": int(pair_pipe.get((left, right), pair_pipe.get((right, left), 0))),
                "shm_weight": int(pair_shm.get((left, right), pair_shm.get((right, left), 0))),
                "ns_weight": int(pair_namespace.get((left, right), pair_namespace.get((right, left), 0))),
            }
        )

    sorted_nodes = sorted(degree_total.items(), key=lambda kv: kv[1], reverse=True)[:max_nodes]
    process_nodes = []
    for name, degree in sorted_nodes:
        process_nodes.append(
            {
                "name": name,
                "degree": int(degree),
                "socket_degree": int(degree_socket.get(name, 0)),
                "unix_socket_degree": int(degree_unix_socket.get(name, 0)),
                "tcp_degree": int(degree_tcp.get(name, 0)),
                "pipe_degree": int(degree_pipe.get(name, 0)),
                "shm_degree": int(degree_shm.get(name, 0)),
                "ns_degree": int(degree_namespace.get(name, 0)),
            }
        )

    return {
        "process_nodes": process_nodes,
        "pair_links": pair_links,
        "stats": {
            "shared_socket_inodes": int(sum(1 for owners in socket_owners.values() if len({pid for pid, _ in owners}) > 1)),
            "shared_unix_socket_inodes": int(sum(1 for owners in unix_socket_owners.values() if len({pid for pid, _ in owners}) > 1)),
            "shared_tcp_socket_inodes": int(sum(1 for owners in tcp_socket_owners.values() if len({pid for pid, _ in owners}) > 1)),
            "local_tcp_pairs": len(local_tcp_pairs),
            "shared_pipe_inodes": int(sum(1 for owners in pipe_owners.values() if len({pid for pid, _ in owners}) > 1)),
            "shared_memory_regions": int(sum(1 for owners in shm_owners.values() if len({pid for pid, _ in owners}) > 1)),
            "shared_namespace_groups": int(sum(1 for owners in namespace_owners.values() if len({pid for pid, _ in owners}) > 1)),
            "pair_count": len(pair_links),
            "node_count": len(process_nodes),
        },
    }


def _status_kb(value):
    token = str(value or "").split()[0] if value else ""
    if token.lstrip("-").isdigit():
        return int(token)
    return None


def _read_status_counters(pid):
    """Lifetime counters from world-readable /proc status.

    Context switches and thread count are bare integers. Resident and virtual
    sizes come as ``N kB`` — including the high-water marks, which are the
    memory biography the kernel actually keeps.
    """
    out = {
        "ctx_voluntary": None,
        "ctx_nonvoluntary": None,
        "num_threads": None,
        "rss_kb": None,
        "rss_peak_kb": None,
        "virt_kb": None,
        "virt_peak_kb": None,
    }
    try:
        with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                value = value.strip()
                if key == "voluntary_ctxt_switches" and value.isdigit():
                    out["ctx_voluntary"] = int(value)
                elif key == "nonvoluntary_ctxt_switches" and value.isdigit():
                    out["ctx_nonvoluntary"] = int(value)
                elif key == "Threads" and value.isdigit():
                    out["num_threads"] = int(value)
                elif key == "VmRSS":
                    out["rss_kb"] = _status_kb(value)
                elif key == "VmHWM":
                    out["rss_peak_kb"] = _status_kb(value)
                elif key == "VmSize":
                    out["virt_kb"] = _status_kb(value)
                elif key == "VmPeak":
                    out["virt_peak_kb"] = _status_kb(value)
    except (OSError, PermissionError):
        pass
    return out


def _read_fault_counters(pid):
    """Minor and major faults from world-readable /proc/<pid>/stat.

    After the comm field: minflt, cminflt, majflt, cmajflt. The child
    counters are the faults of wait()'d children — useful for a forking
    parent, empty for everyone else.
    """
    out = {"minflt": None, "majflt": None, "cminflt": None, "cmajflt": None}
    try:
        with open(f"/proc/{pid}/stat", "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read()
    except (OSError, PermissionError):
        return out
    close = raw.rfind(")")
    if close == -1:
        return out
    fields = raw[close + 1:].split()
    # 0=state 1=ppid ... 7=minflt 8=cminflt 9=majflt 10=cmajflt
    try:
        if len(fields) > 10:
            out["minflt"] = int(fields[7])
            out["cminflt"] = int(fields[8])
            out["majflt"] = int(fields[9])
            out["cmajflt"] = int(fields[10])
    except ValueError:
        pass
    return out


def _read_io_counters(pid):
    """Byte counters from /proc/<pid>/io, which only the owner may read."""
    try:
        with open(f"/proc/{pid}/io", "r", encoding="utf-8", errors="ignore") as f:
            data = {}
            for line in f:
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                value = value.strip()
                if value.isdigit():
                    data[key.strip()] = int(value)
        return {"read_bytes": data.get("read_bytes"), "write_bytes": data.get("write_bytes")}
    except (OSError, PermissionError):
        return {"read_bytes": None, "write_bytes": None}


def get_process_activity_counters(pid):
    """Cumulative counters for client-side delta sampling.

    Deliberately cheap: no blocking ``cpu_percent`` call, just counter reads, so
    the dossier can poll this every couple of seconds. Rates are derived on the
    client from the difference between two samples, which is why the sample
    timestamp travels with the payload.
    """
    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess as e:
        return {"error": str(e), "pid": pid}

    try:
        times = proc.cpu_times()
        cpu_user = round(float(times.user), 3)
        cpu_system = round(float(times.system), 3)
    except (psutil.AccessDenied, psutil.NoSuchProcess, OSError):
        cpu_user = None
        cpu_system = None

    payload = {
        "pid": pid,
        "ts": time.time(),
        "cpu_user": cpu_user,
        "cpu_system": cpu_system,
    }
    payload.update(_read_status_counters(pid))
    payload.update(_read_fault_counters(pid))
    payload.update(_read_io_counters(pid))
    payload["io_readable"] = payload["read_bytes"] is not None
    return payload


_LINEAGE_MAX_DEPTH = 8


def _describe_ancestor(proc):
    """Snapshot of one process in the ancestry chain, with its real start time."""
    info = proc.as_dict(["pid", "name", "create_time", "status", "username"])
    create_time = info.get("create_time")
    try:
        cmdline = " ".join(proc.cmdline())
    except (psutil.AccessDenied, psutil.NoSuchProcess, OSError):
        cmdline = ""
    return {
        "pid": int(info.get("pid") or 0),
        "name": str(info.get("name") or "?"),
        "status": info.get("status"),
        "username": info.get("username"),
        "cmdline": cmdline[:160],
        "create_time": float(create_time) if create_time else None,
        "age_s": round(time.time() - float(create_time), 1) if create_time else None,
    }


def get_process_lineage_info(pid):
    """Ancestry chain from init down to ``pid``, ordered oldest first.

    Unlike fd tables, ``/proc/<pid>/stat`` is world readable, so start times and
    parent links resolve for foreign processes too. Timestamps here are real
    kernel start times, not a synthetic window.
    """
    try:
        proc = psutil.Process(pid)
    except psutil.NoSuchProcess as e:
        return {"error": str(e), "pid": pid}

    try:
        chain = []
        node = proc
        seen = set()
        while node is not None and len(chain) < _LINEAGE_MAX_DEPTH:
            if node.pid in seen:
                break
            seen.add(node.pid)
            chain.append(_describe_ancestor(node))
            try:
                node = node.parent()
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                break
        chain.reverse()

        try:
            children = proc.children()
            child_rows = [
                {"pid": c.pid, "name": c.name()}
                for c in children[:6]
            ]
            child_count = len(children)
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            child_rows = []
            child_count = 0

        self_row = chain[-1] if chain else None
        return {
            "pid": pid,
            "chain": chain,
            "depth": len(chain),
            "truncated": len(chain) >= _LINEAGE_MAX_DEPTH,
            "children": child_rows,
            "child_count": child_count,
            "boot_time": psutil.boot_time(),
            "age_s": self_row.get("age_s") if self_row else None,
        }
    except psutil.AccessDenied as e:
        return {"error": str(e), "pid": pid}
    except Exception as e:
        capture_exception(e, where="services.process_inspect.get_process_lineage_info")
        return {"error": str(e), "pid": pid}


def get_process_cpu_info(pid):
    try:
        proc = psutil.Process(pid)
        cpu_times = proc.cpu_times()
        cpu_percent = proc.cpu_percent(interval=0.1)

        try:
            cpu_affinity = proc.cpu_affinity()
        except Exception:
            cpu_affinity = []

        try:
            nice = proc.nice()
        except Exception:
            nice = None

        return {
            "pid": pid,
            "cpu_percent": round(cpu_percent, 1),
            "cpu_times": {
                "user": round(cpu_times.user, 2),
                "system": round(cpu_times.system, 2),
                "children_user": round(cpu_times.children_user, 2) if hasattr(cpu_times, "children_user") else 0,
                "children_system": round(cpu_times.children_system, 2) if hasattr(cpu_times, "children_system") else 0,
            },
            "cpu_affinity": cpu_affinity,
            "nice": nice,
        }
    except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
        return {"error": str(e)}
    except Exception as e:
        capture_exception(e, where="services.process_inspect.get_process_cpu_info")
        return {"error": str(e)}


_NAMESPACE_TYPES = [
    ("mnt", "MNT", "mount points / filesystem view"),
    ("pid", "PID", "process id tree"),
    ("net", "NET", "network stack / interfaces / ports"),
    ("ipc", "IPC", "SysV IPC / POSIX message queues"),
    ("uts", "UTS", "hostname / domain name"),
    ("user", "USER", "uid/gid mapping & capabilities"),
]
_HOST_NS_CACHE = {"ts": 0.0, "inodes": {}}


def _host_namespace_inodes():
    """Namespace inodes of PID 1 act as the host/init reference set."""
    now = time.time()
    if _HOST_NS_CACHE["inodes"] and now - _HOST_NS_CACHE["ts"] < 30:
        return _HOST_NS_CACHE["inodes"]
    inodes = {}
    for ns_name, _label, _desc in _NAMESPACE_TYPES:
        inodes[ns_name] = _system_view_service.read_namespace_inode(1, ns_name)
    _HOST_NS_CACHE["inodes"] = inodes
    _HOST_NS_CACHE["ts"] = now
    return inodes


def _namespace_peer_pids(self_pid, isolated_inodes, limit=240):
    """PIDs that share every isolated namespace inode with ``self_pid``.

    These are the process's "cell mates" — the rest of its container/sandbox.
    Only the isolated namespaces are compared (and we early-out on first
    mismatch), so a single-namespace sandbox costs one readlink per process.
    """
    peers = []
    if not isolated_inodes:
        return peers
    ns_items = list(isolated_inodes.items())
    for proc in psutil.process_iter(["pid"]):
        try:
            pid = proc.info["pid"]
            if pid == self_pid:
                continue
            for ns_name, inode in ns_items:
                if _system_view_service.read_namespace_inode(pid, ns_name) != inode:
                    break
            else:
                peers.append(pid)
                if len(peers) >= limit:
                    break
        except (psutil.NoSuchProcess, psutil.AccessDenied, KeyError):
            continue
    return peers


def get_process_namespace_fingerprint(pid):
    """Per-process namespace isolation profile relative to the host (PID 1).

    For each namespace type, reports whether the process lives in its own
    namespace (isolated) or shares the host's. When the process is isolated in
    at least one namespace, also resolves its co-resident peers (container
    mates). Used by the dossier fingerprint + containment halo.
    """
    host = _host_namespace_inodes()
    namespaces = []
    isolated_count = 0
    readable = 0
    isolated_inodes = {}
    for ns_name, label, desc in _NAMESPACE_TYPES:
        inode = _system_view_service.read_namespace_inode(pid, ns_name)
        host_inode = host.get(ns_name)
        if inode:
            readable += 1
        isolated = bool(inode and host_inode and inode != host_inode)
        if isolated:
            isolated_count += 1
            isolated_inodes[ns_name] = inode
        namespaces.append(
            {
                "id": ns_name,
                "label": label,
                "description": desc,
                "inode": inode,
                "host_inode": host_inode,
                "isolated": isolated,
            }
        )
    total = len(_NAMESPACE_TYPES)
    if isolated_count >= total:
        verdict = "fully isolated"
    elif isolated_count == 0:
        verdict = "host process"
    else:
        verdict = "partially sandboxed"

    peer_pids = _namespace_peer_pids(pid, isolated_inodes)
    return {
        "namespaces": namespaces,
        "isolated_count": isolated_count,
        "total": total,
        "readable": readable,
        "containerized": isolated_count > 0,
        "verdict": verdict,
        "peer_pids": peer_pids,
        "peer_count": len(peer_pids),
        "container_size": len(peer_pids) + 1 if isolated_count > 0 else 0,
    }


_TCP_STATES = {
    "01": "ESTABLISHED",
    "02": "SYN_SENT",
    "03": "SYN_RECV",
    "04": "FIN_WAIT1",
    "05": "FIN_WAIT2",
    "06": "TIME_WAIT",
    "07": "CLOSE",
    "08": "CLOSE_WAIT",
    "09": "LAST_ACK",
    "0A": "LISTEN",
    "0B": "CLOSING",
}


def _family_label(family, conn_type):
    fam = str(family or "").upper()
    typ = str(conn_type or "").upper()
    if "UNIX" in fam:
        return "unix"
    proto = "udp" if "DGRAM" in typ else "tcp"
    if "INET6" in fam:
        return f"{proto}6"
    if "INET" in fam:
        return proto
    return "socket"


def _format_addr(addr):
    if not addr:
        return None
    if hasattr(addr, "ip") and hasattr(addr, "port"):
        return f"{addr.ip}:{addr.port}"
    if hasattr(addr, "path") and addr.path:
        return str(addr.path)
    if isinstance(addr, (tuple, list)) and addr:
        if len(addr) >= 2 and addr[1] is not None:
            return f"{addr[0]}:{addr[1]}"
        return str(addr[0])
    return str(addr)


def _split_ip_port(text):
    if not text or ":" not in str(text):
        return None
    host, port = str(text).rsplit(":", 1)
    if not port.isdigit():
        return None
    return host, int(port)


def _tcp_peer_index():
    """Map a local 4-tuple to the process on the other end, when both ends are visible."""
    try:
        names = {}
        for proc in psutil.process_iter(["pid", "name"]):
            info = proc.info
            names[int(info["pid"])] = info.get("name")

        endpoints = {}
        for conn in psutil.net_connections(kind="inet"):
            pid = getattr(conn, "pid", None)
            laddr = getattr(conn, "laddr", None)
            raddr = getattr(conn, "raddr", None)
            if not pid or not laddr or not raddr:
                continue
            if not hasattr(laddr, "ip") or not hasattr(raddr, "ip"):
                continue
            endpoints[(laddr.ip, int(laddr.port), raddr.ip, int(raddr.port))] = int(pid)

        peers = {}
        for (lip, lport, rip, rport), pid in endpoints.items():
            other = endpoints.get((rip, rport, lip, lport))
            if other and other != pid:
                peers[(lip, lport, rip, rport)] = (other, names.get(other))
        return peers
    except (psutil.Error, OSError, AttributeError, TypeError, ValueError, IndexError):
        return {}


def _annotate_connection_peers(connections):
    peers = _tcp_peer_index()
    if not peers:
        return connections
    for row in connections:
        ends = _split_ip_port(row.get("local_address"))
        remote = _split_ip_port(row.get("remote_address"))
        if not ends or not remote:
            continue
        hit = peers.get((ends[0], ends[1], remote[0], remote[1]))
        if not hit:
            continue
        row["peer_pid"] = hit[0]
        row["peer_name"] = hit[1]
    return connections


def _hex_ipv4(hex_ip):
    chunks = [hex_ip[i : i + 2] for i in range(0, 8, 2)]
    chunks.reverse()
    return ".".join(str(int(part, 16)) for part in chunks)


def _connections_from_procnet(pid):
    """When ptrace is refused, pair this process's socket inodes with /proc/net."""
    try:
        fd_dir = f"/proc/{pid}/fd"
        inodes = {}
        for fd_num in os.listdir(fd_dir):
            if not fd_num.isdigit():
                continue
            try:
                target = os.readlink(f"{fd_dir}/{fd_num}")
            except (OSError, PermissionError):
                continue
            if target.startswith("socket:[") and target.endswith("]"):
                try:
                    inodes[int(target[8:-1])] = int(fd_num)
                except ValueError:
                    continue
        if not inodes:
            return []

        rows = []
        tables = (
            ("/proc/net/tcp", "tcp", False),
            ("/proc/net/tcp6", "tcp6", True),
            ("/proc/net/udp", "udp", False),
            ("/proc/net/udp6", "udp6", True),
        )
        for path, family, ipv6 in tables:
            try:
                handle = open(path, "r", encoding="utf-8", errors="replace")
            except (OSError, PermissionError):
                continue
            with handle:
                for line in handle:
                    parts = line.split()
                    if len(parts) < 10 or parts[0] == "sl":
                        continue
                    try:
                        inode = int(parts[9])
                    except ValueError:
                        continue
                    fd = inodes.get(inode)
                    if fd is None:
                        continue
                    try:
                        local_hex, remote_hex = parts[1], parts[2]
                        if ipv6:
                            local_address = local_hex
                            remote_address = None if remote_hex.endswith(":0000") else remote_hex
                        else:
                            lip, lport = local_hex.split(":")
                            rip, rport = remote_hex.split(":")
                            local_address = f"{_hex_ipv4(lip)}:{int(lport, 16)}"
                            remote_address = None if rip == "00000000" else f"{_hex_ipv4(rip)}:{int(rport, 16)}"
                    except (ValueError, IndexError):
                        continue
                    rows.append(
                        {
                            "fd": fd,
                            "family": family,
                            "type": family,
                            "local_address": local_address,
                            "remote_address": remote_address,
                            "status": _TCP_STATES.get(parts[3].upper(), parts[3]),
                            "peer_pid": None,
                            "peer_name": None,
                        }
                    )
        return rows
    except (OSError, PermissionError, ValueError, IndexError, TypeError):
        return []


def _collect_process_connections(pid, proc):
    connections = []
    try:
        for conn in proc.connections():
            connections.append(
                {
                    "fd": conn.fd if hasattr(conn, "fd") else None,
                    "family": _family_label(getattr(conn, "family", None), getattr(conn, "type", None)),
                    "type": str(getattr(conn, "type", "") or ""),
                    "local_address": _format_addr(getattr(conn, "laddr", None)),
                    "remote_address": _format_addr(getattr(conn, "raddr", None)),
                    "status": getattr(conn, "status", None),
                    "peer_pid": None,
                    "peer_name": None,
                }
            )
    except (psutil.AccessDenied, psutil.NoSuchProcess, AttributeError):
        connections = []
    if not connections:
        connections = _connections_from_procnet(pid)
    return _annotate_connection_peers(connections)[:20]


def get_process_fds_info(pid):
    try:
        proc = psutil.Process(pid)

        try:
            num_fds = proc.num_fds()
        except (psutil.AccessDenied, AttributeError):
            try:
                fd_dir = f"/proc/{pid}/fd"
                if os.path.exists(fd_dir):
                    num_fds = len([f for f in os.listdir(fd_dir) if f.isdigit()])
                else:
                    num_fds = 0
            except Exception:
                num_fds = 0

        open_files = []
        try:
            for fd in proc.open_files():
                open_files.append({"path": fd.path, "fd": fd.fd if hasattr(fd, "fd") else None})
        except (psutil.AccessDenied, psutil.NoSuchProcess, AttributeError):
            try:
                fd_dir = f"/proc/{pid}/fd"
                if os.path.exists(fd_dir):
                    for fd_num in os.listdir(fd_dir):
                        if fd_num.isdigit():
                            try:
                                fd_path = os.readlink(f"{fd_dir}/{fd_num}")
                                ip_pattern = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}")
                                if (
                                    fd_path.startswith("/")
                                    and not fd_path.startswith("socket:")
                                    and not fd_path.startswith("pipe:")
                                    and not fd_path.startswith("anon_inode:")
                                    and not ip_pattern.match(fd_path)
                                ):
                                    open_files.append({"path": fd_path, "fd": int(fd_num)})
                            except (OSError, ValueError):
                                pass
            except (OSError, PermissionError):
                pass

        connections = _collect_process_connections(pid, proc)

        descriptors = []
        fd_dir = f"/proc/{pid}/fd"
        try:
            if os.path.exists(fd_dir):
                for fd_num in sorted((fd for fd in os.listdir(fd_dir) if fd.isdigit()), key=lambda value: int(value)):
                    try:
                        target = os.readlink(f"{fd_dir}/{fd_num}")
                    except (OSError, PermissionError):
                        continue

                    fd_index = int(fd_num)
                    if fd_index == 0:
                        fd_type = "stdin"
                    elif fd_index == 1:
                        fd_type = "stdout"
                    elif fd_index == 2:
                        fd_type = "stderr"
                    elif target.startswith("socket:"):
                        fd_type = "socket"
                    elif target.startswith("pipe:"):
                        fd_type = "pipe"
                    elif target.startswith("anon_inode:"):
                        fd_type = "anon_inode"
                    elif target.startswith("/"):
                        fd_type = "file"
                    else:
                        fd_type = "descriptor"

                    descriptors.append({"fd": fd_index, "type": fd_type, "target": target})
        except (OSError, PermissionError):
            pass

        connection_by_fd = {item.get("fd"): item for item in connections if item.get("fd") is not None}
        for descriptor in descriptors:
            conn = connection_by_fd.get(descriptor["fd"])
            if not conn:
                continue
            family = str(conn.get("family") or "").lower()
            if family == "unix":
                descriptor["type"] = "unix socket"
            elif family.startswith("tcp"):
                descriptor["type"] = "tcp socket" if conn.get("remote_address") else "inet socket"
            elif family.startswith("udp"):
                descriptor["type"] = "udp socket"
            descriptor["local_address"] = conn.get("local_address")
            descriptor["remote_address"] = conn.get("remote_address")
            descriptor["status"] = conn.get("status")

        return {
            "pid": pid,
            "num_fds": num_fds,
            "open_files": open_files[:20],
            "connections": connections[:20],
            "descriptors": descriptors[:40],
            "namespace_fingerprint": get_process_namespace_fingerprint(pid),
        }
    except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
        return {"error": f"Access denied or process not found: {str(e)}"}
    except Exception as e:
        capture_exception(e, where="services.process_inspect.get_process_fds_info")
        return {"error": f"Error getting FDs: {str(e)}"}
