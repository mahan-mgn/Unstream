"""دیتابیس و کتابخانه — منبع حقیقتی که صف روی آن ساخته شده."""

from __future__ import annotations

import time


def _add(db, track, job_id="j1", quality="320", status="queued", created=1000.0):
    db.insert_job(job_id, track, quality, status, created)
    return job_id


def test_insert_and_read_back(fresh_db, track):
    _add(fresh_db, track)
    row = fresh_db.get_job("j1")
    assert row["track_id"] == track.id
    assert row["status"] == "queued"
    assert fresh_db.row_track(row)["title"] == track.title


def test_update_ignores_unknown_columns(fresh_db, track):
    """`_emit` همه‌ی فیلدهای progress را می‌فرستد؛ percent ستون ندارد و نباید بترکاند."""
    _add(fresh_db, track)
    fresh_db.update_job("j1", status="ready", percent=42, nonsense="x")
    assert fresh_db.get_job("j1")["status"] == "ready"


def test_find_ready_only_matches_same_quality(fresh_db, track):
    _add(fresh_db, track, "j1", quality="320")
    fresh_db.update_job("j1", status="ready", path="/tmp/a.mp3")

    assert fresh_db.find_ready(track.id, "320")["id"] == "j1"
    # کیفیت متفاوت یعنی فایل متفاوت — بازاستفاده اشتباه است
    assert fresh_db.find_ready(track.id, "flac") is None


def test_find_ready_ignores_unfinished_jobs(fresh_db, track):
    _add(fresh_db, track, "j1", status="downloading")
    assert fresh_db.find_ready(track.id, "320") is None


def test_library_counts_and_bytes(fresh_db, track):
    for i in range(3):
        _add(fresh_db, track, f"j{i}", created=1000.0 + i)
        fresh_db.update_job(f"j{i}", status="ready", path=f"/tmp/{i}.mp3", bytes=100)

    rows, total, size = fresh_db.library()
    assert total == 3
    assert size == 300
    # تازه‌ترین اول
    assert rows[0]["id"] == "j2"


def test_library_exposes_play_count_and_last_played(fresh_db, track):
    """ردیفِ «اخیراً پخش‌شده»ی کتابخانه به هر دو ستون نیاز دارد."""
    _add(fresh_db, track, "played")
    fresh_db.update_job("played", status="ready", path="/tmp/a.mp3")
    _add(fresh_db, track, "never")
    fresh_db.update_job("never", status="ready", path="/tmp/b.mp3")

    fresh_db.record_play("played", track.id, track.title, track.artist, track.album, None, 1000, 40, 900.0)
    fresh_db.record_play("played", track.id, track.title, track.artist, track.album, None, 1000, 30, 950.0)

    rows = {r["id"]: r for r in fresh_db.library()[0]}
    assert rows["played"]["play_count"] == 2
    assert rows["played"]["last_played_at"] == 950.0
    # هرگز پخش نشده: هیچ ردیفی در plays نیست، پس MAX تهی است و باید None بماند
    assert rows["never"]["play_count"] == 0
    assert rows["never"]["last_played_at"] is None


def test_library_search_matches_artist_and_album(fresh_db, track):
    _add(fresh_db, track)
    fresh_db.update_job("j1", status="ready", path="/tmp/a.mp3")

    assert fresh_db.library("farhad")[1] == 1
    assert fresh_db.library("mard-e tanha")[1] == 1
    assert fresh_db.library("something else")[1] == 0


def test_library_excludes_failures(fresh_db, track):
    _add(fresh_db, track, "ok")
    fresh_db.update_job("ok", status="ready", path="/tmp/a.mp3")
    _add(fresh_db, track, "bad")
    fresh_db.update_job("bad", status="error", error="boom")

    assert fresh_db.library()[1] == 1


def test_mark_interrupted_only_touches_live_jobs(fresh_db, track):
    _add(fresh_db, track, "live", status="downloading")
    _add(fresh_db, track, "done", status="ready")

    assert fresh_db.mark_interrupted() == 1
    assert fresh_db.get_job("live")["status"] == "error"
    assert fresh_db.get_job("done")["status"] == "ready"


def test_expired_files_respects_cutoff(fresh_db, track):
    now = time.time()
    _add(fresh_db, track, "old", created=now - 10_000)
    fresh_db.update_job("old", status="ready", path="/tmp/old.mp3")
    _add(fresh_db, track, "new", created=now)
    fresh_db.update_job("new", status="ready", path="/tmp/new.mp3")

    expired = [r["id"] for r in fresh_db.expired_files(now - 5_000)]
    assert expired == ["old"]


