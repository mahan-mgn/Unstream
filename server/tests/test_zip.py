"""
آرشیو — چیزی که کاربر واقعاً باز می‌کند.

ساختار پوشه اینجا ساخته می‌شود نه روی دیسک؛ `paths` نگاشت را تست می‌کند و
این‌جا فقط باید مطمئن شویم همان نگاشت به اعضای ZIP رسیده و `.lrc` هم‌نامِ
فایل صوتی مانده.
"""

from __future__ import annotations

import asyncio
import time
import zipfile

import pytest

from app import jobs, main
from app.models import ZipRequest


@pytest.fixture
def zip_db(tmp_path, monkeypatch, fresh_db):
    monkeypatch.setattr(jobs, "DOWNLOAD_DIR", tmp_path)
    monkeypatch.setattr(main, "DOWNLOAD_DIR", tmp_path)
    jobs.manager._jobs.clear()
    return fresh_db


def _ready(db, track, job_id, folder, ext=".mp3", lrc=False):
    """یک جابِ موفق با فایل واقعی، در پوشه‌ی اختصاصی خودش."""
    folder.mkdir(parents=True, exist_ok=True)
    audio = folder / f"{track.artist} - {track.title}{ext}"
    audio.write_bytes(b"x" * 32)
    db.insert_job(job_id, track, "320", "ready", time.time())
    fields = {"status": "ready", "path": str(audio), "bytes": 32}
    if lrc:
        lyrics = audio.with_suffix(".lrc")
        lyrics.write_text("[00:01.00]x", encoding="utf-8")
        fields["lyrics_path"] = str(lyrics)
    db.update_job(job_id, **fields)
    return audio


def _build(zip_db, job_ids, name="Album"):
    """(اعضای آرشیو، مسیر آرشیو)"""
    ready = asyncio.run(main.create_zip(ZipRequest(jobIds=job_ids, name=name)))
    archive, _, _ = main._archives[ready.url.rsplit("/", 1)[-1]]
    with zipfile.ZipFile(archive) as z:
        return z.namelist(), archive


def test_archive_uses_the_folder_structure(zip_db, tmp_path, track):
    numbered = track.model_copy(update={"trackNumber": 4})
    _ready(zip_db, numbered, "j1", tmp_path / "j1")

    names, _ = _build(zip_db, ["j1"])

    assert names == ["Farhad Mehrad/Mard-E Tanha/04 - Mard-e Tanha.mp3"]


def test_featured_tracks_stay_in_one_album_folder(zip_db, tmp_path, track):
    """
    آلبومی که چند ترکش مهمان دارد باید یک پوشه باشد. قبلاً هر ترک با هنرمندِ
    خودش پوشه می‌گرفت و پلیر همان‌قدر آلبومِ هم‌نام نشان می‌داد.
    """
    solo = track.model_copy(update={"trackNumber": 1, "albumArtist": "Farhad Mehrad"})
    guest = track.model_copy(
        update={
            "id": "itunes:track:2",
            "title": "Jomeh",
            "artist": "Farhad Mehrad, Esfandiar",
            "albumArtist": "Farhad Mehrad",
            "trackNumber": 2,
        }
    )
    _ready(zip_db, solo, "j1", tmp_path / "j1")
    _ready(zip_db, guest, "j2", tmp_path / "j2")

    names, _ = _build(zip_db, ["j1", "j2"], name="Mard-E Tanha")

    assert sorted(n for n in names if n.endswith(".mp3")) == [
        "Farhad Mehrad/Mard-E Tanha/01 - Mard-e Tanha.mp3",
        "Farhad Mehrad/Mard-E Tanha/02 - Jomeh.mp3",
    ]


def test_lyrics_stay_next_to_their_audio(zip_db, tmp_path, track):
    """پلیرها `.lrc` را با هم‌نامی پیدا می‌کنند، نه با یک ایندکس."""
    numbered = track.model_copy(update={"trackNumber": 4})
    _ready(zip_db, numbered, "j1", tmp_path / "j1", lrc=True)

    names, _ = _build(zip_db, ["j1"])

    assert sorted(names) == [
        "Farhad Mehrad/Mard-E Tanha/04 - Mard-e Tanha.lrc",
        "Farhad Mehrad/Mard-E Tanha/04 - Mard-e Tanha.mp3",
    ]


def test_a_playlist_is_added_for_multiple_tracks(zip_db, tmp_path, track):
    _ready(zip_db, track.model_copy(update={"trackNumber": 1}), "j1", tmp_path / "j1")
    second = track.model_copy(update={"id": "itunes:track:2", "title": "Jomeh", "trackNumber": 2})
    _ready(zip_db, second, "j2", tmp_path / "j2")

    names, archive = _build(zip_db, ["j1", "j2"], name="Mard-E Tanha")

    assert "Mard-E Tanha.m3u" in names
    with zipfile.ZipFile(archive) as z:
        body = z.read("Mard-E Tanha.m3u").decode("utf-8")
    # مسیرهای پلی‌لیست باید همان مسیرهای داخل آرشیو باشند، وگرنه هیچ‌کدام باز نمی‌شوند
    for line in body.splitlines():
        if line and not line.startswith("#"):
            assert line in names


def test_a_single_track_gets_no_playlist(zip_db, tmp_path, track):
    """یک فایل، پلی‌لیست نمی‌خواهد."""
    _ready(zip_db, track, "j1", tmp_path / "j1")

    names, _ = _build(zip_db, ["j1"])

    assert not any(n.endswith(".m3u") for n in names)


def test_two_qualities_of_one_track_do_not_overwrite_each_other(zip_db, tmp_path, track):
    """
    هر دو به یک مسیر رندر می‌شوند. بدون شماره‌گذاری، باز کردن آرشیو یکی را
    روی دیگری می‌ریخت و کاربر بی‌خبر یک فایل کم داشت.
    """
    _ready(zip_db, track, "j1", tmp_path / "j1")
    _ready(zip_db, track, "j2", tmp_path / "j2")

    names, _ = _build(zip_db, ["j1", "j2"])

    audio = [n for n in names if n.endswith(".mp3")]
    assert len(audio) == 2
    assert len(set(audio)) == 2


def test_nothing_ready_is_404(zip_db, track):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        asyncio.run(main.create_zip(ZipRequest(jobIds=["ghost"], name="x")))

    assert exc.value.status_code == 404
