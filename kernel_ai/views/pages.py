"""Site pages: index, subsystem HTML, and health."""
from flask import Blueprint
from kernel_ai.http import pages as h

bp = Blueprint("pages", __name__)

_PAGE_ROUTES = [
    ("/", "index", h.index),
    ("/linux-crypto-subsystem", "linux_crypto_subsystem_page", h.linux_crypto_subsystem_page),
    ("/crypto", "crypto_page_legacy", h.crypto_page_legacy),
    ("/linux-security-subsystem", "linux_security_subsystem_page", h.linux_security_subsystem_page),
    ("/security", "security_page_legacy", h.security_page_legacy),
    ("/linux-processes-subsystem", "linux_processes_subsystem_page", h.linux_processes_subsystem_page),
    ("/processes", "processes_page_legacy", h.processes_page_legacy),
    ("/linux-crypto-subsystem.html", "linux_crypto_subsystem_html", h.linux_crypto_subsystem_html),
    ("/linux-security-subsystem.html", "linux_security_subsystem_html", h.linux_security_subsystem_html),
    ("/linux-processes-subsystem.html", "linux_processes_subsystem_html", h.linux_processes_subsystem_html),
    ("/linux-memory-subsystem", "linux_memory_subsystem_page", h.linux_memory_subsystem_page),
    ("/linux-memory-subsystem.html", "linux_memory_subsystem_html", h.linux_memory_subsystem_html),
    ("/linux-network-subsystem", "linux_network_subsystem_page", h.linux_network_subsystem_page),
    ("/network", "network_page_legacy", h.network_page_legacy),
    ("/linux-network-subsystem.html", "linux_network_subsystem_html", h.linux_network_subsystem_html),
    ("/linux-filesystem-subsystem", "linux_filesystem_subsystem_page", h.linux_filesystem_subsystem_page),
    ("/filesystem", "filesystem_page_legacy", h.filesystem_page_legacy),
    ("/files", "files_page_legacy", h.files_page_legacy),
    ("/linux-filesystem-subsystem.html", "linux_filesystem_subsystem_html", h.linux_filesystem_subsystem_html),
    ("/kernel-dna", "kernel_dna_page", h.kernel_dna_page),
    ("/kernel-dna.html", "kernel_dna_html", h.kernel_dna_html),
    ("/linux-devices-subsystem", "linux_devices_subsystem_page", h.linux_devices_subsystem_page),
    ("/devices", "devices_page_legacy", h.devices_page_legacy),
    ("/linux-devices-subsystem.html", "linux_devices_subsystem_html", h.linux_devices_subsystem_html),
    ("/health", "health_check", h.health_check),
]

for rule, endpoint, view_func in _PAGE_ROUTES:
    bp.add_url_rule(rule, endpoint=endpoint, view_func=view_func)


# /static/<path:filename> is served by Flask's built-in static handler (see ``app.static_folder`` in webapp).
