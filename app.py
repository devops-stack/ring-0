#!/usr/bin/env python3
"""
WSGI entry point for Linux Kernel Visualization Backend.

Development:  python app.py
Production:   gunicorn -w 1 -b 0.0.0.0:8000 "kernel_ai.webapp:app"
              or: gunicorn ... "app:app"
"""
from kernel_ai.config import Config
from kernel_ai.services.core_observability import get_system_info
from kernel_ai.webapp import app, create_app

__all__ = ["app", "create_app"]


if __name__ == "__main__":
    system_info = get_system_info()
    print("🚀 Linux Kernel Visualization Backend")
    print(f"📍 Platform: {system_info['platform']}")
    print(f"🐧 Kernel: {system_info['kernel']}")
    print(f"🌐 Server: http://127.0.0.1:5001")
    print("📊 API endpoints:")
    print(f"   - {Config.API_PREFIX}/syscalls-realtime")
    print(f"   - {Config.API_PREFIX}/kernel-data")
    print(f"   - {Config.API_PREFIX}/process-kernel-map")
    print(f"   - {Config.API_PREFIX}/nginx-files")
    print(f"   - {Config.API_PREFIX}/execution-context")
    print("   - /health")

    app.run(
        host="0.0.0.0",
        port=5001,
        debug=Config.DEBUG,
        threaded=True,
    )
