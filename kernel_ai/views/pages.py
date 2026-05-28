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
    ("/health", "health_check", h.health_check),
]

for rule, endpoint, view_func in _PAGE_ROUTES:
    bp.add_url_rule(rule, endpoint=endpoint, view_func=view_func)


# /static/<path:filename> is served by Flask's built-in static handler (see ``app.static_folder`` in webapp).
