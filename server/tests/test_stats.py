"""
پخش‌ها، علاقه‌مندی‌ها و آمارِ گوش‌دادن.

نکته‌ی ظریف: متادیتای هر پخش (عنوان/هنرمند/کاور) در خودِ ردیفِ plays کپی
می‌شود، نه فقط شناسه — تا اگر فایل بعداٌ از کتابخانه پاک شد، تاریخچه و آمار
با آن نمیرند. و آمار بر اساسِ track_id گروه می‌بندد نه job_id، چون یک ترک
ممکن است دو کیفیت (دو جاب) داشته باشد و نباید دو بار شمرده شود.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app import jobs, main
from app.models import PlayEvent


@pytest.fixture
def library_db(tmp_path, monkeypatch, fresh_db):
    monkeypatch.setattr(jobs, "DOWNLOAD_DIR", tmp_path)
    jobs.manager._jobs.clear()
    return fresh_db


def _ready(db, track, job_id, path, quality="320", size=100):
    db.insert_job(job_id, track, quality, "ready", time.time())
    db.update_job(job_id, status="ready", path=str(path), bytes=size)


def _play(db, job_id, seconds=None):
    """یک رویدادِ پخش را از مسیرِ واقعیِ اندپوینت رد می‌کند."""
    return asyncio.run(main.record_play(PlayEvent(jobId=job_id, seconds=seconds)))


# ---------- ثبتِ پخش ----------


def test_record_play_writes_a_row(library_db, tmp_path, track):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)

    _play(library_db, "j1")

    rows = library_db.recent_plays(10)
    assert len(rows) == 1
    assert rows[0]["job_id"] == "j1"
    assert rows[0]["title"] == track.title
    assert rows[0]["artist"] == track.artist


def test_record_play_defaults_seconds_to_full_duration(library_db, tmp_path, track):
    """وقتی فرانت ثانیه نمی‌فرستد، کلِ مدتِ ترک حساب می‌شود."""
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)

    _play(library_db, "j1")

    assert library_db.recent_plays(1)[0]["seconds"] == track.durationMs // 1000


def test_record_play_honors_explicit_seconds(library_db, tmp_path, track):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)

    _play(library_db, "j1", seconds=42)

    assert library_db.recent_plays(1)[0]["seconds"] == 42


def test_record_play_clamps_negative_seconds(library_db, tmp_path, track):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)

    _play(library_db, "j1", seconds=-5)

    assert library_db.recent_plays(1)[0]["seconds"] == 0


def test_record_play_on_missing_job_raises(library_db):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        _play(library_db, "nope")
    assert exc.value.status_code == 404


def test_play_metadata_survives_file_deletion(library_db, tmp_path, track):
    """
    تاریخچه باید بعد از پاک‌شدنِ فایل هم بماند — متادیتا در ردیفِ plays کپی
    شده، نه اینکه به jobs وصل باشد.
    """
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)
    _play(library_db, "j1")

    library_db.delete_job("j1")

    rows = library_db.recent_plays(10)
    assert len(rows) == 1
    assert rows[0]["title"] == track.title


# ---------- علاقه‌مندی ----------


def test_set_favorite_toggles(library_db, tmp_path, track):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)

    assert library_db.set_favorite("j1", True) is True
    assert library_db.get_job("j1")["favorite"] == 1
    assert library_db.set_favorite("j1", False) is True
    assert library_db.get_job("j1")["favorite"] == 0


def test_set_favorite_on_missing_job_returns_false(library_db):
    assert library_db.set_favorite("nope", True) is False


def test_favorite_jobs_only_returns_ready_favorited(library_db, tmp_path, track):
    a = tmp_path / "a.mp3"
    a.write_bytes(b"x")
    b = tmp_path / "b.mp3"
    b.write_bytes(b"x")
    _ready(library_db, track, "j1", a)
    _ready(library_db, track.model_copy(update={"id": "itunes:track:2"}), "j2", b)
    library_db.set_favorite("j1", True)

    rows = library_db.favorite_jobs()

    assert [r["id"] for r in rows] == ["j1"]


# ---------- آمار ----------


def test_stats_aggregates_plays_and_seconds(library_db, tmp_path, track):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)
    _play(library_db, "j1", seconds=60)
    _play(library_db, "j1", seconds=40)

    stats = asyncio.run(main.listening_stats(days=7))

    assert stats.plays == 2
    assert stats.seconds == 100


def test_stats_groups_two_qualities_of_one_track(library_db, tmp_path, track):
    """
    یک ترک با دو کیفیت، دو جاب است ولی یک آهنگ — باید یک ردیف در بیشترین‌ها
    باشد با plays=2، نه دو ردیف با plays=1.
    """
    a = tmp_path / "a.mp3"
    b = tmp_path / "b.mp3"
    a.write_bytes(b"x")
    b.write_bytes(b"x")
    _ready(library_db, track, "j1", a, quality="320")
    _ready(library_db, track, "j2", b, quality="128")
    _play(library_db, "j1", seconds=10)
    _play(library_db, "j2", seconds=10)

    stats = asyncio.run(main.listening_stats(days=7))

    assert len(stats.topTracks) == 1
    assert stats.topTracks[0].plays == 2
    assert stats.topTracks[0].trackId == track.id


def test_stats_top_artists_aggregates_across_tracks(library_db, tmp_path, track):
    a = tmp_path / "a.mp3"
    b = tmp_path / "b.mp3"
    a.write_bytes(b"x")
    b.write_bytes(b"x")
    _ready(library_db, track, "j1", a)
    _ready(library_db, track.model_copy(update={"id": "itunes:track:2"}), "j2", b)
    _play(library_db, "j1")
    _play(library_db, "j2")

    stats = asyncio.run(main.listening_stats(days=7))

    assert len(stats.topArtists) == 1
    assert stats.topArtists[0].artist == track.artist
    assert stats.topArtists[0].plays == 2


def test_stats_ignores_plays_outside_the_window(library_db, tmp_path, track):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)
    # یک پخشِ قدیمی، بیرون از بازه‌ی ۷ روز
    library_db.record_play(
        "j1", track.id, track.title, track.artist, None, None,
        track.durationMs, 10, time.time() - 30 * 86400,
    )

    stats = asyncio.run(main.listening_stats(days=7))

    assert stats.plays == 0


def test_stats_top_artists_merges_collab_separator_variants(library_db, tmp_path, track):
    """
    یک همکاری از دو پلتفرم دو نگارش دارد: «A, B» و «A & B». کاربر باید یک
    ردیف ببیند با پخشِ جمعِ هر دو، نه دو هنرمندِ نیمه.
    """
    a = tmp_path / "a.mp3"
    b = tmp_path / "b.mp3"
    a.write_bytes(b"x")
    b.write_bytes(b"x")
    _ready(library_db, track, "j1", a)
    _ready(library_db, track.model_copy(update={"id": "itunes:track:2", "artist": "Farhad & Mehrad"}), "j2", b)
    _play(library_db, "j1")  # «Farhad Mehrad» تکی — نباید با همکاری قاطی شود
    library_db.record_play(
        "j2", "itunes:track:2", track.title, "Farhad & Mehrad", None, None,
        track.durationMs, 10, time.time(),
    )
    library_db.record_play(
        "j2", "itunes:track:2", track.title, "Farhad, Mehrad", None, None,
        track.durationMs, 10, time.time(),
    )

    stats = asyncio.run(main.listening_stats(days=7))

    collab = [x for x in stats.topArtists if "&" in x.artist or "," in x.artist]
    assert len(collab) == 1
    assert collab[0].plays == 2
    # و هنرمندِ تکی جدا مانده
    assert any(x.artist == track.artist and x.plays == 1 for x in stats.topArtists)


def test_stats_top_tracks_merges_same_song_across_catalogs(library_db, tmp_path, track):
    """
    یک آهنگ از دو کاتالوگ دو شناسه دارد («itunes:track:1»، «deezer:track:9»)
    و هنرمندش با دو نگارشِ همکاری می‌آید («A & B» از اسپاتیفای، «A, B» از
    دیزر). بیِ ادغام، همان آهنگ دو ردیفِ نیمه‌پخش در «آهنگ‌های برتر» می‌گرفت.
    """
    a = tmp_path / "a.mp3"
    b = tmp_path / "b.mp3"
    a.write_bytes(b"x")
    b.write_bytes(b"x")
    one = track.model_copy(update={"artist": "Farhad & Mehrad"})
    other = track.model_copy(
        update={"id": "deezer:track:9", "artist": "Farhad, Mehrad", "title": "  mard-e tanha  "}
    )
    _ready(library_db, one, "j1", a)
    _ready(library_db, other, "j2", b)
    # j1 دو پخش، j2 یک پخش — نمایش باید از پخش‌بیشتر (نگارشِ j1) بماند
    library_db.record_play(
        "j1", "itunes:track:1", one.title, one.artist, None, None,
        one.durationMs, 10, time.time(),
    )
    library_db.record_play(
        "j1", "itunes:track:1", one.title, one.artist, None, None,
        one.durationMs, 10, time.time(),
    )
    library_db.record_play(
        "j2", "deezer:track:9", other.title, other.artist, None, None,
        other.durationMs, 10, time.time(),
    )

    stats = asyncio.run(main.listening_stats(days=7))

    assert len(stats.topTracks) == 1
    row = stats.topTracks[0]
    assert row.plays == 3
    assert row.trackId == "itunes:track:1"
    assert row.artist == "Farhad & Mehrad"


def test_stats_clamps_days(library_db):
    """روزهای نامعتبر باید به بازه‌ی مجاز محدود شوند، نه خطا."""
    stats = asyncio.run(main.listening_stats(days=0))
    assert stats.plays == 0
    stats = asyncio.run(main.listening_stats(days=9999))
    assert stats.plays == 0


# ---------- کتابخانه: favorite و playCount ----------


def test_library_carries_favorite_and_play_count(library_db, tmp_path, track):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)
    library_db.set_favorite("j1", True)
    _play(library_db, "j1")
    _play(library_db, "j1")

    page = asyncio.run(main.library())

    assert page.items[0].favorite is True
    assert page.items[0].playCount == 2


def test_library_defaults_favorite_false_play_count_zero(library_db, tmp_path, track):
    audio = tmp_path / "a.mp3"
    audio.write_bytes(b"x")
    _ready(library_db, track, "j1", audio)

    page = asyncio.run(main.library())

    assert page.items[0].favorite is False
    assert page.items[0].playCount == 0


# ---------- اندپوینتِ علاقه‌مندی‌ها ----------


def test_favorites_endpoint_returns_only_liked_files(library_db, tmp_path, track):
    a = tmp_path / "a.mp3"
    b = tmp_path / "b.mp3"
    a.write_bytes(b"x")
    b.write_bytes(b"x")
    _ready(library_db, track, "j1", a)
    _ready(library_db, track.model_copy(update={"id": "itunes:track:2"}), "j2", b)
    library_db.set_favorite("j2", True)

    items = asyncio.run(main.favorites())

    assert [i.jobId for i in items] == ["j2"]


def test_favorites_endpoint_skips_missing_files(library_db, tmp_path, track):
    """لایک روی فایلی که بعداً پاک شده نباید ۴۰۴ بدهد — فقط رد می‌شود."""
    library_db.insert_job("ghost", track, "320", "ready", time.time())
    library_db.update_job("ghost", path=str(tmp_path / "vanished.mp3"))
    library_db.set_favorite("ghost", True)

    items = asyncio.run(main.favorites())

    assert items == []


# ---------- میکسِ روزانه ----------


def test_mix_center_comes_from_favorites(library_db, tmp_path, track):
    """
    لایکِ شادِ پرانرژی باید ترکِ شادِ بی‌لایک را جلوتر از ترکِ غمگین بیاورد،
    و `source` باید بگوید که مرکز از لایک‌ها آمده.
    """
    a, b, c = tmp_path / "a.mp3", tmp_path / "b.mp3", tmp_path / "c.mp3"
    for f in (a, b, c):
        f.write_bytes(b"x")
    fav = track.model_copy(update={"id": "itunes:track:1"})
    happy = track.model_copy(update={"id": "itunes:track:2"})
    sad = track.model_copy(update={"id": "itunes:track:3"})
    _ready(library_db, fav, "j1", a)
    _ready(library_db, happy, "j2", b)
    _ready(library_db, sad, "j3", c)
    library_db.update_job("j1", valence=0.9, energy=0.9)
    library_db.update_job("j2", valence=0.85, energy=0.8)
    library_db.update_job("j3", valence=0.1, energy=0.1)
    library_db.set_favorite("j1", True)

    mix = asyncio.run(main.daily_mix())

    assert mix.source == "favorites"
    ids = [i.jobId for i in mix.items]
    # لایک خودش همیشه اول است (پاداشِ لایک)، شاد دوم، غمگین آخر
    assert ids.index("j1") < ids.index("j2") < ids.index("j3")


def test_mix_falls_back_to_recent_plays_without_favorites(library_db, tmp_path, track):
    """
    بدونِ لایک، مرکز از پخش‌های اخیر می‌آید: پخشِ یک ترکِ شاد باید هم‌حس‌هایش
    را جلوتر بیاورد. خودِ ترکِ پخش‌شده عمداً سه‌تاست و در میکس نمی‌آید (چون
    اخیراً گوش داده شده)، پس مقایسه بینِ دو ترکِ دیگر است.
    """
    a, b, c = tmp_path / "a.mp3", tmp_path / "b.mp3", tmp_path / "c.mp3"
    for f in (a, b, c):
        f.write_bytes(b"x")
    played = track.model_copy(update={"id": "itunes:track:1"})
    happy = track.model_copy(update={"id": "itunes:track:2"})
    sad = track.model_copy(update={"id": "itunes:track:3"})
    _ready(library_db, played, "j1", a)
    _ready(library_db, happy, "j2", b)
    _ready(library_db, sad, "j3", c)
    library_db.update_job("j1", valence=0.8, energy=0.8)
    library_db.update_job("j2", valence=0.75, energy=0.75)
    library_db.update_job("j3", valence=0.2, energy=0.2)
    _play(library_db, "j1")  # سیگنالِ «اخیر» بدونِ هیچ لایکی

    mix = asyncio.run(main.daily_mix())

    assert mix.source == "recent"
    ids = [i.jobId for i in mix.items]
    assert "j1" not in ids  # پخش‌شده‌ی اخیر تکرار نمی‌شود
    assert ids.index("j2") < ids.index("j3")  # هم‌حسِ سیگنال جلوتر است


def test_mix_excludes_recently_played_tracks(library_db, tmp_path, track):
    """ترکی که همین بازه گوش داده شده، در میکس تکرار نمی‌شود."""
    a, b = tmp_path / "a.mp3", tmp_path / "b.mp3"
    a.write_bytes(b"x")
    b.write_bytes(b"x")
    t1 = track.model_copy(update={"id": "itunes:track:1"})
    t2 = track.model_copy(update={"id": "itunes:track:2"})
    _ready(library_db, t1, "j1", a)
    _ready(library_db, t2, "j2", b)
    library_db.update_job("j1", valence=0.9, energy=0.9)
    library_db.update_job("j2", valence=0.9, energy=0.9)
    library_db.set_favorite("j1", True)
    _play(library_db, "j1")  # لایک هست ولی همین الان هم گوش داده شده

    mix = asyncio.run(main.daily_mix())

    assert [i.jobId for i in mix.items] == ["j2"]


def test_mix_is_none_when_no_signal(library_db, tmp_path, track):
    """نه لایکی نه پخشی — میکس باید بگوید «چیزی برای پیشنهاد نیست»."""
    a = tmp_path / "a.mp3"
    a.write_bytes(b"x")
    _ready(library_db, track, "j1", a)

    mix = asyncio.run(main.daily_mix())

    assert mix.source == "none"


def test_mix_empty_library_is_none(library_db):
    mix = asyncio.run(main.daily_mix())
    assert mix.source == "none"
    assert mix.items == []


# ---------- play_totals: شمارشِ ترکِ متفاوت ----------


def test_play_totals_counts_unique_tracks(library_db, tmp_path, track):
    a, b = tmp_path / "a.mp3", tmp_path / "b.mp3"
    a.write_bytes(b"x")
    b.write_bytes(b"x")
    _ready(library_db, track, "j1", a)
    _ready(library_db, track.model_copy(update={"id": "itunes:track:2"}), "j2", b)
    _play(library_db, "j1")
    _play(library_db, "j1")
    _play(library_db, "j2")

    plays, seconds, unique = library_db.play_totals(time.time() - 60)

    assert (plays, unique) == (3, 2)
