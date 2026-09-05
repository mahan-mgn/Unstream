"""
کاورِ فایل، از داخلِ خودِ فایل.

تلگرام کاورِ ردیفِ آهنگ را از `thumbnail`ای می‌گیرد که موقعِ ارسال به آن داده
می‌شود، نه از تگِ داخلِ فایل — پس آهنگی که کاور دارد می‌تواند در لیست بی‌تصویر
بنشیند. تا پیش از این آن thumbnail هر بار دوباره از CDN گرفته می‌شد و همان
درخواست بود که گاهی تایم‌اوت می‌داد. حالا از کاورِ امبدشده ساخته می‌شود، که
هیچ شبکه‌ای نمی‌خواهد.
"""

from __future__ import annotations

import shutil
import subprocess

import pytest

from app import downloader
from app.config import FFMPEG_BIN
from app.downloader import _TAGGERS, embedded_cover, thumbnail

pytestmark = pytest.mark.skipif(
    shutil.which(FFMPEG_BIN) is None, reason="این تست‌ها به ffmpeg واقعی نیاز دارند"
)


def _jpeg(tmp_path, size: int = 900) -> bytes:
    """یک JPEG واقعی — کاورِ ساختگی که قرار است سالم برگردد."""
    out = tmp_path / "cover.jpg"
    subprocess.run(
        [FFMPEG_BIN, "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", f"testsrc=size={size}x{size}:duration=1:rate=1",
         "-frames:v", "1", str(out)],
        check=True,
    )
    return out.read_bytes()


def _silence(tmp_path, suffix: str):
    """یک فایل صوتیِ واقعیِ کوتاه در همان ظرف — mutagen ظرفِ ساختگی را نمی‌پذیرد."""
    out = tmp_path / f"track{suffix}"
    subprocess.run(
        [FFMPEG_BIN, "-y", "-loglevel", "error", "-f", "lavfi",
         "-i", "anullsrc=r=44100:cl=stereo", "-t", "1", str(out)],
        check=True,
    )
    return out


# هر چهار ظرفی که `_TAGGERS` می‌شناسد. opus و m4a عمداً هستند: کاور در آن‌ها
# نه APIC است نه بلوکِ FLAC، و هر کدام خواننده‌ی خودشان را لازم دارند.
CONTAINERS = [".mp3", ".flac", ".m4a", ".opus"]


class TestEmbeddedCover:
    """
    وارونه‌ی `_TAGGERS`. تقارنشان همان چیزی است که thumbnail به آن تکیه می‌کند —
    اگر خواننده‌ی یک ظرف کم باشد، فایل‌های آن فرمت بی‌صدا بی‌تصویر می‌مانند.
    """

    @pytest.mark.parametrize("suffix", CONTAINERS)
    def test_the_cover_that_was_written_is_the_cover_that_comes_back(
        self, suffix, tmp_path, track
    ):
        cover = _jpeg(tmp_path)
        path = _silence(tmp_path, suffix)

        _TAGGERS[suffix](path, track, (cover, "image/jpeg"), None)

        assert embedded_cover(path) == cover

    @pytest.mark.parametrize("suffix", CONTAINERS)
    def test_a_file_without_a_cover_says_so(self, suffix, tmp_path, track):
        path = _silence(tmp_path, suffix)

        _TAGGERS[suffix](path, track, None, None)

        assert embedded_cover(path) is None

    def test_an_unknown_container_is_not_guessed_at(self, tmp_path):
        path = tmp_path / "track.wav"
        path.write_bytes(b"not really audio")

        assert embedded_cover(path) is None

    def test_a_corrupt_file_does_not_blow_up(self, tmp_path):
        """کاور اختیاری است؛ فایلِ خراب نباید کلِ ارسال را زمین بزند."""
        path = tmp_path / "track.mp3"
        path.write_bytes(b"\x00" * 64)

        assert embedded_cover(path) is None


class TestThumbnail:
    def test_it_fits_inside_telegrams_limits(self, tmp_path, track):
        """
        سقفِ مستندشده‌ی تلگرام: JPEG، حداکثر ۳۲۰ پیکسل، زیر ۲۰۰ کیلوبایت.
        کاورِ امبدشده تقریباً همیشه از هر دو بزرگ‌تر است.
        """
        path = _silence(tmp_path, ".mp3")
        _TAGGERS[".mp3"](path, track, (_jpeg(tmp_path, 1400), "image/jpeg"), None)

        thumb = thumbnail(path)

        assert thumb is not None
        assert len(thumb) <= downloader.THUMB_MAX_BYTES
        assert thumb[:2] == b"\xff\xd8"  # SOI — واقعاً JPEG است
        probe = subprocess.run(
            [shutil.which("ffprobe") or "ffprobe", "-v", "error", "-select_streams", "v",
             "-show_entries", "stream=width,height", "-of", "csv=p=0", "-"],
            input=thumb, capture_output=True, check=True,
        )
        width, height = (int(v) for v in probe.stdout.decode().strip().split(","))
        assert max(width, height) <= downloader.THUMB_PX

    def test_the_file_is_preferred_over_the_network(self, tmp_path, track, monkeypatch):
        """کاورِ داخلِ فایل نه تایم‌اوت می‌دهد نه به پروکسی بند است."""
        def never(_url):
            raise AssertionError("وقتی فایل خودش کاور دارد نباید سراغِ CDN برود")

        monkeypatch.setattr(downloader, "_fetch_artwork", never)
        path = _silence(tmp_path, ".mp3")
        _TAGGERS[".mp3"](path, track, (_jpeg(tmp_path), "image/jpeg"), None)

        assert thumbnail(path, "https://example.com/cover.jpg") is not None

    def test_a_file_without_a_cover_falls_back_to_the_catalog(
        self, tmp_path, track, monkeypatch
    ):
        cover = _jpeg(tmp_path)
        monkeypatch.setattr(downloader, "_fetch_artwork", lambda url: (cover, "image/jpeg"))
        path = _silence(tmp_path, ".mp3")
        _TAGGERS[".mp3"](path, track, None, None)

        assert thumbnail(path, "https://example.com/cover.jpg") is not None

    def test_no_cover_anywhere_is_none_not_an_error(self, tmp_path, track, monkeypatch):
        monkeypatch.setattr(downloader, "_fetch_artwork", lambda url: None)
        path = _silence(tmp_path, ".mp3")
        _TAGGERS[".mp3"](path, track, None, None)

        assert thumbnail(path, None) is None
