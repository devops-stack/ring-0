#!/usr/bin/env python3
"""
Linux Kernel Visualization Backend
"""

import os
import sys
import json
import time
import random
import platform
import subprocess
import re
import ipaddress
import shutil
from datetime import datetime
from threading import Lock
from flask import Flask, jsonify, render_template, send_from_directory, request, redirect, g, Response
import psutil

# Gunicorn -w N: set PROMETHEUS_MULTIPROC_DIR before workers import this module (e.g. in gunicorn.conf.py).
if os.environ.get("PROMETHEUS_MULTIPROC_DIR", "").strip():
    _prom_mpdir = os.environ["PROMETHEUS_MULTIPROC_DIR"].strip()
    os.makedirs(_prom_mpdir, exist_ok=True)

try:
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        CollectorRegistry,
        Counter,
        Histogram,
        generate_latest,
        multiprocess,
    )

    _PROMETHEUS_AVAILABLE = True
except ImportError:
    _PROMETHEUS_AVAILABLE = False
    CONTENT_TYPE_LATEST = "text/plain; version=0.0.4; charset=utf-8"

# Try to import OpenAI (optional)
try:
    import openai
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

app = Flask(__name__)

if _PROMETHEUS_AVAILABLE:
    REQUEST_COUNT = Counter(
        "http_requests_total",
        "Total HTTP requests",
        ["method", "endpoint", "status"],
    )
    REQUEST_LATENCY = Histogram(
        "http_request_duration_seconds",
        "HTTP request latency in seconds",
        buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, float("inf")),
    )

    @app.before_request
    def _prometheus_before_request():
        g._prom_start = time.perf_counter()

    @app.after_request
    def _prometheus_after_request(response):
        start = getattr(g, "_prom_start", None)
        if start is not None:
            REQUEST_LATENCY.observe(time.perf_counter() - start)
        ep = request.endpoint
        rule = request.url_rule.rule if request.url_rule else None
        endpoint_label = ep or rule or "unmatched"
        try:
            REQUEST_COUNT.labels(
                method=request.method,
                endpoint=endpoint_label,
                status=str(response.status_code),
            ).inc()
        except Exception:
            pass
        return response

    @app.route("/metrics")
    def prometheus_metrics():
        if os.environ.get("PROMETHEUS_MULTIPROC_DIR", "").strip():
            registry = CollectorRegistry()
            multiprocess.MultiProcessCollector(registry)
            data = generate_latest(registry)
        else:
            data = generate_latest()
        return Response(data, mimetype=CONTENT_TYPE_LATEST)

else:

    @app.route("/metrics")
    def prometheus_metrics_disabled():
        return jsonify(
            {"error": "prometheus_client not installed; pip install prometheus-client"}
        ), 503


TRACEROUTE_CACHE = {}
TRACEROUTE_CACHE_TTL_SECONDS = 60
NETWORK_STACK_PREV = {
    "timestamp": None,
    "tcpext_retrans": None,
    "ip_in": None,
    "ip_out": None,
    "ip_discards": None,
    "iface_rx": None,
    "iface_tx": None,
    "iface_drops": None
}
DEVICES_PREV = {
    "timestamp": None,
    "disk_sectors": {},
    "net_bytes": {},
    "tty_irq_total": None,
    "irq_by_key": {}
}
FILESYSTEM_PREV = {
    "timestamp": None,
    "write_bytes": None
}
CRYPTO_PREV = {
    "timestamp": None,
    "active_flows": 0
}
ENTROPY_PREV = {
    "timestamp": None,
    "disk_read_bytes": None,
    "disk_write_bytes": None,
    "net_sent_bytes": None,
    "net_recv_bytes": None,
    "interrupt_total": None
}
EXEC_CONTEXT_PREV = {
    "timestamp": None,
    "irq_totals": {},
    "softirq_totals": {}
}
SECURITY_PREV = {
    "timestamp": None,
    "events": 0
}
FRONTEND_LOG_WRITE_LOCK = Lock()
FRONTEND_LOG_FILE = os.getenv("FRONTEND_LOG_FILE", "/opt/ring0/kernel-ai/logs/frontend-events.jsonl")

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

# Configuration
class Config:
    # Detect environment: production if DEBUG env var is not set or is False
    DEBUG = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    ENV = os.getenv('FLASK_ENV', 'production' if not DEBUG else 'development')
    STATIC_FOLDER = 'static'
    TEMPLATES_FOLDER = 'templates'
    API_PREFIX = '/api'
    # Cache settings
    SEND_FILE_MAX_AGE_DEFAULT = 0 if DEBUG else 31536000  # 1 year in production

app.config.from_object(Config)

# CORS and cache control headers
@app.after_request
def add_headers(response):
    """Add CORS headers and cache control based on environment"""
    # Add CORS headers for all API requests
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    
    # Always disable HTML caching so browsers pick up fresh script version URLs.
    if response.content_type and 'text/html' in response.content_type:
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response

    # Only apply cache control to static files (JS, CSS, images)
    if response.content_type and (
        'text/javascript' in response.content_type or 
        'application/javascript' in response.content_type or
        'text/css' in response.content_type or
        'image/' in response.content_type
    ):
        if app.config['DEBUG']:
            # Development: no cache
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        else:
            # Production: long cache with revalidation
            # Files with ?v= parameter will be cached, but browser will check for updates
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
            # Remove Pragma header in production (not needed with Cache-Control)
            if 'Pragma' in response.headers:
                del response.headers['Pragma']
    return response

def get_system_info():
    """Get system information"""
    return {
        'platform': platform.system(),
        'kernel': platform.release(),
        'python_version': platform.python_version(),
        'cpu_count': psutil.cpu_count(),
        'memory_total': psutil.virtual_memory().total
    }

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


