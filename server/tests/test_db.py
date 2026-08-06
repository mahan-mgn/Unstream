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
