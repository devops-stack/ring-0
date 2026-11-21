"""Replay a frozen normal dataset through Stages 4 and 8, offline.

A threshold is only meaningful against the score distribution of the host it
runs on: Stage 8's normal ran to 1.73 on the dev box and to 4.62 on PROD, so a
number tuned on one is noise on the other. This feeds days recorded by
kernel-ai-normal-recorder through the same tracker and models the worker uses
and reports, per threshold, how many alerts a day of normal traffic produces.

Scoring mirrors ``MLWorker._score_sequence`` and ``MLWorker._tick_stage8``:
per-pid windows, only windows that changed since the previous tick, the
global window as fallback, and the worker's tick interval in event time.
Learning and quarantine are left out on purpose — they change what the
profile becomes, not how a fixed artifact scores, and an evaluation has to
hold the artifact fixed.

    python -m kernel_ai.ml.replay --data /var/lib/kernel-ai-normal \\
        --days 2026-11-19 --stide mldata/stide_latest.joblib \\
        --markov mldata/markov_latest.joblib
"""

from __future__ import annotations

import argparse
import json
from calendar import timegm
from collections import Counter
from dataclasses import dataclass, field, replace
from time import strptime
from typing import Iterable, Iterator

from kernel_ai.ml.collectors.base import ALLOWED_SYSCALLS, SyscallEvent
from kernel_ai.ml.normal_dataset import hour_files, iter_lines, load_cgroups
from kernel_ai.ml.sequence import NgramTracker, StideModel
from kernel_ai.ml.sequence_deep.markov import comm_context, unit_context

STAGE4_GRID = (0.10, 0.20, 0.30, 0.40, 0.55)
STAGE8_GRID = (4.0, 5.0, 6.0, 6.5, 7.0, 7.5, 8.0, 9.0)
WORST_GRID = (8.0, 10.0, 12.0, 14.0, 16.0, 18.0)


def _epoch(ts: str) -> float | None:
    """RFC3339Nano from the sensor; 3.10's fromisoformat takes neither Z nor ns."""
    try:
        base, _, frac = ts.rstrip("Z").partition(".")
        whole = timegm(strptime(base, "%Y-%m-%dT%H:%M:%S"))
        return whole + (float("0." + frac) if frac else 0.0)
    except (ValueError, AttributeError):
        return None


@dataclass(frozen=True)
class ReplayEvent(SyscallEvent):
    # Stage 8 context key; see comm_context / unit_context.
    context: str | None = None


def _context(obj: dict, comm: str, mode: str, cgroups: dict[int, str] | None) -> str | None:
    if mode == "unit" and cgroups:
        try:
            path = cgroups.get(int(obj.get("cgroup_id") or 0))
        except (TypeError, ValueError):
            path = None
        if path is not None:
            return unit_context(path)
    return comm_context(comm)


def to_event(
    obj: dict, *, context: str = "comm", cgroups: dict[int, str] | None = None
) -> ReplayEvent | None:
    """KernelEventV1 → ReplayEvent, filtered like the collector's sensor mode.

    ``context="unit"`` keys the event by its systemd unit when the day's
    cgroups.json knows the id, and by comm otherwise.
    """
    if obj.get("kind") != "syscall_span":
        return None
    span = obj.get("syscall")
    if not isinstance(span, dict):
        return None
    name = str(span.get("name") or "").strip()
    if name not in ALLOWED_SYSCALLS:
        return None
    ts = _epoch(str(obj.get("timestamp") or ""))
    if ts is None:
        return None
    comm = str(obj.get("comm") or "?")[:64]
    try:
        return ReplayEvent(
            ts=ts,
            pid=int(obj.get("pid") or 0),
            uid=int(obj.get("uid") or 0),
            comm=comm,
            syscall=name[:64],
            context=_context(obj, comm, context, cgroups),
        )
    except (TypeError, ValueError):
        return None


def iter_dataset_events(
    root: str, days: list[str] | None, *, context: str = "comm"
) -> Iterator[ReplayEvent]:
    maps: dict[str, dict[int, str]] = {}
    for path in hour_files(root, days=days):
        day = str(path.parent)
        if day not in maps:
            maps[day] = load_cgroups(day) if context == "unit" else {}
        for line in iter_lines(path):
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            ev = to_event(obj, context=context, cgroups=maps[day]) if isinstance(obj, dict) else None
            if ev is not None:
                yield ev


def _fresh(entries, marks: dict[int, int], stamps: dict[int, int]):
    fresh = []
    for pid, window in entries:
        stamp = stamps.get(pid)
        if stamp is None or marks.get(pid) == stamp:
            continue
        marks[pid] = stamp
        fresh.append((pid, window))
    for gone in [pid for pid in marks if pid not in stamps]:
        marks.pop(gone, None)
    return fresh


@dataclass
class TickScore:
    ts: float
    score: float
    pid: int | None
    comm: str
    detail: str = ""


