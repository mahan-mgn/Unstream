"""
برشِ خودکارِ حاشیه‌ی یک‌رنگِ کاورها.

اسکنِ J-card اپل (و بعضی آلبوم‌های بازنشر) کاور را با دو نوارِ عمودیِ سفید/
زردِ یک‌رنگِ پیلارباکس می‌آورد؛ همان تصویرِ خام تا ابد در آینه می‌ماند و هر
جای اپ — کارت، هیرو، امبدِ فایل — دو نوارِ مرده کنارِ جلد دارد.

تشخیص: تصویر با ffmpeg به RGB خام دیکد می‌شود (ffmpeg پیش‌نیازِ خودِ اپ است،
وابستگیِ تازه نیست) و هر سطر/ستونی که انحرافِ معیارِ ناچیزی دارد «حاشیه»
شمرده می‌شود. جعبه‌ی محتوا همان چیزی است که بعد از خوردنِ حاشیه‌ها می‌ماند؛
اگر حاشیه‌ای نبود، بایت‌ها دست‌نخورده برمی‌گردند و هیچ هزینه‌ای جز یک دیکد
نمی‌شود. برش نهایی مربعِ مرکزیِ جعبه است چون همه‌جای اپ کاورِ مربع نمایش
داده می‌شود و فایلِ امبدشده هم باید مربع بماند.
"""

from __future__ import annotations

import statistics
import subprocess

from .config import FFMPEG_BIN

# سطر/ستونی با مجموعِ انحرافِ سه کانالِ کمتر از این، «یک‌رنگ» است.
# ۹ خیلی محافظه‌کارانه است: دانه‌ی فیلمِ ملایم هنوز رد می‌شود، نوارِ واقعی نه.
_UNIFORM_SD_SUM = 9.0

# نوارِ واقعیِ اسکنِ J-card روشن است (سفید/زرد — میدینِ درخشندگی بالای ۱۲۸).
# پس‌زمینه‌ی تیره بخشی از خودِ آرت‌ورک است — قلبِ نئونِ KAASH روی سیاه — و
# بریدنش یعنی زومِ بی‌جا: کاوری که روی پلتفرم با حاشیه‌ی سیاه دیده می‌شود،
# اینجا پرشده و کاورِ دیگری به نظر می‌رسد. نوارِ کاندیدِ برش باید روشن باشد.
_BRIGHT_LUMA = 128.0

# حاشیه‌ی به‌این‌کوچکی سر و کاری باهاش ندارد؛ برشِشان جز بازرمپ‌کردنِ JPEG چیزی
# نمی‌دهد. (نسبت به ابعادِ تصویر، نه مطلق — با تصویرِ ۵۰ پیکسلی هم کار می‌کند.)
_MIN_BORDER = 0.04

_FFMPEG = FFMPEG_BIN
_FFPROBE = str(__import__("pathlib").Path(FFMPEG_BIN).with_name("ffprobe.exe"))


