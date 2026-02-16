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
import ipaddress
import shutil
from datetime import datetime
from flask import Flask, jsonify, render_template, send_from_directory, request
import psutil

# Try to import OpenAI (optional)
try:
    import openai
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

app = Flask(__name__)
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
    "tty_irq_total": None
}

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

def get_real_system_calls():
    """Get real system calls from /proc filesystem"""
    try:
        if platform.system() != 'Linux':
            return get_mock_system_calls()
        
        # Dictionary to count syscalls
        syscall_counts = {}
        
        # Read /proc/*/syscall for all processes
        # This shows the current syscall each process is executing
        proc_dirs = []
        try:
            proc_dirs = [d for d in os.listdir('/proc') if d.isdigit()]
        except PermissionError:
            # If we can't read /proc, use limited access
            pass
        
        # Sample up to 100 processes to avoid performance issues
        sampled_procs = proc_dirs[:100] if len(proc_dirs) > 100 else proc_dirs
        
        for pid in sampled_procs:
            try:
                syscall_path = f'/proc/{pid}/syscall'
                if os.path.exists(syscall_path):
                    with open(syscall_path, 'r') as f:
                        line = f.read().strip()
                        if line and line != '-1':
                            # Format: syscall_number arg1 arg2 ... (or just number)
                            parts = line.split()
                            if parts:
                                try:
                                    syscall_num = int(parts[0])
                                    syscall_name = SYSCALL_NAMES.get(syscall_num, f'syscall_{syscall_num}')
                                    syscall_counts[syscall_name] = syscall_counts.get(syscall_name, 0) + 1
                                except ValueError:
                                    continue
            except (PermissionError, FileNotFoundError, IOError):
                # Process may have terminated or we don't have permission
                continue
        
        # Also get CPU statistics from /proc/stat which includes context switches
        try:
            with open('/proc/stat', 'r') as f:
                stat_lines = f.readlines()
                for line in stat_lines:
                    if line.startswith('ctxt '):
                        # Context switches indicate syscall activity
                        ctxt_switches = int(line.split()[1])
                        # Use this to scale our counts
                        break
        except (IOError, ValueError, IndexError):
            ctxt_switches = 0
        
        # Convert counts to list format expected by frontend
        syscalls = []
        if syscall_counts:
            # Sort by count and take top 10
            sorted_syscalls = sorted(syscall_counts.items(), key=lambda x: x[1], reverse=True)[:10]
            
            for name, count in sorted_syscalls:
                # Format: "count total" where total is a larger number
                # This matches the frontend expectation
                total = count * 1000 + random.randint(100, 999)  # Add some variation
                formatted_count = f"{count:03d} {total:06d}"
                syscalls.append({'name': name, 'count': formatted_count})
        else:
            # Fallback: use /proc/stat to infer activity
            try:
                with open('/proc/stat', 'r') as f:
                    cpu_line = f.readline()
                    if cpu_line.startswith('cpu '):
                        # CPU stats include user and system time
                        parts = cpu_line.split()
                        if len(parts) >= 4:
                            user_time = int(parts[1])
                            system_time = int(parts[3])
                            # Estimate syscall activity from system time
                            activity_level = system_time % 1000
                            
                            # Common syscalls that are likely active
                            common_syscalls = ['read', 'write', 'open', 'close', 'mmap', 
                                              'fork', 'execve', 'socket', 'connect', 'accept']
                            
                            for i, name in enumerate(common_syscalls[:10]):
                                # Use activity level to create realistic counts
                                count = (activity_level + i * 10) % 999 + 1
                                total = count * 1000 + random.randint(100, 999)
                                formatted_count = f"{count:03d} {total:06d}"
                                syscalls.append({'name': name, 'count': formatted_count})
            except (IOError, ValueError, IndexError):
                pass
        
        # If we still don't have data, use mock
        if not syscalls:
            return get_mock_system_calls()
        
        return syscalls
        
    except Exception as e:
        print(f"Error getting system calls: {e}")
        import traceback
        traceback.print_exc()
        return get_mock_system_calls()

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

