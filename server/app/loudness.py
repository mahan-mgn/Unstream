"""
اندازه‌گیری بلندیِ ادراکی (EBU R128) — اختیاری.

هر ترک با بلندیِ متفاوتی مسترینگ شده و منابعِ ما هم یکسان نیستند: همان آهنگ از
یوتیوب و از ساندکلاد چند دسی‌بل با هم فرق دارد. نتیجه‌اش این است که در یک صف،
هر چند ترک یک‌بار باید دستی صدا را کم و زیاد کرد.

راه‌حل استاندارد (ReplayGain، و امروز R128) این است: بلندیِ *ادراکی* هر فایل یک
بار اندازه گرفته و ذخیره شود، و پخش‌کننده موقع پخش همان‌قدر تقویت/تضعیف کند تا
همه به یک هدف برسند. خودِ فایل دست‌نخورده می‌ماند — نه ترنسکد دوباره، نه از دست
رفتنِ دینامیک.

بی‌صدا از کار می‌افتد: بدون ffmpeg یا با فایلِ خراب، None برمی‌گردد و پخش‌کننده
به رفتار قبلی (بدون تنظیم) برمی‌گردد — درست مثل mood.analyze.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .config import FFMPEG_BIN, LOUDNESS_TARGET

# خروجیِ خلاصه‌ی فیلترِ ebur128 روی stderr می‌آید:
#   Integrated loudness:
#     I:         -8.4 LUFS
#   True peak:
#     Peak:      +0.3 dBFS
_INTEGRATED = re.compile(r"I:\s*(-?\d+(?:\.\d+)?)\s*LUFS")
_PEAK = re.compile(r"Peak:\s*([+-]?\d+(?:\.\d+)?)\s*dBFS")

# سقفِ تقویت. ترکِ خیلی آرام (مثلاً ضبطِ زنده‌ی قدیمی) با ۲۰ دسی‌بل تقویت،
# نویزِ زمینه‌اش هم بیست برابر می‌شود؛ بهتر است کمی آرام بماند تا خش‌دار شود.
MAX_GAIN_DB = 12.0
# فاصله‌ی امنِ اوجِ خروجی تا کلیپ‌شدن
HEADROOM_DB = 1.0


def analyze(path: Path) -> tuple[float, float] | None:
    """
    (بلندیِ یکپارچه به LUFS، اوجِ واقعی به dBFS) یا None.

    بلاک‌کننده است — باید در thread صدا زده شود. کلِ فایل خوانده می‌شود ولی
    دیکد بدون خروجی است (`-f null`)، پس چند برابر سریع‌تر از پخشِ واقعی است.
    """
    try:
        proc = subprocess.run(
            [
                FFMPEG_BIN,
                "-nostdin",
                "-hide_banner",
                "-i",
                str(path),
                "-map",
                "a:0",
                "-af",
                "ebur128=peak=true",
                "-f",
                "null",
                "-",
            ],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
        )
    except Exception:
        return None

    # خلاصه در انتهای stderr می‌آید؛ در طول کار هم خطوطِ لحظه‌ای چاپ می‌شود که
    # همین الگوها را دارند — پس آخرین تطبیق ملاک است، نه اولی.
    integrated = _INTEGRATED.findall(proc.stderr or "")
    peaks = _PEAK.findall(proc.stderr or "")
    if not integrated:
        return None

    loudness = float(integrated[-1])
    # ترکِ کاملاً ساکت -inf می‌دهد که float("-inf") نمی‌شود ولی عددِ خیلی کوچک
    # می‌شود؛ چنین فایلی چیزی برای نرمال‌کردن ندارد
    if loudness < -70:
        return None
    peak = float(peaks[-1]) if peaks else 0.0
    return loudness, peak


def gain_db(loudness: float | None, peak: float | None, target: float = LOUDNESS_TARGET) -> float:
    """
    چند دسی‌بل باید کم/زیاد شود تا این فایل به هدف برسد.

    دو سقف دارد: تقویتِ بیش از MAX_GAIN_DB (که فقط نویز را بالا می‌آورد) و
    تقویتی که اوجِ فایل را از HEADROOM_DB بالاتر ببرد — دومی مهم‌تر است، چون
    کلیپ‌شدن شنیده می‌شود و کم‌صدا بودن فقط اذیت‌کننده است.
    """
    if loudness is None:
        return 0.0
    gain = target - loudness
    gain = min(gain, MAX_GAIN_DB)
    if peak is not None:
        gain = min(gain, -HEADROOM_DB - peak)
    return round(max(gain, -MAX_GAIN_DB), 2)
