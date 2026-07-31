"""MITRE ATT&CK technique catalogue + heuristic mapping from anomaly shape.

v1 is intentionally rule-based and explainable. A supervised classifier can
plug in later (``classifier.py``) without changing the mutation contract.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Technique:
    mitre: str
    family: str
    name: str
    color: str  # UI accent hint
    cves: tuple[str, ...] = ()


# Compact catalogue of families we can currently speak about from Stages 1–5.
TECHNIQUES: dict[str, Technique] = {
    "T1059": Technique("T1059", "execution", "Command and Scripting Interpreter", "#e8a54b"),
    "T1204": Technique("T1204", "execution", "User Execution", "#e8a54b"),
    "T1498": Technique("T1498", "impact", "Network Denial of Service", "#e0564e"),
    "T1499": Technique("T1499", "impact", "Endpoint Denial of Service", "#e0564e"),
    "T1496": Technique("T1496", "impact", "Resource Hijacking", "#c9a6ff"),
    "T1071": Technique("T1071", "command_and_control", "Application Layer Protocol", "#67c8e0"),
    "T1046": Technique("T1046", "discovery", "Network Service Discovery", "#8ff0d2"),
    "T1068": Technique("T1068", "privilege_escalation", "Exploitation for Privilege Escalation", "#e0564e"),
    "T1548": Technique("T1548", "privilege_escalation", "Abuse Elevation Control Mechanism", "#e0564e"),
    "T1083": Technique("T1083", "discovery", "File and Directory Discovery", "#b8c7da"),
    "T1106": Technique("T1106", "execution", "Native API", "#f0c48a"),
    "T1055": Technique("T1055", "defense_evasion", "Process Injection", "#c9a6ff"),
}


# child_comm tokens that suggest scripting / shells / C2 helpers
_EXEC_CHILDREN = frozenset(
    {
        "bash", "sh", "dash", "zsh", "python", "python3", "perl", "ruby", "php",
        "node", "nc", "ncat", "netcat", "socat", "curl", "wget", "busybox",
    }
)
_SCAN_HINTS = frozenset({"nmap", "masscan", "zmap", "nikto"})
_MINER_HINTS = frozenset({"xmrig", "minerd", "cpuminer", "ethminer"})


def _technique_payload(tech: Technique, *, confidence: float, source: str, why: str) -> dict:
    return {
        "family": tech.family,
        "mitre": tech.mitre,
        "name": tech.name,
        "label_confidence": round(max(0.0, min(1.0, confidence)), 3),
        "cve": list(tech.cves),
        "source": source,
        "color": tech.color,
        "why": why,
    }


def map_anomaly(anomaly: dict) -> dict | None:
    """Return an ``attack`` dict or None if we should leave it unattributed."""
    source = str(anomaly.get("source") or "")
    feature = str(anomaly.get("feature") or "")
    atype = str(anomaly.get("type") or "")
    message = str(anomaly.get("message") or "").lower()
    meta = anomaly.get("meta") or {}
    kind = str(meta.get("kind") or "")

    # --- Stage 5 lineage / privesc ---
    if source == "stage5_process" or feature.startswith("lineage:") or atype.startswith("lineage:"):
        child = str(meta.get("comm") or "")
        parent = str(meta.get("parent_comm") or "")
        edge = f"{parent}→{child}".lower()
        child_l = child.lower()
        if child_l in _MINER_HINTS or any(h in edge for h in _MINER_HINTS):
            return _technique_payload(
                TECHNIQUES["T1496"],
                confidence=0.72,
                source="heuristic",
                why=f"lineage suggests miner binary ({parent}→{child})",
            )
        if child_l in _SCAN_HINTS:
            return _technique_payload(
                TECHNIQUES["T1046"],
                confidence=0.7,
                source="heuristic",
                why=f"lineage suggests scanner ({parent}→{child})",
            )
        if child_l in _EXEC_CHILDREN or kind == "lineage":
            conf = 0.66 if child_l in _EXEC_CHILDREN else 0.45
            return _technique_payload(
                TECHNIQUES["T1059"],
                confidence=conf,
                source="heuristic",
                why=f"unusual process lineage {parent}→{child}",
            )

    if kind == "privesc" or "euid_root" in atype or feature.startswith("privesc:"):
        return _technique_payload(
            TECHNIQUES["T1548"],
            confidence=0.75,
            source="heuristic",
            why="effective uid 0 with non-root real uid",
        )

    # --- Stage 4 / Stage 8 sequence ---
    if (
        source in ("stage4_sequence", "stage8_sequence")
        or feature in ("syscall_seq", "syscall_seq_deep")
        or atype in ("syscall_sequence", "syscall_sequence_deep")
    ):
        why = (
            "low-likelihood syscall order (deep sequence model)"
            if source == "stage8_sequence" or feature == "syscall_seq_deep"
            else "novel syscall sequencing (STIDE mismatch)"
        )
        conf = 0.58 if source == "stage8_sequence" else 0.55
        return _technique_payload(
            TECHNIQUES["T1106"],
            confidence=conf,
            source="heuristic",
            why=why,
        )

    # --- Stage 1 / 2 host features ---
    feat = feature.lower()
    if any(k in feat for k in ("tcp_retrans", "net_softirq", "tcp_inseg", "tcp_outseg")):
        return _technique_payload(
            TECHNIQUES["T1498"],
            confidence=0.4,
            source="heuristic",
            why=f"network-path pressure on {feature}",
        )
    if any(k in feat for k in ("ctxt_per_sec", "procs_running", "proc_count", "run_queue", "load1", "cpu_busy")):
        # Resource pressure — could be DoS or miner; stay conservative.
        if "miner" in message or "xmrig" in message:
            tech = TECHNIQUES["T1496"]
            conf = 0.6
            why = "host CPU/sched pressure with miner hint"
        else:
            tech = TECHNIQUES["T1499"]
            conf = 0.38
            why = f"host sched/CPU pressure on {feature}"
        return _technique_payload(tech, confidence=conf, source="heuristic", why=why)
    if any(k in feat for k in ("pgfault", "pgmajfault", "pgscan", "swap_io", "psi_mem")):
        return _technique_payload(
            TECHNIQUES["T1499"],
            confidence=0.36,
            source="heuristic",
            why=f"memory pressure on {feature}",
        )
    if "hardirq" in feat or "block_softirq" in feat:
        return _technique_payload(
            TECHNIQUES["T1499"],
            confidence=0.34,
            source="heuristic",
            why=f"IRQ/block pressure on {feature}",
        )

    if source == "stage2_isoforest":
        return _technique_payload(
            TECHNIQUES["T1499"],
            confidence=0.3,
            source="heuristic",
            why="IsolationForest unusual host state (family-level guess)",
        )

    return None
