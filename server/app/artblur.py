"""
نسخه‌ی بلورشده‌ی کاور برای پس‌زمینه‌ی هیرو.

چرا اصلاً سمتِ سرور؟ CSS blur روی هر موتورِ رندری خروجیِ کمی متفاوت می‌دهد —
گاوسِ-skia با گاوسِ-blink و مقیاسِ DPR جابه‌جا نمی‌نشیند و همان صفحه در کروم و
اج دو رنگِ متفاوت نشان می‌دهد. یک فایلِ از-قبل-بلورشده در همه‌ی مرورگرها
پیکسل‌به‌پیکسل یکی است. گرادیان‌ها و scrimهای رویش در CSS می‌مانند — آن‌ها
دقیق‌اند و به موتور بستگی ندارند.

خروجی در همان شاخه‌ی کاورها کنارِ خودِ کاور کش می‌شود: `<sha>-blur.jpg`.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from .config import FFMPEG_BIN
from .db import artwork_row

# بلورِ CSSای که جایگزینش شدیم: 64px روی تصویری که خودش 1.5 برابر کشیده شده.
# روی 1000 پیکسلِ خروجی همین ~30 پله boxblur است. boxblur دو پله پشتِ هم
# توزیعِ گاوسی‌مانندِ نرم‌تری می‌دهد و لبه‌های مربعیِ boxblur را می‌پوشاند.
_BLUR_RADIUS = "30"

# خروجی: عریضِ کافی برای هیروی تمام‌عرض، از هر کاوری صرفه‌جویی
_BLUR_WIDTH = 1000

CACHE_SUFFIX = "-blur.jpg"
MIME = "image/jpeg"


def blur_path(sha: str) -> Path:
    """مسیرِ فایلِ بلورشده — کنارِ خودِ کاور."""
    from .artcache import CACHE_DIR, path_for

    return path_for(sha).with_name(f"{sha}{CACHE_SUFFIX}")


def build(sha: str) -> Path | None:
    """
    از کاورِ آینه‌شده نسخه‌ی بلور می‌سازد. کاورِ نبوده → None.

    همگام و بلاک‌کننده است؛ مسیرِ درخواست آن را در thread صدا می‌زند
    (همان الگوی `artcache.fetch`).
    """
    row = artwork_row(sha)
    if row is None or row["fetched_at"] is None:
        return None
    from .artcache import path_for

    src = path_for(sha)
    if not src.exists():
        return None

    out = blur_path(sha)
    # پسوندِ .part فرمتِ خروجی را از ffmpeg می‌پوشاند — صریح jpeg می‌گوییم
    tmp = out.with_suffix(".part.jpg")
    # saturate/brightness همان اعدادِ کلاسِ قبلی‌اند (saturate-[1.35] brightness-110)
    # boxblur دو پله‌ای: توزیعِ گاوسی‌مانند، بدونِ مربع‌شدنِ لبه‌ها
    cmd = [
        FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src),
        "-vf",
        (
            f"scale={_BLUR_WIDTH}:-2,"
            f"boxblur={_BLUR_RADIUS}:1,eq=saturation=1.35:brightness=0.10,"
            f"boxblur={_BLUR_RADIUS}:1"
        ),
        "-q:v", "4",
        str(tmp),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=30)
        if res.returncode != 0 or not tmp.exists():
            return None
        tmp.replace(out)
        return out
    except Exception:
        tmp.unlink(missing_ok=True)
        return None
