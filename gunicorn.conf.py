# Optional: use with gunicorn -c gunicorn.conf.py ...
# For Prometheus with multiple workers, set before starting gunicorn:
#   export PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus_kernel_ai
#   rm -rf "$PROMETHEUS_MULTIPROC_DIR" && mkdir -p "$PROMETHEUS_MULTIPROC_DIR"


import os


def child_exit(server, worker):
    """Required for prometheus_client multiprocess mode (gunicorn -w N > 1)."""
    # Without the directory there are no per-worker metric files to clean up, and
    # prometheus_client raises TypeError on the None path rather than saying so —
    # once per worker exit, which is every restart.
    if not os.environ.get("PROMETHEUS_MULTIPROC_DIR", "").strip():
        return
    try:
        from prometheus_client import multiprocess

        multiprocess.mark_process_dead(worker.pid)
    except ImportError:
        pass
