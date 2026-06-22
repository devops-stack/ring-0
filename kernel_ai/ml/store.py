"""Postgres-backed store for the ML pipeline.

Schema (all created on demand):
    ml_feature_snapshots  - one JSONB row per tick (raw features, for training)
    ml_anomalies          - detected mutations served to the Kernel DNA UI
    ml_baseline_state     - EWMA state, persisted for warm restarts

The worker owns one long-lived connection. The Flask read path opens a fresh
short-lived connection per call (thread-safe, low volume), and tolerates the DB
being unreachable by returning empty results instead of raising.
"""

from __future__ import annotations

import logging

import psycopg
from psycopg.types.json import Json

logger = logging.getLogger("kernel_ai.ml.store")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ml_feature_snapshots (
    ts        timestamptz NOT NULL DEFAULT now(),
    features  jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS ml_feature_snapshots_ts_idx ON ml_feature_snapshots (ts);

CREATE TABLE IF NOT EXISTS ml_anomalies (
    id            bigserial PRIMARY KEY,
    ts            timestamptz NOT NULL DEFAULT now(),
    source        text        NOT NULL DEFAULT 'stage1_baseline',
    feature       text        NOT NULL,
    subsystem     text,
    type          text        NOT NULL,
    severity      text        NOT NULL,
    score         double precision NOT NULL,
    value         double precision,
    baseline_mean double precision,
    baseline_std  double precision,
    position      double precision,
    message       text,
    meta          jsonb
);
CREATE INDEX IF NOT EXISTS ml_anomalies_ts_idx ON ml_anomalies (ts);

CREATE TABLE IF NOT EXISTS ml_baseline_state (
    name       text PRIMARY KEY,
    mean       double precision NOT NULL,
    var        double precision NOT NULL,
    count      integer          NOT NULL,
    updated_at timestamptz      NOT NULL DEFAULT now()
);
"""


def connect(dsn: str, *, autocommit: bool = True) -> psycopg.Connection:
    return psycopg.connect(dsn, autocommit=autocommit)


def ensure_schema(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(_SCHEMA)


class PostgresStore:
    """Write side, used by the worker over a single persistent connection."""

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self.conn = connect(dsn)
        ensure_schema(self.conn)

    def insert_feature_snapshot(self, features: dict[str, float]) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO ml_feature_snapshots (features) VALUES (%s)",
                (Json(features),),
            )

    def insert_anomalies(self, anomalies: list[dict]) -> None:
        if not anomalies:
            return
        with self.conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO ml_anomalies
                    (source, feature, subsystem, type, severity, score, value,
                     baseline_mean, baseline_std, position, message, meta)
                VALUES
                    (%(source)s, %(feature)s, %(subsystem)s, %(type)s, %(severity)s,
                     %(score)s, %(value)s, %(baseline_mean)s, %(baseline_std)s,
                     %(position)s, %(message)s, %(meta)s)
                """,
                [
                    {
                        "source": a.get("source", "stage1_baseline"),
                        "feature": a["feature"],
                        "subsystem": a.get("subsystem"),
                        "type": a["type"],
                        "severity": a["severity"],
                        "score": a["score"],
                        "value": a.get("value"),
                        "baseline_mean": a.get("baseline_mean"),
                        "baseline_std": a.get("baseline_std"),
                        "position": a.get("position"),
                        "message": a.get("message"),
                        "meta": Json(a.get("meta") or {}),
                    }
                    for a in anomalies
                ],
            )

    def save_baseline(self, rows: list[dict]) -> None:
        if not rows:
            return
        with self.conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO ml_baseline_state (name, mean, var, count, updated_at)
                VALUES (%(name)s, %(mean)s, %(var)s, %(count)s, now())
                ON CONFLICT (name) DO UPDATE
                    SET mean = EXCLUDED.mean,
                        var = EXCLUDED.var,
                        count = EXCLUDED.count,
                        updated_at = now()
                """,
                rows,
            )

    def load_baseline(self) -> list[dict]:
        with self.conn.cursor() as cur:
            cur.execute("SELECT name, mean, var, count FROM ml_baseline_state")
            return [
                {"name": r[0], "mean": r[1], "var": r[2], "count": r[3]}
                for r in cur.fetchall()
            ]

    def prune(self, features_hours: int, anomalies_hours: int) -> None:
        with self.conn.cursor() as cur:
            cur.execute(
                "DELETE FROM ml_feature_snapshots WHERE ts < now() - make_interval(hours => %s)",
                (features_hours,),
            )
            cur.execute(
                "DELETE FROM ml_anomalies WHERE ts < now() - make_interval(hours => %s)",
                (anomalies_hours,),
            )

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:  # noqa: BLE001 - best-effort cleanup
            pass


def fetch_recent_anomalies(dsn: str, *, since_seconds: int = 120, limit: int = 100) -> list[dict]:
    """Read recent anomalies for the API. Never raises on DB trouble."""
    try:
        with connect(dsn) as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT ts, source, feature, subsystem, type, severity, score, value,
                       baseline_mean, baseline_std, position, message
                FROM ml_anomalies
                WHERE ts > now() - make_interval(secs => %s)
                ORDER BY ts DESC
                LIMIT %s
                """,
                (since_seconds, limit),
            )
            cols = [d.name for d in cur.description]
            out = []
            for row in cur.fetchall():
                rec = dict(zip(cols, row))
                if rec.get("ts") is not None:
                    rec["ts"] = rec["ts"].isoformat()
                out.append(rec)
            return out
    except Exception as exc:  # noqa: BLE001 - API must degrade gracefully
        logger.warning("fetch_recent_anomalies failed: %s", exc)
        return []
