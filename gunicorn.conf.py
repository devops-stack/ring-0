# Optional: use with gunicorn -c gunicorn.conf.py ...
# For Prometheus with multiple workers, set before starting gunicorn:
#   export PROMETHEUS_MULTIPROC_DIR=/tmp/prometheus_kernel_ai
#   rm -rf "$PROMETHEUS_MULTIPROC_DIR" && mkdir -p "$PROMETHEUS_MULTIPROC_DIR"


def child_exit(server, worker):
    """Required for prometheus_client multiprocess mode (gunicorn -w N > 1)."""
    try:
        from prometheus_client import multiprocess

        multiprocess.mark_process_dead(worker.pid)
    except ImportError:
        pass
