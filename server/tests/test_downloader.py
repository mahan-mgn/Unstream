"""نام‌گذاری فایل، انتخاب فرمت و نوشتن متن آهنگ."""

from __future__ import annotations

import pytest

from app.downloader import BITRATE, CODEC_BITRATE, EXT, _ydl_opts, safe_name, write_lrc
from app.providers.lrclib import Lyrics


class TestSafeName:
    @pytest.mark.parametrize("char", list('\\/:*?"<>|'))
    def test_windows_forbidden_characters_are_replaced(self, char):
        assert char not in safe_name(f"a{char}b")

    def test_persian_is_untouched(self):
        assert safe_name("فرهاد مهراد - مرد تنها") == "فرهاد مهراد - مرد تنها"

    def test_length_is_capped(self):
        assert len(safe_name("x" * 500)) == 120

    def test_trailing_dot_is_stripped(self):
        # ویندوز فایلی که به نقطه ختم شود را نمی‌پذیرد
        assert not safe_name("album.").endswith(".")

    def test_empty_falls_back(self):
        assert safe_name("   ") == "track"


class TestQualityOptions:
    def test_every_quality_has_an_extension(self):
        for quality in (*BITRATE, *CODEC_BITRATE):
            assert quality in EXT

    def test_mp3_bitrate_reaches_the_postprocessor(self, tmp_path):
        opts = _ydl_opts(tmp_path / "x", "192", lambda _: None)
        step = opts["postprocessors"][0]
        assert step["preferredcodec"] == "mp3"
        assert step["preferredquality"] == "192"

    def test_flac_does_not_carry_a_bitrate(self, tmp_path):
        """بیت‌ریت روی کدک بی‌اتلاف بی‌معنی است و ffmpeg هم قبولش نمی‌کند."""
        step = _ydl_opts(tmp_path / "x", "flac", lambda _: None)["postprocessors"][0]
        assert step["preferredcodec"] == "flac"
        assert "preferredquality" not in step

    def test_m4a_prefers_a_source_it_can_copy(self, tmp_path):
        opts = _ydl_opts(tmp_path / "x", "m4a", lambda _: None)
        assert "ext=m4a" in opts["format"]

    def test_original_does_not_transcode(self, tmp_path):
        assert _ydl_opts(tmp_path / "x", "original", lambda _: None)["postprocessors"] == []

    def test_progress_hook_is_normalized_to_percent(self, tmp_path):
        seen: list[float] = []
        opts = _ydl_opts(tmp_path / "x", "320", seen.append)
        hook = opts["progress_hooks"][0]

        hook({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 200})
        hook({"status": "finished"})  # باید نادیده برود
        hook({"status": "downloading", "downloaded_bytes": 200, "total_bytes": 200})

        # سقف ۹۹ است: ۱۰۰٪ مال وقتی است که تگ‌گذاری هم تمام شده باشد
        assert seen == [25.0, 99.0]


class TestLyrics:
    def test_lrc_lands_next_to_the_audio(self, tmp_path):
        audio = tmp_path / "Farhad - Barf.mp3"
        audio.write_bytes(b"")
        path = write_lrc(audio, Lyrics(plain="x", synced="[00:01.00]x"))
        # هم‌نامی با فایل صوتی همان چیزی است که پلیرها دنبالش می‌گردند
        assert path == tmp_path / "Farhad - Barf.lrc"
        assert path.read_text(encoding="utf-8") == "[00:01.00]x"

    def test_plain_only_writes_nothing(self, tmp_path):
        audio = tmp_path / "a.mp3"
        audio.write_bytes(b"")
        assert write_lrc(audio, Lyrics(plain="just text", synced=None)) is None

    def test_no_lyrics_writes_nothing(self, tmp_path):
        assert write_lrc(tmp_path / "a.mp3", None) is None

    def test_empty_lyrics_is_falsy(self):
        assert not Lyrics(plain=None, synced=None)
        assert Lyrics(plain="x", synced=None)
