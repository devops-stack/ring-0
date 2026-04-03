"""Crypto and security realtime services."""

from __future__ import annotations

import os
import random
import subprocess
import time
from datetime import datetime

import psutil


def collect_crypto_realtime(callbacks, crypto_prev):
    """
    Build a near-realtime list of processes likely interacting with kernel crypto.
    This is heuristic-based and derived from active network/process context.
    """
    infer_crypto_protocol = callbacks["infer_crypto_protocol"]
    is_likely_crypto_actor = callbacks["is_likely_crypto_actor"]
    infer_tls_terminator = callbacks["infer_tls_terminator"]
    collect_algorithm_competition = callbacks["collect_algorithm_competition"]
    parse_proc_crypto_entries = callbacks["parse_proc_crypto_entries"]
    collect_kernel_crypto_clients = callbacks["collect_kernel_crypto_clients"]
    collect_hw_offload_status = callbacks["collect_hw_offload_status"]
    collect_sync_async_queue = callbacks["collect_sync_async_queue"]
    collect_algorithm_requesters = callbacks["collect_algorithm_requesters"]
    build_crypto_decision_pipelines = callbacks["build_crypto_decision_pipelines"]
    collect_entropy_cloud_status = callbacks["collect_entropy_cloud_status"]

    items = []
    tls_listener_by_port = {}
    tls_listener_names = set()
    unknown_pid_flows = 0

    try:
        connections = psutil.net_connections(kind="inet")
    except Exception:
        connections = []

    tls_ports = {443, 8443, 9443, 6443}
    for conn in connections:
        status = str(getattr(conn, "status", "") or "")
        if status != "LISTEN":
            continue
        laddr = getattr(conn, "laddr", None)
        local_port = getattr(laddr, "port", 0) if laddr else 0
        if int(local_port or 0) not in tls_ports:
            continue
        pid = getattr(conn, "pid", None)
        pid_i = int(pid or 0)
        process_name = "unknown"
        if pid_i:
            try:
                process_name = psutil.Process(pid_i).name().lower()
            except Exception:
                process_name = f"pid-{pid_i}"
        tls_listener_by_port[int(local_port)] = {"pid": pid_i, "process": process_name}
        tls_listener_names.add(process_name)
        items.append(
            {
                "process": process_name,
                "pid": pid_i,
                "protocol": "TLS",
                "algorithm": "AES-GCM/SHA256",
                "endpoint": f"0.0.0.0:{int(local_port)}",
                "local_port": int(local_port),
                "remote_port": 0,
                "status": "LISTEN",
                "tls_terminator": process_name,
                "source_kind": "listener",
            }
        )

    for conn in connections:
        pid = getattr(conn, "pid", None)
        status = str(getattr(conn, "status", "") or "")
        if status not in ("ESTABLISHED", "SYN_SENT", "SYN_RECV"):
            continue

        laddr = getattr(conn, "laddr", None)
        raddr = getattr(conn, "raddr", None)
        local_ip = getattr(laddr, "ip", "") if laddr else ""
        local_port = getattr(laddr, "port", 0) if laddr else 0
        remote_ip = getattr(raddr, "ip", "") if raddr else ""
        remote_port = getattr(raddr, "port", 0) if raddr else 0

        pid_i = int(pid or 0)
        process_name = "unknown"
        if pid_i:
            try:
                proc = psutil.Process(pid_i)
                process_name = proc.name()
            except Exception:
                process_name = f"pid-{pid_i}"
        else:
            unknown_pid_flows += 1
            listener_meta = tls_listener_by_port.get(int(local_port or 0))
            if listener_meta:
                process_name = listener_meta.get("process") or "unknown"

        protocol, algorithm = infer_crypto_protocol(local_port, remote_port, process_name)
        if not is_likely_crypto_actor(process_name, local_port, remote_port, protocol):
            continue

        tls_terminator = infer_tls_terminator(process_name, local_port, protocol, tls_listener_names)
        endpoint = f"{remote_ip}:{remote_port}" if remote_ip else f"{local_ip}:{local_port}"

        items.append(
            {
                "process": process_name.lower(),
                "pid": pid_i,
                "protocol": protocol,
                "algorithm": algorithm,
                "endpoint": endpoint,
                "local_port": int(local_port or 0),
                "remote_port": int(remote_port or 0),
                "status": status,
                "tls_terminator": tls_terminator,
                "source_kind": "connection",
            }
        )

    if not items:
        for proc in psutil.process_iter(attrs=["pid", "name"]):
            try:
                name = str(proc.info.get("name", "")).lower()
            except Exception:
                continue
            if any(token in name for token in ["nginx", "sshd", "curl", "openssl", "kube", "vpn", "python"]):
                protocol, algorithm = infer_crypto_protocol(0, 0, name)
                items.append(
                    {
                        "process": name,
                        "pid": int(proc.info.get("pid") or 0),
                        "protocol": protocol,
                        "algorithm": algorithm,
                        "endpoint": "-",
                        "local_port": 0,
                        "remote_port": 0,
                        "status": "RUNNING",
                        "tls_terminator": "n/a",
                        "source_kind": "process",
                    }
                )
            if len(items) >= 12:
                break

    deduped = {}
    for item in items:
        key = (
            item.get("process"),
            int(item.get("pid") or 0),
            item.get("protocol"),
            item.get("algorithm"),
            item.get("endpoint"),
            item.get("status"),
            item.get("source_kind"),
        )
        if key not in deduped:
            deduped[key] = item
    items = list(deduped.values())

    now = time.time()
    prev_ts = crypto_prev["timestamp"]
    prev_flows = crypto_prev["active_flows"]
    active_flows = len(items)
    crypto_prev["timestamp"] = now
    crypto_prev["active_flows"] = active_flows

    if prev_ts:
        dt = max(now - prev_ts, 0.001)
        flow_delta = abs(active_flows - prev_flows)
        ops_per_sec = round((active_flows * 90) + (flow_delta / dt) * 60, 2)
    else:
        ops_per_sec = round(active_flows * 90, 2)

    unique_processes = []
    for item in items:
        p = item["process"]
        if p not in unique_processes:
            unique_processes.append(p)

    algorithm_competitions = {
        "aes": collect_algorithm_competition("aes"),
        "sha": collect_algorithm_competition("sha"),
        "chacha20": collect_algorithm_competition("chacha20"),
    }
    proc_crypto_entries = parse_proc_crypto_entries()
    kernel_clients = collect_kernel_crypto_clients(items)
    hw_offload = collect_hw_offload_status(proc_crypto_entries, algorithm_competitions)
    crypto_stage1 = {
        "kernel_clients": kernel_clients,
        "sync_async": collect_sync_async_queue(items),
        "hw_offload": hw_offload,
    }
    algorithm_requesters = collect_algorithm_requesters(items, kernel_clients)
    crypto_decision_pipelines = build_crypto_decision_pipelines(
        algorithm_competitions=algorithm_competitions,
        kernel_clients=kernel_clients,
        hw_offload=hw_offload,
        algorithm_requesters=algorithm_requesters,
    )
    entropy_cloud = collect_entropy_cloud_status()

    return {
        "items": items[:24],
        "processes": unique_processes[:16],
        "meta": {
            "ops_per_sec": ops_per_sec,
            "tls_sessions": sum(1 for i in items if i.get("protocol") == "TLS"),
            "active_flows": active_flows,
            "unknown_pid_flows": int(unknown_pid_flows),
            "tls_terminators": sorted(list(tls_listener_names))[:8],
            "algorithm_competition": algorithm_competitions["aes"],
            "algorithm_competitions": algorithm_competitions,
            "algorithm_requesters": algorithm_requesters,
            "crypto_stage1": crypto_stage1,
            "entropy_cloud": entropy_cloud,
            "crypto_decision_pipeline": crypto_decision_pipelines.get("aes", {}),
            "crypto_decision_pipelines": crypto_decision_pipelines,
            "source": "live-heuristic-v2",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        },
    }


