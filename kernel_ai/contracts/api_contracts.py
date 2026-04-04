"""Runtime validators for stable HTTP response contracts."""

from __future__ import annotations

from typing import Any, TypedDict


class KernelDataResponse(TypedDict):
    timestamp: str
    syscalls: list
    subsystems: dict
    processes: int
    system_stats: dict


class NetworkStackRealtimeResponse(TypedDict):
    timestamp: str
    layer_metrics: dict
    layer_activity: dict
    signals: dict
    throughput_mb_s: float
    tcp_counters: dict


class CryptoRealtimeResponse(TypedDict):
    items: list
    processes: list
    meta: dict


class SecurityRealtimeResponse(TypedDict):
    timestamp: str
    pipeline: dict
    trust_graph: list
    attack_surface: list
    security_tools: dict
    security_core: dict
    meta: dict


class FilesystemBlocksResponse(TypedDict):
    timestamp: str
    rows: int
    cols: int
    zones: list
    blocks: list
    meta: dict


def _expect_dict(payload: Any, name: str) -> dict:
    if not isinstance(payload, dict):
        raise ValueError(f"{name} must be a JSON object")
    return payload


def _expect_key(payload: dict, key: str, expected_type: type | tuple[type, ...], name: str) -> None:
    if key not in payload:
        raise ValueError(f"{name}: missing key '{key}'")
    if not isinstance(payload[key], expected_type):
        raise ValueError(f"{name}: key '{key}' has invalid type")


def validate_kernel_data_response(payload: Any) -> None:
    data = _expect_dict(payload, "kernel_data")
    _expect_key(data, "timestamp", str, "kernel_data")
    _expect_key(data, "syscalls", list, "kernel_data")
    _expect_key(data, "subsystems", dict, "kernel_data")
    _expect_key(data, "processes", int, "kernel_data")
    _expect_key(data, "system_stats", dict, "kernel_data")


def validate_network_stack_realtime_response(payload: Any) -> None:
    data = _expect_dict(payload, "network_stack_realtime")
    _expect_key(data, "timestamp", str, "network_stack_realtime")
    _expect_key(data, "layer_metrics", dict, "network_stack_realtime")
    _expect_key(data, "layer_activity", dict, "network_stack_realtime")
    _expect_key(data, "signals", dict, "network_stack_realtime")
    _expect_key(data, "throughput_mb_s", (int, float), "network_stack_realtime")
    _expect_key(data, "tcp_counters", dict, "network_stack_realtime")


def validate_crypto_realtime_response(payload: Any) -> None:
    data = _expect_dict(payload, "crypto_realtime")
    _expect_key(data, "items", list, "crypto_realtime")
    _expect_key(data, "processes", list, "crypto_realtime")
    _expect_key(data, "meta", dict, "crypto_realtime")
    _expect_key(data["meta"], "active_flows", int, "crypto_realtime.meta")


def validate_security_realtime_response(payload: Any) -> None:
    data = _expect_dict(payload, "security_realtime")
    _expect_key(data, "timestamp", str, "security_realtime")
    _expect_key(data, "pipeline", dict, "security_realtime")
    _expect_key(data, "trust_graph", list, "security_realtime")
    _expect_key(data, "attack_surface", list, "security_realtime")
    _expect_key(data, "security_tools", dict, "security_realtime")
    _expect_key(data, "security_core", dict, "security_realtime")
    _expect_key(data, "meta", dict, "security_realtime")


def validate_filesystem_blocks_response(payload: Any) -> None:
    data = _expect_dict(payload, "filesystem_blocks")
    _expect_key(data, "timestamp", str, "filesystem_blocks")
    _expect_key(data, "rows", int, "filesystem_blocks")
    _expect_key(data, "cols", int, "filesystem_blocks")
    _expect_key(data, "zones", list, "filesystem_blocks")
    _expect_key(data, "blocks", list, "filesystem_blocks")
    _expect_key(data, "meta", dict, "filesystem_blocks")
