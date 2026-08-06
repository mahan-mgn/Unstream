"""
لایه‌ی ماندگاری روی SQLite.

قبلاً صف فقط در حافظه بود: با هر ری‌استارت سرور، هم تاریخچه می‌پرید و هم
فایل‌های روی دیسک بی‌صاحب می‌شدند (هیچ‌کس نمی‌دانست کدام فایل مال کدام ترک است).
حالا هر جاب یک ردیف است، و «کتابخانه» چیزی نیست جز جاب‌های موفقی که فایلشان هست.

نوشتن‌ها ریزند و با یک قفل سریالایز می‌شوند — استخر اتصال ارزشش را ندارد.
درصد پیشرفت عمداً ذخیره نمی‌شود؛ صدها نوشتن در ثانیه برای عددی که با ری‌استارت
بی‌معنی می‌شود.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .config import DB_PATH

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id           TEXT PRIMARY KEY,
    track_id     TEXT NOT NULL,
    track_json   TEXT NOT NULL,
    search_text  TEXT NOT NULL DEFAULT '',
    quality      TEXT NOT NULL,
    status       TEXT NOT NULL,
    error        TEXT,
    warning      TEXT,
    format       TEXT,
    path         TEXT,
    lyrics_path  TEXT,
    bytes        INTEGER NOT NULL DEFAULT 0,
    created_at   REAL NOT NULL,
    finished_at  REAL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_track   ON jobs(track_id, quality, status);
"""


def connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        # WAL: خواندنِ کتابخانه نباید پشت نوشتنِ یک جاب صف بکشد
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA synchronous=NORMAL")
        _conn.executescript(SCHEMA)
        _conn.commit()
    return _conn


def close() -> None:
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None


def _exec(sql: str, params: tuple = ()) -> sqlite3.Cursor:
    with _lock:
        conn = connect()
        cur = conn.execute(sql, params)
        conn.commit()
        return cur


def _query(sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    with _lock:
        return connect().execute(sql, params).fetchall()


# ---------- جاب‌ها ----------


def insert_job(
    job_id: str,
    track: Any,
    quality: str,
    status: str,
    created_at: float,
) -> None:
    _exec(
        """INSERT OR REPLACE INTO jobs
           (id, track_id, track_json, search_text, quality, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            job_id,
            track.id,
            track.model_dump_json(),
            f"{track.title} {track.artist} {track.album or ''}".lower(),
            quality,
            status,
            created_at,
        ),
    )


_UPDATABLE = (
    "status",
    "error",
    "warning",
    "format",
    "path",
    "lyrics_path",
    "bytes",
    "finished_at",
)


def update_job(job_id: str, **fields: Any) -> None:
    """فقط ستون‌های شناخته‌شده — بقیه (مثلاً percent) بی‌سروصدا نادیده می‌روند."""
    known = {k: v for k, v in fields.items() if k in _UPDATABLE}
    if not known:
        return
    assignments = ", ".join(f"{k} = ?" for k in known)
    _exec(
        f"UPDATE jobs SET {assignments} WHERE id = ?",
        (*known.values(), job_id),
    )


def delete_job(job_id: str) -> None:
    _exec("DELETE FROM jobs WHERE id = ?", (job_id,))


def get_job(job_id: str) -> sqlite3.Row | None:
    rows = _query("SELECT * FROM jobs WHERE id = ?", (job_id,))
    return rows[0] if rows else None


def find_ready(track_id: str, quality: str) -> sqlite3.Row | None:
    """همین ترک با همین کیفیت، از قبل و با موفقیت. مبنای «دوباره دانلود نکن»."""
    rows = _query(
        """SELECT * FROM jobs
           WHERE track_id = ? AND quality = ? AND status = 'ready' AND path IS NOT NULL
           ORDER BY created_at DESC LIMIT 1""",
        (track_id, quality),
    )
    return rows[0] if rows else None


def ready_jobs() -> list[sqlite3.Row]:
    """برای هیدریت کردن حافظه موقع بالا آمدن سرور."""
    return _query("SELECT * FROM jobs WHERE status = 'ready' ORDER BY created_at DESC")


def mark_interrupted() -> int:
    """
    جابی که موقع خاموش شدن سرور نیمه‌کاره بوده هیچ‌وقت خودش تمام نمی‌شود.
    به‌جای اینکه برای همیشه «در حال دانلود» بماند، صریح شکست‌خورده اعلامش می‌کنیم.
    """
    cur = _exec(
        """UPDATE jobs SET status = 'error', error = ?, finished_at = strftime('%s','now')
           WHERE status NOT IN ('ready', 'error', 'canceled')""",
        ("سرور موقع دانلود ری‌استارت شد — دوباره تلاش کن",),
    )
    return cur.rowcount


# ---------- کتابخانه ----------


def library(query: str = "", limit: int = 50, offset: int = 0) -> tuple[list[sqlite3.Row], int, int]:
    """(ردیف‌ها، تعداد کل، مجموع حجم) — فیلترِ متنی روی عنوان/هنرمند/آلبوم."""
    where = "status = 'ready' AND path IS NOT NULL"
    params: tuple = ()
    if query.strip():
        where += " AND search_text LIKE ?"
        params = (f"%{query.strip().lower()}%",)

    head = _query(f"SELECT COUNT(*) c, COALESCE(SUM(bytes), 0) b FROM jobs WHERE {where}", params)[0]
    rows = _query(
        f"SELECT * FROM jobs WHERE {where} ORDER BY created_at DESC LIMIT ? OFFSET ?",
        (*params, limit, offset),
    )
    return rows, int(head["c"]), int(head["b"])


def expired_files(cutoff: float) -> list[sqlite3.Row]:
    """جاب‌های موفقی که فایلشان از عمر مجاز گذشته."""
    return _query(
        "SELECT * FROM jobs WHERE status = 'ready' AND path IS NOT NULL AND created_at < ?",
        (cutoff,),
    )


def expired_failures(cutoff: float) -> list[str]:
    rows = _query(
        "SELECT id FROM jobs WHERE status IN ('error','canceled') AND COALESCE(finished_at, created_at) < ?",
        (cutoff,),
    )
    return [r["id"] for r in rows]


def known_paths() -> set[str]:
    """هر مسیری که دیتابیس می‌شناسد — بقیه‌ی فایل‌های پوشه یتیم‌اند."""
    paths: set[str] = set()
    for row in _query("SELECT path, lyrics_path FROM jobs WHERE path IS NOT NULL"):
        paths.add(row["path"])
        if row["lyrics_path"]:
            paths.add(row["lyrics_path"])
    return paths


# ---------- کمکی ----------


def row_track(row: sqlite3.Row) -> dict:
    return json.loads(row["track_json"])


def row_path(row: sqlite3.Row) -> Path | None:
    return Path(row["path"]) if row["path"] else None
