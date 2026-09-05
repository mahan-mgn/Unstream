"""
تست‌های artblur — بلورِ سمتِ سرور برای یکدستیِ هیرو بین مرورگرها.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app import artblur, artcache, db

# یک PNG تک‌رنگِ ۱×۱ معتبر — ورودیِ حداقلی برای ffmpeg
_ONE_PIXEL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de"
    "0000000c49444154789c63f8cfc0000003010100c9fe92ef0000000049454e44ae426082"
)


@pytest.fixture
def stored_cover(fresh_db, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    """یک کاورِ ذخیره‌شده در آینه (فایل + ردیفِ گرفته‌شده)."""
    monkeypatch.setattr(artcache, "CACHE_DIR", tmp_path / "artwork")
    sha = "0123456789abcdefghij"
    db.remember_artwork([(sha, "https://cdn.example/x.jpg")], now=1.0)
    db.artwork_stored(sha, "image/png", len(_ONE_PIXEL_PNG), now=2.0)
    src = artcache.path_for(sha)
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_bytes(_ONE_PIXEL_PNG)
    return sha


def test_blur_path_sits_beside_cover() -> None:
    p = artcache.path_for("0123456789abcdefghij")
    b = artblur.blur_path("0123456789abcdefghij")
    assert b.parent == p.parent
    assert b.name == "0123456789abcdefghij-blur.jpg"


def test_build_makes_a_jpeg_beside_the_cover(stored_cover: str) -> None:
    out = artblur.build(stored_cover)
    assert out is not None and out.exists()
    assert out.name == f"{stored_cover}{artblur.CACHE_SUFFIX}"
    # JPEG با magic استاندارد شروع می‌شود
    assert out.read_bytes()[:2] == b"\xff\xd8"


def test_build_twice_is_cheap_and_stable(stored_cover: str) -> None:
    first = artblur.build(stored_cover)
    again = artblur.build(stored_cover)
    assert first == again
    assert again is not None and again.read_bytes()[:2] == b"\xff\xd8"


def test_build_returns_none_for_unstored_sha(fresh_db) -> None:
    assert artblur.build("ffffffffffffffffffff") is None
