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


class TestJobDirectories:
    """
    هر جاب پوشه‌ی خودش را دارد. نام فایل کیفیت را در خود ندارد، پس پوشه‌ی
    مشترک یعنی دانلود همان ترک با کیفیت دیگر فایل قبلی را می‌پراند و ردیف
    قدیمی به فایل جدید اشاره می‌ماند.
    """

    def test_each_job_gets_its_own_directory(self, downloads):
        assert jobs.job_dir("aaa") != jobs.job_dir("bbb")
        assert jobs.job_dir("aaa").parent == downloads

    def test_discard_takes_the_empty_directory_with_it(self, downloads):
        folder = jobs.job_dir("j1")
        folder.mkdir()
        audio = folder / "Farhad - Barf.mp3"
        audio.write_bytes(b"x")

        jobs._discard(audio)

        assert not audio.exists()
        assert not folder.exists()

    def test_discard_keeps_a_directory_that_still_has_files(self, downloads):
        folder = jobs.job_dir("j1")
        folder.mkdir()
        (folder / "keep.lrc").write_bytes(b"x")
        audio = folder / "gone.mp3"
        audio.write_bytes(b"x")

        jobs._discard(audio)
        assert folder.exists()

    def test_empty_directory_of_a_job_that_never_produced_a_file(self, downloads):
        """لغو یا شکست قبل از ساخته شدن فایل، پوشه‌ی خالی جا می‌گذاشت."""
        folder = jobs.job_dir("j1")
        folder.mkdir()

        jobs._rmdir_if_empty(folder)
        assert not folder.exists()

    def test_orphan_directories_are_removed(self, downloads, fresh_db):
        folder = jobs.job_dir("dead")
        folder.mkdir()
        _aged(folder / "leftover.mp3", 7200)

        jobs.sweep_disk()
        assert not folder.exists()

    def test_owned_directories_survive(self, downloads, fresh_db, track):
        folder = jobs.job_dir("alive")
        folder.mkdir()
        audio = _aged(folder / "owned.mp3", 99999)
        fresh_db.insert_job("alive", track, "320", "queued", time.time())
        fresh_db.update_job("alive", status="ready", path=str(audio))

        jobs.sweep_disk()
        assert audio.exists()

    def test_fresh_directories_are_spared(self, downloads, fresh_db):
        """دانلودی که همین حالا در جریان است هنوز ردیفِ path ندارد."""
        folder = jobs.job_dir("running")
        folder.mkdir()
        _aged(folder / "in-progress.part", 60)

        jobs.sweep_disk()
        assert folder.exists()

    def test_expired_job_takes_its_directory(self, downloads, fresh_db, track):
        folder = jobs.job_dir("old")
        folder.mkdir()
        audio = _aged(folder / "old.mp3", 99999)
        lrc = _aged(folder / "old.lrc", 99999)
        fresh_db.insert_job("old", track, "320", "queued", time.time() - 10_000)
        fresh_db.update_job("old", status="ready", path=str(audio), lyrics_path=str(lrc))

        jobs.sweep_disk()

        assert not folder.exists()
        assert fresh_db.get_job("old") is None
