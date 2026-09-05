"""
کشِ قدیمیِ بات — فقط برای مهاجرتِ یک‌باره.

دنبال‌کردنِ هنرمندها به دیتابیسِ سرور (`app/db.py`، جدول `follows`) منتقل شد تا
وب هم بتواند از همان‌جا هنرمند دنبال کند؛ بات حالا از طریقِ `/api/follows` با
همان جدول کار می‌کند. تنها کاری که این فایل می‌کند خواندنِ ردیف‌های باقی‌مانده
از bot.dbِ نسخه‌های قدیمی و هل‌دادنشان به سرور است (در `run._migrate_follows`)،
و بعد خالی‌کردنش.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from ..config import BOT_DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS follows (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id             INTEGER NOT NULL,
    artist_id           TEXT NOT NULL,
    artist_name         TEXT NOT NULL,
    artist_source_url   TEXT NOT NULL,
    source              TEXT NOT NULL,
    artwork_url         TEXT,
    last_release_id     TEXT,
    last_release_title  TEXT,
    created_at          REAL NOT NULL,
    UNIQUE(chat_id, artist_id)
);
"""

_conn: sqlite3.Connection | None = None


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        BOT_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(BOT_DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
        _conn.commit()
    return _conn


def close() -> None:
    global _conn
    if _conn is not None:
        _conn.close()
        _conn = None


@dataclass
class LegacyFollow:
    id: int
    chat_id: int
    artist_id: str
    artist_name: str
    artist_source_url: str
    source: str
    artwork_url: str | None
    last_release_id: str | None
    last_release_title: str | None


def _row(r: sqlite3.Row) -> LegacyFollow:
    return LegacyFollow(
        id=r["id"],
        chat_id=r["chat_id"],
        artist_id=r["artist_id"],
        artist_name=r["artist_name"],
        artist_source_url=r["artist_source_url"],
        source=r["source"],
        artwork_url=r["artwork_url"],
        last_release_id=r["last_release_id"],
        last_release_title=r["last_release_title"],
    )


def all_follows() -> list[LegacyFollow]:
    return [_row(r) for r in _db().execute("SELECT * FROM follows").fetchall()]


def clear_all() -> None:
    """ردیف‌ها سرور نشسته‌اند — این‌جا دیگر جایی ندارند."""
    conn = _db()
    conn.execute("DELETE FROM follows")
    conn.commit()
