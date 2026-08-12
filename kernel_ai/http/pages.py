"""HTTP handlers for site pages."""

from datetime import datetime

from flask import jsonify, redirect, render_template, send_from_directory

from kernel_ai.config import PROJECT_ROOT
from kernel_ai.services import core_observability as _core_observability_service


def get_system_info():
    return _core_observability_service.get_system_info()


def index():
    return send_from_directory(str(PROJECT_ROOT), "index.html")


def linux_crypto_subsystem_page():
    return render_template("linux-crypto-subsystem.html")


def crypto_page_legacy():
    return redirect("/linux-crypto-subsystem", code=301)


def linux_security_subsystem_page():
    return render_template("linux-security-subsystem.html")


def security_page_legacy():
    return redirect("/linux-security-subsystem", code=301)


def linux_processes_subsystem_page():
    return render_template("linux-processes-subsystem.html")


def processes_page_legacy():
    return redirect("/linux-processes-subsystem", code=301)


def linux_crypto_subsystem_html():
    return redirect("/linux-crypto-subsystem", code=301)


def linux_security_subsystem_html():
    return redirect("/linux-security-subsystem", code=301)


def linux_processes_subsystem_html():
    return redirect("/linux-processes-subsystem", code=301)


def linux_memory_subsystem_page():
    return render_template("linux-memory-subsystem.html")


def linux_memory_subsystem_html():
    return redirect("/linux-memory-subsystem", code=301)


def linux_network_subsystem_page():
    return render_template("linux-network-subsystem.html")


def network_page_legacy():
    return redirect("/linux-network-subsystem", code=301)


def linux_network_subsystem_html():
    return redirect("/linux-network-subsystem", code=301)


def linux_filesystem_subsystem_page():
    return render_template("linux-filesystem-subsystem.html")


def filesystem_page_legacy():
    return redirect("/linux-filesystem-subsystem", code=301)


def files_page_legacy():
    return redirect("/linux-filesystem-subsystem", code=301)


def linux_filesystem_subsystem_html():
    return redirect("/linux-filesystem-subsystem", code=301)


def kernel_dna_page():
    return render_template("kernel-dna.html")


def kernel_dna_html():
    return redirect("/kernel-dna", code=301)


def linux_devices_subsystem_page():
    return render_template("linux-devices-subsystem.html")


def devices_page_legacy():
    return redirect("/linux-devices-subsystem", code=301)


def linux_devices_subsystem_html():
    return redirect("/linux-devices-subsystem", code=301)


def health_check():
    return jsonify(
        {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "system_info": get_system_info(),
        }
    )
