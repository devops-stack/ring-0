"""Join an HTTP attempt to a later web-stack kernel mutation → success."""

from __future__ import annotations

from typing import Any

WEB_COMMS = {"nginx", "gunicorn", "python", "python3"}
KERNEL_SOURCES = {
    "stage4_sequence",
    "stage5_process",
    "stage8_markov",
    "stage8_lstm",
}
JOIN_SEC = 30.0
SUCCESS_FEATURE = "http_success:exec"
SUCCESS_POSITION = 0.12


def _comm(anomaly: dict[str, Any]) -> str:
    meta = anomaly.get("meta") if isinstance(anomaly.get("meta"), dict) else {}
    return str(meta.get("comm") or meta.get("parent_comm") or "").lower()


def is_web_kernel_anomaly(anomaly: dict[str, Any]) -> bool:
    comm = _comm(anomaly)
    if comm in WEB_COMMS:
        return True
    parent = ""
    meta = anomaly.get("meta") if isinstance(anomaly.get("meta"), dict) else {}
    parent = str(meta.get("parent_comm") or "").lower()
    if parent in WEB_COMMS:
        return True
    feature = str(anomaly.get("feature") or "")
    return any(name in feature for name in WEB_COMMS)


def join_success(
    attempts: list[dict[str, Any]],
    kernel_anomalies: list[dict[str, Any]],
    *,
    slack_sec: float = JOIN_SEC,
) -> list[dict[str, Any]]:
    """Each web-stack kernel hit that follows an attempt becomes one success row."""
    if not attempts or not kernel_anomalies:
        return []
    out: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for kernel in kernel_anomalies:
        if not is_web_kernel_anomaly(kernel):
            continue
        kts = float(kernel.get("ts") or 0.0)
        matched = None
        for attempt in attempts:
            ats = float(attempt.get("ts") or 0.0)
            if ats <= kts <= ats + slack_sec:
                matched = attempt
                break
        if matched is None:
            continue
        key = (str(matched.get("src_ip") or ""), int(kts))
        if key in seen:
            continue
        seen.add(key)
        cls = str(matched.get("cls") or "anomaly")
        src_ip = str(matched.get("src_ip") or "")
        ip_tail = ".".join(src_ip.split(".")[-2:]) if src_ip else "--"
        meta = dict(kernel.get("meta") or {})
        meta.update(
            {
                "stage": 9,
                "kind": "success",
                "cls": cls,
                "src_ip": src_ip,
                "why": f"attempt:{cls} then {kernel.get('source')}",
                "kernel_source": kernel.get("source"),
            }
        )
        out.append(
            {
                "source": "stage9_success",
                "feature": SUCCESS_FEATURE,
                "subsystem": "sched",
                "type": SUCCESS_FEATURE,
                "severity": "high",
                "score": 1.0,
                "value": slack_sec,
                "baseline_mean": None,
                "baseline_std": None,
                "position": SUCCESS_POSITION,
                "message": (
                    f"HTTP attempt ({cls}) then web-stack kernel mutation "
                    f"({kernel.get('source')}, ip …{ip_tail})"
                ),
                "meta": meta,
                "ts": kts,
            }
        )
    return out
