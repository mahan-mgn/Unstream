"""
نرمال‌سازی بلندی — از عددِ خامِ ffmpeg تا تقویتی که پخش‌کننده اعمال می‌کند.

خودِ اندازه‌گیری به ffmpeg و یک فایل واقعی نیاز دارد؛ چیزی که اینجا تست می‌شود
پارس‌کردنِ خروجی و منطقِ سقف‌هاست — همان دو جایی که اشتباه می‌تواند به صدای
کلیپ‌شده یا ترکِ بی‌صدا ختم شود.
"""

from __future__ import annotations

from app import loudness

# نمونه‌ی واقعیِ خلاصه‌ی فیلترِ ebur128 روی stderr
SUMMARY = """
[Parsed_ebur128_0 @ 000001] Summary:

  Integrated loudness:
    I:          -9.3 LUFS
    Threshold: -19.6 LUFS

  Loudness range:
    LRA:         5.2 LU

  True peak:
    Peak:       -0.7 dBFS
"""


def test_parses_last_match(monkeypatch, tmp_path):
    """
    ffmpeg در طولِ کار هم خطوطِ لحظه‌ای با همین الگو چاپ می‌کند؛ فقط خلاصه‌ی
    آخر معتبر است.
    """

    class Proc:
        stderr = "  I:  -70.0 LUFS\n" + SUMMARY

    monkeypatch.setattr(loudness.subprocess, "run", lambda *a, **k: Proc())
    assert loudness.analyze(tmp_path / "x.mp3") == (-9.3, -0.7)


def test_silent_file_has_nothing_to_normalize(monkeypatch, tmp_path):
    class Proc:
        stderr = "  I:  -91.0 LUFS\n  Peak: -inf dBFS\n"

    monkeypatch.setattr(loudness.subprocess, "run", lambda *a, **k: Proc())
    assert loudness.analyze(tmp_path / "x.mp3") is None


def test_missing_ffmpeg_is_silent(monkeypatch, tmp_path):
    def boom(*a, **k):
        raise FileNotFoundError

    monkeypatch.setattr(loudness.subprocess, "run", boom)
    assert loudness.analyze(tmp_path / "x.mp3") is None


def test_loud_track_is_turned_down():
    # ۹.۳- تا هدفِ ۱۴- یعنی ۴.۷ دسی‌بل پایین‌تر
    assert loudness.gain_db(-9.3, -0.7) == -4.7


def test_quiet_track_is_capped_by_peak_headroom():
    """
    ترکی که خودش تا لبه‌ی صفر رفته را نمی‌شود تقویت کرد — هرچقدر هم آرام
    شنیده شود، بالا بردنش یعنی کلیپ.
    """
    assert loudness.gain_db(-20.0, -0.2) == -0.8


def test_quiet_track_with_headroom_is_boosted():
    assert loudness.gain_db(-20.0, -12.0) == 6.0


def test_boost_never_exceeds_the_cap():
    """ترکِ خیلی آرام با هدرومِ فراوان هم نباید نویزش را بیست برابر کند."""
    assert loudness.gain_db(-45.0, -40.0) == loudness.MAX_GAIN_DB


def test_unmeasured_file_gets_no_gain():
    assert loudness.gain_db(None, None) == 0.0