def _kernel_dna_read_proc_vmstat():
    """Parse /proc/vmstat into a dict of int counters."""
    vm = {}
    try:
        with open('/proc/vmstat', 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    vm[parts[0]] = int(parts[1])
    except (OSError, ValueError):
        pass
    return vm


def _kernel_dna_vmstat_activity_nucleotides():
    """Real VM counters when no per-task syscall sample is available."""
    result = []
    vm = _kernel_dna_read_proc_vmstat()
    mapping = [
        ('pgfault', 'mm'),
        ('pgmajfault', 'mm'),
        ('pswpin', 'mm'),
        ('pswpout', 'mm'),
        ('oom_kill', 'mm'),
        ('nr_dirty', 'mm'),
        ('nr_written', 'mm'),
        ('pgscan_kswapd', 'mm'),
        ('pgscan_direct', 'mm'),
        ('workingset_refault', 'mm'),
    ]
    for key, sub in mapping:
        if key in vm and vm[key] > 0:
            result.append({'name': f'vm:{key}', 'count': vm[key], 'subsystem': sub})
    return result


def _kernel_dna_block_device_activity_nucleotides():
    """Cumulative I/O from /sys/block/<dev>/stat."""
    result = []
    tr = tw = tsr = tsw = 0
    try:
        for name in os.listdir('/sys/block'):
            if name.startswith(('loop', 'ram')):
                continue
            stat_path = os.path.join('/sys/block', name, 'stat')
            if not os.path.isfile(stat_path):
                continue
            with open(stat_path, 'r', encoding='utf-8', errors='replace') as f:
                st = f.read().split()
            if len(st) < 7:
                continue
            tr += int(st[0])
            tsr += int(st[2])
            tw += int(st[4])
            tsw += int(st[6])
    except (OSError, ValueError, IndexError):
        pass
    if tr > 0:
        result.append({'name': 'disk:read_ios', 'count': tr, 'subsystem': 'fs'})
    if tw > 0:
        result.append({'name': 'disk:write_ios', 'count': tw, 'subsystem': 'fs'})
    if tsr > 0:
        result.append({'name': 'disk:sectors_read', 'count': tsr, 'subsystem': 'fs'})
    if tsw > 0:
        result.append({'name': 'disk:sectors_written', 'count': tsw, 'subsystem': 'fs'})
    return result


def _kernel_dna_sockstat_activity_nucleotides():
    """Socket counts from /proc/net/sockstat."""
    result = []
    try:
        with open('/proc/net/sockstat', 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                parts = line.split()
                if line.startswith('TCP:') and len(parts) >= 3:
                    result.append({'name': 'net:tcp_inuse', 'count': int(parts[2]), 'subsystem': 'net'})
                elif line.startswith('UDP:') and len(parts) >= 3:
                    result.append({'name': 'net:udp_inuse', 'count': int(parts[2]), 'subsystem': 'net'})
    except (OSError, ValueError, IndexError):
        pass
    return result


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
    """Blocked-in-syscall sample from /proc/[pid]/syscall; else real vmstat + block + sockstat (no random on Linux)."""
    try:
        if platform.system() != 'Linux':
            return get_mock_system_calls()

        try:
            proc_dirs = [d for d in os.listdir('/proc') if d.isdigit()]
        except PermissionError:
            proc_dirs = []

        sampled = sorted(proc_dirs, key=int)[: min(KERNEL_DNA_MAX_PROCS, len(proc_dirs))]

        syscall_counts = {}
        for pid in sampled:
            try:
                syscall_path = f'/proc/{pid}/syscall'
                if not os.path.exists(syscall_path):
                    continue
                with open(syscall_path, 'r', encoding='utf-8', errors='replace') as f:
                    line = f.read().strip()
                if not line or line in ('-1', 'running'):
                    continue
                parts = line.split()
                if not parts:
                    continue
                try:
                    syscall_num = int(parts[0])
                except ValueError:
                    continue
                syscall_name = SYSCALL_NAMES.get(syscall_num, f'syscall_{syscall_num}')
                syscall_counts[syscall_name] = syscall_counts.get(syscall_name, 0) + 1
            except (PermissionError, FileNotFoundError, IOError, ValueError):
                continue

        if syscall_counts:
            syscalls = []
            for name, count in sorted(syscall_counts.items(), key=lambda x: x[1], reverse=True)[:20]:
                syscalls.append({
                    'name': name,
                    'count': count,
                    'subsystem': map_syscall_to_subsystem(name),
                })
            return syscalls

        merged = []
        merged.extend(_kernel_dna_vmstat_activity_nucleotides())
        merged.extend(_kernel_dna_block_device_activity_nucleotides())
        merged.extend(_kernel_dna_sockstat_activity_nucleotides())
        if merged:
            merged.sort(key=lambda x: x['count'], reverse=True)
            return merged[:20]
        return []

    except Exception as e:
        print(f"Error getting system calls: {e}")
        import traceback
        traceback.print_exc()
        return [] if platform.system() == 'Linux' else get_mock_system_calls()

def get_mock_system_calls():
    """Mock data for system calls"""
    return [
        {'name': 'read', 'count': '166 643218'},
        {'name': 'write', 'count': '964 016161'},
        {'name': 'open', 'count': '972 983879'},
        {'name': 'close', 'count': '989 612075'},
        {'name': 'mmap', 'count': '819 540732'},
        {'name': 'fork', 'count': '512 826219'},
        {'name': 'execve', 'count': '025 461491'},
        {'name': 'socket', 'count': '838 475394'},
        {'name': 'connect', 'count': '632 094939'},
        {'name': 'accept', 'count': '417 205788'}
    ]

def get_kernel_subsystem_status():
    """Get real kernel subsystem status from /proc filesystem"""
    try:
        if platform.system() != 'Linux':
            return get_mock_kernel_subsystems()
        
        subsystems = {}
        
        # 1. Memory Management - from /proc/meminfo
        try:
            with open('/proc/meminfo', 'r') as f:
                meminfo = {}
                for line in f:
                    if ':' in line:
                        key, value = line.split(':', 1)
                        meminfo[key.strip()] = value.strip()
                
                # Calculate memory usage percentage
                mem_total_kb = int(meminfo.get('MemTotal', '0').replace(' kB', ''))
                mem_available_kb = int(meminfo.get('MemAvailable', '0').replace(' kB', ''))
                mem_free_kb = int(meminfo.get('MemFree', '0').replace(' kB', ''))
                
                if mem_total_kb > 0:
                    mem_used_kb = mem_total_kb - mem_available_kb
                    memory_usage = int((mem_used_kb / mem_total_kb) * 100)
                else:
                    memory_usage = 0
                
                # Count processes using memory (rough estimate from active pages)
                active_kb = int(meminfo.get('Active', '0').replace(' kB', ''))
                processes_estimate = max(10, min(100, active_kb // 50000))  # Rough estimate
                
                subsystems['memory_management'] = {
                    'status': 'active',
                    'usage': memory_usage,
                    'processes': processes_estimate
                }
        except (IOError, ValueError, KeyError) as e:
            print(f"Error reading meminfo: {e}")
            subsystems['memory_management'] = {
                'status': 'active',
                'usage': 75,
                'processes': 25
            }
        
        # 2. Process Scheduler - from /proc/stat
        try:
            with open('/proc/stat', 'r') as f:
                stat_data = {}
                for line in f:
                    if line.startswith('cpu '):
                        parts = line.split()
                        # CPU stats: user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice
                        if len(parts) >= 5:
                            user_time = int(parts[1])
                            system_time = int(parts[3])
                            idle_time = int(parts[4])
                            total_time = user_time + system_time + idle_time
                            
                            if total_time > 0:
                                cpu_usage = int(((user_time + system_time) / total_time) * 100)
                            else:
                                cpu_usage = 0
                    elif line.startswith('processes '):
                        total_processes = int(line.split()[1])
                    elif line.startswith('ctxt '):
                        context_switches = int(line.split()[1])
                
                # Estimate scheduler activity from context switches
                # More context switches = more scheduler activity
                scheduler_usage = min(100, max(50, cpu_usage))
                
                # Get current running processes
                try:
                    with open('/proc/loadavg', 'r') as f:
                        loadavg = f.read().strip().split()
                        running_processes = int(float(loadavg[3].split('/')[0]))
                except:
                    running_processes = len(psutil.pids()) if 'psutil' in sys.modules else 50
                
                subsystems['process_scheduler'] = {
                    'status': 'active',
                    'usage': scheduler_usage,
                    'processes': running_processes
                }
        except (IOError, ValueError, KeyError) as e:
            print(f"Error reading /proc/stat: {e}")
            subsystems['process_scheduler'] = {
                'status': 'active',
                'usage': 85,
                'processes': 45
            }
        
        # 3. File System - from /proc/mounts and /proc/filesystems
        try:
            # Count mounted filesystems
            with open('/proc/mounts', 'r') as f:
                mount_count = len([line for line in f if line.strip() and not line.startswith('#')])
            
            # Count filesystem types
            with open('/proc/filesystems', 'r') as f:
                fs_types = len([line for line in f if line.strip() and not line.startswith('#')])
            
            # Estimate filesystem activity from I/O wait
            try:
                with open('/proc/stat', 'r') as f:
                    for line in f:
                        if line.startswith('cpu '):
                            parts = line.split()
                            if len(parts) >= 6:
                                iowait = int(parts[5])
                                # Use iowait as indicator of filesystem activity
                                fs_usage = min(100, max(20, iowait // 100))
                            else:
                                fs_usage = 60
                            break
            except:
                fs_usage = 60
            
            # Estimate processes using filesystem
            fs_processes = max(5, min(50, mount_count * 2))
            
            subsystems['file_system'] = {
                'status': 'active',
                'usage': fs_usage,
                'processes': fs_processes
            }
        except (IOError, ValueError) as e:
            print(f"Error reading filesystem info: {e}")
            subsystems['file_system'] = {
                'status': 'active',
                'usage': 60,
                'processes': 15
            }
        
        # 4. Network Stack - from /proc/net/sockstat and /proc/net/tcp
        try:
            network_usage = 30
            network_processes = 8
            
            # Try to read socket statistics
            try:
                with open('/proc/net/sockstat', 'r') as f:
                    for line in f:
                        if line.startswith('TCP:'):
                            # Format: TCP: inuse 26 orphan 0 tw 44 alloc 28 mem 3
                            parts = line.split()
                            # Find indices of key values
                            try:
                                inuse_idx = parts.index('inuse') + 1 if 'inuse' in parts else -1
                                alloc_idx = parts.index('alloc') + 1 if 'alloc' in parts else -1
                                
                                if inuse_idx > 0 and inuse_idx < len(parts):
                                    tcp_inuse = int(parts[inuse_idx])
                                else:
                                    tcp_inuse = 0
                                
                                if alloc_idx > 0 and alloc_idx < len(parts):
                                    tcp_alloc = int(parts[alloc_idx])
                                else:
                                    tcp_alloc = tcp_inuse + 10  # Fallback
                                
                                if tcp_alloc > 0:
                                    network_usage = min(100, max(20, int((tcp_inuse / tcp_alloc) * 100)))
                                else:
                                    network_usage = 30
                                
                                network_processes = max(8, min(50, tcp_inuse // 2))
                            except (ValueError, IndexError):
                                # Fallback parsing
                                network_usage = 30
                                network_processes = 12
                            break
            except FileNotFoundError:
                # Fallback: count TCP connections from /proc/net/tcp
                try:
                    with open('/proc/net/tcp', 'r') as f:
                        tcp_connections = len([line for line in f if line.strip() and not line.startswith('sl')])
                    network_usage = min(100, max(20, tcp_connections // 10))
                    network_processes = max(8, min(50, tcp_connections // 5))
                except:
                    pass
            
            subsystems['network_stack'] = {
                'status': 'active',
                'usage': network_usage,
                'processes': network_processes
            }
        except (IOError, ValueError) as e:
            print(f"Error reading network info: {e}")
            subsystems['network_stack'] = {
                'status': 'active',
                'usage': 50,
                'processes': 12
            }
        
        return subsystems
        
    except Exception as e:
        print(f"Error getting subsystem status: {e}")
        import traceback
        traceback.print_exc()
        return get_mock_kernel_subsystems()

def get_mock_kernel_subsystems():
    """Mock data for kernel subsystems"""
    return {
        'memory_management': {'status': 'active', 'usage': 75, 'processes': 25},
        'process_scheduler': {'status': 'active', 'usage': 85, 'processes': 45},
        'file_system': {'status': 'active', 'usage': 60, 'processes': 15},
        'network_stack': {'status': 'active', 'usage': 50, 'processes': 12}
    }

def get_process_kernel_map():
    """Get process to kernel subsystem mapping"""
    try:
        if not OPENAI_AVAILABLE:
            return get_mock_process_kernel_map()
        
        # Try to use OpenAI API
        if not hasattr(openai, 'api_key') or not openai.api_key:
            return get_mock_process_kernel_map()
        
        # Here would be OpenAI API logic
        # For now return mock data
        return get_mock_process_kernel_map()
        
    except Exception as e:
        print(f"Error getting process map: {e}")
        return get_mock_process_kernel_map()

def get_mock_process_kernel_map():
    """Mock data for process mapping"""
    return {
        "systemd": ["kernel/sched/core.c", "kernel/time/timekeeping.c"],
        "sshd": ["kernel/security/security.c", "kernel/audit/audit.c"],
        "nginx": ["kernel/net/socket.c", "kernel/net/core/sock.c"],
        "python3": ["kernel/fs/read_write.c", "kernel/mm/memory.c"],
        "bash": ["kernel/exec.c", "kernel/fork.c"],
        "cron": ["kernel/time/timer.c", "kernel/sched/clock.c"]
    }

def get_proc_matrix_data():
    """Build Matrix view data - processes and their resource usage"""
    matrix = []

    # Collect processes with required fields
    processes = []
    for proc in psutil.process_iter(
        ['pid', 'name', 'cpu_percent', 'memory_info', 'io_counters', 'num_fds']
    ):
        try:
            info = proc.info
            pid = info['pid']

            # CPU usage (may be 0 on first call)
            cpu_percent = info.get('cpu_percent') or 0.0

            # Memory: resident set size in MB
            mem_mb = 0.0
            mem_info = info.get('memory_info')
            if mem_info:
                mem_mb = mem_info.rss / 1024 / 1024

            # IO: sum of read/write bytes in MB
            io_total_mb = 0.0
            io_counters = info.get('io_counters')
            if io_counters:
                io_total_mb = (
                    io_counters.read_bytes + io_counters.write_bytes
                ) / 1024 / 1024

            # NET: count TCP entries from /proc/[pid]/net/tcp
            net_connections = 0
            tcp_path = f'/proc/{pid}/net/tcp'
            try:
                if os.path.exists(tcp_path):
                    with open(tcp_path, 'r') as f:
                        lines = f.readlines()
                        # subtract header
                        net_connections = max(0, len(lines) - 1)
            except (IOError, PermissionError):
                pass

            # FD: number of file descriptors
            num_fds = info.get('num_fds') or 0

            processes.append({
                'pid': pid,
                'name': info.get('name') or 'unknown',
                'cpu': float(cpu_percent),
                'mem': float(mem_mb),
                'io': float(io_total_mb),
                'net': int(net_connections),
                'fd': int(num_fds),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    # Sort by CPU usage and take top 20 for clarity
    processes.sort(key=lambda p: p['cpu'], reverse=True)
    matrix = processes[:20]

    return matrix

# API Endpoints

@app.route('/')
def index():
    """Main page"""
    # Serve index.html from root directory
    return send_from_directory('.', 'index.html')

@app.route('/linux-crypto-subsystem')
def linux_crypto_subsystem_page():
    """SEO-friendly Linux crypto subsystem page."""
    return render_template('linux-crypto-subsystem.html')

@app.route('/crypto')
def crypto_page_legacy():
    """Legacy path redirect to Linux crypto subsystem page."""
    return redirect('/linux-crypto-subsystem', code=301)

@app.route('/linux-security-subsystem')
def linux_security_subsystem_page():
    """SEO-friendly Linux security subsystem page."""
    return render_template('linux-security-subsystem.html')

@app.route('/security')
def security_page_legacy():
    """Legacy path redirect to Linux security subsystem page."""
    return redirect('/linux-security-subsystem', code=301)

@app.route('/linux-processes-subsystem')
def linux_processes_subsystem_page():
    """SEO-friendly Linux processes subsystem page."""
    return render_template('linux-processes-subsystem.html')

@app.route('/processes')
def processes_page_legacy():
    """Legacy path redirect to Linux processes subsystem page."""
    return redirect('/linux-processes-subsystem', code=301)


@app.route('/linux-crypto-subsystem.html')
def linux_crypto_subsystem_html():
    return redirect('/linux-crypto-subsystem', code=301)


@app.route('/linux-security-subsystem.html')
def linux_security_subsystem_html():
    return redirect('/linux-security-subsystem', code=301)


@app.route('/linux-processes-subsystem.html')
def linux_processes_subsystem_html():
    return redirect('/linux-processes-subsystem', code=301)


@app.route('/linux-memory-subsystem')
def linux_memory_subsystem_page():
    """SEO-friendly Linux memory subsystem page."""
    return render_template('linux-memory-subsystem.html')


@app.route('/linux-memory-subsystem.html')
def linux_memory_subsystem_html():
    return redirect('/linux-memory-subsystem', code=301)

@app.route('/api/syscalls-realtime')
def syscalls_realtime():
    """API for real-time system calls"""
    try:
        data = {
            'timestamp': datetime.now().isoformat(),
            'syscalls': get_real_system_calls(),
            'cpu_usage': psutil.cpu_percent(interval=1),
            'memory_usage': psutil.virtual_memory().percent,
            'system_info': get_system_info()
        }
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/kernel-data')
def kernel_data():
    """API for kernel data"""
    try:
        data = {
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
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/process-kernel-map')
def process_kernel_map():
    """API for process to kernel subsystem mapping"""
    try:
        data = get_process_kernel_map()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/processes')
def get_processes():
    """API for getting all Linux processes"""
    try:
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
        
        return jsonify({'processes': processes})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/health')
def health_check():
    """Application health check"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'system_info': get_system_info()
    })

# Static files handling
@app.route('/static/<path:filename>')
def static_files(filename):
    """Serve static files"""
    return send_from_directory(app.config['STATIC_FOLDER'], filename)

# Error handling
# Active connections functions
# Nginx files functions
def get_nginx_open_files():
    """Get open files for Nginx process"""
    try:
        import psutil
        nginx_processes = []
        for proc in psutil.process_iter(["pid", "name", "open_files"]):
            try:
                if proc.info["name"] and "nginx" in proc.info["name"].lower():
                    nginx_processes.append(proc.info["pid"])
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        
        if nginx_processes:
            # Get open files for first nginx process
            proc = psutil.Process(nginx_processes[0])
            open_files = proc.open_files()
            
            # Filter and format file paths
            files = []
            for file in open_files:
                if file.path:
                    # Extract relative path from full path
                    if "/etc/nginx/" in file.path:
                        rel_path = file.path.split("/etc/nginx/")[-1]
                        files.append({"path": f"nginx/{rel_path}", "type": "config"})
                    elif "/var/log/nginx/" in file.path:
                        rel_path = file.path.split("/var/log/nginx/")[-1]
                        files.append({"path": f"nginx/logs/{rel_path}", "type": "log"})
                    else:
                        files.append({"path": file.path, "type": "other"})
            
            return files[:10]  # Limit to 10 files
        else:
            return get_mock_nginx_files()
            
    except Exception as e:
        print(f"Error getting nginx files: {e}")
        return get_mock_nginx_files()

def get_mock_nginx_files():
    """Mock data for nginx files"""
    return [
        {"path": "nginx/nginx.conf", "type": "config"},
        {"path": "nginx/sites-enabled/default", "type": "config"},
        {"path": "nginx/conf.d/default.conf", "type": "config"},
        {"path": "nginx/logs/access.log", "type": "log"},
        {"path": "nginx/logs/error.log", "type": "log"}
    ]

@app.route("/api/nginx-files")
def nginx_files():
    """API for nginx open files"""
    try:
        files = get_nginx_open_files()
        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
def get_active_connections():
    """Get active network connections"""
    try:
        connections = []
        # Get TCP connections
        with open("/proc/net/tcp", "r") as f:
            lines = f.readlines()[1:]  # Skip header
            for line in lines:
                parts = line.strip().split()
                if len(parts) >= 4:
                    local_addr = parts[1]
                    remote_addr = parts[2]
                    state = parts[3]
                    
                    # Convert hex addresses to readable format
                    # IP addresses in /proc/net/tcp are stored in little-endian format
                    def hex_to_ip(hex_str):
                        # Reverse the hex string to convert from little-endian
                        hex_bytes = [hex_str[i:i+2] for i in range(0, 8, 2)]
                        hex_bytes.reverse()
                        return ".".join([str(int(b, 16)) for b in hex_bytes])
                    
                    local_ip = hex_to_ip(local_addr.split(":")[0])
                    local_port = int(local_addr.split(":")[1], 16)
                    
                    if remote_addr != "00000000:0000":  # Not listening
                        remote_ip = hex_to_ip(remote_addr.split(":")[0])
                        remote_port = int(remote_addr.split(":")[1], 16)
                        
                        connections.append({
                            "local": f"{local_ip}:{local_port}",
                            "remote": f"{remote_ip}:{remote_port}",
                            "state": state,
                            "type": "TCP"
                        })
        
        # Limit to first 20 connections for display
        return connections[:20]
        
    except Exception as e:
        print(f"Error getting active connections: {e}")
        return get_mock_active_connections()

def get_mock_active_connections():
    """Mock data for active connections"""
    return [
        {"local": "127.0.0.1:22", "remote": "192.168.1.100:54321", "state": "01", "type": "TCP"},
        {"local": "0.0.0.0:80", "remote": "10.0.0.50:12345", "state": "01", "type": "TCP"},
        {"local": "127.0.0.1:3306", "remote": "172.16.0.10:65432", "state": "01", "type": "TCP"},
        {"local": "0.0.0.0:443", "remote": "203.0.113.0:54321", "state": "01", "type": "TCP"},
        {"local": "127.0.0.1:5001", "remote": "192.168.1.101:12345", "state": "01", "type": "TCP"}
    ]

def _tcp_state_name(code):
    states = {
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
        "0B": "CLOSING"
    }
    return states.get(str(code).upper(), str(code).upper())

def _get_default_iface():
    try:
        with open("/proc/net/route", "r") as f:
            lines = f.readlines()[1:]
        for line in lines:
            parts = line.strip().split()
            if len(parts) < 11:
                continue
            iface = parts[0]
            destination = parts[1]
            flags = int(parts[3], 16)
            if destination == "00000000" and (flags & 0x2):
                return iface
    except (OSError, ValueError):
        pass
    # Fallback: first non-loopback interface.
    try:
        pernic = psutil.net_io_counters(pernic=True)
        for iface in pernic.keys():
            if iface != "lo":
                return iface
    except Exception:
        pass
    return "lo"

def _parse_netstat_tcpext():
    try:
        with open("/proc/net/netstat", "r") as f:
            lines = [line.strip() for line in f if line.strip()]
        for i in range(0, len(lines) - 1, 2):
            header = lines[i].split()
            values = lines[i + 1].split()
            if not header or header[0] != "TcpExt:":
                continue
            if not values or values[0] != "TcpExt:":
                continue
            fields = header[1:]
            nums = values[1:]
            if len(fields) != len(nums):
                continue
            mapping = {}
            for name, val in zip(fields, nums):
                try:
                    mapping[name] = int(val)
                except ValueError:
                    mapping[name] = 0
            return mapping
    except OSError:
        return {}
    return {}

def _parse_snmp_section(section_name):
    try:
        with open("/proc/net/snmp", "r") as f:
            lines = [line.strip() for line in f if line.strip()]
        for i in range(0, len(lines) - 1, 2):
            header = lines[i].split()
            values = lines[i + 1].split()
            expected_prefix = f"{section_name}:"
            if not header or header[0] != expected_prefix:
                continue
            if not values or values[0] != expected_prefix:
                continue
            fields = header[1:]
            nums = values[1:]
            if len(fields) != len(nums):
                continue
            out = {}
            for name, val in zip(fields, nums):
                try:
                    out[name] = int(val)
                except ValueError:
                    out[name] = 0
            return out
    except OSError:
        return {}
    return {}

def _get_ss_tcp_metrics():
    """Extract cwnd/rtt/retrans and tx queue from ss -tin (best effort)."""
    ss_cmd = resolve_binary("ss")
    if not ss_cmd:
        return {}
    try:
        result = subprocess.run(
            [ss_cmd, "-tin"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False
        )
        lines = (result.stdout or "").splitlines()
    except (subprocess.TimeoutExpired, OSError):
        return {}

    for idx, line in enumerate(lines):
        if not line.strip().startswith("ESTAB"):
            continue
        metrics = {}
        parts = line.split()
        # ESTAB Recv-Q Send-Q Local:Port Peer:Port
        if len(parts) >= 4:
            try:
                metrics["tx_queue"] = int(parts[2])
                metrics["rx_queue"] = int(parts[1])
            except ValueError:
                pass

        details = lines[idx + 1] if (idx + 1) < len(lines) else ""
        rtt_match = re.search(r'rtt:(\d+(?:\.\d+)?)/', details)
        cwnd_match = re.search(r'cwnd:(\d+)', details)
        retrans_match = re.search(r'retrans:(\d+)(?:/\d+)?', details)
        if rtt_match:
            metrics["rtt_ms"] = float(rtt_match.group(1))
        if cwnd_match:
            metrics["cwnd"] = int(cwnd_match.group(1))
        if retrans_match:
            metrics["retrans_now"] = int(retrans_match.group(1))
        if metrics:
            return metrics
    return {}

def _read_diskstats():
    stats = {}
    try:
        with open("/proc/diskstats", "r") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 14:
                    continue
                name = parts[2]
                # Skip loop/ram for cleaner belt.
                if name.startswith("loop") or name.startswith("ram"):
                    continue
                try:
                    sectors_read = int(parts[5])
                    sectors_written = int(parts[9])
                    stats[name] = sectors_read + sectors_written
                except ValueError:
                    continue
    except OSError:
        pass
    return stats

def _read_tty_irq_total():
    total = 0
    try:
        with open("/proc/interrupts", "r") as f:
            for line in f:
                lower = line.lower()
                if "tty" not in lower and "serial" not in lower:
                    continue
                parts = line.split()
                # Sum first CPU counters columns.
                for token in parts[1:9]:
                    if token.isdigit():
                        total += int(token)
    except OSError:
        pass
    return total

def _safe_read_text(path):
    try:
        with open(path, "r") as f:
            return f.read().strip()
    except OSError:
        return None

def _read_major_minor_from_devfile(devfile_path):
    value = _safe_read_text(devfile_path)
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

def _read_interrupt_lines():
    out = []
    try:
        with open("/proc/interrupts", "r") as f:
            for line in f:
                if ":" not in line:
                    continue
                raw = line.strip()
                parts = raw.split()
                if len(parts) < 2:
                    continue
                irq_sum = 0
                for token in parts[1:]:
                    if token.isdigit():
                        irq_sum += int(token)
                    else:
                        break
                out.append((raw.lower(), irq_sum))
    except OSError:
        pass
    return out

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
    disk_now = _read_diskstats()
    block_devices = _collect_block_devices(disk_now, dt)
    net_devices, net_now = _collect_net_devices(dt)
    char_devices = _collect_char_devices()
    extra_devices = _collect_misc_input_gpu_usb()

    devices = block_devices + net_devices + char_devices + extra_devices
    interrupt_lines = _read_interrupt_lines()

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
    DEVICES_PREV["tty_irq_total"] = _read_tty_irq_total()
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
    now = time.time()
    try:
        usage = psutil.disk_usage("/")
    except Exception:
        usage = None

    used_percent = float(usage.percent) if usage else 0.0
    total_gb = round((usage.total / (1024 ** 3)), 2) if usage else 0.0
    used_gb = round((usage.used / (1024 ** 3)), 2) if usage else 0.0
    free_gb = round((usage.free / (1024 ** 3)), 2) if usage else 0.0

    io = psutil.disk_io_counters()
    write_bytes = int(io.write_bytes) if io else 0
    prev_ts = FILESYSTEM_PREV["timestamp"]
    prev_write = FILESYSTEM_PREV["write_bytes"]
    dt = max(0.001, now - prev_ts) if prev_ts else 1.0
    write_bps = 0.0 if prev_write is None else max(0.0, (write_bytes - prev_write) / dt)

    rows = 20
    cols = 34
    total_blocks = rows * cols
    used_ratio_global = max(0.0, min(1.0, used_percent / 100.0))

    # Logical filesystem zones for a visible map layout.
    zone_defs = [
        {"id": "root", "name": "/", "path": "/", "base": 1.5, "bias": 0.00},
        {"id": "var", "name": "/var", "path": "/var", "base": 1.6, "bias": 0.10},
        {"id": "home", "name": "/home", "path": "/home", "base": 1.35, "bias": 0.06},
        {"id": "usr", "name": "/usr", "path": "/usr", "base": 1.45, "bias": 0.08},
        {"id": "etc", "name": "/etc", "path": "/etc", "base": 1.0, "bias": -0.03},
        {"id": "tmp", "name": "/tmp", "path": "/tmp", "base": 1.0, "bias": -0.02},
        {"id": "dev", "name": "/dev", "path": "/dev", "base": 0.85, "bias": -0.06},
    ]

    activity_counts = {z["id"]: 0 for z in zone_defs}

    # Best-effort activity sampling from open file descriptors by path prefix.
    try:
        processes = list(psutil.process_iter(["pid"]))[:90]
        zone_paths = sorted([(z["path"], z["id"]) for z in zone_defs], key=lambda x: len(x[0]), reverse=True)
        for proc in processes:
            try:
                open_files = proc.open_files()[:28]
            except (psutil.AccessDenied, psutil.NoSuchProcess, psutil.ZombieProcess, OSError):
                continue
            for of in open_files:
                fpath = str(getattr(of, "path", "") or "")
                if not fpath.startswith("/"):
                    continue
                for prefix, zone_id in zone_paths:
                    if prefix == "/":
                        continue
                    if fpath == prefix or fpath.startswith(prefix + "/"):
                        activity_counts[zone_id] += 1
                        break
                else:
                    activity_counts["root"] += 1
    except Exception:
        pass

    weighted = []
    for z in zone_defs:
        act = float(activity_counts.get(z["id"], 0))
        z["activity"] = act
        weighted.append(max(0.2, z["base"] + act * 0.08))

    total_weight = sum(weighted) or 1.0
    row_counts = [max(1, int(round(rows * w / total_weight))) for w in weighted]
    # Normalize row counts to exact total rows.
    while sum(row_counts) > rows:
        idx = max(range(len(row_counts)), key=lambda i: row_counts[i])
        if row_counts[idx] > 1:
            row_counts[idx] -= 1
        else:
            break
    while sum(row_counts) < rows:
        idx = max(range(len(weighted)), key=lambda i: weighted[i])
        row_counts[idx] += 1

    writing_ratio = min(0.20, write_bps / (300 * 1024 * 1024))
    writing_blocks_total = int(round(total_blocks * writing_ratio))
    writing_blocks_total = max(0, min(total_blocks, writing_blocks_total))

    blocks = []
    zones = []
    cursor_row = 0
    zone_used_total = 0
    zone_writing_total = 0
    zone_scores = []
    for z in zone_defs:
        zone_scores.append(z["activity"] + 1.0)
    score_sum = sum(zone_scores) or 1.0

    seed = int(now * 3)
    for idx, z in enumerate(zone_defs):
        row_span = row_counts[idx]
        row_start = cursor_row
        row_end = min(rows - 1, cursor_row + row_span - 1)
        cursor_row += row_span

        zone_cells = max(1, (row_end - row_start + 1) * cols)
        local_used_ratio = max(0.05, min(0.98, used_ratio_global + z["bias"] + min(0.18, z["activity"] / 120.0)))
        zone_used = int(round(zone_cells * local_used_ratio))
        zone_used = max(0, min(zone_cells, zone_used))
        zone_used_total += zone_used

        zone_write_share = zone_scores[idx] / score_sum
        zone_writing = int(round(writing_blocks_total * zone_write_share))
        zone_writing = max(0, min(zone_used, zone_writing))
        zone_writing_total += zone_writing
        inode_pressure = int(max(0, min(
            100,
            round((z["activity"] * 2.6) + (zone_writing * 0.9) + (local_used_ratio * 38.0))
        )))

        cell_index = 0
        for r in range(row_start, row_end + 1):
            for c in range(cols):
                state = "used" if cell_index < zone_used else "free"
                blocks.append({
                    "r": r,
                    "c": c,
                    "i": r * cols + c,
                    "zone_id": z["id"],
                    "state": state
                })
                cell_index += 1

        if zone_writing > 0 and zone_used > 0:
            # Convert some used cells into writing cells within this zone segment.
            zone_block_indices = [
                i for i, b in enumerate(blocks)
                if b["zone_id"] == z["id"] and b["state"] == "used"
            ]
            used_len = len(zone_block_indices)
            for n in range(min(zone_writing, used_len)):
                pick = (seed * 31 + idx * 67 + n * 43) % used_len
                blocks[zone_block_indices[pick]]["state"] = "writing"

        zones.append({
            "id": z["id"],
            "name": z["name"],
            "path": z["path"],
            "row_start": row_start,
            "row_end": row_end,
            "activity": int(z["activity"]),
            "used_percent": round(local_used_ratio * 100.0, 1),
            "writing_blocks": zone_writing,
            "inode_pressure": inode_pressure
        })

    writing_blocks = sum(1 for b in blocks if b["state"] == "writing")

    FILESYSTEM_PREV["timestamp"] = now
    FILESYSTEM_PREV["write_bytes"] = write_bytes

    inode_pressure_global = 0
    if zones:
        inode_pressure_global = int(round(sum(int(z.get("inode_pressure", 0)) for z in zones) / len(zones)))

    return {
        "timestamp": datetime.now().isoformat(),
        "rows": rows,
        "cols": cols,
        "zones": zones,
        "blocks": blocks,
        "meta": {
            "total_gb": total_gb,
            "used_gb": used_gb,
            "free_gb": free_gb,
            "used_percent": round(used_percent, 2),
            "write_bps": round(write_bps, 2),
            "writing_blocks": writing_blocks,
            "inode_pressure": inode_pressure_global
        }
    }

def get_network_stack_realtime():
    now = time.time()
    iface = _get_default_iface()
    pernic = psutil.net_io_counters(pernic=True)
    iface_stats = pernic.get(iface)
    all_connections = get_active_connections()
    interesting = [
        c for c in all_connections
        if not c["remote"].startswith("127.0.0.1") and not c["remote"].startswith("0.0.0.0")
    ]
    flow = interesting[0] if interesting else (all_connections[0] if all_connections else None)
    if flow:
        flow = {
            "local": flow.get("local"),
            "remote": flow.get("remote"),
            "type": str(flow.get("type", "TCP")).upper(),
            "state_code": flow.get("state", "00"),
            "state_name": _tcp_state_name(flow.get("state", "00"))
        }

    tcpext = _parse_netstat_tcpext()
    ip_stats = _parse_snmp_section("Ip")
    tcp_stats = _parse_snmp_section("Tcp")
    ss_metrics = _get_ss_tcp_metrics()

    retrans_total = tcpext.get("RetransSegs", 0)
    ip_in_total = ip_stats.get("InReceives", 0)
    ip_out_total = ip_stats.get("OutRequests", 0)
    ip_discards_total = ip_stats.get("InDiscards", 0) + ip_stats.get("OutDiscards", 0)

    established = 0
    try:
        with open("/proc/net/tcp", "r") as f:
            for line in f.readlines()[1:]:
                parts = line.strip().split()
                if len(parts) >= 4 and parts[3] == "01":
                    established += 1
    except OSError:
        established = 0

    prev_ts = NETWORK_STACK_PREV["timestamp"]
    dt = max(0.001, now - prev_ts) if prev_ts else 1.0

    def rate(curr, prev):
        if prev is None:
            return 0.0
        return max(0.0, (curr - prev) / dt)

    retrans_per_sec = rate(retrans_total, NETWORK_STACK_PREV["tcpext_retrans"])
    ip_in_per_sec = rate(ip_in_total, NETWORK_STACK_PREV["ip_in"])
    ip_out_per_sec = rate(ip_out_total, NETWORK_STACK_PREV["ip_out"])
    ip_drop_per_sec = rate(ip_discards_total, NETWORK_STACK_PREV["ip_discards"])

    rx_per_sec = 0.0
    tx_per_sec = 0.0
    iface_drop_per_sec = 0.0
    rx_bytes = iface_stats.bytes_recv if iface_stats else 0
    tx_bytes = iface_stats.bytes_sent if iface_stats else 0
    iface_drops = (iface_stats.dropin + iface_stats.dropout) if iface_stats else 0
    if NETWORK_STACK_PREV["iface_rx"] is not None:
        rx_per_sec = max(0.0, (rx_bytes - NETWORK_STACK_PREV["iface_rx"]) / dt)
    if NETWORK_STACK_PREV["iface_tx"] is not None:
        tx_per_sec = max(0.0, (tx_bytes - NETWORK_STACK_PREV["iface_tx"]) / dt)
    if NETWORK_STACK_PREV["iface_drops"] is not None:
        iface_drop_per_sec = max(0.0, (iface_drops - NETWORK_STACK_PREV["iface_drops"]) / dt)

    NETWORK_STACK_PREV["timestamp"] = now
    NETWORK_STACK_PREV["tcpext_retrans"] = retrans_total
    NETWORK_STACK_PREV["ip_in"] = ip_in_total
    NETWORK_STACK_PREV["ip_out"] = ip_out_total
    NETWORK_STACK_PREV["ip_discards"] = ip_discards_total
    NETWORK_STACK_PREV["iface_rx"] = rx_bytes
    NETWORK_STACK_PREV["iface_tx"] = tx_bytes
    NETWORK_STACK_PREV["iface_drops"] = iface_drops

    packets_per_sec = ip_in_per_sec + ip_out_per_sec
    drop_ratio = (ip_drop_per_sec / packets_per_sec) if packets_per_sec > 0 else 0.0
    throughput_mb_s = (rx_per_sec + tx_per_sec) / (1024 * 1024)

    retrans_prob = min(0.75, retrans_per_sec / 600.0)
    drop_prob = min(0.75, (ip_drop_per_sec / 500.0) + (drop_ratio * 8.0))
    packet_speed = max(1.4, min(4.8, 1.8 + throughput_mb_s / 8.0))

    socket_activity = min(1.0, (len(all_connections) / 80.0) + (retrans_per_sec / 250.0))
    tcp_activity = min(1.0, (ss_metrics.get("cwnd", 0) / 80.0) + (retrans_per_sec / 300.0))
    ip_activity = min(1.0, packets_per_sec / 15000.0)
    netfilter_activity = min(1.0, (ip_drop_per_sec / 120.0) + (drop_ratio * 6.0))
    driver_activity = min(1.0, ((rx_per_sec + tx_per_sec) / (60 * 1024 * 1024)) + (iface_drop_per_sec / 40.0))
    nic_activity = min(1.0, ((rx_per_sec + tx_per_sec) / (80 * 1024 * 1024)))

    return {
        "timestamp": datetime.now().isoformat(),
        "flow": flow,
        "layer_metrics": {
            "userspace": {
                "active_processes": len(psutil.pids())
            },
            "socket_api": {
                "active_sockets": len(all_connections),
                "established": established,
                "retransmits_per_sec": round(retrans_per_sec, 2)
            },
            "tcp_udp": {
                "established": established,
                "retrans_per_sec": round(retrans_per_sec, 2),
                "cwnd": int(ss_metrics.get("cwnd", 0)),
                "rtt_ms": round(float(ss_metrics.get("rtt_ms", 0.0)), 2),
                "tx_queue": int(ss_metrics.get("tx_queue", 0))
            },
            "ip": {
                "in_packets_per_sec": round(ip_in_per_sec, 2),
                "out_packets_per_sec": round(ip_out_per_sec, 2),
                "drop_per_sec": round(ip_drop_per_sec, 3),
                "drop_ratio": round(drop_ratio, 5)
            },
            "netfilter": {
                "drop_per_sec": round(ip_drop_per_sec, 3),
                "drop_ratio": round(drop_ratio, 5)
            },
            "driver": {
                "iface": iface,
                "rx_mb_s": round(rx_per_sec / (1024 * 1024), 3),
                "tx_mb_s": round(tx_per_sec / (1024 * 1024), 3),
                "tx_queue": int(ss_metrics.get("tx_queue", 0)),
                "drops_per_sec": round(iface_drop_per_sec, 3)
            },
            "nic": {
                "iface": iface,
                "rx_errors": int(getattr(iface_stats, "errin", 0)) if iface_stats else 0,
                "tx_errors": int(getattr(iface_stats, "errout", 0)) if iface_stats else 0,
                "drops_total": int(iface_drops)
            }
        },
        "layer_activity": {
            "userspace": min(1.0, len(psutil.pids()) / 400.0),
            "socket": round(socket_activity, 4),
            "tcp": round(tcp_activity, 4),
            "ip": round(ip_activity, 4),
            "netfilter": round(netfilter_activity, 4),
            "driver": round(driver_activity, 4),
            "nic": round(nic_activity, 4)
        },
        "signals": {
            "drop_probability": round(drop_prob, 4),
            "retransmit_probability": round(retrans_prob, 4),
            "packet_speed": round(packet_speed, 3)
        },
        "throughput_mb_s": round(throughput_mb_s, 3),
        "tcp_counters": {
            "in_segs": int(tcp_stats.get("InSegs", 0)),
            "out_segs": int(tcp_stats.get("OutSegs", 0)),
            "retrans_segs_total": int(retrans_total)
        }
    }

def _safe_read_text(path):
    try:
        with open(path, "r") as f:
            return f.read().strip()
    except (OSError, PermissionError):
        return None

def _parse_cgroup_path(pid):
    cgroup_text = _safe_read_text(f"/proc/{pid}/cgroup")
    if not cgroup_text:
        return "/"
    chosen = "/"
    for line in cgroup_text.splitlines():
        parts = line.split(":")
        if len(parts) != 3:
            continue
        _, controllers, path = parts
        path = path.strip() or "/"
        # Prefer cgroup v2 unified hierarchy entry "0::/path"
        if controllers == "":
            return path
        if path and path != "/":
            chosen = path
    return chosen

def _read_namespace_inode(pid, ns_name):
    ns_link = f"/proc/{pid}/ns/{ns_name}"
    try:
        target = os.readlink(ns_link)
    except (OSError, PermissionError):
        return None
    match = re.search(r'\[(\d+)\]', target)
    return match.group(1) if match else target

def _read_cgroup_v2_stats(cgroup_path):
    root = "/sys/fs/cgroup"
    rel = cgroup_path.lstrip("/")
    base = os.path.join(root, rel) if rel else root

    cpu_max_text = _safe_read_text(os.path.join(base, "cpu.max"))
    cpu_quota_cores = None
    if cpu_max_text:
        parts = cpu_max_text.split()
        if len(parts) >= 2 and parts[0] != "max":
            try:
                quota = float(parts[0])
                period = float(parts[1])
                if period > 0:
                    cpu_quota_cores = round(quota / period, 2)
            except ValueError:
                cpu_quota_cores = None

    mem_current = _safe_read_text(os.path.join(base, "memory.current"))
    mem_max = _safe_read_text(os.path.join(base, "memory.max"))
    pids_current = _safe_read_text(os.path.join(base, "pids.current"))
    pids_max = _safe_read_text(os.path.join(base, "pids.max"))
    io_stat_text = _safe_read_text(os.path.join(base, "io.stat"))

    memory_current_mb = None
    memory_max_mb = None
    try:
        if mem_current is not None:
            memory_current_mb = round(int(mem_current) / (1024 * 1024), 1)
    except ValueError:
        memory_current_mb = None

    try:
        if mem_max and mem_max != "max":
            memory_max_mb = round(int(mem_max) / (1024 * 1024), 1)
    except ValueError:
        memory_max_mb = None

    io_bytes = None
    if io_stat_text:
        total = 0
        for line in io_stat_text.splitlines():
            rbytes_match = re.search(r'rbytes=(\d+)', line)
            wbytes_match = re.search(r'wbytes=(\d+)', line)
            if rbytes_match:
                total += int(rbytes_match.group(1))
            if wbytes_match:
                total += int(wbytes_match.group(1))
        io_bytes = total

    return {
        "cpu_quota_cores": cpu_quota_cores,
        "memory_current_mb": memory_current_mb,
        "memory_max_mb": memory_max_mb,
        "pids_current": int(pids_current) if pids_current and pids_current.isdigit() else None,
        "pids_max": None if pids_max in (None, "max") else (int(pids_max) if pids_max.isdigit() else None),
        "io_total_mb": round(io_bytes / (1024 * 1024), 1) if io_bytes is not None else None
    }

def get_isolation_context():
    """Aggregate namespace and cgroup context for UI layer."""
    namespace_keys = ["mnt", "pid", "net", "ipc", "uts", "user"]
    namespace_labels = {
        "mnt": "MNT",
        "pid": "PID",
        "net": "NET",
        "ipc": "IPC",
        "uts": "UTS",
        "user": "USER"
    }
    namespace_counts = {k: {} for k in namespace_keys}
    cgroup_aggregates = {}
    total_scanned = 0

    for proc in psutil.process_iter(["pid", "name", "memory_info"]):
        try:
            pid = proc.info["pid"]
            total_scanned += 1

            cgroup_path = _parse_cgroup_path(pid)
            agg = cgroup_aggregates.setdefault(cgroup_path, {
                "path": cgroup_path,
                "process_count": 0,
                "memory_mb_sum": 0.0,
                "sample_processes": []
            })
            agg["process_count"] += 1

            mem_info = proc.info.get("memory_info")
            if mem_info:
                agg["memory_mb_sum"] += (mem_info.rss / (1024 * 1024))

            if len(agg["sample_processes"]) < 4:
                process_name = proc.info.get("name") or "unknown"
                agg["sample_processes"].append(process_name)

            for ns_name in namespace_keys:
                inode = _read_namespace_inode(pid, ns_name)
                if inode:
                    ns_map = namespace_counts[ns_name]
                    ns_map[inode] = ns_map.get(inode, 0) + 1
        except (psutil.NoSuchProcess, psutil.AccessDenied, KeyError):
            continue

    namespaces = []
    for ns_name in namespace_keys:
        entries = namespace_counts[ns_name]
        unique_count = len(entries)
        dominant_inode = None
        dominant_count = 0
        if entries:
            dominant_inode, dominant_count = max(entries.items(), key=lambda kv: kv[1])
        activity = round((dominant_count / total_scanned), 3) if total_scanned > 0 else 0
        namespaces.append({
            "id": ns_name,
            "label": namespace_labels[ns_name],
            "unique_count": unique_count,
            "dominant_inode": dominant_inode,
            "dominant_count": dominant_count,
            "activity": activity
        })

    top_cgroups = sorted(
        cgroup_aggregates.values(),
        key=lambda x: (x["process_count"], x["memory_mb_sum"]),
        reverse=True
    )[:4]

    for item in top_cgroups:
        stats = _read_cgroup_v2_stats(item["path"])
        item["memory_mb_sum"] = round(item["memory_mb_sum"], 1)
        item.update(stats)

    return {
        "timestamp": datetime.now().isoformat(),
        "processes_scanned": total_scanned,
        "namespaces": namespaces,
        "top_cgroups": top_cgroups
    }

def get_route_hint(remote_ip):
    """Fallback path hint using Linux routing table when traceroute tools are absent."""
    ip_cmd = resolve_binary("ip")
    if not ip_cmd:
        return {
            "remote_ip": remote_ip,
            "tool": None,
            "reached": False,
            "hop_count": 0,
            "hops": [],
            "note": "Path tools unavailable on host"
        }

    try:
        result = subprocess.run(
            [ip_cmd, "-o", "route", "get", remote_ip],
            capture_output=True,
            text=True,
            timeout=2,
            check=False
        )
        line = (result.stdout or "").strip()
        if not line:
            return {
                "remote_ip": remote_ip,
                "tool": "ip-route",
                "reached": False,
                "hop_count": 0,
                "hops": [],
                "note": "No route information available"
            }

        via_match = re.search(r'\svia\s(\d{1,3}(?:\.\d{1,3}){3})', line)
        dev_match = re.search(r'\sdev\s([A-Za-z0-9_.:-]+)', line)
        src_match = re.search(r'\ssrc\s(\d{1,3}(?:\.\d{1,3}){3})', line)

        hops = []
        if via_match:
            hops.append({
                "hop": 1,
                "target": via_match.group(1),
                "rtt_ms": None
            })
            hops.append({
                "hop": 2,
                "target": remote_ip,
                "rtt_ms": None
            })
        else:
            hops.append({
                "hop": 1,
                "target": remote_ip,
                "rtt_ms": None
            })

        note_parts = ["Traceroute not installed, showing kernel route hint"]
        if dev_match:
            note_parts.append(f"dev={dev_match.group(1)}")
        if src_match:
            note_parts.append(f"src={src_match.group(1)}")

        return {
            "remote_ip": remote_ip,
            "tool": "ip-route",
            "reached": False,
            "hop_count": len(hops),
            "hops": hops,
            "note": ", ".join(note_parts)
        }
    except (subprocess.TimeoutExpired, OSError):
        return {
            "remote_ip": remote_ip,
            "tool": "ip-route",
            "reached": False,
            "hop_count": 0,
            "hops": [],
            "note": "Route hint lookup timed out"
        }

def get_traceroute_info(remote_ip, max_hops=8):
    """Get traceroute/tracepath information for a remote IP with short timeout."""
    try:
        target_ip = ipaddress.ip_address(remote_ip)
        # Skip loopback/local addresses - traceroute is not meaningful here.
        if target_ip.is_loopback or target_ip.is_unspecified:
            return {
                "remote_ip": remote_ip,
                "tool": None,
                "reached": False,
                "hop_count": 0,
                "hops": [],
                "note": "Local address, traceroute skipped"
            }
    except ValueError:
        raise ValueError("Invalid IP address")

    now = time.time()
    cached = TRACEROUTE_CACHE.get(remote_ip)
    if cached and (now - cached["timestamp"]) < TRACEROUTE_CACHE_TTL_SECONDS:
        return cached["data"]

    traceroute_cmd = resolve_binary("traceroute")
    tracepath_cmd = resolve_binary("tracepath")
    cmd = None
    tool = None
    if traceroute_cmd:
        cmd = [traceroute_cmd, "-n", "-m", str(max_hops), "-q", "1", "-w", "1", remote_ip]
        tool = "traceroute"
    elif tracepath_cmd:
        cmd = [tracepath_cmd, "-n", "-m", str(max_hops), remote_ip]
        tool = "tracepath"
    else:
        data = get_route_hint(remote_ip)
        TRACEROUTE_CACHE[remote_ip] = {"timestamp": now, "data": data}
        return data

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=7,
            check=False
        )
        output = (result.stdout or "").strip()
        if not output and result.stderr:
            output = result.stderr.strip()
    except subprocess.TimeoutExpired:
        return {
            "remote_ip": remote_ip,
            "tool": tool,
            "reached": False,
            "hop_count": 0,
            "hops": [],
            "note": "Traceroute timed out"
        }

    hops = []
    for raw_line in output.splitlines():
        line = raw_line.strip()
        hop_match = re.match(r'^(\d+)\s+', line)
        if not hop_match:
            tracepath_match = re.match(r'^(\d+):\s+', line)
            if not tracepath_match:
                continue
            hop_idx = int(tracepath_match.group(1))
        else:
            hop_idx = int(hop_match.group(1))

        if "*" in line and re.search(r'\*\s*\*\s*\*', line):
            hops.append({
                "hop": hop_idx,
                "target": "*",
                "rtt_ms": None
            })
            continue

        ip_match = re.search(r'(\d{1,3}(?:\.\d{1,3}){3})', line)
        rtt_match = re.search(r'(\d+(?:\.\d+)?)\s*ms', line)
        hops.append({
            "hop": hop_idx,
            "target": ip_match.group(1) if ip_match else "?",
            "rtt_ms": float(rtt_match.group(1)) if rtt_match else None
        })

    reached = any(h.get("target") == remote_ip for h in hops)
    data = {
        "remote_ip": remote_ip,
        "tool": tool,
        "reached": reached,
        "hop_count": len(hops),
        "hops": hops[:max_hops],
        "note": None
    }
    TRACEROUTE_CACHE[remote_ip] = {"timestamp": now, "data": data}
    return data

@app.route("/api/active-connections")
def active_connections():
    """API for active network connections"""
    try:
        connections = get_active_connections()
        return jsonify({"connections": connections})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/traceroute")
def traceroute_info():
    """API endpoint for traceroute path to remote IP."""
    try:
        remote_ip = request.args.get("ip", "").strip()
        if not remote_ip:
            return jsonify({"error": "Missing 'ip' query parameter"}), 400

        data = get_traceroute_info(remote_ip)
        return jsonify(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/network-stack-realtime")
def network_stack_realtime():
    """Live telemetry for Network Stack visualization."""
    try:
        return jsonify(get_network_stack_realtime())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/devices-realtime")
def devices_realtime():
    """Live telemetry for Devices belt visualization."""
    try:
        return jsonify(get_devices_realtime())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/filesystem-blocks")
def filesystem_blocks():
    """Live block-map style filesystem telemetry."""
    try:
        return jsonify(get_filesystem_blocks())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/isolation-context")
def isolation_context():
    """API endpoint for cgroups + namespaces design layer."""
    try:
        return jsonify(get_isolation_context())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/process/<int:pid>/threads")
def get_process_threads(pid):
    """API for getting thread information for a specific process"""
    try:
        thread_info = get_process_threads_info(pid)
        return jsonify(thread_info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/process/<int:pid>/cpu")
def get_process_cpu(pid):
    """API for getting CPU statistics for a specific process"""
    try:
        cpu_info = get_process_cpu_info(pid)
        return jsonify(cpu_info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/process/<int:pid>/fds")
def get_process_fds(pid):
    """API for getting file descriptors for a specific process"""
    try:
        fds_info = get_process_fds_info(pid)
        return jsonify(fds_info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/processes-detailed")
def get_processes_detailed():
    """API for getting all processes with detailed information (threads, CPU, FDs)"""
    try:
        processes = []
        for proc in psutil.process_iter(['pid', 'name', 'status', 'memory_info', 'cpu_percent', 'num_threads', 'num_fds']):
            try:
                memory_info = proc.info.get('memory_info')
                if memory_info is None:
                    # Some transient/zombie processes may have incomplete info.
                    continue
                memory_mb = float(memory_info.rss) / 1024 / 1024
                
                # Get num_fds with fallback
                num_fds = proc.info.get('num_fds')
                if num_fds is None or num_fds == 0:
                    # Try to count from /proc/[pid]/fd directly
                    try:
                        pid = proc.info['pid']
                        fd_dir = f'/proc/{pid}/fd'
                        if os.path.exists(fd_dir):
                            num_fds = len([f for f in os.listdir(fd_dir) if f.isdigit()])
                        else:
                            num_fds = 0
                    except (OSError, PermissionError):
                        num_fds = 0
                if num_fds is None:
                    num_fds = 0
                
                # Get process name - use cmdline for nginx to get full name like "nginx: master process"
                process_name = proc.info.get('name') or f'pid-{proc.info.get("pid", "unknown")}'
                try:
                    cmdline = proc.cmdline()
                    if cmdline and len(cmdline) > 0:
                        # For nginx, cmdline[0] is "nginx:" and we want the full description
                        if cmdline[0] == 'nginx:' and len(cmdline) > 1:
                            process_name = f"nginx: {cmdline[1]}"
                except (psutil.AccessDenied, psutil.NoSuchProcess):
                    pass
                
                # Get cmdline for better process identification
                cmdline_str = ''
                try:
                    cmdline = proc.cmdline()
                    if cmdline:
                        cmdline_str = ' '.join(cmdline)
                except (psutil.AccessDenied, psutil.NoSuchProcess):
                    pass
                
                processes.append({
                    'pid': proc.info['pid'],
                    'name': process_name,
                    'cmdline': cmdline_str,  # Add cmdline for better identification
                    'status': proc.info.get('status', 'unknown'),
                    'memory_mb': round(memory_mb, 1),
                    'cpu_percent': round(float(proc.info.get('cpu_percent', 0) or 0), 1),
                    'num_threads': int(proc.info.get('num_threads', 0) or 0),
                    'num_fds': int(num_fds or 0)
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            except Exception:
                # Never fail the whole endpoint because of one malformed/transient process.
                continue
        
        return jsonify({'processes': processes})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_ipc_links_summary(max_pairs=120, max_nodes=24):
    """Collect IPC relationships by shared sockets, pipes and shared memory mappings."""
    socket_inode_re = re.compile(r"^socket:\[(\d+)\]$")
    pipe_inode_re = re.compile(r"^pipe:\[(\d+)\]$")
    # /proc/<pid>/maps sample:
    # address perms offset dev inode pathname
    # We use mappings with shared perms (e.g. rw-s) and real inode/path.
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
                    # Skip anonymous pseudo-regions like [heap], [stack], [anon]
                    if map_path.startswith("["):
                        continue

                    shm_key = f"{dev}:{inode}:{map_path}"
                    shm_owners.setdefault(shm_key, set()).add((pid, proc_name))
        except (OSError, PermissionError):
            continue

        for ns_name in namespace_keys:
            ns_inode = _read_namespace_inode(pid, ns_name)
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
        pair_links.append({
            "left": left,
            "right": right,
            "weight": int(weight),
            "socket_weight": int(pair_socket.get((left, right), pair_socket.get((right, left), 0))),
            "pipe_weight": int(pair_pipe.get((left, right), pair_pipe.get((right, left), 0))),
            "shm_weight": int(pair_shm.get((left, right), pair_shm.get((right, left), 0))),
            "ns_weight": int(pair_namespace.get((left, right), pair_namespace.get((right, left), 0))),
        })

    sorted_nodes = sorted(degree_total.items(), key=lambda kv: kv[1], reverse=True)[:max_nodes]
    process_nodes = []
    for name, degree in sorted_nodes:
        process_nodes.append({
            "name": name,
            "degree": int(degree),
            "socket_degree": int(degree_socket.get(name, 0)),
            "pipe_degree": int(degree_pipe.get(name, 0)),
            "shm_degree": int(degree_shm.get(name, 0)),
            "ns_degree": int(degree_namespace.get(name, 0)),
        })

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
        }
    }


@app.route("/api/ipc-links")
def get_ipc_links():
    """API: shared IPC/socket links across processes."""
    try:
        max_pairs = request.args.get("max_pairs", default=120, type=int)
        max_nodes = request.args.get("max_nodes", default=24, type=int)
        max_pairs = max(20, min(300, max_pairs))
        max_nodes = max(8, min(64, max_nodes))
        return jsonify(get_ipc_links_summary(max_pairs=max_pairs, max_nodes=max_nodes))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def get_process_threads_info(pid):
    """Get thread information for a specific process"""
    try:
        proc = psutil.Process(pid)
        threads = proc.threads()
        
        # Also read from /proc/[pid]/status for additional info
        thread_count = proc.num_threads()
        
        try:
            with open(f'/proc/{pid}/status', 'r') as f:
                status_data = {}
                for line in f:
                    if ':' in line:
                        key, value = line.split(':', 1)
                        status_data[key.strip()] = value.strip()
                
                voluntary_switches = int(status_data.get('voluntary_ctxt_switches', 0))
                nonvoluntary_switches = int(status_data.get('nonvoluntary_ctxt_switches', 0))
        except:
            voluntary_switches = 0
            nonvoluntary_switches = 0
        
        return {
            'pid': pid,
            'thread_count': thread_count,
            'threads': [
                {
                    'id': t.id,
                    'user_time': t.user_time,
                    'system_time': t.system_time
                } for t in threads
            ],
            'voluntary_ctxt_switches': voluntary_switches,
            'nonvoluntary_ctxt_switches': nonvoluntary_switches
        }
    except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
        return {'error': str(e)}
    except Exception as e:
        return {'error': str(e)}

def get_process_cpu_info(pid):
    """Get CPU statistics for a specific process"""
    try:
        proc = psutil.Process(pid)
        
        # Get CPU times
        cpu_times = proc.cpu_times()
        cpu_percent = proc.cpu_percent(interval=0.1)
        
        # Get CPU affinity if available
        try:
            cpu_affinity = proc.cpu_affinity()
        except:
            cpu_affinity = []
        
        # Get nice value
        try:
            nice = proc.nice()
        except:
            nice = None
        
        return {
            'pid': pid,
            'cpu_percent': round(cpu_percent, 1),
            'cpu_times': {
                'user': round(cpu_times.user, 2),
                'system': round(cpu_times.system, 2),
                'children_user': round(cpu_times.children_user, 2) if hasattr(cpu_times, 'children_user') else 0,
                'children_system': round(cpu_times.children_system, 2) if hasattr(cpu_times, 'children_system') else 0
            },
            'cpu_affinity': cpu_affinity,
            'nice': nice
        }
    except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
        return {'error': str(e)}
    except Exception as e:
        return {'error': str(e)}

def get_process_fds_info(pid):
    """Get file descriptors information for a specific process"""
    try:
        proc = psutil.Process(pid)
        
        # Get number of file descriptors
        try:
            num_fds = proc.num_fds()
        except (psutil.AccessDenied, AttributeError):
            # Try to count from /proc/[pid]/fd
            try:
                fd_dir = f'/proc/{pid}/fd'
                if os.path.exists(fd_dir):
                    num_fds = len([f for f in os.listdir(fd_dir) if f.isdigit()])
                else:
                    num_fds = 0
            except:
                num_fds = 0
        
        # Get open files
        open_files = []
        try:
            for fd in proc.open_files():
                open_files.append({
                    'path': fd.path,
                    'fd': fd.fd if hasattr(fd, 'fd') else None
                })
        except (psutil.AccessDenied, psutil.NoSuchProcess, AttributeError):
            # Fallback: try to read from /proc/[pid]/fd directly
            try:
                fd_dir = f'/proc/{pid}/fd'
                if os.path.exists(fd_dir):
                    for fd_num in os.listdir(fd_dir):
                        if fd_num.isdigit():
                            try:
                                fd_path = os.readlink(f'{fd_dir}/{fd_num}')
                                # Filter out special files (sockets, pipes, etc.)
                                # Also filter out IP addresses (which might appear as socket paths)
                                # Check if it looks like an IP address (e.g., "0.0.0.0", "127.0.0.1")
                                ip_pattern = re.compile(r'^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}')
                                if (fd_path.startswith('/') and 
                                    not fd_path.startswith('socket:') and 
                                    not fd_path.startswith('pipe:') and 
                                    not fd_path.startswith('anon_inode:') and
                                    not ip_pattern.match(fd_path)):  # Filter IP addresses
                                    open_files.append({
                                        'path': fd_path,
                                        'fd': int(fd_num)
                                    })
                            except (OSError, ValueError):
                                pass
            except (OSError, PermissionError):
                pass
        
        # Get connections (sockets)
        connections = []
        try:
            for conn in proc.connections():
                connections.append({
                    'fd': conn.fd if hasattr(conn, 'fd') else None,
                    'family': str(conn.family),
                    'type': str(conn.type),
                    'local_address': f"{conn.laddr.ip}:{conn.laddr.port}" if conn.laddr else None,
                    'remote_address': f"{conn.raddr.ip}:{conn.raddr.port}" if conn.raddr else None,
                    'status': conn.status
                })
        except (psutil.AccessDenied, psutil.NoSuchProcess, AttributeError):
            pass
        
        return {
            'pid': pid,
            'num_fds': num_fds,
            'open_files': open_files[:20],  # Limit to 20
            'connections': connections[:20]  # Limit to 20
        }
    except (psutil.NoSuchProcess, psutil.AccessDenied) as e:
        return {'error': f'Access denied or process not found: {str(e)}'}
    except Exception as e:
        return {'error': f'Error getting FDs: {str(e)}'}


@app.route('/api/proc-matrix')
def get_proc_matrix():
    """API: Matrix view data (processes vs CPU / MEM / IO / NET / FD)"""
    try:
        matrix = get_proc_matrix_data()
        return jsonify({
            'matrix': matrix,
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/proc-timeline')
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

@app.route('/api/execution-context')
def get_execution_context():
    """Get execution context data for Ring-1 visualization"""
    try:
        if platform.system() != 'Linux':
            return jsonify({
                'mode': 'kernel',
                'cpu_state': 'running',
                'syscall_active': False,
                'syscall_name': None,
                'interrupts': [],
                'preempted': False,
                'preempted_pid': None
            })
        
        # Determine mode (user/kernel) by checking active processes
        mode = 'user'  # Default
        syscall_active = False
        syscall_name = None
        active_pid = None
        active_syscalls = []  # List of processes with active syscalls: [{pid, syscall_name}]
        
        # Check for active syscalls
        try:
            proc_dirs = [d for d in os.listdir('/proc') if d.isdigit()]
            sampled_procs = proc_dirs[:100]  # Sample more processes
            
            syscall_count = 0
            for pid in sampled_procs:
                try:
                    syscall_path = f'/proc/{pid}/syscall'
                    if os.path.exists(syscall_path):
                        with open(syscall_path, 'r') as f:
                            line = f.read().strip()
                            if line and line != '-1':
                                parts = line.split()
                                if parts:
                                    syscall_num = int(parts[0])
                                    if syscall_num > 0:
                                        syscall_count += 1
                                        current_syscall_name = SYSCALL_NAMES.get(syscall_num, f'syscall_{syscall_num}')
                                        
                                        # Add to list of active syscalls
                                        active_syscalls.append({
                                            'pid': int(pid),
                                            'syscall_name': current_syscall_name
                                        })
                                        
                                        if not syscall_active:  # Get first active syscall for main display
                                            syscall_active = True
                                            syscall_name = current_syscall_name
                                            active_pid = int(pid)
                                        mode = 'kernel'  # Syscall means kernel mode
                except (ValueError, IOError, PermissionError):
                    continue
            
            # If we found syscalls, we're in kernel mode
            if syscall_count > 0:
                mode = 'kernel'
        except PermissionError:
            pass
        
        # Get CPU state from /proc/stat
        cpu_state = 'running'
        try:
            with open('/proc/stat', 'r') as f:
                cpu_line = f.readline()
                if cpu_line.startswith('cpu '):
                    parts = cpu_line.split()
                    if len(parts) >= 5:
                        idle_time = int(parts[4])
                        total_time = sum(int(p) for p in parts[1:11] if p.isdigit())
                        if total_time > 0:
                            idle_percent = (idle_time / total_time) * 100
                            if idle_percent > 90:
                                cpu_state = 'idle'
                            elif idle_percent > 50:
                                cpu_state = 'sleeping'
        except (IOError, ValueError, IndexError):
            pass
        
        # Get recent interrupts and associate with processes
        interrupts = []
        # Get list of ALL processes (not just active syscalls) for better distribution
        all_process_pids = []
        try:
            proc_dirs = [d for d in os.listdir('/proc') if d.isdigit()]
            # Get all process PIDs (limit to reasonable number)
            all_process_pids = [int(pid) for pid in proc_dirs[:200] if pid.isdigit()]
        except PermissionError:
            pass
        
        # Track previous interrupt counts to detect new interrupts
        previous_interrupt_counts = {}
        try:
            # Try to read previous counts from a simple cache (in-memory)
            # For now, we'll just report all interrupts and let frontend handle distribution
            with open('/proc/interrupts', 'r') as f:
                lines = f.readlines()
                # Parse interrupt counts
                for line in lines[1:]:  # Skip header
                    if line.strip():
                        parts = line.split()
                        if len(parts) > 1:
                            # Check if any CPU has non-zero interrupts
                            for i in range(1, min(len(parts), 5)):  # Check first 4 CPUs
                                try:
                                    count = int(parts[i])
                                    # Report interrupts more frequently (every 10 instead of 100)
                                    if count > 0:
                                        # Extract IRQ number
                                        irq_num = parts[0].rstrip(':')
                                        
                                        # Associate with a process - use CPU and IRQ to select process
                                        # This ensures consistent mapping: same CPU+IRQ = same process
                                        associated_pid = None
                                        if all_process_pids:
                                            # Use CPU and IRQ to create a consistent hash for process selection
                                            hash_value = (i - 1) * 100 + int(irq_num) if irq_num.isdigit() else (i - 1) * 100
                                            process_index = hash_value % len(all_process_pids)
                                            associated_pid = all_process_pids[process_index]
                                        
                                        interrupts.append({
                                            'cpu': i - 1,
                                            'irq': irq_num,
                                            'count': count,
                                            'pid': associated_pid,  # Always associate with a process
                                            'timestamp': datetime.now().isoformat()
                                        })
                                        break  # Only one per IRQ line
                                except (ValueError, IndexError):
                                    continue
        except (IOError, PermissionError):
            pass

        # Build IRQ/SoftIRQ stack data with rates for a compact "IRQ stack" UI panel.
        now_ts = time.time()
        prev_ts = EXEC_CONTEXT_PREV.get("timestamp")
        dt = (now_ts - prev_ts) if prev_ts else None
        if dt is not None and dt <= 0:
            dt = None

        irq_totals_now = {}
        irq_rows = []
        try:
            with open('/proc/interrupts', 'r') as f:
                lines = f.readlines()
            for raw in lines[1:]:
                if ":" not in raw:
                    continue
                left, right = raw.split(":", 1)
                irq_name = left.strip()
                tokens = right.split()
                if not tokens:
                    continue

                counts = []
                idx = 0
                while idx < len(tokens) and tokens[idx].isdigit():
                    counts.append(int(tokens[idx]))
                    idx += 1
                if not counts:
                    continue
                total = sum(counts)
                desc = " ".join(tokens[idx:]).strip() or irq_name
                key = f"{irq_name}:{desc}"
                irq_totals_now[key] = total

                prev_total = EXEC_CONTEXT_PREV["irq_totals"].get(key)
                per_sec = 0.0
                if dt and prev_total is not None:
                    per_sec = max(0.0, (total - prev_total) / dt)

                top_cpu = None
                if counts:
                    top_cpu = int(max(range(len(counts)), key=lambda i: counts[i]))

                irq_rows.append({
                    "irq": irq_name,
                    "label": desc,
                    "total": int(total),
                    "per_sec": round(per_sec, 2),
                    "top_cpu": top_cpu,
                    "subsystem": map_interrupt_to_subsystem(desc)
                })
        except (IOError, PermissionError):
            pass

        softirq_totals_now = {}
        softirq_rows = []
        try:
            with open('/proc/softirqs', 'r') as f:
                lines = f.readlines()
            for raw in lines[1:]:
                if ":" not in raw:
                    continue
                left, right = raw.split(":", 1)
                name = left.strip()
                counts = []
                for tok in right.split():
                    if tok.isdigit():
                        counts.append(int(tok))
                if not counts:
                    continue
                total = sum(counts)
                softirq_totals_now[name] = total
                prev_total = EXEC_CONTEXT_PREV["softirq_totals"].get(name)
                per_sec = 0.0
                if dt and prev_total is not None:
                    per_sec = max(0.0, (total - prev_total) / dt)
                softirq_rows.append({
                    "name": name,
                    "total": int(total),
                    "per_sec": round(per_sec, 2)
                })
        except (IOError, PermissionError):
            pass

        irq_rows.sort(key=lambda row: (row["per_sec"], row["total"]), reverse=True)
        softirq_rows.sort(key=lambda row: (row["per_sec"], row["total"]), reverse=True)
        hard_top = irq_rows[:5]
        soft_top = softirq_rows[:4]

        hard_total_rate = sum(row["per_sec"] for row in irq_rows)
        soft_total_rate = sum(row["per_sec"] for row in softirq_rows)
        net_softirq_rate = 0.0
        block_softirq_rate = 0.0
        timer_softirq_rate = 0.0
        for row in softirq_rows:
            nm = row["name"].upper()
            if nm in ("NET_RX", "NET_TX"):
                net_softirq_rate += row["per_sec"]
            elif nm == "BLOCK":
                block_softirq_rate += row["per_sec"]
            elif nm == "TIMER":
                timer_softirq_rate += row["per_sec"]

        EXEC_CONTEXT_PREV["timestamp"] = now_ts
        EXEC_CONTEXT_PREV["irq_totals"] = irq_totals_now
        EXEC_CONTEXT_PREV["softirq_totals"] = softirq_totals_now
        
        # Check for preempted processes (simplified - check if process is in 'R' state but not on CPU)
        preempted = False
        preempted_pid = None
        try:
            # This is a simplified check - in reality, preemption detection is more complex
            # We check if there are processes in 'R' state (runnable but not running)
            proc_dirs = [d for d in os.listdir('/proc') if d.isdigit()]
            for pid in proc_dirs[:20]:  # Check first 20
                try:
                    stat_path = f'/proc/{pid}/stat'
                    if os.path.exists(stat_path):
                        with open(stat_path, 'r') as f:
                            stat_data = f.read().split()
                            if len(stat_data) > 2:
                                state = stat_data[2]
                                # 'R' = running/runnable, but if it's not the active one, it might be preempted
                                if state == 'R' and active_pid and int(pid) != active_pid:
                                    preempted = True
                                    preempted_pid = int(pid)
                                    break
                except (ValueError, IOError, PermissionError, IndexError):
                    continue
        except PermissionError:
            pass
        
        return jsonify({
            'mode': mode,
            'cpu_state': cpu_state,
            'syscall_active': syscall_active,
            'syscall_name': syscall_name,
            'active_pid': active_pid,
            'active_syscalls': active_syscalls,  # List of processes with active syscalls
            'interrupts': interrupts[:10],  # Limit to 10 most recent
            'irq_stack': {
                'hard': hard_top,
                'soft': soft_top,
                'summary': {
                    'hard_total_per_sec': round(hard_total_rate, 2),
                    'soft_total_per_sec': round(soft_total_rate, 2),
                    'net_softirq_per_sec': round(net_softirq_rate, 2),
                    'block_softirq_per_sec': round(block_softirq_rate, 2),
                    'timer_softirq_per_sec': round(timer_softirq_rate, 2)
                }
            },
            'preempted': preempted,
            'preempted_pid': preempted_pid,
            'cpu_count': psutil.cpu_count(),
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def get_kernel_dna_data():
    """
    Collect Kernel DNA data: syscalls, interrupts, context switches, locks
    Returns data structured for DNA visualization
    """
    dna_data = {
        'nucleotides': [],  # List of events: syscall, interrupt, context_switch, lock
        'genes': [],  # Kernel subsystems segments
        'mutations': [],  # Anomalies detected
        'timestamp': datetime.now().isoformat()
    }
    
    # 1. Collect syscalls (A nucleotides)
    try:
        syscalls = get_real_system_calls()
        for syscall in syscalls[:20]:  # Limit to 20 most frequent
            dna_data['nucleotides'].append({
                'type': 'syscall',
                'code': 'A',
                'name': syscall['name'],
                'count': syscall.get('count', 0),
                'subsystem': syscall.get('subsystem') or map_syscall_to_subsystem(syscall['name']),
                'timestamp': datetime.now().isoformat()
            })
    except Exception as e:
        print(f"Error collecting syscalls: {e}")
    
    # 2. Collect interrupts (T nucleotides)
    try:
        with open('/proc/interrupts', 'r') as f:
            interrupt_lines = f.readlines()
            # Skip header line
            for line in interrupt_lines[1:11]:  # First 10 interrupt lines
                parts = line.strip().split()
                if len(parts) > 1:
                    interrupt_name = parts[0].rstrip(':')
                    total_count = sum(int(x) for x in parts[1:] if x.isdigit())
                    if total_count > 0:
                        dna_data['nucleotides'].append({
                            'type': 'interrupt',
                            'code': 'T',
                            'name': interrupt_name,
                            'count': total_count,
                            'subsystem': map_interrupt_to_subsystem(interrupt_name),
                            'timestamp': datetime.now().isoformat()
                        })
    except (IOError, ValueError, PermissionError) as e:
        print(f"Error collecting interrupts: {e}")
        dna_data['nucleotides'].extend(_kernel_dna_softirq_nucleotides())
    
    # 3. Collect context switches (C nucleotides)
    try:
        with open('/proc/stat', 'r') as f:
            for line in f:
                if line.startswith('ctxt '):
                    ctxt_count = int(line.split()[1])
                    # Calculate context switches per second (simplified)
                    dna_data['nucleotides'].append({
                        'type': 'context_switch',
                        'code': 'C',
                        'name': 'context_switch',
                        'count': ctxt_count,
                        'subsystem': 'sched',
                        'timestamp': datetime.now().isoformat()
                    })
                    break
    except (IOError, ValueError, PermissionError) as e:
        print(f"Error collecting context switches: {e}")
    
    # 4. Collect locks (G nucleotides) - from /proc/locks
    try:
        with open('/proc/locks', 'r') as f:
            lock_lines = f.readlines()
            lock_count = len(lock_lines)
            if lock_count > 0:
                dna_data['nucleotides'].append({
                    'type': 'lock',
                    'code': 'G',
                    'name': 'mutex/lock',
                    'count': lock_count,
                    'subsystem': 'kernel',
                    'timestamp': datetime.now().isoformat()
                })
    except (IOError, PermissionError) as e:
        # Fallback: estimate locks based on process count
        try:
            process_count = len(psutil.pids())
            estimated_locks = process_count // 10
            dna_data['nucleotides'].append({
                'type': 'lock',
                'code': 'G',
                'name': 'mutex/lock',
                'count': estimated_locks,
                'subsystem': 'kernel',
                'timestamp': datetime.now().isoformat()
            })
        except:
            pass
    
    # 5. Define gene segments (kernel subsystems)
    dna_data['genes'] = [
        {'name': 'sched', 'start': 0, 'end': 0.2, 'color': '#58b6d8'},
        {'name': 'net', 'start': 0.2, 'end': 0.4, 'color': '#4a9eff'},
        {'name': 'fs', 'start': 0.4, 'end': 0.6, 'color': '#6bcf7f'},
        {'name': 'mm', 'start': 0.6, 'end': 0.8, 'color': '#ffa94d'},
        {'name': 'drivers', 'start': 0.8, 'end': 1.0, 'color': '#ff6b9d'}
    ]
    
    # 6. Detect mutations (anomalies)
    mutations = []
    
    # Check for syscall flood
    syscall_count = sum(1 for n in dna_data['nucleotides'] if n['type'] == 'syscall')
    if syscall_count > 15:
        mutations.append({
            'type': 'syscall_flood',
            'severity': 'high',
            'message': f'Syscall flood detected: {syscall_count} active syscalls',
            'position': 0.3
        })
    
    # Check for abnormal context switching
    ctxt_switches = [n for n in dna_data['nucleotides'] if n['type'] == 'context_switch']
    if ctxt_switches and ctxt_switches[0]['count'] > 1000000:
        mutations.append({
            'type': 'abnormal_context_switch',
            'severity': 'medium',
            'message': 'Abnormal context switching rate detected',
            'position': 0.5
        })
    
    # Check for lock contention
    locks = [n for n in dna_data['nucleotides'] if n['type'] == 'lock']
    if locks and locks[0]['count'] > 100:
        mutations.append({
            'type': 'lock_contention',
            'severity': 'medium',
            'message': f'High lock contention: {locks[0]["count"]} active locks',
            'position': 0.7
        })
    
    dna_data['mutations'] = mutations
    
    return dna_data

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

def infer_crypto_protocol(local_port, remote_port, process_name):
    """Infer protocol likely using kernel crypto from socket and process context."""
    tls_ports = {443, 465, 636, 853, 993, 995, 2376, 6443, 8443, 9443}
    ssh_ports = {22}
    wg_ports = {51820}
    p_name = (process_name or "").lower()
    ports = {int(local_port or 0), int(remote_port or 0)}

    if ports & ssh_ports or "sshd" in p_name or "ssh" in p_name:
        return "SSH", "ChaCha20-Poly1305"
    if ports & wg_ports or "wg" in p_name or "wireguard" in p_name:
        return "WireGuard", "ChaCha20"
    if ports & tls_ports or any(x in p_name for x in ["nginx", "haproxy", "curl", "wget", "openssl", "stunnel", "traefik"]):
        return "TLS", "AES-GCM/SHA256"
    return "Crypto API", "AES/SHA"

def is_likely_crypto_actor(process_name, local_port, remote_port, protocol):
    """Heuristic gate to avoid flooding with unrelated sockets."""
    p_name = (process_name or "").lower()
    interesting_ports = {22, 443, 465, 636, 853, 993, 995, 2376, 6443, 8443, 9443, 51820}
    process_tokens = [
        "nginx", "haproxy", "envoy", "caddy", "apache", "httpd", "traefik",
        "sshd", "ssh", "wg", "wireguard", "openssl", "stunnel", "curl", "wget",
        "python", "gunicorn", "uvicorn"
    ]
    if protocol in ("TLS", "SSH", "WireGuard"):
        return True
    if int(local_port or 0) in interesting_ports or int(remote_port or 0) in interesting_ports:
        return True
    return any(token in p_name for token in process_tokens)

def infer_tls_terminator(process_name, local_port, protocol, tls_listener_names):
    """Guess where TLS termination happens."""
    if protocol != "TLS":
        return "n/a"
    p_name = (process_name or "").lower()
    if p_name and p_name != "unknown":
        return p_name
    if int(local_port or 0) in {443, 8443, 9443, 6443} and tls_listener_names:
        top = next(iter(tls_listener_names))
        return f"listener:{top}"
    if int(local_port or 0) in {443, 8443, 9443, 6443}:
        return "unknown"
    return "upstream-or-external-lb"

def parse_proc_crypto_entries():
    """Parse /proc/crypto into a list of dict entries."""
    entries = []
    try:
        with open("/proc/crypto", "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read()
    except Exception:
        return entries

    blocks = [block.strip() for block in raw.split("\n\n") if block.strip()]
    for block in blocks:
        item = {}
        for line in block.splitlines():
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            item[key.strip().lower()] = value.strip()
        if item:
            entries.append(item)
    return entries

def collect_algorithm_competition(requested_algorithm="aes"):
    """
    Build algorithm implementation competition using kernel crypto registry.
    The winner is the implementation with highest priority.
    """
    entries = parse_proc_crypto_entries()
    requested = (requested_algorithm or "aes").lower()
    req_type_allow = {
        "aes": {"skcipher", "aead", "cipher"},
        "sha": {"shash", "ahash", "hash"},
        "chacha20": {"skcipher", "aead", "cipher"}
    }
    req_tokens = {
        "aes": ["aes"],
        "sha": ["sha"],
        "chacha20": ["chacha20", "xchacha20", "chacha"]
    }
    allowed_types = req_type_allow.get(requested, {"skcipher", "aead", "cipher", "shash", "ahash", "hash"})
    tokens = req_tokens.get(requested, [requested])
    candidates = []

    for entry in entries:
        name = str(entry.get("name", "")).lower()
        driver = str(entry.get("driver", "")).lower()
        alg_type = str(entry.get("type", "")).lower()

        if not any(token in name or token in driver for token in tokens):
            continue
        if alg_type and alg_type not in allowed_types:
            continue

        try:
            priority = int(entry.get("priority", "0") or 0)
        except ValueError:
            priority = 0

        impl_name = driver or name or "unknown-impl"
        candidates.append({
            "name": impl_name,
            "priority": priority,
            "type": alg_type or "unknown",
            "source": "kernel"
        })

    # Deduplicate by implementation name, keep the highest priority variant.
    dedup = {}
    for item in candidates:
        existing = dedup.get(item["name"])
        if existing is None or item["priority"] > existing["priority"]:
            dedup[item["name"]] = item
    candidates = list(dedup.values())
    candidates.sort(key=lambda x: x["priority"], reverse=True)

    if not candidates:
        # Fallback keeps the UX informative on hosts without readable /proc/crypto.
        fallback_map = {
            "aes": [
                {"name": "aesni-intel", "priority": 300, "type": "skcipher", "source": "mock"},
                {"name": "aes-avx", "priority": 200, "type": "skcipher", "source": "mock"},
                {"name": "aes-generic", "priority": 100, "type": "skcipher", "source": "mock"}
            ],
            "sha": [
                {"name": "sha256-avx2", "priority": 240, "type": "shash", "source": "mock"},
                {"name": "sha256-ssse3", "priority": 180, "type": "shash", "source": "mock"},
                {"name": "sha256-generic", "priority": 100, "type": "shash", "source": "mock"}
            ],
            "chacha20": [
                {"name": "chacha20-neon", "priority": 260, "type": "skcipher", "source": "mock"},
                {"name": "chacha20-simd", "priority": 220, "type": "skcipher", "source": "mock"},
                {"name": "chacha20-generic", "priority": 100, "type": "skcipher", "source": "mock"}
            ]
        }
        candidates = fallback_map.get(requested, fallback_map["aes"])

    selected = candidates[0] if candidates else None
    return {
        "request": requested.upper(),
        "implementations": candidates[:8],
        "selected": selected,
        "selection_policy": "max-priority"
    }

def collect_kernel_crypto_clients(items):
    """Infer major kernel crypto clients from active process/protocol context."""
    client_rules = [
        ("kTLS", ["nginx", "haproxy", "envoy", "caddy", "apache", "httpd", "traefik"], "TLS"),
        ("WireGuard", ["wg", "wireguard"], "WireGuard"),
        ("IPsec/XFRM", ["charon", "strongswan", "ipsec", "racoon"], "TLS"),
        ("dm-crypt", ["cryptsetup", "dmcrypt", "luks"], "CRYPTO API"),
        ("fscrypt", ["fscrypt"], "CRYPTO API"),
        ("AF_ALG", ["openssl", "python", "curl", "wget"], "CRYPTO API")
    ]
    results = []
    lowered_items = []
    for item in items:
        lowered_items.append({
            "process": str(item.get("process", "")).lower(),
            "protocol": str(item.get("protocol", "")),
            "source_kind": str(item.get("source_kind", ""))
        })

    for name, tokens, proto_hint in client_rules:
        flows = 0
        for item in lowered_items:
            proc = item["process"]
            proto = item["protocol"]
            if any(token in proc for token in tokens):
                flows += 1
            elif proto_hint and proto == proto_hint:
                flows += 1
        status = "active" if flows > 0 else "idle"
        results.append({
            "name": name,
            "status": status,
            "active_flows": int(flows)
        })
    return results

def collect_sync_async_queue(items):
    """Estimate sync/async crypto execution pressure from active flows."""
    active_items = [i for i in items if str(i.get("status", "")).upper() != "LISTEN"]
    async_items = [
        i for i in active_items
        if str(i.get("source_kind", "")) == "connection"
        or str(i.get("protocol", "")).upper() in {"TLS", "WIREGUARD", "SSH"}
    ]
    sync_items = max(len(active_items) - len(async_items), 0) + sum(
        1 for i in items if str(i.get("source_kind", "")) == "process"
    )
    queue_depth = max(len(async_items) - 1, 0)
    queue_latency_ms = round(0.35 + min(5.5, queue_depth * 0.42 + len(active_items) * 0.08), 2)
    return {
        "sync_ops_est": int(sync_items),
        "async_ops_est": int(len(async_items)),
        "queue_depth_est": int(queue_depth),
        "queue_latency_ms_est": queue_latency_ms,
        "mode": "heuristic"
    }

def collect_hw_offload_status(entries, algorithm_competitions):
    """Estimate hardware acceleration availability from /proc/crypto drivers."""
    names = []
    for entry in entries:
        n = str(entry.get("name", "")).lower()
        d = str(entry.get("driver", "")).lower()
        if n:
            names.append(n)
        if d:
            names.append(d)

    def has_token(tokens):
        return any(any(token in item for token in tokens) for item in names)

    selected_impls = {
        key: str(value.get("selected", {}).get("name", "")).lower()
        for key, value in (algorithm_competitions or {}).items()
    }
    selected_joined = " ".join(selected_impls.values())

    engines = [
        {
            "engine": "AES-NI / CPU INSTR",
            "available": has_token(["aesni", "vaes"]),
            "active": ("aesni" in selected_joined or "vaes" in selected_joined)
        },
        {
            "engine": "SIMD (AVX/NEON)",
            "available": has_token(["avx", "sse", "simd", "neon"]),
            "active": any(token in selected_joined for token in ["avx", "simd", "neon", "sse"])
        },
        {
            "engine": "ARM CRYPTO EXT",
            "available": has_token(["arm64", "ce", "neon"]),
            "active": "arm64" in selected_joined
        },
        {
            "engine": "QAT OFFLOAD",
            "available": has_token(["qat"]),
            "active": "qat" in selected_joined
        },
        {
            "engine": "VIRTIO-CRYPTO",
            "available": has_token(["virtio"]),
            "active": "virtio" in selected_joined
        }
    ]
    result = []
    for item in engines:
        if item["active"]:
            status = "active"
        elif item["available"]:
            status = "available"
        else:
            status = "unavailable"
        result.append({
            "engine": item["engine"],
            "status": status
        })
    return result

def read_sysctl_int(path, default=0):
    """Read integer sysctl/proc file value safely."""
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read().strip()
        return int(raw or default)
    except Exception:
        return int(default)

def read_proc_interrupt_total():
    """Read total interrupts count from /proc/stat."""
    try:
        with open("/proc/stat", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("intr "):
                    parts = line.strip().split()
                    if len(parts) >= 2:
                        return int(parts[1])
    except Exception:
        return 0
    return 0

def collect_entropy_cloud_status():
    """
    Collect Linux random subsystem entropy status and source activity.
    This is a best-effort realtime heuristic for UI visualization.
    """
    now = time.time()
    entropy_bits = read_sysctl_int("/proc/sys/kernel/random/entropy_avail", 0)
    pool_size_bits = read_sysctl_int("/proc/sys/kernel/random/poolsize", 256)
    read_threshold = read_sysctl_int("/proc/sys/kernel/random/read_wakeup_threshold", 128)
    write_threshold = read_sysctl_int("/proc/sys/kernel/random/write_wakeup_threshold", 64)

    try:
        disk = psutil.disk_io_counters()
    except Exception:
        disk = None
    try:
        net = psutil.net_io_counters()
    except Exception:
        net = None
    intr_total = read_proc_interrupt_total()

    prev_ts = ENTROPY_PREV.get("timestamp")
    dt = max(now - prev_ts, 0.001) if prev_ts else None

    disk_read_now = int(getattr(disk, "read_bytes", 0) or 0)
    disk_write_now = int(getattr(disk, "write_bytes", 0) or 0)
    net_sent_now = int(getattr(net, "bytes_sent", 0) or 0)
    net_recv_now = int(getattr(net, "bytes_recv", 0) or 0)

    if dt:
        disk_delta = max(
            (disk_read_now - int(ENTROPY_PREV.get("disk_read_bytes") or disk_read_now))
            + (disk_write_now - int(ENTROPY_PREV.get("disk_write_bytes") or disk_write_now)),
            0
        )
        net_delta = max(
            (net_sent_now - int(ENTROPY_PREV.get("net_sent_bytes") or net_sent_now))
            + (net_recv_now - int(ENTROPY_PREV.get("net_recv_bytes") or net_recv_now)),
            0
        )
        intr_delta = max(intr_total - int(ENTROPY_PREV.get("interrupt_total") or intr_total), 0)
    else:
        disk_delta = 0
        net_delta = 0
        intr_delta = 0

    ENTROPY_PREV["timestamp"] = now
    ENTROPY_PREV["disk_read_bytes"] = disk_read_now
    ENTROPY_PREV["disk_write_bytes"] = disk_write_now
    ENTROPY_PREV["net_sent_bytes"] = net_sent_now
    ENTROPY_PREV["net_recv_bytes"] = net_recv_now
    ENTROPY_PREV["interrupt_total"] = intr_total

    def scale_intensity(rate_value, scale):
        return int(max(0, min(100, (float(rate_value) / float(scale)) * 100.0)))

    disk_rate = (disk_delta / dt) if dt else 0
    net_rate = (net_delta / dt) if dt else 0
    intr_rate = (intr_delta / dt) if dt else 0

    irq_intensity = scale_intensity(intr_rate, 25000)
    disk_intensity = scale_intensity(disk_rate, 80 * 1024 * 1024)
    net_intensity = scale_intensity(net_rate, 120 * 1024 * 1024)
    hwrng_intensity = 68 if entropy_bits > max(read_threshold, 128) else 34

    sources = [
        {
            "source": "interrupt timing",
            "intensity": irq_intensity,
            "status": "active" if irq_intensity >= 25 else "low"
        },
        {
            "source": "disk IO",
            "intensity": disk_intensity,
            "status": "active" if disk_intensity >= 18 else "low"
        },
        {
            "source": "network timing",
            "intensity": net_intensity,
            "status": "active" if net_intensity >= 18 else "low"
        },
        {
            "source": "hardware RNG",
            "intensity": hwrng_intensity,
            "status": "active" if hwrng_intensity >= 50 else "limited"
        }
    ]

    source_avg = int(sum(s["intensity"] for s in sources) / max(len(sources), 1))
    entropy_pct = max(0.0, min(1.0, float(entropy_bits) / max(float(pool_size_bits), 1.0)))
    particle_density = max(16, min(84, int(18 + entropy_pct * 42 + source_avg * 0.35)))
    key_birth_rate = round(0.6 + entropy_pct * 9.4 + source_avg * 0.06, 2)

    crng_state = "ready" if entropy_bits >= max(read_threshold, 128) else "warming"
    random_state = "stable" if entropy_bits >= max(write_threshold, 64) else "refilling"

    return {
        "entropy_pool_bits": int(entropy_bits),
        "entropy_pool_size_bits": int(pool_size_bits),
        "crng_state": crng_state,
        "random_subsystem_state": random_state,
        "particle_density": int(particle_density),
        "key_birth_rate_est": float(key_birth_rate),
        "sources": sources,
        "read_wakeup_threshold": int(read_threshold),
        "write_wakeup_threshold": int(write_threshold),
        "mode": "live-heuristic"
    }

def collect_algorithm_requesters(items, kernel_clients):
    """Infer likely requestor objects that trigger algorithm competition."""
    algo_map = {"aes": {}, "sha": {}, "chacha20": {}}
    client_boost_rules = {
        "aes": {"kTLS", "dm-crypt", "AF_ALG", "IPsec/XFRM"},
        "sha": {"kTLS", "AF_ALG", "IPsec/XFRM"},
        "chacha20": {"WireGuard", "AF_ALG"}
    }

    for item in items or []:
        process_name = str(item.get("process", "unknown")).lower() or "unknown"
        protocol = str(item.get("protocol", "")).upper()
        algorithm = str(item.get("algorithm", "")).upper()
        status = str(item.get("status", "")).upper()
        if status == "LISTEN":
            continue

        matched_algorithms = set()
        if "AES" in algorithm or protocol == "TLS":
            matched_algorithms.add("aes")
        if "SHA" in algorithm or protocol == "TLS":
            matched_algorithms.add("sha")
        if "CHACHA" in algorithm or protocol in {"WIREGUARD", "SSH"}:
            matched_algorithms.add("chacha20")
        if not matched_algorithms and protocol == "CRYPTO API":
            matched_algorithms.update(["aes", "sha"])

        for algo_key in matched_algorithms:
            key = f"process:{process_name}"
            bucket = algo_map[algo_key].setdefault(key, {
                "name": process_name,
                "kind": "process",
                "score": 0
            })
            bucket["score"] += 1

    for client in kernel_clients or []:
        name = str(client.get("name", "")).strip()
        flows = int(client.get("active_flows", 0) or 0)
        if not name or flows <= 0:
            continue
        for algo_key, allowed_clients in client_boost_rules.items():
            if name not in allowed_clients:
                continue
            key = f"client:{name}"
            bucket = algo_map[algo_key].setdefault(key, {
                "name": name,
                "kind": "kernel-client",
                "score": 0
            })
            # Kernel clients are presented as primary requestor objects.
            bucket["score"] += max(2, flows)

    result = {}
    for algo_key, raw in algo_map.items():
        ranked = sorted(raw.values(), key=lambda x: x.get("score", 0), reverse=True)
        if not ranked:
            ranked = [{
                "name": "user/kernel request",
                "kind": "generic",
                "score": 1
            }]
        result[algo_key] = ranked[:4]
    return result

def build_crypto_decision_pipelines(algorithm_competitions, kernel_clients, hw_offload, algorithm_requesters):
    """Build visual decision pipeline metadata for each algorithm family."""
    hw_active = [h.get("engine") for h in (hw_offload or []) if h.get("status") == "active"]
    hw_available = [h.get("engine") for h in (hw_offload or []) if h.get("status") == "available"]
    capability_hint = ", ".join(hw_active[:2] or hw_available[:2]) if (hw_active or hw_available) else "generic-cpu-only"

    tfm_lookup_map = {
        "AES": "crypto_alloc_skcipher(aes)",
        "SHA": "crypto_alloc_shash(sha*)",
        "CHACHA20": "crypto_alloc_skcipher(chacha20)"
    }

    pipelines = {}
    for key, comp in (algorithm_competitions or {}).items():
        request = str(comp.get("request", key)).upper()
        impls = comp.get("implementations", []) or []
        shortlist = [str(x.get("name", "unknown")) for x in impls[:3]]
        requesters = list((algorithm_requesters or {}).get(key, []))
        top_requester = requesters[0] if requesters else {"name": "user/kernel request", "kind": "generic"}
        request_origin = f"{top_requester.get('kind', 'generic')}: {top_requester.get('name', 'unknown')}"
        selected_driver = str((comp.get("selected") or {}).get("name", "unknown"))
        fallback_driver = next((name for name in shortlist if "generic" in name.lower()), shortlist[-1] if shortlist else "none")
        selected_is_generic = "generic" in selected_driver.lower()
        selected_source = str((comp.get("selected") or {}).get("source", "kernel")).lower()
        fallback_active = selected_is_generic and len(shortlist) > 1

        pipelines[key] = {
            "request": request,
            "request_origin": request_origin,
            "requesters": requesters,
            "tfm_lookup": tfm_lookup_map.get(request, f"crypto_lookup({request.lower()})"),
            "impl_shortlist": shortlist,
            "priority_check": "max priority wins",
            "capability_check": capability_hint,
            "selected_driver": selected_driver,
            "fallback_driver": fallback_driver,
            "fallback_active": bool(fallback_active),
            "fallback_reason": "higher-priority impl unavailable or unsupported" if fallback_active else "not-triggered",
            "source": selected_source
        }
    return pipelines

def collect_crypto_realtime():
    """
    Build a near-realtime list of processes likely interacting with kernel crypto.
    This is heuristic-based and derived from active network/process context.
    """
    items = []
    tls_listener_by_port = {}
    tls_listener_names = set()
    unknown_pid_flows = 0

    try:
        connections = psutil.net_connections(kind="inet")
    except Exception:
        connections = []

    # Build TLS listener map first. This helps attribute ESTABLISHED sockets that
    # may not expose pid under restricted privileges.
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
        items.append({
            "process": process_name,
            "pid": pid_i,
            "protocol": "TLS",
            "algorithm": "AES-GCM/SHA256",
            "endpoint": f"0.0.0.0:{int(local_port)}",
            "local_port": int(local_port),
            "remote_port": 0,
            "status": "LISTEN",
            "tls_terminator": process_name,
            "source_kind": "listener"
        })

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

        items.append({
            "process": process_name.lower(),
            "pid": pid_i,
            "protocol": protocol,
            "algorithm": algorithm,
            "endpoint": endpoint,
            "local_port": int(local_port or 0),
            "remote_port": int(remote_port or 0),
            "status": status,
            "tls_terminator": tls_terminator,
            "source_kind": "connection"
        })

    # If no sockets are available, still expose likely crypto actors.
    if not items:
        for proc in psutil.process_iter(attrs=["pid", "name"]):
            try:
                name = str(proc.info.get("name", "")).lower()
            except Exception:
                continue
            if any(token in name for token in ["nginx", "sshd", "curl", "openssl", "kube", "vpn", "python"]):
                protocol, algorithm = infer_crypto_protocol(0, 0, name)
                items.append({
                    "process": name,
                    "pid": int(proc.info.get("pid") or 0),
                    "protocol": protocol,
                    "algorithm": algorithm,
                    "endpoint": "-",
                    "local_port": 0,
                    "remote_port": 0,
                    "status": "RUNNING",
                    "tls_terminator": "n/a",
                    "source_kind": "process"
                })
            if len(items) >= 12:
                break

    # Deduplicate near-identical rows.
    deduped = {}
    for item in items:
        key = (
            item.get("process"),
            int(item.get("pid") or 0),
            item.get("protocol"),
            item.get("algorithm"),
            item.get("endpoint"),
            item.get("status"),
            item.get("source_kind")
        )
        if key not in deduped:
            deduped[key] = item
    items = list(deduped.values())

    now = time.time()
    prev_ts = CRYPTO_PREV["timestamp"]
    prev_flows = CRYPTO_PREV["active_flows"]
    active_flows = len(items)
    CRYPTO_PREV["timestamp"] = now
    CRYPTO_PREV["active_flows"] = active_flows

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
        "chacha20": collect_algorithm_competition("chacha20")
    }
    proc_crypto_entries = parse_proc_crypto_entries()
    kernel_clients = collect_kernel_crypto_clients(items)
    hw_offload = collect_hw_offload_status(proc_crypto_entries, algorithm_competitions)
    crypto_stage1 = {
        "kernel_clients": kernel_clients,
        "sync_async": collect_sync_async_queue(items),
        "hw_offload": hw_offload
    }
    algorithm_requesters = collect_algorithm_requesters(items, kernel_clients)
    crypto_decision_pipelines = build_crypto_decision_pipelines(
        algorithm_competitions=algorithm_competitions,
        kernel_clients=kernel_clients,
        hw_offload=hw_offload,
        algorithm_requesters=algorithm_requesters
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
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
    }

def collect_security_realtime():
    """
    Stage-1 security subsystem telemetry:
    - Threat decision pipeline
    - Process trust graph
    - Attack surface map
    """
    now = time.time()
    process_rows = []
    suspicious_tokens = {
        "nmap", "masscan", "hydra", "sqlmap", "metasploit", "msfconsole",
        "netcat", "nc", "ncat", "socat", "john", "hashcat", "strace", "gdb"
    }
    trusted_tokens = {
        "systemd", "sshd", "nginx", "python", "containerd", "dockerd",
        "kubelet", "cron", "rsyslogd", "dbus-daemon"
    }
    ptrace_like = {"strace", "gdb", "ltrace"}

    def classify_trust(score):
        if score >= 70:
            return "blocked"
        if score >= 48:
            return "suspicious"
        if score >= 28:
            return "observe"
        return "trusted"

    # Process sample and heuristic score.
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

            process_rows.append({
                "pid": pid,
                "name": name,
                "trust": trust,
                "risk_score": score,
                "threads": threads,
                "mem_percent": round(mem, 2),
                "status": status,
                "user": user
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception:
            continue

    # Focus on the most security-relevant rows.
    process_rows.sort(key=lambda p: (p["risk_score"], p["mem_percent"], p["threads"]), reverse=True)
    trust_graph = process_rows[:12]

    # Build threat pipeline lanes from top rows.
    request_candidates = [
        "open /etc/shadow",
        "connect tcp:443",
        "exec /usr/bin/sudo",
        "ptrace attach",
        "bpf program load",
        "write /usr/lib/systemd/*"
    ]
    hook_candidates = [
        "security_file_open",
        "security_socket_connect",
        "security_bprm_check",
        "seccomp-bpf",
        "cgroup device policy",
        "audit hook"
    ]
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
        lanes.append({
            "process": row.get("name", "unknown"),
            "pid": int(row.get("pid", 0)),
            "request": req,
            "hook": hook,
            "verdict": verdict,
            "reason": "risk-score-policy",
            "risk_score": score
        })

    # Attack surface metrics.
    try:
        listen_ports = len([
            c for c in psutil.net_connections(kind="inet")
            if str(getattr(c, "status", "") or "") == "LISTEN"
        ])
    except Exception:
        listen_ports = 0

    try:
        with open("/proc/modules", "r", encoding="utf-8") as f:
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
            timeout=1.8
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
        {"name": "suspicious-processes", "value": int(suspicious_processes), "severity": "high" if suspicious_processes > 6 else "medium"}
    ]

    # Stage 3: kernel security tools insights.
    def _read_text(path):
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return str(f.read().strip())
        except Exception:
            return ""

    # LSM status matrix (best effort, distro dependent).
    apparmor_raw = _read_text("/sys/module/apparmor/parameters/enabled")
    selinux_enforce = _read_text("/sys/fs/selinux/enforce")
    selinux_mode = _read_text("/sys/fs/selinux/enforce")
    selinux_policy = _read_text("/sys/fs/selinux/policyvers")
    yama_scope = _read_text("/proc/sys/kernel/yama/ptrace_scope")
    bpf_unpriv = _read_text("/proc/sys/kernel/unprivileged_bpf_disabled")
    landlock_present = os.path.exists("/sys/kernel/security/landlock")
    ima_present = os.path.exists("/sys/kernel/security/ima")
    
    # Check for BPF LSM (modern trend).
    bpf_lsm_present = os.path.exists("/sys/kernel/security/bpf")
    try:
        lsm_list_raw = _read_text("/sys/kernel/security/lsm")
        active_lsms = [x.strip() for x in lsm_list_raw.split(",")] if lsm_list_raw else []
        stacking_enabled = len([x for x in active_lsms if x in {"selinux", "apparmor", "bpf"}]) > 1
    except Exception:
        active_lsms = []
        stacking_enabled = False
    
    lsm_status = [
        {
            "name": "AppArmor",
            "status": "enforcing" if apparmor_raw.lower().startswith("y") else ("disabled" if apparmor_raw else "unknown"),
            "detail": apparmor_raw or "n/a",
            "type": "policy_engine"
        },
        {
            "name": "SELinux",
            "status": "enforcing" if selinux_enforce == "1" else ("disabled" if selinux_enforce == "0" else "unknown"),
            "detail": selinux_enforce or "n/a",
            "type": "policy_engine",
            "policy_version": selinux_policy or "n/a"
        },
        {
            "name": "BPF LSM",
            "status": "present" if bpf_lsm_present else "absent",
            "detail": "eBPF-based LSM" if bpf_lsm_present else "n/a",
            "type": "policy_engine"
        },
        {
            "name": "LSM Stacking",
            "status": "enabled" if stacking_enabled else "disabled",
            "detail": ",".join(active_lsms[:3]) if active_lsms else "n/a",
            "type": "stacking"
        },
        {
            "name": "Yama ptrace",
            "status": "hardened" if yama_scope in {"2", "3"} else ("relaxed" if yama_scope in {"0", "1"} else "unknown"),
            "detail": yama_scope or "n/a",
            "type": "restriction"
        },
        {
            "name": "unprivileged bpf",
            "status": "blocked" if bpf_unpriv == "1" else ("allowed" if bpf_unpriv == "0" else "unknown"),
            "detail": bpf_unpriv or "n/a",
            "type": "restriction"
        },
        {
            "name": "Landlock",
            "status": "present" if landlock_present else "absent",
            "detail": "sysfs" if landlock_present else "n/a",
            "type": "restriction"
        },
        {
            "name": "IMA/EVM",
            "status": "present" if ima_present else "absent",
            "detail": "sysfs" if ima_present else "n/a",
            "type": "integrity"
        }
    ]
    
    # LSM engines detail for security core visualization.
    lsm_engines = []
    if apparmor_raw.lower().startswith("y"):
        lsm_engines.append({
            "name": "AppArmor",
            "type": "policy_engine",
            "status": "enforcing",
            "hooks": ["file_open", "bprm_check", "socket_connect"],
            "decisions_per_sec": random.randint(8, 45)
        })
    if selinux_enforce == "1":
        lsm_engines.append({
            "name": "SELinux",
            "type": "policy_engine",
            "status": "enforcing",
            "hooks": ["file_open", "bprm_check", "socket_connect", "inode_create"],
            "decisions_per_sec": random.randint(12, 52)
        })
    if bpf_lsm_present:
        lsm_engines.append({
            "name": "BPF LSM",
            "type": "policy_engine",
            "status": "enforcing",
            "hooks": ["file_open", "bprm_check", "socket_connect"],
            "decisions_per_sec": random.randint(5, 28)
        })

    # Capabilities drift (CapEff/CapPrm from /proc/<pid>/status).
    # Full capabilities map (all 40+ capabilities).
    all_capabilities_map = {
        0: "CAP_CHOWN", 1: "CAP_DAC_OVERRIDE", 2: "CAP_DAC_READ_SEARCH", 3: "CAP_FOWNER",
        4: "CAP_FSETID", 5: "CAP_KILL", 6: "CAP_SETGID", 7: "CAP_SETUID",
        8: "CAP_SETPCAP", 9: "CAP_LINUX_IMMUTABLE", 10: "CAP_NET_BIND_SERVICE",
        11: "CAP_NET_BROADCAST", 12: "CAP_NET_ADMIN", 13: "CAP_NET_RAW", 14: "CAP_IPC_LOCK",
        15: "CAP_IPC_OWNER", 16: "CAP_SYS_MODULE", 17: "CAP_SYS_RAWIO", 18: "CAP_SYS_CHROOT",
        19: "CAP_SYS_PTRACE", 20: "CAP_SYS_PACCT", 21: "CAP_SYS_ADMIN", 22: "CAP_SYS_BOOT",
        23: "CAP_SYS_NICE", 24: "CAP_SYS_RESOURCE", 25: "CAP_SYS_TIME", 26: "CAP_SYS_TTY_CONFIG",
        27: "CAP_MKNOD", 28: "CAP_LEASE", 29: "CAP_AUDIT_WRITE", 30: "CAP_AUDIT_CONTROL",
        31: "CAP_SETFCAP", 32: "CAP_MAC_OVERRIDE", 33: "CAP_MAC_ADMIN", 34: "CAP_SYSLOG",
        35: "CAP_WAKE_ALARM", 36: "CAP_BLOCK_SUSPEND", 37: "CAP_AUDIT_READ", 38: "CAP_PERFMON",
        39: "CAP_BPF", 40: "CAP_CHECKPOINT_RESTORE"
    }
    dangerous_caps = {
        12: "CAP_NET_ADMIN",
        16: "CAP_SYS_MODULE",
        17: "CAP_SYS_RAWIO",
        19: "CAP_SYS_PTRACE",
        21: "CAP_SYS_ADMIN",
        39: "CAP_BPF"
    }
    capabilities_rows = []
    seccomp_counts = {"none": 0, "strict": 0, "filter": 0, "unknown": 0}
    seccomp_processes = []  # For security core visualization.
    capabilities_processes = []  # For security core visualization.
    
    # Common syscalls for seccomp visualization.
    common_syscalls = [
        "read", "write", "open", "close", "stat", "fstat", "lstat", "poll", "lseek",
        "mmap", "mprotect", "munmap", "brk", "rt_sigaction", "rt_sigprocmask",
        "rt_sigreturn", "ioctl", "pread64", "pwrite64", "readv", "writev",
        "access", "pipe", "select", "sched_yield", "mremap", "msync", "mincore",
        "madvise", "shmget", "shmat", "shmctl", "dup", "dup2", "pause", "nanosleep",
        "getitimer", "alarm", "setitimer", "getpid", "sendfile", "socket", "connect",
        "accept", "sendto", "recvfrom", "sendmsg", "recvmsg", "shutdown", "bind",
        "listen", "getsockname", "getpeername", "socketpair", "setsockopt", "getsockopt",
        "clone", "fork", "vfork", "execve", "exit", "wait4", "kill", "uname",
        "semget", "semop", "semctl", "shmdt", "msgget", "msgsnd", "msgrcv", "msgctl",
        "fcntl", "flock", "fsync", "fdatasync", "truncate", "ftruncate", "getdents",
        "getcwd", "chdir", "fchdir", "rename", "mkdir", "rmdir", "creat", "link",
        "unlink", "symlink", "readlink", "chmod", "fchmod", "chown", "fchown",
        "lchown", "umask", "gettimeofday", "getrlimit", "getrusage", "sysinfo",
        "times", "ptrace", "getuid", "syslog", "getgid", "setuid", "setgid",
        "geteuid", "getegid", "setpgid", "getppid", "getpgrp", "setsid", "setreuid",
        "setregid", "getgroups", "setgroups", "setresuid", "getresuid", "setresgid",
        "getresgid", "getpgid", "setfsuid", "setfsgid", "getsid", "capget", "capset",
        "rt_sigpending", "rt_sigtimedwait", "rt_sigqueueinfo", "rt_sigsuspend",
        "sigaltstack", "utime", "mknod", "uselib", "personality", "ustat", "statfs",
        "fstatfs", "sysfs", "getpriority", "setpriority", "sched_setparam",
        "sched_getparam", "sched_setscheduler", "sched_getscheduler",
        "sched_get_priority_max", "sched_get_priority_min", "sched_rr_get_interval",
        "mlock", "munlock", "mlockall", "munlockall", "vhangup", "modify_ldt",
        "pivot_root", "prctl", "arch_prctl", "adjtimex", "setrlimit", "chroot",
        "sync", "acct", "settimeofday", "mount", "umount2", "swapon", "swapoff",
        "reboot", "sethostname", "setdomainname", "iopl", "ioperm", "create_module",
        "init_module", "delete_module", "get_kernel_syms", "query_module", "quotactl",
        "nfsservctl", "getpmsg", "putpmsg", "afs_syscall", "tuxcall", "security",
        "gettid", "readahead", "setxattr", "lsetxattr", "fsetxattr", "getxattr",
        "lgetxattr", "fgetxattr", "listxattr", "llistxattr", "flistxattr",
        "removexattr", "lremovexattr", "fremovexattr", "tkill", "time", "futex",
        "sched_setaffinity", "sched_getaffinity", "set_thread_area", "io_setup",
        "io_destroy", "io_getevents", "io_submit", "io_cancel", "get_thread_area",
        "lookup_dcookie", "epoll_create", "epoll_ctl_old", "epoll_wait_old",
        "remap_file_pages", "getdents64", "set_tid_address", "restart_syscall",
        "semtimedop", "fadvise64", "timer_create", "timer_settime", "timer_gettime",
        "timer_getoverrun", "timer_delete", "clock_settime", "clock_gettime",
        "clock_getres", "clock_nanosleep", "exit_group", "epoll_wait", "epoll_ctl",
        "tgkill", "utimes", "vserver", "mbind", "set_mempolicy", "get_mempolicy",
        "mq_open", "mq_unlink", "mq_timedsend", "mq_timedreceive", "mq_notify",
        "mq_getsetattr", "kexec_load", "waitid", "add_key", "request_key", "keyctl",
        "ioprio_set", "ioprio_get", "inotify_init", "inotify_add_watch",
        "inotify_rm_watch", "migrate_pages", "openat", "mkdirat", "mknodat",
        "fchownat", "futimesat", "newfstatat", "unlinkat", "renameat", "linkat",
        "symlinkat", "readlinkat", "fchmodat", "faccessat", "pselect6", "ppoll",
        "unshare", "set_robust_list", "get_robust_list", "splice", "tee",
        "sync_file_range", "vmsplice", "move_pages", "utimensat", "epoll_pwait",
        "signalfd", "timerfd_create", "eventfd", "fallocate", "timerfd_settime",
        "timerfd_gettime", "accept4", "signalfd4", "eventfd2", "epoll_create1",
        "dup3", "pipe2", "inotify_init1", "preadv", "pwritev", "rt_tgsigqueueinfo",
        "perf_event_open", "recvmmsg", "fanotify_init", "fanotify_mark",
        "prlimit64", "name_to_handle_at", "open_by_handle_at", "clock_adjtime",
        "syncfs", "sendmmsg", "setns", "getcpu", "process_vm_readv",
        "process_vm_writev", "kcmp", "finit_module", "sched_setattr",
        "sched_getattr", "renameat2", "seccomp", "getrandom", "memfd_create",
        "kexec_file_load", "bpf", "execveat", "userfaultfd", "membarrier",
        "mlock2", "copy_file_range", "preadv2", "pwritev2", "pkey_mprotect",
        "pkey_alloc", "pkey_free", "statx", "io_pgetevents", "rseq"
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
        
        # Collect seccomp details for security core visualization.
        if seccomp_mode in {"filter", "strict"}:
            # Heuristic: generate allowed/blocked syscalls based on process type.
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
                # Generic: allow common syscalls, block dangerous ones.
                allowed_syscalls = common_syscalls[:40]  # First 40 common syscalls
                blocked_syscalls = ["ptrace", "mount", "umount", "sys_module", "bpf", "keyctl", "kexec_load"]
            
            seccomp_processes.append({
                "pid": pid,
                "name": row.get("name", "unknown"),
                "mode": seccomp_mode,
                "allowed_syscalls": allowed_syscalls[:20],  # Limit for visualization
                "blocked_syscalls": blocked_syscalls,
                "sandbox_level": "strict" if seccomp_mode == "strict" else "filter"
            })
        
        if not cap_eff_hex:
            continue
        try:
            cap_eff_val = int(cap_eff_hex, 16)
            cap_prm_val = int(cap_prm_hex or "0", 16)
        except Exception:
            continue

        # Collect all capabilities (not just dangerous ones) for security core visualization.
        all_caps = [all_capabilities_map.get(bit, f"CAP_{bit}") for bit in range(41) if (cap_eff_val & (1 << bit))]
        matched = [name for bit, name in dangerous_caps.items() if (cap_eff_val & (1 << bit))]
        
        # Store capabilities as "keys" for visualization.
        capabilities_processes.append({
            "pid": pid,
            "name": row.get("name", "unknown"),
            "user": row.get("user", ""),
            "capabilities": all_caps[:15],  # Limit for visualization
            "dangerous_caps": matched,
            "cap_eff_hex": cap_eff_hex,
            "has_keys": len(all_caps) > 0
        })
        
        if not matched:
            continue
        risk = min(100, 20 + len(matched) * 16 + (10 if row.get("user") == "root" else 0))
        capabilities_rows.append({
            "pid": pid,
            "name": row.get("name", "unknown"),
            "user": row.get("user", ""),
            "seccomp": seccomp_mode,
            "cap_eff": cap_eff_hex,
            "cap_prm": cap_prm_hex or "0",
            "dangerous": matched[:4],
            "risk_score": int(risk)
        })

    capabilities_rows.sort(key=lambda x: (x.get("risk_score", 0), len(x.get("dangerous", []))), reverse=True)
    capabilities_drift = capabilities_rows[:8]

    # Seccomp coverage summary + top unsandboxed risky processes.
    total_seccomp_sample = max(1, sum(seccomp_counts.values()))
    unsandboxed = [r for r in capabilities_rows if r.get("seccomp") == "none"]
    unsandboxed.sort(key=lambda x: x.get("risk_score", 0), reverse=True)
    seccomp_coverage = {
        "none": int(seccomp_counts.get("none", 0)),
        "strict": int(seccomp_counts.get("strict", 0)),
        "filter": int(seccomp_counts.get("filter", 0)),
        "unknown": int(seccomp_counts.get("unknown", 0)),
        "coverage_percent": round((seccomp_counts.get("filter", 0) + seccomp_counts.get("strict", 0)) * 100.0 / total_seccomp_sample, 2),
        "high_risk_unsandboxed": [
            {
                "pid": int(r.get("pid", 0)),
                "name": str(r.get("name", "unknown")),
                "risk_score": int(r.get("risk_score", 0))
            }
            for r in unsandboxed[:6]
        ]
    }

    prev_ts = SECURITY_PREV["timestamp"]
    prev_events = int(SECURITY_PREV["events"] or 0)
    current_events = len(lanes)
    SECURITY_PREV["timestamp"] = now
    SECURITY_PREV["events"] = current_events
    if prev_ts:
        dt = max(0.001, now - prev_ts)
        decisions_per_sec = round((current_events / dt) + abs(current_events - prev_events) * 0.6, 2)
    else:
        decisions_per_sec = float(current_events)

    return {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "pipeline": {
            "stages": [
                "request event",
                "LSM/seccomp hook",
                "policy verdict"
            ],
            "lanes": lanes
        },
        "trust_graph": trust_graph,
        "attack_surface": attack_surface,
        "security_tools": {
            "lsm_status": lsm_status,
            "capabilities_drift": capabilities_drift,
            "seccomp_coverage": seccomp_coverage
        },
        "security_core": {
            "lsm_engines": lsm_engines,
            "seccomp_processes": seccomp_processes[:12],  # Top 12 for visualization
            "capabilities_processes": capabilities_processes[:12],  # Top 12 for visualization
            "stacking_enabled": stacking_enabled,
            "active_lsms": active_lsms
        },
        "meta": {
            "decisions_per_sec": decisions_per_sec,
            "events": current_events,
            "trusted": sum(1 for p in trust_graph if p.get("trust") == "trusted"),
            "observe": sum(1 for p in trust_graph if p.get("trust") == "observe"),
            "suspicious": sum(1 for p in trust_graph if p.get("trust") == "suspicious"),
            "blocked": sum(1 for p in trust_graph if p.get("trust") == "blocked"),
            "seccomp_coverage_percent": seccomp_coverage.get("coverage_percent", 0.0),
            "mode": "live-heuristic-v2"
        }
    }

def _parse_meminfo_kb():
    """Linux /proc/meminfo values in kB (same units as psutil docs)."""
    out = {}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    out[parts[0].rstrip(":")] = int(parts[1])
    except Exception:
        pass
    return out


def _memory_strip_blocks(kind, kb_k, mem_total_kb, n_blocks, seed0):
    """Variable-width blocks in one horizontal strip; heat ~ share of RAM in this category."""
    mem_total_kb = max(1, int(mem_total_kb))
    kb_k = max(0, int(kb_k))
    weights = []
    for i in range(n_blocks):
        v = (((seed0 + i * 104729) % 1000) + 40) / 1040.0
        weights.append(v)
    sw = sum(weights)
    share = kb_k / float(mem_total_kb)
    blocks = []
    for i in range(n_blocks):
        w = weights[i] / sw
        heat = min(
            1.0,
            0.05 + min(0.92, share * 2.0) + (((seed0 + i * 31) % 15) / 120.0),
        )
        blocks.append({"w": round(w, 6), "heat": round(heat, 4), "kind": kind})
    return blocks


def _build_memory_visual_rows(meminfo_kb, syscall_nodes, vm, swap):
    """
    Rows of horizontal strips: each row ≈ one kernel/accounting bucket from /proc/meminfo.
    Block widths are stylistic subdivisions; row mass is proportional to kb / MemTotal.
    """
    mi = meminfo_kb or {}
    mt = max(1, int(mi.get("MemTotal") or 0))
    if mt <= 1:
        try:
            mt = max(1, int(getattr(vm, "total", 0) / 1024))
        except Exception:
            mt = 1

    seed_base = (mt % 100000) + int(mi.get("Active", 0) or 0) % 50000

    row_specs = [
        ("buffers", "buffers", mi.get("Buffers", 0)),
        ("cached", "page cache", mi.get("Cached", 0)),
        ("anon", "anonymous (heap/stack)", mi.get("AnonPages", 0)),
    ]
    # Slab: split reclaimable vs unreclaimable when both exist (Linux 2.6.19+).
    if mi.get("SReclaimable") is not None and mi.get("SUnreclaim") is not None:
        row_specs.append(("sreclaim", "slab reclaimable", mi.get("SReclaimable", 0)))
        row_specs.append(("sunreclaim", "slab unreclaimable", mi.get("SUnreclaim", 0)))
    else:
        row_specs.append(("slab", "slab / kmalloc", mi.get("Slab", 0)))
    row_specs.extend(
        [
            ("shmem", "shmem / tmpfs", mi.get("Shmem", 0)),
            ("mapped", "file mappings", mi.get("Mapped", 0)),
        ]
    )
    dirty_wb = int(mi.get("Dirty", 0) or 0) + int(mi.get("Writeback", 0) or 0) + int(
        mi.get("WritebackTmp", 0) or 0
    )
    if dirty_wb > 0:
        row_specs.append(("dirty_wb", "dirty + writeback", dirty_wb))
    ah = int(mi.get("AnonHugePages", 0) or 0)
    if ah > 0:
        row_specs.append(("anon_huge", "transparent huge pages (anon)", ah))
    shm_h = int(mi.get("ShmemHugePages", 0) or 0)
    if shm_h > 0:
        row_specs.append(("shmem_huge", "huge pages (shmem)", shm_h))
    vmu = int(mi.get("VmallocUsed", 0) or 0)
    if vmu > 0:
        row_specs.append(("vmalloc", "vmalloc used", vmu))
    ac = int(mi.get("Active", 0) or 0)
    iac = int(mi.get("Inactive", 0) or 0)
    if ac > 0:
        row_specs.append(("active", "active (LRU)", ac))
    if iac > 0:
        row_specs.append(("inactive", "inactive (LRU)", iac))
    swap_tot = int(mi.get("SwapTotal", 0) or 0)
    swap_free = int(mi.get("SwapFree", 0) or 0)
    swap_used = max(0, swap_tot - swap_free)
    if swap_tot > 0:
        row_specs.append(("swap", "swap occupied", swap_used))

    pt = int(mi.get("PageTables", 0) or 0)
    ks = int(mi.get("KernelStack", 0) or 0)
    if pt + ks > 0:
        row_specs.append(("kmeta", "pagetables + kernel stacks", pt + ks))

    rows = []
    for sk, label, kb in row_specs:
        kb = int(kb or 0)
        if kb <= 0 and sk != "swap":
            continue
        if sk == "swap" and kb <= 0:
            continue
        sk_seed = sum(ord(c) for c in sk) * 31 + len(sk)
        n_blocks = 22 + (seed_base % 11) + (sk_seed % 9)
        seed0 = seed_base + (sk_seed % 100000)
        blocks = _memory_strip_blocks(sk, kb, mt, n_blocks, seed0)
        rows.append(
            {
                "id": sk,
                "label": label,
                "kb": kb,
                "pct_of_ram": round(100.0 * kb / float(mt), 2) if mt else 0.0,
                "blocks": blocks,
            }
        )

    top_tasks = sorted(
        syscall_nodes,
        key=lambda x: int(x.get("rss_bytes") or 0),
        reverse=True,
    )[:6]
    if top_tasks:
        tr_bytes = sum(int(x.get("rss_bytes") or 0) for x in top_tasks) or 1
        tr_kb = max(1, int(tr_bytes / 1024))
        task_blocks = []
        for p in top_tasks:
            rss = int(p.get("rss_bytes") or 0)
            if rss <= 0:
                continue
            w = rss / float(tr_bytes)
            mp = float(p.get("memory_percent") or 0.0)
            heat = min(1.0, 0.2 + (mp / 100.0) * 0.75 + (rss / float(tr_bytes)) * 0.15)
            task_blocks.append(
                {
                    "w": round(w, 6),
                    "heat": round(heat, 4),
                    "kind": "task",
                    "pid": int(p.get("pid") or 0),
                    "name": str(p.get("name") or "")[:14],
                }
            )
        if task_blocks:
            sw = sum(b["w"] for b in task_blocks)
            if sw > 0:
                for b in task_blocks:
                    b["w"] = round(b["w"] / sw, 6)
            rows.append(
                {
                    "id": "tasks",
                    "label": "sampled tasks RSS (top)",
                    "kb": tr_kb,
                    "pct_of_ram": round(100.0 * tr_kb / float(mt), 2) if mt else 0.0,
                    "blocks": task_blocks,
                }
            )

    dirty_kb = int(mi.get("Dirty", 0) or 0)
    wb_kb = int(mi.get("Writeback", 0) or 0)
    sr_kb = int(mi.get("SReclaimable", 0) or 0)
    su_kb = int(mi.get("SUnreclaim", 0) or 0)
    slab_total_kb = int(mi.get("Slab", 0) or 0) or (sr_kb + su_kb)
    summary = {
        "total_mb": round(mt / 1024.0, 1),
        "used_percent": round(vm.percent, 1) if vm else 0.0,
        "available_mb": round((mi.get("MemAvailable", 0) or 0) / 1024.0, 1),
        "swap_percent": round(swap.percent, 1) if swap else 0.0,
        "buffers_mb": round((mi.get("Buffers", 0) or 0) / 1024.0, 1),
        "cached_mb": round((mi.get("Cached", 0) or 0) / 1024.0, 1),
        "anon_mb": round((mi.get("AnonPages", 0) or 0) / 1024.0, 1),
        "slab_mb": round(slab_total_kb / 1024.0, 1),
        "sreclaimable_mb": round(sr_kb / 1024.0, 1),
        "sunreclaim_mb": round(su_kb / 1024.0, 1),
        "dirty_mb": round(dirty_kb / 1024.0, 2),
        "writeback_mb": round(wb_kb / 1024.0, 2),
        "dirty_writeback_mb": round(dirty_wb / 1024.0, 2),
        "anon_huge_mb": round(ah / 1024.0, 2),
        "shmem_huge_mb": round(shm_h / 1024.0, 2),
        "vmalloc_mb": round(vmu / 1024.0, 2),
        "active_mb": round(ac / 1024.0, 1),
        "inactive_mb": round(iac / 1024.0, 1),
        "swap_used_mb": round(swap_used / 1024.0, 1) if swap_tot else 0.0,
        "source": "proc_meminfo+psutil+v2",
    }
    return rows, summary


def collect_processes_realtime():
    """
    Processes subsystem telemetry focused on:
    - syscall interception signals
    - network tracing
    - security hooks
    """
    lsm_raw = ""
    try:
        with open("/sys/kernel/security/lsm", "r", encoding="utf-8", errors="ignore") as f:
            lsm_raw = str(f.read().strip())
    except Exception:
        lsm_raw = ""
    active_lsms = [x.strip() for x in lsm_raw.split(",") if x.strip()]

    yama_scope = ""
    try:
        with open("/proc/sys/kernel/yama/ptrace_scope", "r", encoding="utf-8", errors="ignore") as f:
            yama_scope = str(f.read().strip())
    except Exception:
        yama_scope = ""

    syscall_nodes = []
    seccomp_modes = {"none": 0, "strict": 0, "filter": 0, "unknown": 0}
    for proc in psutil.process_iter(["pid", "ppid", "name", "username", "cpu_percent", "memory_percent", "num_threads"]):
        try:
            pid = int(proc.info.get("pid") or 0)
            if pid <= 0:
                continue
            ppid = int(proc.info.get("ppid") or 0)
            name = str(proc.info.get("name") or "unknown")
            user = str(proc.info.get("username") or "")
            cpu = float(proc.info.get("cpu_percent") or 0.0)
            mem = float(proc.info.get("memory_percent") or 0.0)
            threads = int(proc.info.get("num_threads") or 0)
            rss = 0
            try:
                rss = int(getattr(proc.memory_info(), "rss", 0) or 0)
            except Exception:
                rss = 0
            fd_count = 0
            try:
                fd_count = int(proc.num_fds() or 0)
            except Exception:
                fd_count = 0
            seccomp_mode = "unknown"
            with open(f"/proc/{pid}/status", "r", encoding="utf-8", errors="ignore") as f:
                for ln in f:
                    if ln.startswith("Seccomp:"):
                        raw = ln.split(":", 1)[1].strip()
                        if raw == "0":
                            seccomp_mode = "none"
                        elif raw == "1":
                            seccomp_mode = "strict"
                        elif raw == "2":
                            seccomp_mode = "filter"
                        else:
                            seccomp_mode = "unknown"
                        break
            seccomp_modes[seccomp_mode] = seccomp_modes.get(seccomp_mode, 0) + 1
            syscall_pressure = min(100, int(cpu * 1.5 + threads * 0.35 + mem * 0.8))
            syscall_nodes.append({
                "pid": pid,
                "ppid": ppid,
                "name": name,
                "user": user,
                "fd_count": fd_count,
                "syscall_pressure": syscall_pressure,
                "seccomp_mode": seccomp_mode,
                "memory_percent": round(mem, 2),
                "rss_bytes": rss,
            })
        except Exception:
            continue
    syscall_nodes.sort(key=lambda x: x.get("syscall_pressure", 0), reverse=True)
    syscall_nodes = syscall_nodes[:14]

    network_nodes = {}
    try:
        for conn in psutil.net_connections(kind="inet"):
            pid = int(getattr(conn, "pid", 0) or 0)
            if pid <= 0:
                continue
            remote_ip = ""
            try:
                raddr = getattr(conn, "raddr", None)
                if raddr and len(raddr) >= 1:
                    remote_ip = str(raddr[0])
            except Exception:
                remote_ip = ""
            status = str(getattr(conn, "status", "") or "").upper()
            bucket = network_nodes.get(pid)
            if not bucket:
                proc_name = "unknown"
                try:
                    proc_name = psutil.Process(pid).name()
                except Exception:
                    proc_name = "unknown"
                bucket = {
                    "pid": pid,
                    "name": proc_name,
                    "connections": 0,
                    "remote_ips": set(),
                    "states": {}
                }
                network_nodes[pid] = bucket
            bucket["connections"] += 1
            if remote_ip:
                bucket["remote_ips"].add(remote_ip)
            if status:
                bucket["states"][status] = bucket["states"].get(status, 0) + 1
    except Exception:
        pass

    network_tracing = []
    for _, row in network_nodes.items():
        states_sorted = sorted(row["states"].items(), key=lambda kv: kv[1], reverse=True)
        top_state = states_sorted[0][0] if states_sorted else "UNKNOWN"
        network_tracing.append({
            "pid": int(row["pid"]),
            "name": str(row["name"]),
            "connections": int(row["connections"]),
            "unique_peers": int(len(row["remote_ips"])),
            "peer_sample": sorted(list(row["remote_ips"]))[:4],
            "top_state": top_state
        })
    network_tracing.sort(key=lambda x: (x.get("connections", 0), x.get("unique_peers", 0)), reverse=True)
    network_tracing = network_tracing[:14]

    security_hooks = [
        {
            "name": "LSM stack",
            "status": "active" if active_lsms else "unknown",
            "detail": ",".join(active_lsms[:4]) if active_lsms else "n/a"
        },
        {
            "name": "SELinux/AppArmor engines",
            "status": "active" if any(x in {"selinux", "apparmor"} for x in active_lsms) else "inactive",
            "detail": "policy-enforcement-path"
        },
        {
            "name": "BPF LSM",
            "status": "active" if "bpf" in active_lsms else "inactive",
            "detail": "dynamic-policy-hook"
        },
        {
            "name": "seccomp filter gate",
            "status": "active" if (seccomp_modes.get("filter", 0) + seccomp_modes.get("strict", 0)) > 0 else "inactive",
            "detail": f"filter:{seccomp_modes.get('filter', 0)} strict:{seccomp_modes.get('strict', 0)}"
        },
        {
            "name": "Yama ptrace scope",
            "status": "hardened" if yama_scope in {"2", "3"} else ("relaxed" if yama_scope in {"0", "1"} else "unknown"),
            "detail": yama_scope or "n/a"
        }
    ]

    # Neural graph model: nodes=processes, edges=behavior interactions.
    node_pool = {}
    for row in syscall_nodes[:16]:
        pid = int(row.get("pid") or 0)
        if pid <= 0:
            continue
        node_pool[pid] = {
            "pid": pid,
            "ppid": int(row.get("ppid") or 0),
            "name": str(row.get("name") or "unknown"),
            "user": str(row.get("user") or ""),
            "syscall_pressure": int(row.get("syscall_pressure") or 0),
            "fd_count": int(row.get("fd_count") or 0),
            "seccomp_mode": str(row.get("seccomp_mode") or "unknown"),
            "connections": 0,
            "unique_peers": 0,
            "memory_percent": float(row.get("memory_percent") or 0.0),
            "rss_bytes": int(row.get("rss_bytes") or 0),
        }
    for row in network_tracing[:16]:
        pid = int(row.get("pid") or 0)
        if pid <= 0:
            continue
        if pid not in node_pool:
            node_pool[pid] = {
                "pid": pid,
                "ppid": 0,
                "name": str(row.get("name") or "unknown"),
                "user": "",
                "syscall_pressure": 0,
                "fd_count": 0,
                "seccomp_mode": "unknown",
                "connections": 0,
                "unique_peers": 0,
                "memory_percent": 0.0,
                "rss_bytes": 0,
            }
        node_pool[pid]["connections"] = int(row.get("connections") or 0)
        node_pool[pid]["unique_peers"] = int(row.get("unique_peers") or 0)

    edges = []
    edge_keys = set()
    network_by_pid = {int(r.get("pid") or 0): r for r in network_tracing}
    node_pids = sorted(node_pool.keys())

    def _add_edge(src_pid, dst_pid, edge_type, weight):
        src = int(src_pid or 0)
        dst = int(dst_pid or 0)
        if src <= 0 or dst <= 0 or src == dst:
            return
        if src not in node_pool or dst not in node_pool:
            return
        pair = tuple(sorted((src, dst)))
        key = (pair[0], pair[1], edge_type)
        if key in edge_keys:
            return
        edge_keys.add(key)
        edges.append({
            "source": src,
            "target": dst,
            "type": edge_type,
            "weight": float(max(0.1, min(1.0, weight)))
        })

    # IPC edges: parent-child links inside the sampled set.
    for pid, node in node_pool.items():
        ppid = int(node.get("ppid") or 0)
        if ppid in node_pool:
            _add_edge(pid, ppid, "ipc", 0.72)

    # Syscalls edges: close-pressure processes likely competing on kernel hooks.
    sorted_by_pressure = sorted(node_pool.values(), key=lambda n: n.get("syscall_pressure", 0), reverse=True)
    for i in range(len(sorted_by_pressure) - 1):
        a = sorted_by_pressure[i]
        b = sorted_by_pressure[i + 1]
        diff = abs(int(a.get("syscall_pressure", 0)) - int(b.get("syscall_pressure", 0)))
        weight = 1.0 - min(0.8, diff / 100.0)
        _add_edge(int(a.get("pid")), int(b.get("pid")), "syscalls", weight)

    # Network edges: connect nodes that share at least one peer sample.
    for i in range(len(node_pids)):
        for j in range(i + 1, len(node_pids)):
            pa = node_pids[i]
            pb = node_pids[j]
            ra = network_by_pid.get(pa) or {}
            rb = network_by_pid.get(pb) or {}
            sa = set(ra.get("peer_sample") or [])
            sb = set(rb.get("peer_sample") or [])
            if sa and sb and (sa & sb):
                _add_edge(pa, pb, "network", 0.88)

    # File access edges: processes with high FD count and same user.
    for i in range(len(node_pids)):
        for j in range(i + 1, len(node_pids)):
            na = node_pool[node_pids[i]]
            nb = node_pool[node_pids[j]]
            if not na.get("user") or na.get("user") != nb.get("user"):
                continue
            fa = int(na.get("fd_count") or 0)
            fb = int(nb.get("fd_count") or 0)
            if fa >= 16 and fb >= 16:
                _add_edge(int(na.get("pid")), int(nb.get("pid")), "file_access", 0.64)

    nodes = list(node_pool.values())[:18]
    edges = edges[:64]

    try:
        vm = psutil.virtual_memory()
        swap = psutil.swap_memory()
        meminfo_kb = _parse_meminfo_kb()
        strip_rows, mem_summary = _build_memory_visual_rows(meminfo_kb, syscall_nodes, vm, swap)
        memory_visual = {
            "layout": "strips",
            "rows": strip_rows,
            "summary": mem_summary,
        }
    except Exception:
        memory_visual = {
            "layout": "strips",
            "rows": [],
            "summary": {
                "total_mb": 0,
                "used_percent": 0.0,
                "available_mb": 0,
                "swap_percent": 0.0,
                "source": "error",
            },
        }

    return {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "syscalls_interception": syscall_nodes,
        "network_tracing": network_tracing,
        "security_hooks": security_hooks,
        "neural_graph": {
            "nodes": nodes,
            "edges": edges
        },
        "memory_visual": memory_visual,
        "meta": {
            "processes_sampled": len(syscall_nodes),
            "network_processes": len(network_tracing),
            "seccomp_filter_percent": round(
                (seccomp_modes.get("filter", 0) + seccomp_modes.get("strict", 0))
                * 100.0 / max(1, sum(seccomp_modes.values())),
                2
            ),
            "mode": "live-heuristic-v1"
        }
    }

@app.route('/api/kernel-dna')
def kernel_dna():
    """API endpoint for Kernel DNA visualization data"""
    try:
        data = get_kernel_dna_data()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/crypto-realtime')
def crypto_realtime():
    """Realtime-ish crypto interaction feed for crypto visualization."""
    try:
        return jsonify(collect_crypto_realtime())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/security-realtime')
def security_realtime():
    """Realtime-ish security interaction feed for security visualization."""
    try:
        return jsonify(collect_security_realtime())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/processes-realtime')
def processes_realtime():
    """Realtime-ish processes interaction feed for processes visualization."""
    try:
        return jsonify(collect_processes_realtime())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/frontend-logs', methods=['POST', 'OPTIONS'])
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

@app.errorhandler(404)
def not_found(error):
    return jsonify({'error': 'Not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    system_info = get_system_info()
    
    print("🚀 Linux Kernel Visualization Backend")
    print(f"📍 Platform: {system_info['platform']}")
    print(f"🐧 Kernel: {system_info['kernel']}")
    print(f"🌐 Server: http://127.0.0.1:5001")
    print(f"📊 API endpoints:")
    print(f"   - {Config.API_PREFIX}/syscalls-realtime")
    print(f"   - {Config.API_PREFIX}/kernel-data")
    print(f"   - {Config.API_PREFIX}/process-kernel-map")
    print(f"   - {Config.API_PREFIX}/nginx-files")
    print(f"   - {Config.API_PREFIX}/execution-context")
    print(f"   - /health")
    
    app.run(
        host='0.0.0.0',
        port=5001,
        debug=Config.DEBUG,
        threaded=True
    )

