"""Crypto and security realtime services facade."""

from __future__ import annotations

import logging
import os
import random
import subprocess

import psutil

from kernel_ai.services.crypto import crypto_pipeline as _crypto_pipeline
from kernel_ai.services.crypto import entropy as _entropy_service
from kernel_ai.services.crypto import helpers as _helpers
from kernel_ai.services.crypto import security_pipeline as _security_pipeline

logger = logging.getLogger(__name__)

__all__ = [
    "infer_crypto_protocol",
    "is_likely_crypto_actor",
    "infer_tls_terminator",
    "parse_proc_crypto_entries",
    "collect_algorithm_competition",
    "collect_kernel_crypto_clients",
    "collect_sync_async_queue",
    "collect_hw_offload_status",
    "collect_algorithm_requesters",
    "build_crypto_decision_pipelines",
    "read_sysctl_int",
    "read_proc_interrupt_total",
    "collect_entropy_cloud_status",
    "collect_crypto_realtime",
    "collect_security_realtime",
]

# Re-export helpers for backward compatibility and callback injection.
infer_crypto_protocol = _helpers.infer_crypto_protocol
is_likely_crypto_actor = _helpers.is_likely_crypto_actor
infer_tls_terminator = _helpers.infer_tls_terminator
parse_proc_crypto_entries = _helpers.parse_proc_crypto_entries
collect_algorithm_competition = _helpers.collect_algorithm_competition
collect_kernel_crypto_clients = _helpers.collect_kernel_crypto_clients
collect_sync_async_queue = _helpers.collect_sync_async_queue
collect_hw_offload_status = _helpers.collect_hw_offload_status
collect_algorithm_requesters = _helpers.collect_algorithm_requesters
build_crypto_decision_pipelines = _helpers.build_crypto_decision_pipelines


def read_sysctl_int(path, default=0):
    return _entropy_service.read_sysctl_int(path, default=default)


def read_proc_interrupt_total():
    return _entropy_service.read_proc_interrupt_total()


def collect_entropy_cloud_status(entropy_prev):
    return _entropy_service.collect_entropy_cloud_status(entropy_prev)


def collect_crypto_realtime(crypto_prev, entropy_prev=None, callbacks=None):
    entropy_prev_local = entropy_prev or {
        "timestamp": None,
        "disk_read_bytes": 0,
        "disk_write_bytes": 0,
        "net_sent_bytes": 0,
        "net_recv_bytes": 0,
        "interrupt_total": 0,
    }
    defaults = {
        "infer_crypto_protocol": infer_crypto_protocol,
        "is_likely_crypto_actor": is_likely_crypto_actor,
        "infer_tls_terminator": infer_tls_terminator,
        "collect_algorithm_competition": collect_algorithm_competition,
        "parse_proc_crypto_entries": parse_proc_crypto_entries,
        "collect_kernel_crypto_clients": collect_kernel_crypto_clients,
        "collect_hw_offload_status": collect_hw_offload_status,
        "collect_sync_async_queue": collect_sync_async_queue,
        "collect_algorithm_requesters": collect_algorithm_requesters,
        "build_crypto_decision_pipelines": build_crypto_decision_pipelines,
        "collect_entropy_cloud_status": lambda: collect_entropy_cloud_status(entropy_prev_local),
    }
    merged_callbacks = dict(defaults)
    if callbacks:
        merged_callbacks.update(callbacks)
    return _crypto_pipeline.collect_crypto_realtime(
        crypto_prev=crypto_prev,
        callbacks=merged_callbacks,
        psutil_module=psutil,
        logger=logger,
    )


def collect_security_realtime(security_prev):
    return _security_pipeline.collect_security_realtime(
        security_prev=security_prev,
        psutil_module=psutil,
        subprocess_module=subprocess,
        random_module=random,
        os_module=os,
    )
