"""
Site pages: index, subsystem HTML, health, static files.

View implementations live in ``kernel_ai.webapp``; this module only wires URLs (lazy import avoids cycles).
"""
from flask import Blueprint

bp = Blueprint("pages", __name__)


def _core():
    from kernel_ai import webapp as core

    return core


@bp.route("/")
def index():
    return _core().index()


@bp.route("/linux-crypto-subsystem")
def linux_crypto_subsystem_page():
    return _core().linux_crypto_subsystem_page()


@bp.route("/crypto")
def crypto_page_legacy():
    return _core().crypto_page_legacy()


@bp.route("/linux-security-subsystem")
def linux_security_subsystem_page():
    return _core().linux_security_subsystem_page()


@bp.route("/security")
def security_page_legacy():
    return _core().security_page_legacy()


@bp.route("/linux-processes-subsystem")
def linux_processes_subsystem_page():
    return _core().linux_processes_subsystem_page()


@bp.route("/processes")
def processes_page_legacy():
    return _core().processes_page_legacy()


@bp.route("/linux-crypto-subsystem.html")
def linux_crypto_subsystem_html():
    return _core().linux_crypto_subsystem_html()


@bp.route("/linux-security-subsystem.html")
def linux_security_subsystem_html():
    return _core().linux_security_subsystem_html()


@bp.route("/linux-processes-subsystem.html")
def linux_processes_subsystem_html():
    return _core().linux_processes_subsystem_html()


@bp.route("/linux-memory-subsystem")
def linux_memory_subsystem_page():
    return _core().linux_memory_subsystem_page()


@bp.route("/linux-memory-subsystem.html")
def linux_memory_subsystem_html():
    return _core().linux_memory_subsystem_html()


@bp.route("/health")
def health_check():
    return _core().health_check()


# /static/<path:filename> is served by Flask's built-in static handler (see ``app.static_folder`` in webapp).