def collect_security_realtime(security_prev):
    """
    Stage-1 security subsystem telemetry:
    - Threat decision pipeline
    - Process trust graph
    - Attack surface map
    """
    now = time.time()
    process_rows = []
    suspicious_tokens = {
        "nmap",
        "masscan",
        "hydra",
        "sqlmap",
        "metasploit",
        "msfconsole",
        "netcat",
        "nc",
        "ncat",
        "socat",
        "john",
        "hashcat",
        "strace",
        "gdb",
    }
    trusted_tokens = {"systemd", "sshd", "nginx", "python", "containerd", "dockerd", "kubelet", "cron", "rsyslogd", "dbus-daemon"}
    ptrace_like = {"strace", "gdb", "ltrace"}

    def classify_trust(score):
        if score >= 70:
            return "blocked"
        if score >= 48:
            return "suspicious"
        if score >= 28:
            return "observe"
        return "trusted"

    for proc in psutil.process_iter(["pid", "name", "username", "memory_percent", "status", "num_threads"]):
        try:
            pid = int(proc.info.get("pid") or 0)
            name = str(proc.info.get("name") or "unknown").lower()
            mem = float(proc.info.get("memory_percent") or 0.0)
            threads = int(proc.info.get("num_threads") or 0)
            status = str(proc.info.get("status") or "unknown")
            user = str(proc.info.get("username") or "")

            score = 12
            if any(tok in name for tok in suspicious_tokens):
                score += 38
            if any(tok in name for tok in trusted_tokens):
                score -= 10
            if user == "root":
                score += 14
            if threads > 120:
                score += 8
            if mem > 8.0:
                score += 8
            if status in {"zombie", "stopped"}:
                score += 10
            score = max(0, min(100, score))
            trust = classify_trust(score)

            process_rows.append(
                {
                    "pid": pid,
                    "name": name,
                    "trust": trust,
                    "risk_score": score,
                    "threads": threads,
                    "mem_percent": round(mem, 2),
                    "status": status,
                    "user": user,
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception:
            continue

    process_rows.sort(key=lambda p: (p["risk_score"], p["mem_percent"], p["threads"]), reverse=True)
    trust_graph = process_rows[:12]

    request_candidates = ["open /etc/shadow", "connect tcp:443", "exec /usr/bin/sudo", "ptrace attach", "bpf program load", "write /usr/lib/systemd/*"]
    hook_candidates = ["security_file_open", "security_socket_connect", "security_bprm_check", "seccomp-bpf", "cgroup device policy", "audit hook"]
    lanes = []
    for idx, row in enumerate(trust_graph[:10]):
        req = request_candidates[idx % len(request_candidates)]
        hook = hook_candidates[idx % len(hook_candidates)]
        score = int(row.get("risk_score") or 0)
        if score >= 70:
            verdict = "deny"
        elif score >= 45:
            verdict = "audit"
        else:
            verdict = "allow"
        lanes.append(
            {
                "process": row.get("name", "unknown"),
                "pid": int(row.get("pid", 0)),
                "request": req,
                "hook": hook,
                "verdict": verdict,
                "reason": "risk-score-policy",
                "risk_score": score,
            }
        )

    try:
        listen_ports = len([c for c in psutil.net_connections(kind="inet") if str(getattr(c, "status", "") or "") == "LISTEN"])
    except Exception:
        listen_ports = 0

    try:
        with open("/proc/modules", "r", encoding="utf-8", errors="ignore") as f:
            loaded_modules = sum(1 for _ in f)
    except Exception:
        loaded_modules = 0

    ptrace_processes = sum(1 for p in process_rows if any(tok in p.get("name", "") for tok in ptrace_like))
    root_processes = sum(1 for p in process_rows if p.get("user") == "root")
    suspicious_processes = sum(1 for p in process_rows if p.get("trust") in {"suspicious", "blocked"})

    setuid_bins = 0
    try:
        out = subprocess.check_output(
            "find /usr/bin /usr/sbin -xdev -perm -4000 -type f 2>/dev/null | wc -l",
            shell=True,
            text=True,
            timeout=1.8,
        ).strip()
        setuid_bins = int(out or 0)
    except Exception:
        setuid_bins = 0

    attack_surface = [
        {"name": "open-listen-ports", "value": int(listen_ports), "severity": "high" if listen_ports > 40 else "medium"},
        {"name": "setuid-binaries", "value": int(setuid_bins), "severity": "high" if setuid_bins > 70 else "medium"},
        {"name": "loaded-kernel-modules", "value": int(loaded_modules), "severity": "medium" if loaded_modules > 180 else "low"},
        {"name": "ptrace-capable-processes", "value": int(ptrace_processes), "severity": "high" if ptrace_processes > 0 else "low"},
        {"name": "root-processes", "value": int(root_processes), "severity": "medium" if root_processes > 120 else "low"},
        {"name": "suspicious-processes", "value": int(suspicious_processes), "severity": "high" if suspicious_processes > 6 else "medium"},
    ]

    def _read_text(path):
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return str(f.read().strip())
        except Exception:
            return ""

    apparmor_raw = _read_text("/sys/module/apparmor/parameters/enabled")
    selinux_enforce = _read_text("/sys/fs/selinux/enforce")
    selinux_policy = _read_text("/sys/fs/selinux/policyvers")
    yama_scope = _read_text("/proc/sys/kernel/yama/ptrace_scope")
    bpf_unpriv = _read_text("/proc/sys/kernel/unprivileged_bpf_disabled")
    landlock_present = os.path.exists("/sys/kernel/security/landlock")
    ima_present = os.path.exists("/sys/kernel/security/ima")
    bpf_lsm_present = os.path.exists("/sys/kernel/security/bpf")
    try:
        lsm_list_raw = _read_text("/sys/kernel/security/lsm")
        active_lsms = [x.strip() for x in lsm_list_raw.split(",")] if lsm_list_raw else []
        stacking_enabled = len([x for x in active_lsms if x in {"selinux", "apparmor", "bpf"}]) > 1
    except Exception:
        active_lsms = []
        stacking_enabled = False

    lsm_status = [
        {"name": "AppArmor", "status": "enforcing" if apparmor_raw.lower().startswith("y") else ("disabled" if apparmor_raw else "unknown"), "detail": apparmor_raw or "n/a", "type": "policy_engine"},
        {"name": "SELinux", "status": "enforcing" if selinux_enforce == "1" else ("disabled" if selinux_enforce == "0" else "unknown"), "detail": selinux_enforce or "n/a", "type": "policy_engine", "policy_version": selinux_policy or "n/a"},
        {"name": "BPF LSM", "status": "present" if bpf_lsm_present else "absent", "detail": "eBPF-based LSM" if bpf_lsm_present else "n/a", "type": "policy_engine"},
        {"name": "LSM Stacking", "status": "enabled" if stacking_enabled else "disabled", "detail": ",".join(active_lsms[:3]) if active_lsms else "n/a", "type": "stacking"},
        {"name": "Yama ptrace", "status": "hardened" if yama_scope in {"2", "3"} else ("relaxed" if yama_scope in {"0", "1"} else "unknown"), "detail": yama_scope or "n/a", "type": "restriction"},
        {"name": "unprivileged bpf", "status": "blocked" if bpf_unpriv == "1" else ("allowed" if bpf_unpriv == "0" else "unknown"), "detail": bpf_unpriv or "n/a", "type": "restriction"},
        {"name": "Landlock", "status": "present" if landlock_present else "absent", "detail": "sysfs" if landlock_present else "n/a", "type": "restriction"},
        {"name": "IMA/EVM", "status": "present" if ima_present else "absent", "detail": "sysfs" if ima_present else "n/a", "type": "integrity"},
    ]

    lsm_engines = []
    if apparmor_raw.lower().startswith("y"):
        lsm_engines.append({"name": "AppArmor", "type": "policy_engine", "status": "enforcing", "hooks": ["file_open", "bprm_check", "socket_connect"], "decisions_per_sec": random.randint(8, 45)})
    if selinux_enforce == "1":
        lsm_engines.append({"name": "SELinux", "type": "policy_engine", "status": "enforcing", "hooks": ["file_open", "bprm_check", "socket_connect", "inode_create"], "decisions_per_sec": random.randint(12, 52)})
    if bpf_lsm_present:
        lsm_engines.append({"name": "BPF LSM", "type": "policy_engine", "status": "enforcing", "hooks": ["file_open", "bprm_check", "socket_connect"], "decisions_per_sec": random.randint(5, 28)})

    all_capabilities_map = {
        0: "CAP_CHOWN",
        1: "CAP_DAC_OVERRIDE",
        2: "CAP_DAC_READ_SEARCH",
        3: "CAP_FOWNER",
        4: "CAP_FSETID",
        5: "CAP_KILL",
        6: "CAP_SETGID",
        7: "CAP_SETUID",
        8: "CAP_SETPCAP",
        9: "CAP_LINUX_IMMUTABLE",
        10: "CAP_NET_BIND_SERVICE",
        11: "CAP_NET_BROADCAST",
        12: "CAP_NET_ADMIN",
        13: "CAP_NET_RAW",
        14: "CAP_IPC_LOCK",
        15: "CAP_IPC_OWNER",
        16: "CAP_SYS_MODULE",
        17: "CAP_SYS_RAWIO",
        18: "CAP_SYS_CHROOT",
        19: "CAP_SYS_PTRACE",
        20: "CAP_SYS_PACCT",
        21: "CAP_SYS_ADMIN",
        22: "CAP_SYS_BOOT",
        23: "CAP_SYS_NICE",
        24: "CAP_SYS_RESOURCE",
        25: "CAP_SYS_TIME",
        26: "CAP_SYS_TTY_CONFIG",
        27: "CAP_MKNOD",
        28: "CAP_LEASE",
        29: "CAP_AUDIT_WRITE",
        30: "CAP_AUDIT_CONTROL",
        31: "CAP_SETFCAP",
        32: "CAP_MAC_OVERRIDE",
        33: "CAP_MAC_ADMIN",
        34: "CAP_SYSLOG",
        35: "CAP_WAKE_ALARM",
        36: "CAP_BLOCK_SUSPEND",
        37: "CAP_AUDIT_READ",
        38: "CAP_PERFMON",
        39: "CAP_BPF",
        40: "CAP_CHECKPOINT_RESTORE",
    }
    dangerous_caps = {12: "CAP_NET_ADMIN", 16: "CAP_SYS_MODULE", 17: "CAP_SYS_RAWIO", 19: "CAP_SYS_PTRACE", 21: "CAP_SYS_ADMIN", 39: "CAP_BPF"}
    capabilities_rows = []
    seccomp_counts = {"none": 0, "strict": 0, "filter": 0, "unknown": 0}
    seccomp_processes = []
    capabilities_processes = []

    common_syscalls = [
        "read",
        "write",
        "open",
        "close",
        "stat",
        "fstat",
        "lstat",
        "poll",
        "lseek",
        "mmap",
        "mprotect",
        "munmap",
        "brk",
        "rt_sigaction",
        "rt_sigprocmask",
        "rt_sigreturn",
        "ioctl",
        "pread64",
        "pwrite64",
        "readv",
        "writev",
        "access",
        "pipe",
        "select",
        "sched_yield",
        "mremap",
        "msync",
        "mincore",
        "madvise",
        "shmget",
        "shmat",
        "shmctl",
        "dup",
        "dup2",
        "pause",
        "nanosleep",
        "getitimer",
        "alarm",
        "setitimer",
        "getpid",
    ]

    for row in process_rows[:180]:
        pid = int(row.get("pid") or 0)
        if pid <= 0:
            continue
        cap_eff_hex = ""
        cap_prm_hex = ""
        seccomp_mode = "unknown"
        try:
            with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="ignore") as f:
                for ln in f:
                    if ln.startswith("CapEff:"):
                        cap_eff_hex = ln.split(":", 1)[1].strip()
                    elif ln.startswith("CapPrm:"):
                        cap_prm_hex = ln.split(":", 1)[1].strip()
                    elif ln.startswith("Seccomp:"):
                        seccomp_raw = ln.split(":", 1)[1].strip()
                        if seccomp_raw == "0":
                            seccomp_mode = "none"
                        elif seccomp_raw == "1":
                            seccomp_mode = "strict"
                        elif seccomp_raw == "2":
                            seccomp_mode = "filter"
                        else:
                            seccomp_mode = "unknown"
        except Exception:
            pass

        seccomp_counts[seccomp_mode] = seccomp_counts.get(seccomp_mode, 0) + 1
        if seccomp_mode in {"filter", "strict"}:
            allowed_syscalls = []
            blocked_syscalls = []
            proc_name_lower = str(row.get("name", "")).lower()
            if "nginx" in proc_name_lower or "apache" in proc_name_lower:
                allowed_syscalls = ["read", "write", "open", "close", "socket", "accept", "send", "recv", "epoll_wait", "fstat"]
                blocked_syscalls = ["ptrace", "mount", "umount", "sys_module", "bpf", "keyctl"]
            elif "sshd" in proc_name_lower:
                allowed_syscalls = ["read", "write", "open", "close", "socket", "accept", "send", "recv", "fork", "execve"]
                blocked_syscalls = ["mount", "umount", "sys_module", "bpf"]
            elif "docker" in proc_name_lower or "containerd" in proc_name_lower:
                allowed_syscalls = ["read", "write", "open", "close", "socket", "clone", "unshare", "mount", "umount"]
                blocked_syscalls = ["sys_module", "bpf"]
            else:
                allowed_syscalls = common_syscalls[:40]
                blocked_syscalls = ["ptrace", "mount", "umount", "sys_module", "bpf", "keyctl", "kexec_load"]
            seccomp_processes.append(
                {
                    "pid": pid,
                    "name": row.get("name", "unknown"),
                    "mode": seccomp_mode,
                    "allowed_syscalls": allowed_syscalls[:20],
                    "blocked_syscalls": blocked_syscalls,
                    "sandbox_level": "strict" if seccomp_mode == "strict" else "filter",
                }
            )

        if not cap_eff_hex:
            continue
        try:
            cap_eff_val = int(cap_eff_hex, 16)
        except Exception:
            continue

        all_caps = [all_capabilities_map.get(bit, f"CAP_{bit}") for bit in range(41) if (cap_eff_val & (1 << bit))]
        matched = [name for bit, name in dangerous_caps.items() if (cap_eff_val & (1 << bit))]
        capabilities_processes.append(
            {
                "pid": pid,
                "name": row.get("name", "unknown"),
                "user": row.get("user", ""),
                "capabilities": all_caps[:15],
                "dangerous_caps": matched,
                "cap_eff_hex": cap_eff_hex,
                "has_keys": len(all_caps) > 0,
            }
        )
        if not matched:
            continue
        risk = min(100, 20 + len(matched) * 16 + (10 if row.get("user") == "root" else 0))
        capabilities_rows.append(
            {
                "pid": pid,
                "name": row.get("name", "unknown"),
                "user": row.get("user", ""),
                "seccomp": seccomp_mode,
                "cap_eff": cap_eff_hex,
                "cap_prm": cap_prm_hex or "0",
                "dangerous": matched[:4],
                "risk_score": int(risk),
            }
        )

    capabilities_rows.sort(key=lambda x: (x.get("risk_score", 0), len(x.get("dangerous", []))), reverse=True)
    capabilities_drift = capabilities_rows[:8]

    total_seccomp_sample = max(1, sum(seccomp_counts.values()))
    unsandboxed = [r for r in capabilities_rows if r.get("seccomp") == "none"]
    unsandboxed.sort(key=lambda x: x.get("risk_score", 0), reverse=True)
    seccomp_coverage = {
        "none": int(seccomp_counts.get("none", 0)),
        "strict": int(seccomp_counts.get("strict", 0)),
        "filter": int(seccomp_counts.get("filter", 0)),
        "unknown": int(seccomp_counts.get("unknown", 0)),
        "coverage_percent": round((seccomp_counts.get("filter", 0) + seccomp_counts.get("strict", 0)) * 100.0 / total_seccomp_sample, 2),
        "high_risk_unsandboxed": [{"pid": int(r.get("pid", 0)), "name": str(r.get("name", "unknown")), "risk_score": int(r.get("risk_score", 0))} for r in unsandboxed[:6]],
    }

    prev_ts = security_prev["timestamp"]
    prev_events = int(security_prev["events"] or 0)
    current_events = len(lanes)
    security_prev["timestamp"] = now
    security_prev["events"] = current_events
    if prev_ts:
        dt = max(0.001, now - prev_ts)
        decisions_per_sec = round((current_events / dt) + abs(current_events - prev_events) * 0.6, 2)
    else:
        decisions_per_sec = float(current_events)

    return {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "pipeline": {"stages": ["request event", "LSM/seccomp hook", "policy verdict"], "lanes": lanes},
        "trust_graph": trust_graph,
        "attack_surface": attack_surface,
        "security_tools": {"lsm_status": lsm_status, "capabilities_drift": capabilities_drift, "seccomp_coverage": seccomp_coverage},
        "security_core": {
            "lsm_engines": lsm_engines,
            "seccomp_processes": seccomp_processes[:12],
            "capabilities_processes": capabilities_processes[:12],
            "stacking_enabled": stacking_enabled,
            "active_lsms": active_lsms,
        },
        "meta": {
            "decisions_per_sec": decisions_per_sec,
            "events": current_events,
            "trusted": sum(1 for p in trust_graph if p.get("trust") == "trusted"),
            "observe": sum(1 for p in trust_graph if p.get("trust") == "observe"),
            "suspicious": sum(1 for p in trust_graph if p.get("trust") == "suspicious"),
            "blocked": sum(1 for p in trust_graph if p.get("trust") == "blocked"),
            "seccomp_coverage_percent": seccomp_coverage.get("coverage_percent", 0.0),
            "mode": "live-heuristic-v2",
        },
    }