def test_known_paths_includes_lyrics(fresh_db, track):
    _add(fresh_db, track)
    fresh_db.update_job("j1", status="ready", path="/tmp/a.mp3", lyrics_path="/tmp/a.lrc")
    assert fresh_db.known_paths() == {"/tmp/a.mp3", "/tmp/a.lrc"}


def test_valence_and_energy_round_trip(fresh_db, track):
    """تحلیلِ حس‌وحال بعد از ready می‌رسد و باید جدا از بقیه‌ی فیلدها ذخیره بماند."""
    _add(fresh_db, track)
    fresh_db.update_job("j1", status="ready", path="/tmp/a.mp3", valence=0.8, energy=0.3)

    row = fresh_db.get_job("j1")
    assert row["valence"] == 0.8
    assert row["energy"] == 0.3


def test_valence_and_energy_default_to_null(fresh_db, track):
    """وقتی librosa نصب نباشد یا تحلیل شکست بخورد، ستون باید خالی بماند نه صفر."""
    _add(fresh_db, track)
    fresh_db.update_job("j1", status="ready", path="/tmp/a.mp3")

    row = fresh_db.get_job("j1")
    assert row["valence"] is None
    assert row["energy"] is None


def test_migration_adds_mood_columns_to_a_pre_mood_database(tmp_path, monkeypatch):
    """دیتابیسِ نسخه‌ی قبل از این ویژگی هم باید بی‌خطا بالا بیاید و ستون‌ها اضافه شوند."""
    import sqlite3

    from app import db

    db.close()
    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute(
        """CREATE TABLE jobs (
            id TEXT PRIMARY KEY, track_id TEXT NOT NULL, track_json TEXT NOT NULL,
            search_text TEXT NOT NULL DEFAULT '', quality TEXT NOT NULL,
            status TEXT NOT NULL, error TEXT, warning TEXT, format TEXT, path TEXT,
            lyrics_path TEXT, bytes INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL,
            finished_at REAL
        )"""
    )
    conn.commit()
    conn.close()

    monkeypatch.setattr(db, "DB_PATH", path)
    live = db.connect()
    columns = {row[1] for row in live.execute("PRAGMA table_info(jobs)")}
    db.close()

    assert {"valence", "energy"} <= columns


def test_library_search_treats_wildcards_literally(fresh_db, track):
    """
    `%` و `_` برای خودِ LIKE معنی دارند.

    بدون فرار دادنشان، کاربری که در جستجوی کتابخانه «_» تایپ می‌کرد کلِ
    کتابخانه را می‌گرفت (هر کاراکتری با `_` مچ می‌شود) — دقیقاً برعکسِ کاری
    که می‌خواست بکند.
    """
    for i in range(3):
        _add(fresh_db, track, f"j{i}", created=1000.0 + i)
        fresh_db.update_job(f"j{i}", status="ready", path=f"/tmp/{i}.mp3")

    assert fresh_db.library("")[1] == 3
    assert fresh_db.library("_")[1] == 0
    assert fresh_db.library("%")[1] == 0
    # متنِ واقعی همچنان باید پیدا شود
    assert fresh_db.library("farhad")[1] == 3


def test_library_search_finds_literal_wildcard_in_title(fresh_db, track):
    """و برعکس: ترکی که واقعاً `%` در نامش دارد باید با همان پیدا شود."""
    odd = track.model_copy(update={"id": "itunes:track:9", "title": "100% Pure"})
    _add(fresh_db, odd, "j9")
    fresh_db.update_job("j9", status="ready", path="/tmp/9.mp3")

    assert fresh_db.library("100%")[1] == 1
    assert fresh_db.library("100")[1] == 1


def test_smart_playlist_query_escapes_wildcards(fresh_db, track):
    """قانونِ پلی‌لیستِ هوشمند از همان مسیرِ LIKE می‌رود و همان مشکل را داشت."""
    _add(fresh_db, track, "j1")
    fresh_db.update_job("j1", status="ready", path="/tmp/1.mp3")

    assert len(fresh_db.smart_jobs({"query": "farhad"})) == 1
    assert len(fresh_db.smart_jobs({"query": "_"})) == 0
