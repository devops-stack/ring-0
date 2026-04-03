#!/usr/bin/env python3
"""
Linux Kernel Visualization Backend
Organized version with proper project structure
"""

import os
import json
import time
import random
import subprocess
import re
import shutil
from datetime import datetime
from flask import Flask, jsonify, render_template, send_from_directory, request, redirect
import psutil

from kernel_ai.config import Config, PROJECT_ROOT
from kernel_ai.hooks import register_hooks
from kernel_ai.http.register import register_http_routes
from kernel_ai.prometheus_setup import init_prometheus
from kernel_ai.collectors import proc_fs as _proc_fs
from kernel_ai.services import execution as _execution_service
from kernel_ai.services import network as _network_service
from kernel_ai.services import crypto_security as _crypto_security_service
from kernel_ai.services import core_observability as _core_observability_service
from kernel_ai.services import process_inspect as _process_inspect_service
from kernel_ai.services import processes as _processes_service
from kernel_ai.services import syscalls as _syscalls_service
from kernel_ai.services import system_view as _system_view_service
from kernel_ai.state import (
    CRYPTO_PREV,
    DEVICES_PREV,
    ENTROPY_PREV,
    EXEC_CONTEXT_PREV,
    FRONTEND_LOG_FILE,
    FRONTEND_LOG_WRITE_LOCK,
    SECURITY_PREV,
)

# Use ``_proc_fs.*`` directly so tests can monkeypatch ``kernel_ai.collectors.proc_fs``.

# Gunicorn -w N: set PROMETHEUS_MULTIPROC_DIR before workers import this module (e.g. in gunicorn.conf.py).
if os.environ.get("PROMETHEUS_MULTIPROC_DIR", "").strip():
    _prom_mpdir = os.environ["PROMETHEUS_MULTIPROC_DIR"].strip()
    os.makedirs(_prom_mpdir, exist_ok=True)

# Try to import OpenAI (optional)
try:
    import openai
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
app = Flask(
    __name__,
    static_folder=os.path.join(_ROOT, "static"),
    template_folder=os.path.join(_ROOT, "templates"),
)
app.config.from_object(Config)
init_prometheus(app)
register_hooks(app)


def safe_trim(value, limit=2048):
    """Trim large strings to keep log payload size bounded."""
    if value is None:
        return ""
    text = str(value)
    if len(text) <= limit:
        return text
    return text[:limit] + "...[truncated]"

