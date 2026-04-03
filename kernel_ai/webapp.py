#!/usr/bin/env python3
"""
Linux Kernel Visualization Backend
Organized version with proper project structure
"""

import os
import sys
import json
import time
import random
import platform
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
from kernel_ai.services import process_inspect as _process_inspect_service
from kernel_ai.services import processes as _processes_service
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
    return _processes_service.get_proc_matrix_data()

# API Endpoints

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

def process_kernel_map():
    """API for process to kernel subsystem mapping"""
    try:
        data = get_process_kernel_map()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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

def nginx_files():
    """API for nginx open files"""
    try:
        files = get_nginx_open_files()
        return jsonify({"files": files})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
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
    try:
        connections = get_active_connections()
        return jsonify({"connections": connections})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

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

def network_stack_realtime():
    """Live telemetry for Network Stack visualization."""
    try:
        return jsonify(get_network_stack_realtime())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def devices_realtime():
    """Live telemetry for Devices belt visualization."""
    try:
        return jsonify(get_devices_realtime())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def filesystem_blocks():
    """Live block-map style filesystem telemetry."""
    try:
        return jsonify(get_filesystem_blocks())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def isolation_context():
    """API endpoint for cgroups + namespaces design layer."""
    try:
        return jsonify(get_isolation_context())
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def get_process_threads(pid):
    """API for getting thread information for a specific process"""
    try:
        thread_info = get_process_threads_info(pid)
        return jsonify(thread_info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def get_process_cpu(pid):
    """API for getting CPU statistics for a specific process"""
    try:
        cpu_info = get_process_cpu_info(pid)
        return jsonify(cpu_info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def get_process_fds(pid):
    """API for getting file descriptors for a specific process"""
    try:
        fds_info = get_process_fds_info(pid)
        return jsonify(fds_info)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def get_processes_detailed():
    """API for getting all processes with detailed information (threads, CPU, FDs)"""
    try:
        return jsonify({"processes": _processes_service.get_processes_detailed_data()})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def get_ipc_links_summary(max_pairs=120, max_nodes=24):
    return _process_inspect_service.get_ipc_links_summary(max_pairs=max_pairs, max_nodes=max_nodes)


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
    try:
        matrix = get_proc_matrix_data()
        return jsonify({
            'matrix': matrix,
            'timestamp': datetime.now().isoformat(),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
    try:
        return jsonify(
            _execution_service.get_execution_context_data(
                syscall_names=SYSCALL_NAMES,
                map_interrupt_to_subsystem_fn=map_interrupt_to_subsystem,
                exec_context_prev=EXEC_CONTEXT_PREV,
            )
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

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
    return _processes_service._parse_meminfo_kb()


def _memory_strip_blocks(kind, kb_k, mem_total_kb, n_blocks, seed0):
    return _processes_service._memory_strip_blocks(kind, kb_k, mem_total_kb, n_blocks, seed0)


def _build_memory_visual_rows(meminfo_kb, syscall_nodes, vm, swap):
    return _processes_service._build_memory_visual_rows(meminfo_kb, syscall_nodes, vm, swap)


def collect_processes_realtime():
    return _processes_service.collect_processes_realtime()

def kernel_dna():
    """API endpoint for Kernel DNA visualization data"""
    try:
        data = get_kernel_dna_data()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def crypto_realtime():
    """Realtime-ish crypto interaction feed for crypto visualization."""
    try:
        return jsonify(collect_crypto_realtime())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def security_realtime():
    """Realtime-ish security interaction feed for security visualization."""
    try:
        return jsonify(collect_security_realtime())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def processes_realtime():
    """Realtime-ish processes interaction feed for processes visualization."""
    try:
        return jsonify(collect_processes_realtime())
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
    try:
        return jsonify(_processes_service.get_proc_graph_data())
    except Exception as e:
        return jsonify({"error": str(e), "nodes": [], "edges": []}), 500


def get_process_files():
    """Bezier process↔file curves for ``bezier_curves.js`` (optional real data; empty → decorative fallback)."""
    try:
        return jsonify({"curves": [], "timestamp": datetime.now().isoformat()})
    except Exception as e:
        return jsonify({"error": str(e), "curves": []}), 500


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