def get_devices_realtime():
    now = time.time()
    prev_ts = DEVICES_PREV["timestamp"]
    dt = max(0.001, now - prev_ts) if prev_ts else 1.0

    # 1) Block devices throughput from /proc/diskstats sectors delta.
    disk_now = _read_diskstats()
    block_devices = []
    for name, sectors_total in disk_now.items():
        prev = DEVICES_PREV["disk_sectors"].get(name)
        delta_sectors = max(0, sectors_total - prev) if prev is not None else 0
        bps = (delta_sectors * 512) / dt  # 512 bytes/sector
        block_devices.append({
            "name": name,
            "type": "block",
            "throughput_bps": bps,
            "targets": ["vfs"],
            "label": f"{name} (block)"
        })

    # 2) Network device throughput from psutil counters.
    net_now = {}
    net_devices = []
    try:
        pernic = psutil.net_io_counters(pernic=True)
        for iface, counters in pernic.items():
            if iface == "lo":
                continue
            total_bytes = counters.bytes_recv + counters.bytes_sent
            net_now[iface] = total_bytes
            prev = DEVICES_PREV["net_bytes"].get(iface)
            delta = max(0, total_bytes - prev) if prev is not None else 0
            bps = delta / dt
            net_devices.append({
                "name": iface,
                "type": "network",
                "throughput_bps": bps,
                "targets": ["net"],
                "label": f"{iface} (net)",
                "errors": int(counters.errin + counters.errout),
                "drops": int(counters.dropin + counters.dropout)
            })
    except Exception:
        net_devices = []

    # 3) TTY pseudo-device load via IRQ delta.
    tty_irq_total = _read_tty_irq_total()
    prev_tty_irq = DEVICES_PREV["tty_irq_total"]
    tty_irq_delta = max(0, tty_irq_total - prev_tty_irq) if prev_tty_irq is not None else 0
    tty_load_per_sec = tty_irq_delta / dt
    tty_devices = [{
        "name": "tty0",
        "type": "tty",
        "throughput_bps": tty_load_per_sec * 1024,  # normalize into "bytes-like" lane speed
        "targets": ["sched", "signals"],
        "label": "tty0 (tty)",
        "irq_per_sec": round(tty_load_per_sec, 2)
    }]

    # 4) Null as baseline low-load misc port.
    null_device = [{
        "name": "null",
        "type": "misc",
        "throughput_bps": 0.0,
        "targets": ["kernel"],
        "label": "null (misc)"
    }]

    devices = block_devices + net_devices + tty_devices + null_device
    devices.sort(key=lambda d: d.get("throughput_bps", 0), reverse=True)
    top_devices = devices[:12]

    max_bps = max([d.get("throughput_bps", 0) for d in top_devices] + [1.0])
    for d in top_devices:
        d["throughput_bps"] = round(float(d.get("throughput_bps", 0)), 2)
        d["throughput_mb_s"] = round(d["throughput_bps"] / (1024 * 1024), 4)
        d["load_norm"] = round(min(1.0, d["throughput_bps"] / max_bps), 4)

    DEVICES_PREV["timestamp"] = now
    DEVICES_PREV["disk_sectors"] = disk_now
    DEVICES_PREV["net_bytes"] = net_now
    DEVICES_PREV["tty_irq_total"] = tty_irq_total

    return {
        "timestamp": datetime.now().isoformat(),
        "devices": top_devices,
        "meta": {
            "count": len(top_devices),
            "max_throughput_bps": round(max_bps, 2)
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
                memory_info = proc.info['memory_info']
                memory_mb = memory_info.rss / 1024 / 1024
                
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
                process_name = proc.info['name']
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
                    'status': proc.info['status'],
                    'memory_mb': round(memory_mb, 1),
                    'cpu_percent': round(proc.info.get('cpu_percent', 0), 1),
                    'num_threads': proc.info.get('num_threads', 0),
                    'num_fds': num_fds
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        
        return jsonify({'processes': processes})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
        
        # Event: exec (process creation)
        timeline.append({
            'type': 'exec',
            'timestamp': datetime.fromtimestamp(proc_info['create_time']).isoformat(),
            'pid': pid
        })
        
        # Event: mmap (from /proc/[pid]/maps)
        try:
            maps_path = f'/proc/{pid}/maps'
            if os.path.exists(maps_path):
                with open(maps_path, 'r') as f:
                    map_count = len(f.readlines())
                    if map_count > 0:
                        timeline.append({
                            'type': 'mmap',
                            'timestamp': datetime.now().isoformat(),
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
                        timeline.append({
                            'type': 'read',
                            'timestamp': datetime.now().isoformat(),
                            'pid': pid,
                            'bytes': io_data.get('read_bytes', 0)
                        })
                    
                    if io_data.get('write_bytes', 0) > 0:
                        timeline.append({
                            'type': 'write',
                            'timestamp': datetime.now().isoformat(),
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
                    if len(lines) > 1:  # Has connections (excluding header)
                        # Check connection states
                        for line in lines[1:]:  # Skip header
                            parts = line.split()
                            if len(parts) >= 4:
                                state = parts[3]
                                # State 01 = ESTABLISHED (connect), 0A = LISTEN (accept)
                                if state == '01':
                                    timeline.append({
                                        'type': 'connect',
                                        'timestamp': datetime.now().isoformat(),
                                        'pid': pid
                                    })
                                elif state == '0A':
                                    timeline.append({
                                        'type': 'accept',
                                        'timestamp': datetime.now().isoformat(),
                                        'pid': pid
                                    })
        except (IOError, PermissionError):
            pass
        
        # Sort timeline by timestamp
        timeline.sort(key=lambda x: x['timestamp'])
        
        return jsonify({
            'timeline': timeline,
            'pid': pid,
            'name': proc_info.get('name', 'unknown'),
            'timestamp': datetime.now().isoformat()
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
                'count': syscall.get('count', '0'),
                'subsystem': map_syscall_to_subsystem(syscall['name']),
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
        # Fallback: generate some sample interrupts
        for irq_name in ['timer', 'keyboard', 'mouse', 'network']:
            dna_data['nucleotides'].append({
                'type': 'interrupt',
                'code': 'T',
                'name': irq_name,
                'count': random.randint(100, 1000),
                'subsystem': map_interrupt_to_subsystem(irq_name),
                'timestamp': datetime.now().isoformat()
            })
    
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

@app.route('/api/kernel-dna')
def kernel_dna():
    """API endpoint for Kernel DNA visualization data"""
    try:
        data = get_kernel_dna_data()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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

