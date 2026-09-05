"""
پلی‌لیست‌های کاربر — دستی و هوشمند.

دو نوع در یک جدول می‌نشینند و تفاوتشان فقط در منبعِ اعضاست: فهرستِ ذخیره‌شده در
برابر قانونی که موقع خواندن اجرا می‌شود. تست‌ها دقیقاً همین مرز را می‌سنجند.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app import jobs, main
from app.models import PlaylistCreate, PlaylistItemsRequest, PlaylistRule, PlaylistUpdate


@pytest.fixture
def library(tmp_path, monkeypatch, fresh_db):
    monkeypatch.setattr(jobs, "DOWNLOAD_DIR", tmp_path)
    jobs.manager._jobs.clear()
    return fresh_db


def _ready(db, track, job_id, tmp_path, *, valence=None, energy=None, title=None):
    audio = tmp_path / f"{job_id}.mp3"
    audio.write_bytes(b"x" * 10)
    stored = track.model_copy(update={"id": f"{track.id}:{job_id}", "title": title or track.title})
    db.insert_job(job_id, stored, "320", "ready", time.time())
    db.update_job(
        job_id,
        status="ready",
        path=str(audio),
        bytes=10,
        valence=valence,
        energy=energy,
    )
    return job_id


def _create(**kwargs):
    return asyncio.run(main.create_playlist(PlaylistCreate(**kwargs)))


def test_manual_playlist_keeps_the_order_it_was_given(library, tmp_path, track):
    a = _ready(library, track, "j1", tmp_path, title="A")
    b = _ready(library, track, "j2", tmp_path, title="B")

    playlist = _create(name="شب‌ها", jobIds=[b, a])
    detail = asyncio.run(main.get_playlist(playlist.id))

    assert [i.jobId for i in detail.items] == [b, a]
    assert detail.trackCount == 2


def test_adding_the_same_track_twice_does_nothing(library, tmp_path, track):
    a = _ready(library, track, "j1", tmp_path)
    playlist = _create(name="x", jobIds=[a])

    result = asyncio.run(
        main.add_playlist_items(playlist.id, PlaylistItemsRequest(jobIds=[a]))
    )
    assert result["added"] == 0
    assert asyncio.run(main.get_playlist(playlist.id)).trackCount == 1


def test_unknown_job_is_rejected(library, track):
    playlist = _create(name="x")
    with pytest.raises(Exception):
        asyncio.run(main.add_playlist_items(playlist.id, PlaylistItemsRequest(jobIds=["nope"])))


def test_removing_from_the_library_shortens_the_playlist(library, tmp_path, track):
    """عضوی که فایلش رفته نباید در پلی‌لیست بماند و بعد موقع پخش خطا بدهد."""
    a = _ready(library, track, "j1", tmp_path)
    b = _ready(library, track, "j2", tmp_path)
    playlist = _create(name="x", jobIds=[a, b])

    jobs.manager.forget(a)

    assert [i.jobId for i in asyncio.run(main.get_playlist(playlist.id)).items] == [b]


def test_smart_playlist_filters_by_mood(library, tmp_path, track):
    _ready(library, track, "sad", tmp_path, valence=0.1, energy=0.2, title="Sad")
    _ready(library, track, "happy", tmp_path, valence=0.9, energy=0.8, title="Happy")

    playlist = _create(
        name="شادها",
        kind="smart",
        rule=PlaylistRule(valenceMin=0.6),
    )
    detail = asyncio.run(main.get_playlist(playlist.id))

    assert [i.jobId for i in detail.items] == ["happy"]


def test_smart_playlist_ignores_tracks_without_analysis(library, tmp_path, track):
    """
    ترکِ تحلیل‌نشده valence ندارد؛ واردکردنش در فیلترِ حس‌وحال یعنی نتیجه‌ی
    تصادفی، پس باید بیرون بماند.
    """
    _ready(library, track, "unknown", tmp_path)
    _ready(library, track, "happy", tmp_path, valence=0.9, energy=0.9)

    playlist = _create(name="x", kind="smart", rule=PlaylistRule(valenceMin=0.5))

    assert [i.jobId for i in asyncio.run(main.get_playlist(playlist.id)).items] == ["happy"]


def test_smart_playlist_picks_up_new_downloads(library, tmp_path, track):
    """قانون موقع خواندن اجرا می‌شود، نه موقع ساخت."""
    playlist = _create(name="x", kind="smart", rule=PlaylistRule(energyMin=0.5))
    assert asyncio.run(main.get_playlist(playlist.id)).trackCount == 0

    _ready(library, track, "loud", tmp_path, valence=0.5, energy=0.9)
    assert asyncio.run(main.get_playlist(playlist.id)).trackCount == 1


def test_smart_playlist_refuses_manual_members(library, tmp_path, track):
    a = _ready(library, track, "j1", tmp_path)
    playlist = _create(name="x", kind="smart", rule=PlaylistRule())

    with pytest.raises(Exception):
        asyncio.run(main.add_playlist_items(playlist.id, PlaylistItemsRequest(jobIds=[a])))


def test_smart_playlist_needs_a_rule(library):
    with pytest.raises(Exception):
        _create(name="x", kind="smart")


def test_rename_keeps_the_members(library, tmp_path, track):
    a = _ready(library, track, "j1", tmp_path)
    playlist = _create(name="قدیمی", jobIds=[a])

    renamed = asyncio.run(main.patch_playlist(playlist.id, PlaylistUpdate(name="تازه")))

    assert renamed.name == "تازه"
    assert renamed.trackCount == 1


def test_reorder(library, tmp_path, track):
    a = _ready(library, track, "j1", tmp_path)
    b = _ready(library, track, "j2", tmp_path)
    playlist = _create(name="x", jobIds=[a, b])

    asyncio.run(main.reorder_playlist(playlist.id, PlaylistItemsRequest(jobIds=[b, a])))

    assert [i.jobId for i in asyncio.run(main.get_playlist(playlist.id)).items] == [b, a]


def test_deleting_a_playlist_leaves_the_files_alone(library, tmp_path, track):
    a = _ready(library, track, "j1", tmp_path)
    playlist = _create(name="x", jobIds=[a])

    asyncio.run(main.remove_playlist(playlist.id))

    assert asyncio.run(main.list_playlists()) == []
    assert asyncio.run(main.library()).total == 1
