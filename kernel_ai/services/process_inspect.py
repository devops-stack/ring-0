"""Process inspection and IPC graph services."""

from __future__ import annotations

import os
import re

import psutil

from kernel_ai.services import system_view as _system_view_service


def get_ipc_links_summary(max_pairs=120, max_nodes=24):
    """Collect IPC relationships by shared sockets, pipes and shared memory mappings."""
    socket_inode_re = re.compile(r"^socket:\[(\d+)\]$")
    pipe_inode_re = re.compile(r"^pipe:\[(\d+)\]$")
    socket_owners = {}
    pipe_owners = {}
    shm_owners = {}
    namespace_keys = ["mnt", "pid", "net", "ipc", "uts", "user"]
    namespace_owners = {}

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

                    shm_key = f"{dev}:{inode}:{map_path}"
                    shm_owners.setdefault(shm_key, set()).add((pid, proc_name))
        except (OSError, PermissionError):
            continue

        for ns_name in namespace_keys:
            ns_inode = _system_view_service._read_namespace_inode(pid, ns_name)
            if not ns_inode:
                continue
            ns_key = f"{ns_name}:{ns_inode}"
            namespace_owners.setdefault(ns_key, set()).add((pid, proc_name))

    pair_totals = {}
    pair_socket = {}
    pair_pipe = {}
    pair_shm = {}
    pair_namespace = {}
    degree_total = {}
    degree_socket = {}
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

    consume_inode_owners(socket_owners, "socket")
    consume_inode_owners(pipe_owners, "pipe")
    consume_inode_owners(shm_owners, "shm")
    consume_inode_owners(namespace_owners, "namespace")

    sorted_pairs = sorted(pair_totals.items(), key=lambda kv: kv[1], reverse=True)[:max_pairs]
    pair_links = []
    for (left, right), weight in sorted_pairs:
        pair_links.append(
            {
                "left": left,
                "right": right,
                "weight": int(weight),
                "socket_weight": int(pair_socket.get((left, right), pair_socket.get((right, left), 0))),
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
            "shared_pipe_inodes": int(sum(1 for owners in pipe_owners.values() if len({pid for pid, _ in owners}) > 1)),
            "shared_memory_regions": int(sum(1 for owners in shm_owners.values() if len({pid for pid, _ in owners}) > 1)),
            "shared_namespace_groups": int(sum(1 for owners in namespace_owners.values() if len({pid for pid, _ in owners}) > 1)),
            "pair_count": len(pair_links),
            "node_count": len(process_nodes),
        },
    }


def get_process_threads_info(pid):
    try:
        proc = psutil.Process(pid)
        threads = proc.threads()
        thread_count = proc.num_threads()

        try:
            with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="ignore") as f:
                status_data = {}
                for line in f:
                    if ":" in line:
                        key, value = line.split(":", 1)
                        status_data[key.strip()] = value.strip()
                voluntary_switches = int(status_data.get("voluntary_ctxt_switches", 0))
                nonvoluntary_switches = int(status_data.get("nonvoluntary_ctxt_switches", 0))
        except Exception:
            voluntary_switches = 0
            nonvoluntary_switches = 0

        return {
            "pid": pid,
            "thread_count": thread_count,
            "threads": [{"id": t.id, "user_time": t.user_time, "system_time": t.system_time} for t in threads],
            "voluntary_ctxt_switches": voluntary_switches,
            "nonvoluntary_ctxt_switches": nonvoluntary_switches,
        }
    except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}


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
        return {"error": str(e)}


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

        connections = []
        try:
            for conn in proc.connections():
                connections.append(
                    {
                        "fd": conn.fd if hasattr(conn, "fd") else None,
                        "family": str(conn.family),
                        "type": str(conn.type),
                        "local_address": f"{conn.laddr.ip}:{conn.laddr.port}" if conn.laddr else None,
                        "remote_address": f"{conn.raddr.ip}:{conn.raddr.port}" if conn.raddr else None,
                        "status": conn.status,
                    }
                )
        except (psutil.AccessDenied, psutil.NoSuchProcess, AttributeError):
            pass

        return {"pid": pid, "num_fds": num_fds, "open_files": open_files[:20], "connections": connections[:20]}
    except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
        return {"error": f"Access denied or process not found: {str(e)}"}
    except Exception as e:
        return {"error": f"Error getting FDs: {str(e)}"}
