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

# سرویس‌های بیرونی در تست باید خاموش باشند. بدون این، `server/.env` توسعه‌دهنده
# خوانده می‌شد و تستی که به شناسایی دست می‌زند با کلیدِ واقعی به AcoustID/AudD
# وصل می‌شد — کند، شکننده، و روی سهمیه‌ی کسی حساب می‌شد.
#
# دو لایه لازم است: `UNSTREAM_ENV_NO_FILES` جلوی *خواندنِ فایل* را می‌گیرد
# (config.py هیچ .envی نمی‌بیند)، و مقدارهای خالی جلوی ارث‌بری از محیطِ شل.
os.environ.setdefault("UNSTREAM_ENV_NO_FILES", "1")
for _off in ("UNSTREAM_ACOUSTID_KEY", "UNSTREAM_AUDD_TOKEN", "UNSTREAM_FPCALC"):
    os.environ.setdefault(_off, "")

# تست‌ها از ریشه‌ی server/ اجرا می‌شوند
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from app.models import Album, Artist, Playlist, Track  # noqa: E402


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
def artist() -> Artist:
    return Artist(
        id="deezer:artist:1",
        name="Farhad Mehrad",
        source="deezer",
        sourceUrl="https://www.deezer.com/artist/1",
        subtitle="34 آلبوم",
    )


@pytest.fixture
def album() -> Album:
    return Album(
        id="deezer:album:1",
        title="Mard-E Tanha",
        artist="Farhad Mehrad",
        year=1973,
        trackCount=10,
        source="deezer",
        sourceUrl="https://www.deezer.com/album/1",
    )


@pytest.fixture
def playlist() -> Playlist:
    return Playlist(
        id="deezer:playlist:1",
        title="بهترین‌های فرهاد",
        owner="ناشناس",
        trackCount=20,
        source="deezer",
        sourceUrl="https://www.deezer.com/playlist/1",
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
