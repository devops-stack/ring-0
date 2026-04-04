#!/usr/bin/env python3
"""
Linux Kernel Visualization Backend
Organized version with proper project structure
"""

import os
import time
import random
import subprocess
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
from kernel_ai.services import devices as _devices_service
from kernel_ai.services import process_inspect as _process_inspect_service
from kernel_ai.services import process_timeline as _process_timeline_service
from kernel_ai.services import processes as _processes_service
from kernel_ai.services import syscalls as _syscalls_service
from kernel_ai.services import system_view as _system_view_service
from kernel_ai.services import frontend_logs as _frontend_logs_service
from kernel_ai.services import kernel_maps as _kernel_maps_service
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


def write_frontend_event(event_payload):
    _frontend_logs_service.write_frontend_event(
        event_payload=event_payload,
        frontend_log_file=FRONTEND_LOG_FILE,
        write_lock=FRONTEND_LOG_WRITE_LOCK,
    )

def get_system_info():
    """Get system information."""
    return _core_observability_service.get_system_info()

SYSCALL_NAMES = _kernel_maps_service.SYSCALL_NAMES

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

def get_devices_realtime():
    return _devices_service.get_devices_realtime(
        devices_prev=DEVICES_PREV,
        read_diskstats_fn=_proc_fs.read_diskstats,
        read_interrupt_lines_fn=_proc_fs.read_interrupt_lines,
        read_tty_irq_total_fn=_proc_fs.read_tty_irq_total,
    )

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
    def _payload():
        pid = request.args.get("pid", type=int)
        return _process_timeline_service.get_proc_timeline_data(pid)

    return api_json(
        _payload,
        exception_statuses=[(ValueError, 400), (ProcessLookupError, 404)],
    )

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
    """Map syscall name to kernel subsystem."""
    return _kernel_maps_service.map_syscall_to_subsystem(syscall_name)

def map_interrupt_to_subsystem(interrupt_name):
    """Map interrupt name to kernel subsystem."""
    return _kernel_maps_service.map_interrupt_to_subsystem(interrupt_name)

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
