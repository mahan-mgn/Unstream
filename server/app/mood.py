"""
تشخیص حس‌وحالِ صوتی — والانس (غمگین↔شاد) و انرژی (آرام↔پرشور) — اختیاری.

مدلِ آموزش‌دیده‌ای در کار نیست؛ چیزی برای آموزشش نداریم. به‌جایش دو سیگنالِ
شناخته‌شده در روان‌شناسیِ موسیقی ترکیب می‌شوند: مُدِ ماژور/مینور (کروما در برابر
پروفایل‌های Krumhansl-Kessler — ماژور معمولاً «شادتر» شنیده می‌شود) و تمپو،
به‌علاوه‌ی روشنیِ طیفی برای والانس؛ انرژیِ RMS و تمپو برای انرژی.

عددها کالیبره‌ی مطلق نیستند — یعنی «۰.۷» به معنای «۷۰٪ شادی» نیست. فقط باید
برای مقایسه‌ی نسبیِ ترک‌ها با هم سازگار باشند، چون تنها مصرف‌کننده‌شان شافلِ
فرانت‌اند است که فاصله‌ی دو ترک را می‌سنجد، نه عددشان را نمایش می‌دهد.

بی‌صدا از کار می‌افتد: بدون librosa یا با فایلِ خراب، None برمی‌گردد و دانلود
دست‌نخورده می‌ماند — درست مثل verify.check. ظرف‌هایی که libsndfile نمی‌شناسد
(مثل m4a — خروجیِ استانداردِ کیفیتِ «اورجینال») با دیکدِ ffmpeg به WAV باز
می‌شوند، پس هیچ فرمتی که این برنامه تولید می‌کند بی‌تحلیل نمی‌ماند.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np

from .config import FFMPEG_BIN

# همبستگیِ هرکدام از دوازده گامِ رنگی با «حسِ ماژور» یا «حسِ مینور» —
# پروفایل‌های استانداردِ Krumhansl-Kessler برای تشخیصِ مُد بدون دیتاستِ آموزشی
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)

_SR = 22050
_MAX_SECONDS = 90.0
_OFFSET_SECONDS = 15.0  # رد کردنِ سکوت/اینتروی بی‌معنا برای حس‌وحال


def available() -> bool:
    try:
        import librosa  # noqa: F401
    except ImportError:
        return False
    return True


def _key_mode(chroma: np.ndarray) -> float:
    """+۱ برای ماژورِ خالص، -۱ برای مینورِ خالص، نزدیکِ صفر یعنی مبهم."""
    profile = chroma.mean(axis=1)
    best_major = max(float(np.corrcoef(np.roll(_MAJOR_PROFILE, i), profile)[0, 1]) for i in range(12))
    best_minor = max(float(np.corrcoef(np.roll(_MINOR_PROFILE, i), profile)[0, 1]) for i in range(12))
    return float(np.tanh(best_major - best_minor))


def _decode_wav(path: Path) -> Path | None:
    """
    دیکدِ صدا به WAVِ موقت برای ظرف‌هایی که کتابخانه‌های خواندنِ پایتون
    نمی‌شناسند — مشخصاً m4a/AAC، خروجیِ استانداردِ دانلودِ «اورجینال».

    فقط `_OFFSET_SECONDS + _MAX_SECONDS` ثانیه‌ی اول دیکد می‌شود؛ دیکدِ کلِ یک
    ترکِ پنج‌دقیقه‌ای چند برابر کندتر است و تحلیل به بیشتر از این پنجره نیاز
    ندارد. هیچ‌وقت استثنا بالا نمی‌آید: نبودنِ ffmpeg یا فایلِ خراب یعنی None،
    همان قراردادِ بی‌صدای بقیه‌ی ماژول.
    """
    try:
        handle, name = tempfile.mkstemp(suffix=".wav")
        os.close(handle)
        proc = subprocess.run(
            [
                FFMPEG_BIN,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-t",
                str(_OFFSET_SECONDS + _MAX_SECONDS),
                "-i",
                str(path),
                "-map",
                "a:0",
                "-ac",
                "1",
                "-ar",
                str(_SR),
                "-c:a",
                "pcm_s16le",
                "-y",
                name,
            ],
            capture_output=True,
            timeout=120,
            check=False,  # returncode را پایین‌تر خودمان چک می‌کنیم
        )
        if proc.returncode == 0 and Path(name).stat().st_size > 44:
            return Path(name)
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def _read(librosa, path: Path):
    """
    از بعدِ OFFSET_SECONDS می‌خواند تا سکوت/اینترو حساب نیاید؛ ترکِ کوتاه‌تر از
    آن (که لیبراپسند نیست و استثنا می‌دهد، نه آرایه‌ی خالی) را از همان اول
    می‌خواند.
    """
    try:
        y, sr = librosa.load(
            str(path), sr=_SR, mono=True, offset=_OFFSET_SECONDS, duration=_MAX_SECONDS
        )
        if y.size:
            return y, sr
    except Exception:  # noqa: BLE001, S110 — ظرف/فایلِ مشکل‌دار نباید تحلیل را ببندد
        pass
    try:
        y, sr = librosa.load(str(path), sr=_SR, mono=True, duration=_MAX_SECONDS)
        return (y, sr) if y.size else None
    except Exception:  # noqa: BLE001 — آخرین راه، خواندن از خودِ فایل است
        return None


def _load(librosa, path: Path):
    """
    اول مستقیم، و اگر ظرف را نشناخت (libsndfile کانتینرهای mp4/m4a را نمی‌فهمد)
    یک بار با ffmpeg به WAV دیکد می‌شود و همان مسیرِ خواندن تکرار می‌شود.
    """
    if (result := _read(librosa, path)) is not None:
        return result

    wav = _decode_wav(path)
    if wav is None:
        return None
    try:
        return _read(librosa, wav)
    finally:
        # فایلِ موقت همیشه می‌رود، حتی اگر خودِ تحلیل وسطش استثنا بدهد
        wav.unlink(missing_ok=True)


def analyze(path: Path) -> tuple[float, float] | None:
    """
    (والانس، انرژی) هرکدام در [0, 1]، یا None اگر librosa نصب نباشد یا فایل
    قابل‌خواندن نباشد. بلاک‌کننده است — باید در thread صدا زده شود.
    """
    try:
        import librosa
    except ImportError:
        return None

    try:
        loaded = _load(librosa, path)
        if loaded is None:
            return None
        y, sr = loaded
        if y.size == 0:
            return None

        tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.asarray(tempo).reshape(-1)[0])

        chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
        mode = _key_mode(chroma)

        rms = float(librosa.feature.rms(y=y).mean())
        centroid = float(librosa.feature.spectral_centroid(y=y, sr=sr).mean())

        # تمپوی معمولِ پاپ/راک بینِ ۶۰ تا ۱۸۰ است؛ بیرونِ این بازه کلیپ می‌شود
        tempo_n = float(np.clip((tempo - 60) / 120, 0, 1))
        # سنتروییدِ طیفی خامْ هرتز است؛ ۵۰۰ تا ۴۰۰۰ هرتز بازه‌ی معقولِ «روشنیِ» صداست
        centroid_n = float(np.clip((centroid - 500) / 3500, 0, 1))
        energy_n = float(np.clip(rms / 0.3, 0, 1))

        valence = 0.5 + 0.35 * mode + 0.15 * (tempo_n - 0.5) + 0.1 * (centroid_n - 0.5)
        energy = 0.6 * energy_n + 0.4 * tempo_n

        return float(np.clip(valence, 0, 1)), float(np.clip(energy, 0, 1))
    except Exception:  # noqa: BLE001 — قراردادِ بی‌صدا: هیچ خطایی نباید بالا بیاید
        return None