@dataclass
class ReplayResult:
    events: int = 0
    ticks: int = 0
    first_ts: float | None = None
    last_ts: float | None = None
    stage4: list[TickScore] = field(default_factory=list)
    stage8: list[TickScore] = field(default_factory=list)
    # Least likely transition among everything a pid emitted since the last
    # tick. The worker scores only tokens[-64:] per tick, so on a pid doing
    # ~100 syscalls/s most of each tick is never looked at.
    stage8_worst: list[TickScore] = field(default_factory=list)

    @property
    def hours(self) -> float:
        if self.first_ts is None or self.last_ts is None:
            return 0.0
        return max(1e-9, (self.last_ts - self.first_ts) / 3600.0)


def replay(
    events: Iterable[SyscallEvent],
    cfg,
    *,
    stide: StideModel | None,
    deep=None,
) -> ReplayResult:
    tracker = NgramTracker(n=cfg.seq_n, window=cfg.seq_window)
    res = ReplayResult()
    comms: dict[int, str] = {}
    ctxs: dict[int, str | None] = {}
    marks4: dict[int, int] = {}
    marks8: dict[int, int] = {}
    min_tokens = max(8, cfg.stage8_window // 4)
    tick_end: float | None = None
    last_evict: float | None = None
    batch: list[SyscallEvent] = []

    def score_tick(now: float) -> None:
        nonlocal last_evict
        tracker.update_stream(batch)
        res.ticks += 1
        new_per_pid = Counter(ev.pid for ev in batch)
        stamps = tracker.pid_stamps()

        if stide is not None:
            best = None
            for pid, window in _fresh(
                tracker.recent_by_pid(min_len=cfg.seq_pid_min_window), marks4, stamps
            ):
                mismatch, _ = stide.score_window(window)
                if best is None or mismatch > best[0]:
                    best = (mismatch, pid, window)
            if best is None:
                window = tracker.recent()
                if len(window) >= cfg.seq_min_window:
                    best = (stide.score_window(window)[0], None, window)
            if best is not None:
                top = ",".join(stide.top_unseen(best[2], limit=2))
                res.stage4.append(
                    TickScore(now, best[0], best[1], comms.get(best[1], "?"), top)
                )

        if deep is not None:
            best8 = None
            worst8 = None
            for pid, tokens in _fresh(
                tracker.recent_tokens_by_pid(min_len=min_tokens), marks8, stamps
            ):
                sc = deep.score_tokens(
                    tokens[-cfg.stage8_window :], context=ctxs.get(pid)
                )
                if not sc:
                    continue
                neg = float(sc.get("neg_avg_logprob") or sc.get("perplexity") or 0.0)
                if best8 is None or neg > best8[0]:
                    best8 = (neg, pid, sc)
                fresh_tokens = tokens[-(new_per_pid.get(pid, 0) + 1) :]
                ws = deep.score_tokens(fresh_tokens, context=ctxs.get(pid))
                w = (ws or {}).get("worst_neg_logprob")
                if w is not None and (worst8 is None or w > worst8[0]):
                    worst8 = (float(w), pid, ws)
            if best8 is None:
                tokens = tracker.recent_tokens()
                if len(tokens) >= min_tokens:
                    sc = deep.score_tokens(tokens[-cfg.stage8_window :])
                    if sc:
                        neg = float(sc.get("neg_avg_logprob") or sc.get("perplexity") or 0.0)
                        best8 = (neg, None, sc)
            if best8 is not None:
                worst = ",".join(str(t) for t in (best8[2].get("worst_tokens") or [])[:3])
                res.stage8.append(
                    TickScore(now, best8[0], best8[1], comms.get(best8[1], "?"), worst)
                )
            if worst8 is not None:
                res.stage8_worst.append(
                    TickScore(now, worst8[0], worst8[1], comms.get(worst8[1], "?"),
                              ",".join(str(t) for t in worst8[2].get("worst_tokens") or []))
                )

        if last_evict is None:
            last_evict = now
        if now - last_evict >= cfg.seq_flush_sec:
            tracker.evict_idle(older_than=cfg.seq_pid_idle_events)
            last_evict = now
        batch.clear()

    for ev in events:
        res.events += 1
        comms[ev.pid] = ev.comm
        ctxs[ev.pid] = getattr(ev, "context", None) or comm_context(ev.comm)
        if res.first_ts is None:
            res.first_ts = ev.ts
        res.last_ts = ev.ts
        if tick_end is None:
            tick_end = ev.ts + cfg.interval_sec
        if ev.ts >= tick_end:
            if batch:
                score_tick(tick_end)
            # Jump over silent stretches instead of scoring empty ticks.
            while ev.ts >= tick_end:
                tick_end += cfg.interval_sec
        batch.append(ev)
    if batch and tick_end is not None:
        score_tick(tick_end)
    return res


def quantiles(values: list[float], qs=(0.5, 0.9, 0.99, 0.999, 1.0)) -> dict[str, float]:
    if not values:
        return {}
    ordered = sorted(values)
    out = {}
    for q in qs:
        idx = min(len(ordered) - 1, max(0, int(round(q * (len(ordered) - 1)))))
        out["max" if q == 1.0 else f"p{q * 100:g}"] = round(ordered[idx], 4)
    return out


def alerts(scores: list[TickScore], threshold: float, cooldown: float) -> list[TickScore]:
    """What the worker would have emitted: over threshold, at most one per cooldown."""
    out: list[TickScore] = []
    last = None
    for s in scores:
        if s.score < threshold:
            continue
        if last is not None and s.ts - last < cooldown:
            continue
        last = s.ts
        out.append(s)
    return out


def summarize(res: ReplayResult, cfg) -> dict:
    per_day = 24.0 / res.hours if res.hours else 0.0

    def stage(scores, grid, cooldown):
        rows = []
        for t in grid:
            fired = alerts(scores, t, cooldown)
            rows.append(
                {
                    "threshold": t,
                    "alerts": len(fired),
                    "alerts_per_day": round(len(fired) * per_day, 1),
                    "top_comms": Counter(s.comm for s in fired).most_common(4),
                    "top_detail": Counter(s.detail for s in fired).most_common(3),
                }
            )
        return {
            "ticks_scored": len(scores),
            "tick_max_quantiles": quantiles([s.score for s in scores]),
            "grid": rows,
        }

    return {
        "events": res.events,
        "ticks": res.ticks,
        "hours": round(res.hours, 2),
        "stage4": stage(res.stage4, STAGE4_GRID, cfg.seq_cooldown_sec),
        "stage8": stage(res.stage8, STAGE8_GRID, cfg.stage8_cooldown_sec),
        "stage8_worst": stage(res.stage8_worst, WORST_GRID, cfg.stage8_cooldown_sec),
    }


def score_traces(paths: list[str], cfg, *, stide, deep, context: str = "comm") -> dict[str, dict]:
    """Best Stage 4 / Stage 8 score each attack trace reaches on its own.

    Scoring is per pid, so a trace scores the same alone as mixed into a busy
    host (the global-window fallback aside), and what decides recall is
    whether that score clears the threshold the normal days allow.
    """
    out: dict[str, dict] = {}
    for path in paths:
        evs = []
        sidecar = path.removesuffix(".jsonl") + ".cgroups.json"
        try:
            with open(sidecar, encoding="utf-8") as fh:
                cgroups = {int(k): v for k, v in json.load(fh).items()}
        except (OSError, ValueError):
            cgroups = {}
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                ev = to_event(json.loads(line), context=context, cgroups=cgroups)
                if ev is not None:
                    evs.append(ev)
        evs.sort(key=lambda e: e.ts)
        res = replay(evs, cfg, stide=stide, deep=deep)
        name = path.rsplit("/", 1)[-1].removesuffix(".jsonl")
        best4 = max(res.stage4, key=lambda s: s.score, default=None)
        best8 = max(res.stage8, key=lambda s: s.score, default=None)
        worst8 = max(res.stage8_worst, key=lambda s: s.score, default=None)
        out[name] = {
            "events": res.events,
            "contexts": sorted({e.context or "-" for e in evs}),
            "stage4": round(best4.score, 4) if best4 else None,
            "stage8": round(best8.score, 4) if best8 else None,
            "stage8_worst_tokens": best8.detail if best8 else "",
            "stage8_worst": round(worst8.score, 4) if worst8 else None,
            "stage8_worst_at": worst8.detail if worst8 else "",
        }
    return out


def main() -> None:
    from kernel_ai.ml.config import MLConfig
    from kernel_ai.ml.sequence_deep import DeepSequenceScorer

    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", required=True, help="kernel-ai-normal root")
    ap.add_argument("--days", nargs="*", help="UTC days, e.g. 2026-11-19 (default: all)")
    ap.add_argument("--stide", help="stide_latest.joblib to score with")
    ap.add_argument("--markov", help="markov_latest.joblib to score with")
    ap.add_argument("--stage8-cooldown", type=float, help="override STAGE8_COOLDOWN_SEC")
    ap.add_argument("--attacks", nargs="*", default=[], help="attack trace .jsonl files")
    ap.add_argument("--context", choices=("comm", "unit"), default="comm",
                    help="Stage 8 context key (unit needs cgroups.json per day)")
    args = ap.parse_args()

    cfg = MLConfig()
    if args.stage8_cooldown is not None:
        cfg = replace(cfg, stage8_cooldown_sec=args.stage8_cooldown)
    stide = StideModel.load(args.stide) if args.stide else None
    deep = None
    if args.markov:
        cfg = replace(cfg, stage8_markov_path=args.markov, stage8_lstm_path="")
        deep = DeepSequenceScorer(cfg)
        if not deep.ready:
            raise SystemExit(f"Markov artifact not usable: {args.markov}")

    res = replay(
        iter_dataset_events(args.data, args.days, context=args.context), cfg, stide=stide, deep=deep
    )
    summary = summarize(res, cfg)
    if args.attacks:
        summary["attacks"] = score_traces(
            args.attacks, cfg, stide=stide, deep=deep, context=args.context
        )
    print(json.dumps(summary, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
