"""
تحلیل حس‌وحالِ صوتی — اختیاری و بی‌صدا، پس تست‌ها هم باید همین دو رفتار را
تضمین کنند: با صدای واقعی عددی در بازه‌ی درست می‌دهد، و با هرچیزِ دیگری None.
"""

from __future__ import annotations

import shutil
import subprocess

import numpy as np
import pytest

from app import mood

pytest.importorskip("librosa")
sf = pytest.importorskip("soundfile")

SR = 22050

# مسیرِ واقعیِ ffmpeg — قبل از هر monkeypatch گرفته می‌شود تا فیکسچرسازی همیشه
# با نسخه‌ی واقعی کار کند حتی وقتی تستی خودِ `mood.FFMPEG_BIN` را عوض می‌کند
_FFMPEG = shutil.which(mood.FFMPEG_BIN)
requires_ffmpeg = pytest.mark.skipif(
    _FFMPEG is None, reason="ffmpeg لازم است — مسیرِ جایگزینِ تست بدون آن معنی ندارد"
)


def _write_tone(path, seconds=20.0, freq=440.0, sr=SR):
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    y = 0.3 * np.sin(2 * np.pi * freq * t)
    sf.write(str(path), y, sr)
    return path


def _write_m4a(path, seconds=20.0, freq=440.0, sr=SR):
    """
    فیکسچرِ m4a — همان تنِ ویو که با ffmpeg به AAC تبدیل شده.

    لازم است چون نقطه‌ی شکستِ اصلی همین بود: کیفیتِ «اورجینال» همیشه m4a
    تولید می‌کند و libsndfile آن ظرف را نمی‌خواند، پس تحلیلِ هر دانلودِ
    اورجینالی بی‌صدا حذف می‌شد. این تست آن قرارداد را می‌بندد.
    """
    wav = path.with_suffix(".wav")
    _write_tone(wav, seconds=seconds, freq=freq, sr=sr)
    proc = subprocess.run(
        [_FFMPEG, "-y", "-v", "error", "-i", str(wav), "-vn", "-c:a", "aac", str(path)],
        capture_output=True,
        check=False,
    )
    wav.unlink(missing_ok=True)
    if proc.returncode != 0 or not path.exists():
        pytest.skip("ffmpeg نتوانست فیکسچر m4a بسازد")
    return path


def test_available_is_true_once_librosa_is_installed():
    assert mood.available() is True


def test_analyze_returns_valence_and_energy_in_range(tmp_path):
    audio = _write_tone(tmp_path / "tone.wav")
    result = mood.analyze(audio)

    assert result is not None
    valence, energy = result
    assert 0.0 <= valence <= 1.0
    assert 0.0 <= energy <= 1.0


def test_analyze_falls_back_to_the_start_for_short_tracks(tmp_path):
    """کوتاه‌تر از OFFSET_SECONDS — نباید آرایه‌ی خالی بگیرد و None بدهد."""
    audio = _write_tone(tmp_path / "short.wav", seconds=3.0)
    assert mood.analyze(audio) is not None


def test_analyze_returns_none_for_a_missing_file(tmp_path):
    assert mood.analyze(tmp_path / "nope.wav") is None


def test_analyze_returns_none_for_a_corrupt_file(tmp_path):
    bogus = tmp_path / "bogus.mp3"
    bogus.write_bytes(b"not actually audio")
    assert mood.analyze(bogus) is None


def test_analyze_returns_none_when_librosa_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(mood, "available", lambda: False)
    audio = _write_tone(tmp_path / "tone.wav")

    import builtins

    real_import = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name == "librosa":
            raise ImportError("blocked for test")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", blocked)
    assert mood.analyze(audio) is None


class TestM4aFallback:
    """
    ظرف‌هایی که کتابخانه‌های پایتون نمی‌خوانند (m4a/AAC) باید با دیکدِ ffmpeg
    تحلیل شوند — وگرنه هر دانلودِ «اورجینالی» بی‌صدا از شافلِ هوشمند می‌افتد.
    """

    @requires_ffmpeg
    def test_analyze_reads_m4a_via_ffmpeg(self, tmp_path):
        audio = _write_m4a(tmp_path / "tone.m4a")

        result = mood.analyze(audio)

        assert result is not None
        valence, energy = result
        assert 0.0 <= valence <= 1.0
        assert 0.0 <= energy <= 1.0

    @requires_ffmpeg
    def test_direct_path_is_used_for_readable_files(self, tmp_path, monkeypatch):
        """فایلِ ویو نباید اصلاً سراغِ دیکدِ برود — مسیرِ مستقیمِ قبلی است."""
        audio = _write_tone(tmp_path / "tone.wav")

        def fail(*args, **kwargs):
            raise AssertionError("_decode_wav برای فایلِ خوانا صدا زده نشود")

        monkeypatch.setattr(mood, "_decode_wav", fail)
        assert mood.analyze(audio) is not None

    @requires_ffmpeg
    def test_temp_wav_is_cleaned_up(self, tmp_path):
        """فایلِ موقتِ دیکد نباید بعد از تحلیل روی دیسک بماند."""
        audio = _write_m4a(tmp_path / "tone.m4a")
        before = {p.name for p in tmp_path.iterdir()}

        mood.analyze(audio)

        assert {p.name for p in tmp_path.iterdir()} == before

    def test_missing_ffmpeg_stays_silent(self, tmp_path, monkeypatch):
        """نبودنِ نباید به‌جای استثنا، همان None همیشگی بدهد."""

        def explode(*args, **kwargs):
            raise FileNotFoundError("ffmpeg not installed")

        monkeypatch.setattr(mood.subprocess, "run", explode)
        assert mood.analyze(tmp_path / "nope.m4a") is None

    @requires_ffmpeg
    def test_corrupt_m4a_stays_silent(self, tmp_path):
        bogus = tmp_path / "bogus.m4a"
        bogus.write_bytes(b"not actually audio")
        assert mood.analyze(bogus) is None