def _decode_rgb(data: bytes) -> tuple[bytes, int, int]:
    """JPEG/PNG → (rgb24 خام، عرض، ارتفاع) با ffmpeg روی pipe."""
    proc = subprocess.run(
        [
            _FFMPEG, "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
        ],
        input=data, capture_output=True, timeout=30, check=False,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise ValueError("ffmpeg تصویر را دیکد نکرد")
    # عرض و ارتفاع از اندازه‌ی خروجی نمی‌آید؛ از ffprobe بگیر
    probe = subprocess.run(
        [
            _FFPROBE, "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0", "pipe:0",
        ],
        input=data, capture_output=True, timeout=30, check=False,
    )
    w_s, _, h_s = probe.stdout.decode("ascii").strip().partition(",")
    return proc.stdout, int(w_s), int(h_s)


def _sd_sum(samples: bytes) -> float:
    if not samples:
        return 0.0
    return (
        statistics.pstdev(samples[0::3])
        + statistics.pstdev(samples[1::3])
        + statistics.pstdev(samples[2::3])
    )


def _mean_luma(samples: bytes) -> float:
    """میانگینِ درخشندگیِ تقریبیِ یک سطر/ستون (0..255) — میانگینِ همه‌ی بایت‌ها."""
    if not samples:
        return 0.0
    return sum(samples) / len(samples)


def content_box(rgb: bytes, w: int, h: int) -> tuple[int, int, int, int] | None:
    """
    (x، y، عرض، ارتفاع)ِ ناحیه‌ی غیرِ حاشیه؛ None یعنی حاشیه‌ای در کار نیست.

    هر لبه: اولین سطر/ستونِ پرمحتوا پیدا می‌شود؛ برشِ آن لبه فقط وقتی قبول
    است که نوارِ حاشیه‌ایِ پیدا شده دست‌کم _MIN_BORDER از بُعد را خورده
    باشد — چرت‌وپرتِ چند پیکسلیِ لبه نباید کاور را کراپ کند. اگر هیچ لبه‌ای
    برش نخورد، None.

    نوارِ کاندید باید روشن هم باشد: اسکنِ J-card نوارِ سفید/زرد دارد، ولی
    پس‌زمینه‌ی تیره (سیاهِ قلبِ نئون، شبِ جلدِ فیلم) بخشِ خودِ آرت‌ورک است و
    بریدنش کاور را به نسخه‌ی زوم‌شده تبدیل می‌کند — همان چیزی که روی
    پلتفرم نمی‌بینید.
    """
    stride = w * 3
    min_b = max(2, int(min(w, h) * _MIN_BORDER))

    def first_busy(total: int, sample: callable[[int], bytes]) -> int:
        i = 0
        while i < total // 2:
            samples = sample(i)
            if _sd_sum(samples) >= _UNIFORM_SD_SUM or _mean_luma(samples) < _BRIGHT_LUMA:
                break
            i += 1
        return i

    left = first_busy(w, lambda x: rgb[x * 3::stride])
    right = w - 1 - first_busy(w, lambda x: rgb[(w - 1 - x) * 3::stride])
    top = first_busy(h, lambda y: rgb[y * stride:(y + 1) * stride])
    bottom = h - 1 - first_busy(h, lambda y: rgb[(h - 1 - y) * stride:(h) * stride])

    cropped = (
        left >= min_b or (w - 1 - right) >= min_b
        or top >= min_b or (h - 1 - bottom) >= min_b
    )
    # تصویرِ تمام‌یک‌رنگ اسکن را تا نصفه خورده و جعبه‌ای نصفِ بُعد باقی
    # نگذاشته — چیزی برای نگه‌داشتن نیست، برشِ بی‌معناست.
    if not cropped or (right - left + 1) < min_b * 2 or (bottom - top + 1) < min_b * 2:
        return None
    return left, top, right - left + 1, bottom - top + 1


def crop_bars(data: bytes) -> bytes:
    """
    بایت‌های تصویر را می‌گیرد و اگر حاشیه‌ی یک‌رنگِ معناداری داشت، جعبه‌ی
    محتوا را برمی‌گرداند (نه مربعِ مرکزی — مربعِ وسطِ اسکنِ J-card متنِ
    عنوان را می‌بُرد؛ جعبه‌ی کامل همه‌چیز را نگه می‌دارد و همه‌جای اپ کاور
    با object-cover نمایش داده می‌شود، پس نسبتِ غیرِ مربع مشکلی ندارد).
    هر خطایی یعنی «همان ورودی را بده» — کاورِ شکسته از کاورِ ازدست‌رفته بهتر است.
    """
    try:
        rgb, w, h = _decode_rgb(data)
        box = content_box(rgb, w, h)
        if box is None:
            return data
        x, y, bw, bh = box
        proc = subprocess.run(
            [
                _FFMPEG, "-hide_banner", "-loglevel", "error",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{w}x{h}", "-i", "pipe:0",
                "-vf", f"crop={bw}:{bh}:{x}:{y}",
                "-q:v", "2", "-y", "-f", "image2", "-c:v", "mjpeg", "pipe:1",
            ],
            input=rgb, capture_output=True, timeout=30, check=False,
        )
        if proc.returncode != 0 or not proc.stdout:
            return data
        return proc.stdout
    except Exception:  # noqa: BLE001 — کاورِ شکسته از کاورِ ازدست‌رفته بهتر است
        return data