def write_frontend_event(event_payload):
    """Write one frontend event as JSON line for Elastic Agent tail input."""
    event = {
        "@timestamp": datetime.utcnow().isoformat() + "Z",
        "service.name": "kernel-ai-frontend",
        "event.dataset": "kernel_ai.frontend",
        "event.kind": "event",
        "log.level": safe_trim(event_payload.get("level", "info"), 16).lower(),
        "message": safe_trim(event_payload.get("message", "")),
        "url.path": safe_trim(event_payload.get("path", ""), 512),
        "url.full": safe_trim(event_payload.get("url", ""), 2048),
        "user_agent.original": safe_trim(event_payload.get("userAgent", ""), 1024),
        "session.id": safe_trim(event_payload.get("sessionId", ""), 128),
        "error.stack_trace": safe_trim(event_payload.get("stack", ""), 12000),
        "event.module": safe_trim(event_payload.get("module", "frontend"), 128),
        "tags": event_payload.get("tags", []),
        "meta": event_payload.get("meta", {})
    }
    os.makedirs(os.path.dirname(FRONTEND_LOG_FILE), exist_ok=True)
    line = json.dumps(event, ensure_ascii=False)
    with FRONTEND_LOG_WRITE_LOCK:
        with open(FRONTEND_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")

def resolve_binary(cmd_name):
    """Resolve executable path even when service PATH misses sbin directories."""
    found = shutil.which(cmd_name)
    if found:
        return found
    for base in ("/usr/sbin", "/usr/bin", "/sbin", "/bin"):
        candidate = os.path.join(base, cmd_name)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return None


def get_system_info():
    """Get system information."""
    return _core_observability_service.get_system_info()

# System call number to name mapping (common Linux syscalls)
SYSCALL_NAMES = {
    0: 'read', 1: 'write', 2: 'open', 3: 'close', 4: 'stat', 5: 'fstat',
    6: 'lstat', 7: 'poll', 8: 'lseek', 9: 'mmap', 10: 'mprotect',
    11: 'munmap', 12: 'brk', 13: 'rt_sigaction', 14: 'rt_sigprocmask',
    15: 'rt_sigreturn', 16: 'ioctl', 17: 'pread64', 18: 'pwrite64',
    19: 'readv', 20: 'writev', 21: 'access', 22: 'pipe', 23: 'select',
    24: 'sched_yield', 25: 'mremap', 26: 'msync', 27: 'mincore',
    28: 'madvise', 29: 'shmget', 30: 'shmat', 31: 'shmctl', 32: 'dup',
    33: 'dup2', 34: 'pause', 35: 'nanosleep', 36: 'getitimer',
    37: 'alarm', 38: 'setitimer', 39: 'getpid', 40: 'sendfile',
    41: 'socket', 42: 'connect', 43: 'accept', 44: 'sendto', 45: 'recvfrom',
    46: 'sendmsg', 47: 'recvmsg', 48: 'shutdown', 49: 'bind', 50: 'listen',
    51: 'getsockname', 52: 'getpeername', 53: 'socketpair', 54: 'setsockopt',
    55: 'getsockopt', 56: 'clone', 57: 'fork', 58: 'vfork', 59: 'execve',
    60: 'exit', 61: 'wait4', 62: 'kill', 63: 'uname', 64: 'semget',
    65: 'semop', 66: 'semctl', 67: 'shmdt', 68: 'msgget', 69: 'msgsnd',
    70: 'msgrcv', 71: 'msgctl', 72: 'fcntl', 73: 'flock', 74: 'fsync',
    75: 'fdatasync', 76: 'truncate', 77: 'ftruncate', 78: 'getdents',
    79: 'getcwd', 80: 'chdir', 81: 'fchdir', 82: 'rename', 83: 'mkdir',
    84: 'rmdir', 85: 'creat', 86: 'link', 87: 'unlink', 88: 'symlink',
    89: 'readlink', 90: 'chmod', 91: 'fchmod', 92: 'chown', 93: 'fchown',
    94: 'lchown', 95: 'umask', 96: 'gettimeofday', 97: 'getrlimit',
    98: 'getrusage', 99: 'sysinfo', 100: 'times', 101: 'ptrace',
    102: 'getuid', 103: 'syslog', 104: 'getgid', 105: 'setuid', 106: 'setgid',
    107: 'geteuid', 108: 'getegid', 109: 'setpgid', 110: 'getppid',
    111: 'getpgrp', 112: 'setsid', 113: 'setreuid', 114: 'setregid',
    115: 'getgroups', 116: 'setgroups', 117: 'setresuid', 118: 'getresuid',
    119: 'setresgid', 120: 'getresgid', 121: 'getpgid', 122: 'setfsuid',
    123: 'setfsgid', 124: 'getsid', 125: 'capget', 126: 'capset',
    127: 'rt_sigpending', 128: 'rt_sigtimedwait', 129: 'rt_sigqueueinfo',
    130: 'rt_sigsuspend', 131: 'sigaltstack', 132: 'utime', 133: 'mknod',
    134: 'uselib', 135: 'personality', 136: 'ustat', 137: 'statfs',
    138: 'fstatfs', 139: 'sysfs', 140: 'getpriority', 141: 'setpriority',
    142: 'sched_setparam', 143: 'sched_getparam', 144: 'sched_setscheduler',
    145: 'sched_getscheduler', 146: 'sched_get_priority_max',
    147: 'sched_get_priority_min', 148: 'sched_rr_get_interval',
    149: 'mlock', 150: 'munlock', 151: 'mlockall', 152: 'munlockall',
    153: 'vhangup', 154: 'modify_ldt', 155: 'pivot_root', 156: 'prctl',
    157: 'arch_prctl', 158: 'adjtimex', 159: 'setrlimit', 160: 'chroot',
    161: 'sync', 162: 'acct', 163: 'settimeofday', 164: 'mount',
    165: 'umount2', 166: 'swapon', 167: 'swapoff', 168: 'reboot',
    169: 'sethostname', 170: 'setdomainname', 171: 'iopl', 172: 'ioperm',
    173: 'create_module', 174: 'init_module', 175: 'delete_module',
    176: 'get_kernel_syms', 177: 'query_module', 178: 'quotactl',
    179: 'nfsservctl', 180: 'getpmsg', 181: 'putpmsg', 182: 'afs_syscall',
    183: 'tuxcall', 184: 'security', 185: 'gettid', 186: 'readahead',
    187: 'setxattr', 188: 'lsetxattr', 189: 'fsetxattr', 190: 'getxattr',
    191: 'lgetxattr', 192: 'fgetxattr', 193: 'listxattr', 194: 'llistxattr',
    195: 'flistxattr', 196: 'removexattr', 197: 'lremovexattr',
    198: 'fremovexattr', 199: 'tkill', 200: 'time', 201: 'futex',
    202: 'sched_setaffinity', 203: 'sched_getaffinity', 204: 'set_thread_area',
    205: 'io_setup', 206: 'io_destroy', 207: 'io_getevents', 208: 'io_submit',
    209: 'io_cancel', 210: 'get_thread_area', 211: 'lookup_dcookie',
    212: 'epoll_create', 213: 'epoll_ctl_old', 214: 'epoll_wait_old',
    215: 'remap_file_pages', 216: 'getdents64', 217: 'set_tid_address',
    218: 'restart_syscall', 219: 'semtimedop', 220: 'fadvise64',
    221: 'timer_create', 222: 'timer_settime', 223: 'timer_gettime',
    224: 'timer_getoverrun', 225: 'timer_delete', 226: 'clock_settime',
    227: 'clock_gettime', 228: 'clock_getres', 229: 'clock_nanosleep',
    230: 'exit_group', 231: 'epoll_wait', 232: 'epoll_ctl', 233: 'tgkill',
    234: 'utimes', 235: 'vserver', 236: 'mbind', 237: 'set_mempolicy',
    238: 'get_mempolicy', 239: 'mq_open', 240: 'mq_unlink', 241: 'mq_timedsend',
    242: 'mq_timedreceive', 243: 'mq_notify', 244: 'mq_getsetattr',
    245: 'kexec_load', 246: 'waitid', 247: 'add_key', 248: 'request_key',
    249: 'keyctl', 250: 'ioprio_set', 251: 'ioprio_get', 252: 'inotify_init',
    253: 'inotify_add_watch', 254: 'inotify_rm_watch', 255: 'migrate_pages',
    256: 'openat', 257: 'mkdirat', 258: 'mknodat', 259: 'fchownat',
    260: 'futimesat', 261: 'newfstatat', 262: 'unlinkat', 263: 'renameat',
    264: 'linkat', 265: 'symlinkat', 266: 'readlinkat', 267: 'fchmodat',
    268: 'faccessat', 269: 'pselect6', 270: 'ppoll', 271: 'unshare',
    272: 'set_robust_list', 273: 'get_robust_list', 274: 'splice',
    275: 'tee', 276: 'sync_file_range', 277: 'vmsplice', 278: 'move_pages',
    279: 'utimensat', 280: 'epoll_pwait', 281: 'signalfd', 282: 'timerfd_create',
    283: 'eventfd', 284: 'fallocate', 285: 'timerfd_settime',
    286: 'timerfd_gettime', 287: 'accept4', 288: 'signalfd4', 289: 'eventfd2',
    290: 'epoll_create1', 291: 'dup3', 292: 'pipe2', 293: 'inotify_init1',
    294: 'preadv', 295: 'pwritev', 296: 'rt_tgsigqueueinfo', 297: 'perf_event_open',
    298: 'recvmmsg', 299: 'fanotify_init', 300: 'fanotify_mark',
    301: 'prlimit64', 302: 'name_to_handle_at', 303: 'open_by_handle_at',
    304: 'clock_adjtime', 305: 'syncfs', 306: 'sendmmsg', 307: 'setns',
    308: 'getcpu', 309: 'process_vm_readv', 310: 'process_vm_writev',
    311: 'kcmp', 312: 'finit_module', 313: 'sched_setattr', 314: 'sched_getattr',
    315: 'renameat2', 316: 'seccomp', 317: 'getrandom', 318: 'memfd_create',
    319: 'kexec_file_load', 320: 'bpf', 321: 'execveat', 322: 'userfaultfd',
    323: 'membarrier', 324: 'mlock2', 325: 'copy_file_range', 326: 'preadv2',
    327: 'pwritev2', 328: 'pkey_mprotect', 329: 'pkey_alloc', 330: 'pkey_free',
    331: 'statx', 332: 'io_pgetevents', 333: 'rseq', 334: 'pidfd_send_signal',
    335: 'io_uring_setup', 336: 'io_uring_enter', 337: 'io_uring_register',
    338: 'open_tree', 339: 'move_mount', 340: 'fsopen', 341: 'fsconfig',
    342: 'fsmount', 343: 'fspick', 344: 'pidfd_open', 345: 'clone3',
    346: 'close_range', 347: 'openat2', 348: 'pidfd_getfd', 349: 'faccessat2',
    350: 'process_madvise', 351: 'epoll_pwait2', 352: 'mount_setattr',
    353: 'quotactl_fd', 354: 'landlock_create_ruleset', 355: 'landlock_add_rule',
    356: 'landlock_restrict_self', 357: 'memfd_secret', 358: 'process_mrelease',
    359: 'futex_waitv', 360: 'set_mempolicy_home_node', 361: 'cachestat',
    362: 'fchmodat2', 363: 'map_shadow_stack', 364: 'futex_wake', 365: 'futex_wait',
    366: 'futex_requeue', 367: 'futex_wake_op', 368: 'futex_lock_pi',
    369: 'futex_unlock_pi', 370: 'futex_trylock_pi', 371: 'futex_wait_requeue_pi',
    372: 'futex_cmp_requeue_pi', 373: 'futex_wake_requeue_pi', 374: 'futex_waitv',
    375: 'futex_wake', 376: 'futex_wait', 377: 'futex_requeue', 378: 'futex_wake_op',
    379: 'futex_lock_pi', 380: 'futex_unlock_pi', 381: 'futex_trylock_pi',
    382: 'futex_wait_requeue_pi', 383: 'futex_cmp_requeue_pi', 384: 'futex_wake_requeue_pi',
    385: 'futex_waitv', 386: 'futex_wake', 387: 'futex_wait', 388: 'futex_requeue',
    389: 'futex_wake_op', 390: 'futex_lock_pi', 391: 'futex_unlock_pi',
    392: 'futex_trylock_pi', 393: 'futex_wait_requeue_pi', 394: 'futex_cmp_requeue_pi',
    395: 'futex_wake_requeue_pi'
}

# Max PIDs to scan for /proc/[pid]/syscall (tasks currently blocked in a syscall).
KERNEL_DNA_MAX_PROCS = int(os.environ.get('KERNEL_DNA_MAX_PROCS', '1200'))


def _kernel_dna_softirq_nucleotides(limit=8):
    """Per-vector softirq totals from /proc/softirqs."""
    out = []
    try:
        with open('/proc/softirqs', 'r', encoding='utf-8', errors='replace') as f:
            lines = f.readlines()
        if len(lines) < 2:
            return out
        for line in lines[1 : 1 + limit]:
            parts = line.split()
            if len(parts) < 2:
                continue
            vec = parts[0].rstrip(':')
            total = sum(int(x) for x in parts[1:] if x.isdigit())
            if total > 0:
                out.append({
                    'type': 'interrupt',
                    'code': 'T',
                    'name': f'softirq:{vec}',
                    'count': total,
                    'subsystem': map_interrupt_to_subsystem(vec),
                    'timestamp': datetime.now().isoformat(),
                })
    except (OSError, ValueError):
        pass
    return out


def get_real_system_calls():
    """Blocked-in-syscall sample from /proc/[pid]/syscall; else vm/block/net counters."""
    return _syscalls_service.get_real_system_calls(
        syscall_names=SYSCALL_NAMES,
        map_syscall_to_subsystem_fn=map_syscall_to_subsystem,
        kernel_dna_max_procs=KERNEL_DNA_MAX_PROCS,
        fallback_mock_calls_fn=get_mock_system_calls,
    )

def get_mock_system_calls():
    """Mock data for system calls."""
    return _core_observability_service.get_mock_system_calls()

def get_kernel_subsystem_status():
    """Get real kernel subsystem status from /proc filesystem."""
    return _core_observability_service.get_kernel_subsystem_status()

def get_mock_kernel_subsystems():
    """Mock data for kernel subsystems."""
    return _core_observability_service.get_mock_kernel_subsystems()

def get_process_kernel_map():
    """Get process to kernel subsystem mapping."""
    return _core_observability_service.get_process_kernel_map(
        openai_available=OPENAI_AVAILABLE,
        openai_module=openai if OPENAI_AVAILABLE else None,
    )

def get_mock_process_kernel_map():
    """Mock data for process mapping."""
    return _core_observability_service.get_mock_process_kernel_map()

def get_proc_matrix_data():
    """Build Matrix view data - processes and their resource usage"""
    return _processes_service.get_proc_matrix_data()

# API Endpoints


def api_json(producer, error_status=500, error_extra=None, exception_statuses=None):
    """Execute producer and serialize response/error as JSON."""
    try:
        return jsonify(producer())
    except Exception as e:
        status = error_status
        if exception_statuses:
            for exc_type, exc_status in exception_statuses:
                if isinstance(e, exc_type):
                    status = exc_status
                    break
        payload = {"error": str(e)}
        if error_extra:
            payload.update(error_extra)
        return jsonify(payload), status

def index():
    """Main page"""
    return send_from_directory(str(PROJECT_ROOT), "index.html")

def linux_crypto_subsystem_page():
    """SEO-friendly Linux crypto subsystem page."""
    return render_template('linux-crypto-subsystem.html')

def crypto_page_legacy():
    """Legacy path redirect to Linux crypto subsystem page."""
    return redirect('/linux-crypto-subsystem', code=301)

def linux_security_subsystem_page():
    """SEO-friendly Linux security subsystem page."""
    return render_template('linux-security-subsystem.html')

def security_page_legacy():
    """Legacy path redirect to Linux security subsystem page."""
    return redirect('/linux-security-subsystem', code=301)

def linux_processes_subsystem_page():
    """SEO-friendly Linux processes subsystem page."""
    return render_template('linux-processes-subsystem.html')

def processes_page_legacy():
    """Legacy path redirect to Linux processes subsystem page."""
    return redirect('/linux-processes-subsystem', code=301)


def linux_crypto_subsystem_html():
    return redirect('/linux-crypto-subsystem', code=301)


def linux_security_subsystem_html():
    return redirect('/linux-security-subsystem', code=301)


def linux_processes_subsystem_html():
    return redirect('/linux-processes-subsystem', code=301)


def linux_memory_subsystem_page():
    """SEO-friendly Linux memory subsystem page."""
    return render_template('linux-memory-subsystem.html')


def linux_memory_subsystem_html():
    return redirect('/linux-memory-subsystem', code=301)

def syscalls_realtime():
    """API for real-time system calls"""
    return api_json(
        lambda: {
            'timestamp': datetime.now().isoformat(),
            'syscalls': get_real_system_calls(),
            'cpu_usage': psutil.cpu_percent(interval=1),
            'memory_usage': psutil.virtual_memory().percent,
            'system_info': get_system_info()
        }
    )

def kernel_data():
    """API for kernel data"""
    return api_json(
        lambda: {
            'timestamp': datetime.now().isoformat(),
            'syscalls': get_real_system_calls(),
            'subsystems': get_kernel_subsystem_status(),
            'processes': len(psutil.pids()),
            'system_stats': {
                'cpu_count': psutil.cpu_count(),
                'memory_total': psutil.virtual_memory().total,
                'disk_usage': psutil.disk_usage('/').percent
            }
        }
    )

def process_kernel_map():
    """API for process to kernel subsystem mapping"""
    return api_json(get_process_kernel_map)

def get_processes():
    """API for getting all Linux processes"""
    def _payload():
        processes = []
        for proc in psutil.process_iter(['pid', 'name', 'status', 'memory_info']):
            try:
                memory_info = proc.info['memory_info']
                memory_mb = memory_info.rss / 1024 / 1024  # Convert to MB
                processes.append({
                    'pid': proc.info['pid'],
                    'name': proc.info['name'],
                    'status': proc.info['status'],
                    'memory_mb': round(memory_mb, 1)
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return {'processes': processes}

    return api_json(_payload)

def health_check():
    """Application health check"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'system_info': get_system_info()
    })

# Static files handling
def static_files(filename):
    """Serve static files"""
    return send_from_directory(app.config['STATIC_FOLDER'], filename)

# Error handling
# Active connections functions
# Nginx files functions
def get_nginx_open_files():
    """Get open files for Nginx process."""
    return _core_observability_service.get_nginx_open_files()

def get_mock_nginx_files():
    """Mock data for nginx files."""
    return _core_observability_service.get_mock_nginx_files()

def nginx_files():
    """API for nginx open files"""
    return api_json(lambda: {"files": get_nginx_open_files()})
def get_active_connections():
    """Get active network connections."""
    return _network_service.get_active_connections()

def get_mock_active_connections():
    """Mock data for active connections."""
    return _network_service.get_mock_active_connections()

def _tcp_state_name(code):
    return _network_service._tcp_state_name(code)

def _get_default_iface():
    return _network_service._get_default_iface()

def _parse_netstat_tcpext():
    return _network_service._parse_netstat_tcpext()

def _parse_snmp_section(section_name):
    return _network_service._parse_snmp_section(section_name)

def _get_ss_tcp_metrics():
    """Extract cwnd/rtt/retrans and tx queue from ss -tin (best effort)."""
    return _network_service._get_ss_tcp_metrics()

def _read_major_minor_from_devfile(devfile_path):
    value = _proc_fs.safe_read_text(devfile_path)
    if not value or ":" not in value:
        return (None, None)
    major_s, minor_s = value.split(":", 1)
    try:
        return (int(major_s), int(minor_s))
    except ValueError:
        return (None, None)

def _driver_from_symlink(base_path):
    link_path = os.path.join(base_path, "device", "driver")
    try:
        if os.path.islink(link_path):
            return os.path.basename(os.path.realpath(link_path))
    except OSError:
        pass
    return None

def _detect_bus(sys_path, category):
    if category == "net":
        return "net"
    real = ""
    try:
        real = os.path.realpath(sys_path).lower()
    except OSError:
        real = str(sys_path).lower()
    if "/usb" in real:
        return "usb"
    if "/pci" in real:
        return "pcie"
    if "/virtual" in real:
        return "virtual"
    return "pcie"

def _irq_total_for_tokens(interrupt_lines, tokens):
    if not tokens:
        return 0
    token_set = [t.lower() for t in tokens if t]
    total = 0
    for line_lower, irq_total in interrupt_lines:
        if any(tok in line_lower for tok in token_set):
            total += irq_total
    return total

def _subsystem_for_category(category):
    mapping = {
        "block": "block -> VFS",
        "net": "network -> net stack",
        "char": "char -> tty/mem",
        "misc": "misc -> kernel core",
        "usb": "usb core -> usbfs",
        "input": "input -> evdev",
        "gpu": "drm -> graphics"
    }
    return mapping.get(category, "kernel core")

def _user_interaction_for_category(category):
    mapping = {
        "block": "open/read/write/ioctl",
        "net": "socket/send/recv",
        "char": "read/write/ioctl",
        "misc": "ioctl/control",
        "usb": "udev/hotplug/ioctl",
        "input": "events -> userspace",
        "gpu": "drm ioctl/mmap"
    }
    return mapping.get(category, "syscall/ioctl")

def _collect_block_devices(disk_now, dt):
    devices = []
    for name, sectors_total in disk_now.items():
        prev = DEVICES_PREV["disk_sectors"].get(name)
        delta_sectors = max(0, sectors_total - prev) if prev is not None else 0
        bps = (delta_sectors * 512) / dt
        sys_path = os.path.join("/sys/block", name)
        major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
        devices.append({
            "name": name,
            "category": "block",
            "bus": _detect_bus(sys_path, "block"),
            "sys_path": sys_path,
            "driver": _driver_from_symlink(sys_path),
            "major": major,
            "minor": minor,
            "throughput_bps": bps,
            "irq_tokens": [name],
            "subsystem": _subsystem_for_category("block"),
            "user_interaction": _user_interaction_for_category("block")
        })
    return devices

def _collect_net_devices(dt):
    devices = []
    net_now = {}
    try:
        pernic = psutil.net_io_counters(pernic=True)
        for iface, counters in pernic.items():
            total_bytes = counters.bytes_recv + counters.bytes_sent
            net_now[iface] = total_bytes
            prev = DEVICES_PREV["net_bytes"].get(iface)
            delta = max(0, total_bytes - prev) if prev is not None else 0
            bps = delta / dt
            sys_path = os.path.join("/sys/class/net", iface)
            major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
            devices.append({
                "name": iface,
                "category": "net",
                "bus": "net",
                "sys_path": sys_path,
                "driver": _driver_from_symlink(sys_path),
                "major": major,
                "minor": minor,
                "throughput_bps": bps,
                "irq_tokens": [iface],
                "errors": int(counters.errin + counters.errout),
                "drops": int(counters.dropin + counters.dropout),
                "subsystem": _subsystem_for_category("net"),
                "user_interaction": _user_interaction_for_category("net")
            })
    except Exception:
        return [], {}
    return devices, net_now

def _collect_char_devices():
    devices = []
    seeds = [("tty0", "/sys/class/tty/tty0"), ("null", "/sys/devices/virtual/mem/null"), ("random", "/sys/devices/virtual/mem/random")]
    for name, sys_path in seeds:
        major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
        devices.append({
            "name": name,
            "category": "char",
            "bus": _detect_bus(sys_path, "char"),
            "sys_path": sys_path,
            "driver": _driver_from_symlink(sys_path),
            "major": major,
            "minor": minor,
            "throughput_bps": 0.0,
            "irq_tokens": [name, "tty"] if "tty" in name else [name],
            "subsystem": _subsystem_for_category("char"),
            "user_interaction": _user_interaction_for_category("char")
        })
    return devices

def _collect_misc_input_gpu_usb():
    out = []

    misc_path = "/sys/class/misc"
    if os.path.isdir(misc_path):
        for name in sorted(os.listdir(misc_path))[:4]:
            sys_path = os.path.join(misc_path, name)
            major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
            out.append({
                "name": name,
                "category": "misc",
                "bus": _detect_bus(sys_path, "misc"),
                "sys_path": sys_path,
                "driver": _driver_from_symlink(sys_path),
                "major": major,
                "minor": minor,
                "throughput_bps": 0.0,
                "irq_tokens": [name],
                "subsystem": _subsystem_for_category("misc"),
                "user_interaction": _user_interaction_for_category("misc")
            })

    input_path = "/sys/class/input"
    if os.path.isdir(input_path):
        for name in sorted(os.listdir(input_path)):
            if not name.startswith("event"):
                continue
            sys_path = os.path.join(input_path, name)
            major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
            out.append({
                "name": name,
                "category": "input",
                "bus": _detect_bus(sys_path, "input"),
                "sys_path": sys_path,
                "driver": _driver_from_symlink(sys_path),
                "major": major,
                "minor": minor,
                "throughput_bps": 0.0,
                "irq_tokens": [name, "input"],
                "subsystem": _subsystem_for_category("input"),
                "user_interaction": _user_interaction_for_category("input")
            })
            if len([d for d in out if d["category"] == "input"]) >= 4:
                break

    drm_path = "/sys/class/drm"
    if os.path.isdir(drm_path):
        for name in sorted(os.listdir(drm_path)):
            if not re.match(r"^card\d+$", name):
                continue
            sys_path = os.path.join(drm_path, name)
            major, minor = _read_major_minor_from_devfile(os.path.join(sys_path, "dev"))
            out.append({
                "name": name,
                "category": "gpu",
                "bus": _detect_bus(sys_path, "gpu"),
                "sys_path": sys_path,
                "driver": _driver_from_symlink(sys_path),
                "major": major,
                "minor": minor,
                "throughput_bps": 0.0,
                "irq_tokens": [name, "drm", "gpu"],
                "subsystem": _subsystem_for_category("gpu"),
                "user_interaction": _user_interaction_for_category("gpu")
            })
            if len([d for d in out if d["category"] == "gpu"]) >= 2:
                break

    usb_path = "/sys/bus/usb/devices"
    if os.path.isdir(usb_path):
        for name in sorted(os.listdir(usb_path)):
            if ":" in name or name in ("usb1", "usb2", "usb3", "usb4"):
                continue
            sys_path = os.path.join(usb_path, name)
            if not os.path.isdir(sys_path):
                continue
            out.append({
                "name": name,
                "category": "usb",
                "bus": "usb",
                "sys_path": sys_path,
                "driver": _driver_from_symlink(sys_path),
                "major": None,
                "minor": None,
                "throughput_bps": 0.0,
                "irq_tokens": [name, "usb"],
                "subsystem": _subsystem_for_category("usb"),
                "user_interaction": _user_interaction_for_category("usb")
            })
            if len([d for d in out if d["category"] == "usb"]) >= 4:
                break

    return out

def get_devices_realtime():
    now = time.time()
    prev_ts = DEVICES_PREV["timestamp"]
    dt = max(0.001, now - prev_ts) if prev_ts else 1.0
    disk_now = _proc_fs.read_diskstats()
    block_devices = _collect_block_devices(disk_now, dt)
    net_devices, net_now = _collect_net_devices(dt)
    char_devices = _collect_char_devices()
    extra_devices = _collect_misc_input_gpu_usb()

    devices = block_devices + net_devices + char_devices + extra_devices
    interrupt_lines = _proc_fs.read_interrupt_lines()

    max_bps = max([d.get("throughput_bps", 0.0) for d in devices] + [1.0])
    for d in devices:
        key = f"{d.get('category','unknown')}::{d.get('name','unknown')}"
        irq_total = _irq_total_for_tokens(interrupt_lines, d.get("irq_tokens", []))
        prev_irq = DEVICES_PREV["irq_by_key"].get(key)
        irq_per_sec = 0.0 if prev_irq is None else max(0.0, (irq_total - prev_irq) / dt)

        throughput = float(d.get("throughput_bps", 0.0))
        synthetic = irq_per_sec * 4096.0
        weighted = max(throughput, synthetic)
        d["throughput_bps"] = round(throughput, 2)
        d["throughput_mb_s"] = round(throughput / (1024 * 1024), 4)
        d["irq_total"] = int(irq_total)
        d["irq_per_sec"] = round(irq_per_sec, 2)
        d["load_norm"] = round(min(1.0, weighted / max_bps), 4)
        d["layer_path"] = [
            "Physical layer",
            "Driver layer",
            "Kernel subsystem",
            "User interaction"
        ]
        d["driver"] = d.get("driver") or "n/a"

    devices.sort(key=lambda d: (d.get("load_norm", 0.0), d.get("throughput_bps", 0.0), d.get("irq_per_sec", 0.0)), reverse=True)
    top_devices = devices[:20]

    DEVICES_PREV["timestamp"] = now
    DEVICES_PREV["disk_sectors"] = disk_now
    DEVICES_PREV["net_bytes"] = net_now
    DEVICES_PREV["tty_irq_total"] = _proc_fs.read_tty_irq_total()
    DEVICES_PREV["irq_by_key"] = {
        f"{d.get('category','unknown')}::{d.get('name','unknown')}": d.get("irq_total", 0)
        for d in top_devices
    }

    bus_counts = {"pcie": 0, "usb": 0, "virtual": 0, "net": 0}
    category_counts = {}
    for d in top_devices:
        bus_counts[d.get("bus", "pcie")] = bus_counts.get(d.get("bus", "pcie"), 0) + 1
        c = d.get("category", "unknown")
        category_counts[c] = category_counts.get(c, 0) + 1

    return {
        "timestamp": datetime.now().isoformat(),
        "layout": {
            "name": "Hardware Bus Map",
            "layers": ["Physical layer", "Driver layer", "Kernel subsystem", "User interaction"],
            "buses": ["pcie", "usb", "virtual", "net"]
        },
        "devices": top_devices,
        "meta": {
            "count": len(top_devices),
            "max_throughput_bps": round(max_bps, 2),
            "bus_counts": bus_counts,
            "category_counts": category_counts
        }
    }

def get_filesystem_blocks():
    return _system_view_service.get_filesystem_blocks()

def get_network_stack_realtime():
    return _network_service.get_network_stack_realtime()

def _parse_cgroup_path(pid):
    return _system_view_service._parse_cgroup_path(pid)

def _read_namespace_inode(pid, ns_name):
    return _system_view_service._read_namespace_inode(pid, ns_name)

def _read_cgroup_v2_stats(cgroup_path):
    return _system_view_service._read_cgroup_v2_stats(cgroup_path)

def get_isolation_context():
    """Aggregate namespace and cgroup context for UI layer."""
    return _system_view_service.get_isolation_context()

def get_route_hint(remote_ip):
    """Fallback path hint using Linux routing table when traceroute tools are absent."""
    return _network_service.get_route_hint(remote_ip)

def get_traceroute_info(remote_ip, max_hops=8):
    """Get traceroute/tracepath information for a remote IP with short timeout."""
    return _network_service.get_traceroute_info(remote_ip, max_hops=max_hops)

def active_connections():
    """API for active network connections"""
    return api_json(lambda: {"connections": get_active_connections()})

def traceroute_info():
    """API endpoint for traceroute path to remote IP."""
    def _payload():
        remote_ip = request.args.get("ip", "").strip()
        if not remote_ip:
            raise ValueError("Missing 'ip' query parameter")
        return get_traceroute_info(remote_ip)

    return api_json(_payload, exception_statuses=[(ValueError, 400)])

def network_stack_realtime():
    """Live telemetry for Network Stack visualization."""
    return api_json(get_network_stack_realtime)

def devices_realtime():
    """Live telemetry for Devices belt visualization."""
    return api_json(get_devices_realtime)

def filesystem_blocks():
    """Live block-map style filesystem telemetry."""
    return api_json(get_filesystem_blocks)

def isolation_context():
    """API endpoint for cgroups + namespaces design layer."""
    return api_json(get_isolation_context)

def get_process_threads(pid):
    """API for getting thread information for a specific process"""
    return api_json(lambda: get_process_threads_info(pid))

def get_process_cpu(pid):
    """API for getting CPU statistics for a specific process"""
    return api_json(lambda: get_process_cpu_info(pid))

def get_process_fds(pid):
    """API for getting file descriptors for a specific process"""
    return api_json(lambda: get_process_fds_info(pid))

def get_processes_detailed():
    """API for getting all processes with detailed information (threads, CPU, FDs)"""
    return api_json(lambda: {"processes": _processes_service.get_processes_detailed_data()})


def get_ipc_links_summary(max_pairs=120, max_nodes=24):
    return _process_inspect_service.get_ipc_links_summary(max_pairs=max_pairs, max_nodes=max_nodes)


def get_ipc_links():
    """API: shared IPC/socket links across processes."""
    def _payload():
        max_pairs = request.args.get("max_pairs", default=120, type=int)
        max_nodes = request.args.get("max_nodes", default=24, type=int)
        max_pairs = max(20, min(300, max_pairs))
        max_nodes = max(8, min(64, max_nodes))
        return get_ipc_links_summary(max_pairs=max_pairs, max_nodes=max_nodes)

    return api_json(_payload)

def get_process_threads_info(pid):
    """Get thread information for a specific process."""
    return _process_inspect_service.get_process_threads_info(pid)

def get_process_cpu_info(pid):
    """Get CPU statistics for a specific process."""
    return _process_inspect_service.get_process_cpu_info(pid)

def get_process_fds_info(pid):
    """Get file descriptors information for a specific process."""
    return _process_inspect_service.get_process_fds_info(pid)


def get_proc_matrix():
    """API: Matrix view data (processes vs CPU / MEM / IO / NET / FD)"""
    def _payload():
        matrix = get_proc_matrix_data()
        return {
            'matrix': matrix,
            'timestamp': datetime.now().isoformat(),
        }

    return api_json(_payload)

def get_proc_timeline():
    """API: Timeline view data - events for a specific process"""
    try:
        from flask import request
        pid = request.args.get('pid', type=int)
        if not pid:
            return jsonify({'error': 'PID parameter required'}), 400
        
        timeline = []
        
        # Check if process exists
        try:
            proc = psutil.Process(pid)
        except psutil.NoSuchProcess:
            return jsonify({'error': f'Process {pid} not found'}), 404
        
        # Get process info
        proc_info = proc.as_dict(['pid', 'name', 'create_time', 'status'])
        base_ts = float(proc_info['create_time'])
        # Ordered real-derived events; timestamps are monotonic from process start (precise times not in /proc).
        ordered_events = []
        ordered_events.append({'type': 'exec', 'pid': pid})

        # Event: mmap (from /proc/[pid]/maps)
        try:
            maps_path = f'/proc/{pid}/maps'
            if os.path.exists(maps_path):
                with open(maps_path, 'r') as f:
                    map_count = len(f.readlines())
                    if map_count > 0:
                        ordered_events.append({
                            'type': 'mmap',
                            'pid': pid,
                            'count': map_count
                        })
        except (IOError, PermissionError):
            pass

        # Event: read/write (from /proc/[pid]/io)
        try:
            io_path = f'/proc/{pid}/io'
            if os.path.exists(io_path):
                with open(io_path, 'r') as f:
                    io_data = {}
                    for line in f:
                        if ':' in line:
                            key, value = line.split(':', 1)
                            io_data[key.strip()] = int(value.strip())

                    if io_data.get('read_bytes', 0) > 0:
                        ordered_events.append({
                            'type': 'read',
                            'pid': pid,
                            'bytes': io_data.get('read_bytes', 0)
                        })

                    if io_data.get('write_bytes', 0) > 0:
                        ordered_events.append({
                            'type': 'write',
                            'pid': pid,
                            'bytes': io_data.get('write_bytes', 0)
                        })
        except (IOError, PermissionError):
            pass

        # Event: connect/accept (from /proc/[pid]/net/tcp)
        try:
            tcp_path = f'/proc/{pid}/net/tcp'
            if os.path.exists(tcp_path):
                with open(tcp_path, 'r') as f:
                    lines = f.readlines()
                    if len(lines) > 1:
                        for line in lines[1:]:
                            parts = line.split()
                            if len(parts) >= 4:
                                state = parts[3]
                                if state == '01':
                                    ordered_events.append({'type': 'connect', 'pid': pid})
                                elif state == '0A':
                                    ordered_events.append({'type': 'accept', 'pid': pid})
        except (IOError, PermissionError):
            pass

        step = 0.35
        timeline = []
        for i, ev in enumerate(ordered_events):
            ev = dict(ev)
            ev['timestamp'] = datetime.fromtimestamp(base_ts + i * step).isoformat()
            timeline.append(ev)
        
        return jsonify({
            'timeline': timeline,
            'pid': pid,
            'name': proc_info.get('name', 'unknown'),
            'timestamp': datetime.now().isoformat(),
            'timeline_time_basis': 'Events are ordered from process start; 0.35s steps separate rows for the helix (kernel does not expose per-event wall times for these signals).',
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def get_execution_context():
    """Get execution context data for Ring-1 visualization."""
    return api_json(
        lambda: (
            _execution_service.get_execution_context_data(
                syscall_names=SYSCALL_NAMES,
                map_interrupt_to_subsystem_fn=map_interrupt_to_subsystem,
                exec_context_prev=EXEC_CONTEXT_PREV,
            )
        )
    )

def get_kernel_dna_data():
    return _execution_service.get_kernel_dna_data(
        get_real_system_calls_fn=get_real_system_calls,
        map_syscall_to_subsystem_fn=map_syscall_to_subsystem,
        map_interrupt_to_subsystem_fn=map_interrupt_to_subsystem,
        softirq_nucleotides_fn=_kernel_dna_softirq_nucleotides,
    )

def map_syscall_to_subsystem(syscall_name):
    """Map syscall name to kernel subsystem"""
    if not syscall_name:
        return 'kernel'
    if syscall_name.startswith('vm:'):
        return 'mm'
    if syscall_name.startswith('disk:'):
        return 'fs'
    if syscall_name.startswith('net:'):
        return 'net'
    syscall_lower = syscall_name.lower()
    if any(x in syscall_lower for x in ['read', 'write', 'open', 'close', 'stat', 'fsync']):
        return 'fs'
    elif any(x in syscall_lower for x in ['socket', 'connect', 'send', 'recv', 'bind']):
        return 'net'
    elif any(x in syscall_lower for x in ['mmap', 'munmap', 'brk', 'mprotect']):
        return 'mm'
    elif any(x in syscall_lower for x in ['clone', 'fork', 'exec', 'wait', 'exit']):
        return 'sched'
    else:
        return 'kernel'

def map_interrupt_to_subsystem(interrupt_name):
    """Map interrupt name to kernel subsystem"""
    irq_lower = interrupt_name.lower()
    if 'timer' in irq_lower:
        return 'sched'
    elif any(x in irq_lower for x in ['eth', 'network', 'wifi']):
        return 'net'
    elif any(x in irq_lower for x in ['keyboard', 'mouse', 'usb']):
        return 'drivers'
    else:
        return 'kernel'

def collect_crypto_realtime():
    return _crypto_security_service.collect_crypto_realtime(crypto_prev=CRYPTO_PREV, entropy_prev=ENTROPY_PREV)

def collect_security_realtime():
    return _crypto_security_service.collect_security_realtime(security_prev=SECURITY_PREV)

def _parse_meminfo_kb():
    return _processes_service._parse_meminfo_kb()


def _memory_strip_blocks(kind, kb_k, mem_total_kb, n_blocks, seed0):
    return _processes_service._memory_strip_blocks(kind, kb_k, mem_total_kb, n_blocks, seed0)


def _build_memory_visual_rows(meminfo_kb, syscall_nodes, vm, swap):
    return _processes_service._build_memory_visual_rows(meminfo_kb, syscall_nodes, vm, swap)


def collect_processes_realtime():
    return _processes_service.collect_processes_realtime()

def kernel_dna():
    """API endpoint for Kernel DNA visualization data"""
    return api_json(get_kernel_dna_data)

def crypto_realtime():
    """Realtime-ish crypto interaction feed for crypto visualization."""
    return api_json(collect_crypto_realtime)

def security_realtime():
    """Realtime-ish security interaction feed for security visualization."""
    return api_json(collect_security_realtime)

def processes_realtime():
    """Realtime-ish processes interaction feed for processes visualization."""
    return api_json(collect_processes_realtime)

def ingest_frontend_logs():
    """Receive frontend logs in ECS-like JSON and append to local JSONL file."""
    if request.method == 'OPTIONS':
        return ('', 204)

    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"error": "Invalid JSON payload"}), 400

    events = payload.get("events", payload if isinstance(payload, list) else [payload])
    if not isinstance(events, list):
        return jsonify({"error": "Expected event object or list of events"}), 400
    if len(events) > 100:
        return jsonify({"error": "Batch too large"}), 413

    accepted = 0
    for raw in events:
        if not isinstance(raw, dict):
            continue
        write_frontend_event(raw)
        accepted += 1

    return jsonify({"status": "ok", "accepted": accepted})


def get_proc_graph():
    """3D /proc graph for ``proc-3d-visualization.js``: nodes with x,y,z and edges {from,to}."""
    return api_json(_processes_service.get_proc_graph_data, error_extra={"nodes": [], "edges": []})


def get_process_files():
    """Bezier process↔file curves for ``bezier_curves.js`` (optional real data; empty → decorative fallback)."""
    return api_json(lambda: {"curves": [], "timestamp": datetime.now().isoformat()}, error_extra={"curves": []})


register_http_routes(app)


@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500


def create_app():
    """Application factory. Currently returns the module singleton ``app`` (refactor in progress)."""
    return app
