"""
تنظیمات مشترک تست‌ها.

قبل از هر ایمپورتی از `app` باید مسیر دیتابیس و پوشه‌ی دانلود را به جای موقت
ببریم؛ `config` این‌ها را در زمان ایمپورت می‌خواند و پوشه را همان‌جا می‌سازد.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="unstream-tests-"))
os.environ.setdefault("UNSTREAM_DATA_DIR", str(_TMP / "data"))
os.environ.setdefault("UNSTREAM_DOWNLOAD_DIR", str(_TMP / "downloads"))
os.environ.setdefault("UNSTREAM_DB", str(_TMP / "data" / "test.db"))

# تست‌ها از ریشه‌ی server/ اجرا می‌شوند
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from app.models import Track  # noqa: E402


@pytest.fixture
def track() -> Track:
    return Track(
        id="itunes:track:1",
        title="Mard-e Tanha",
        artist="Farhad Mehrad",
        album="Mard-E Tanha",
        durationMs=185_000,
        source="apple",
        sourceUrl="https://music.apple.com/us/album/x/1?i=2",
    )


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """دیتابیس خالی و مستقل برای هر تست."""
    from app import db

    db.close()
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "unstream.db")
    db.connect()
    yield db
    db.close()
