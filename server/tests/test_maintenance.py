"""
پاک‌سازی دیسک.

قبل از این، هیچ‌کس فایل‌های دانلودشده را پاک نمی‌کرد و `server/downloads/`
بی‌نهایت بزرگ می‌شد. این تست‌ها مرزها را می‌بندند: فایل تازه نباید قربانی شود و
فایلِ صاحب‌دار نباید یتیم به حساب بیاید.
"""

from __future__ import annotations

import time

import pytest

from app import jobs


@pytest.fixture
def downloads(tmp_path, monkeypatch, fresh_db):
    monkeypatch.setattr(jobs, "DOWNLOAD_DIR", tmp_path)
    monkeypatch.setattr(jobs, "FILE_RETENTION_SECONDS", 3600)
    monkeypatch.setattr(jobs, "JOB_TTL_SECONDS", 3600)
    jobs.manager._jobs.clear()
    return tmp_path


def _aged(path, seconds: float):
    """فایل را قدیمی نشان بده بدون اینکه منتظر بمانیم."""
    stamp = time.time() - seconds
    path.write_bytes(b"x")
    import os

    os.utime(path, (stamp, stamp))
    return path


def test_orphan_files_are_removed(downloads, fresh_db):
    orphan = _aged(downloads / "leftover.mp3", 7200)
    jobs.sweep_disk()
    assert not orphan.exists()


def test_recent_orphans_are_spared(downloads, fresh_db):
    """دانلودی که همین الان در جریان است هنوز ردیفِ path ندارد — نباید پاک شود."""
    fresh = _aged(downloads / "in-progress.part", 60)
    jobs.sweep_disk()
    assert fresh.exists()


def test_known_files_are_never_orphans(downloads, fresh_db, track):
    owned = _aged(downloads / "owned.mp3", 99999)
    fresh_db.insert_job("j1", track, "320", "queued", time.time())
    fresh_db.update_job("j1", status="ready", path=str(owned))

    jobs.sweep_disk()
    assert owned.exists()


def test_expired_files_and_their_rows_go_together(downloads, fresh_db, track):
    audio = _aged(downloads / "old.mp3", 99999)
    lrc = _aged(downloads / "old.lrc", 99999)
    fresh_db.insert_job("j1", track, "320", "queued", time.time() - 10_000)
    fresh_db.update_job("j1", status="ready", path=str(audio), lyrics_path=str(lrc))

    jobs.sweep_disk()

    assert not audio.exists()
    assert not lrc.exists()
    # ردیفِ بی‌فایل یعنی کتابخانه‌ی دروغین
    assert fresh_db.get_job("j1") is None


def test_retention_zero_keeps_files_forever(downloads, fresh_db, track, monkeypatch):
    monkeypatch.setattr(jobs, "FILE_RETENTION_SECONDS", 0)
    audio = _aged(downloads / "keep.mp3", 99999)
    fresh_db.insert_job("j1", track, "320", "queued", 0.0)
    fresh_db.update_job("j1", status="ready", path=str(audio))

    jobs.sweep_disk()
    assert audio.exists()


def test_old_failures_are_dropped(downloads, fresh_db, track):
    fresh_db.insert_job("bad", track, "320", "queued", time.time() - 10_000)
    fresh_db.update_job("bad", status="error", error="boom", finished_at=time.time() - 10_000)

    jobs.sweep_disk()
    assert fresh_db.get_job("bad") is None
