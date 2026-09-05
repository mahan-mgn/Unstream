"""برشِ حاشیه‌ی یک‌رنگِ کاور: تشخیصِ جعبه‌ی محتوا و پاس‌دادنِ بی‌حاشیه‌ها."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app import artborder

FFMPEG = artborder._FFMPEG


def _noise_px(n: int) -> bytes:
    """n پیکسلِ پرنویز (هر پیکسل سه بایتِ متفاوت) — هیچ سطر/ستونی یکنواخت نیست."""
    out = bytearray()
    for i in range(n):
        out += bytes(((i * 7) % 256, (i * 29 + 11) % 256, (i * 53 + 200) % 256))
    return bytes(out)


def _img(w: int, h: int, left: int, right: int, top: int, bottom: int) -> bytes:
    """تصویرِ w×h با نوارِ سفیدِ left/right پیکسلیِ عمودی و top/bottom افقی."""
    stride = w * 3
    noise = _noise_px(w - left - right)
    rows = []
    for r in range(h - top - bottom):
        # هر ردیفِ نویز جابه‌جا می‌شود تا ستون‌های محتوا یکنواخت نشوند
        shifted = bytes(((b + r * 37) % 256) for b in noise)
        rows.append(b"\xff" * (left * 3) + shifted + b"\xff" * (right * 3))
    body = b"".join(rows)
    white_row = b"\xff" * stride
    return white_row * top + body + white_row * bottom


def test_content_box_finds_side_pillarbox() -> None:
    assert artborder.content_box(_img(500, 500, 100, 100, 0, 0), 500, 500) == (100, 0, 300, 500)


def test_content_box_finds_top_bottom_bars() -> None:
    assert artborder.content_box(_img(500, 400, 0, 0, 60, 60), 500, 400) == (0, 60, 500, 280)


def test_content_box_none_when_no_border() -> None:
    img = _noise_px(500 * 500)
    assert artborder.content_box(img, 500, 500) is None


def test_content_box_ignores_thin_edge_noise() -> None:
    img = _img(500, 500, 3, 3, 0, 0)  # کمتر از _MIN_BORDER (۲۰ در ۵۰۰)
    assert artborder.content_box(img, 500, 500) is None


def test_crop_bars_real_jcard(tmp_path: Path) -> None:
    src = Path("C:/Users/Mahan/AppData/Local/Temp/musicbazi-qa/art.bin")
    if not src.exists():
        pytest.skip("نمونه‌ی J-card در این ماشین نیست")
    data = src.read_bytes()
    out = artborder.crop_bars(data)
    assert out != data
    _, w, h = artborder._decode_rgb(out)
    assert (w, h) == (282, 500)  # نوارهای ۱۰۸+۱۰۹ پیکسلی خورده شده‌اند
    rgb, w2, h2 = _, w, h
    assert artborder.content_box(rgb, w2, h2) is None  # پسماندی نمانده


def test_crop_bars_passthrough_clean_image() -> None:
    src = Path("C:/Users/Mahan/AppData/Local/Temp/musicbazi-qa/avatar-sc-googoosh.jpg")
    if not src.exists():
        pytest.skip("نمونه‌ی کاورِ تمیز در این ماشین نیست")
    data = src.read_bytes()
    assert artborder.crop_bars(data) == data


def test_crop_bars_survives_garbage() -> None:
    assert artborder.crop_bars(b"not an image at all") == b"not an image at all"


def test_content_box_keeps_dark_artwork_background() -> None:
    """
    پس‌زمینه‌ی تیره «حاشیه» نیست — قلبِ نئونِ KAASH روی سیاه.

    رگرسیونِ نسخه‌ی اول: هر سطر/ستونِ یک‌رنگ از بیرون خورده می‌شد و جلدهای
    با زمینه‌ی سیاه به نسخه‌ی زوم‌شده تبدیل می‌شدند — کاوری که روی پلتفرم
    حاشیه‌ی سیاه دارد، اینجا پرشده دیده می‌شد.
    """
    w = h = 500
    stride = w * 3
    black_row = b"\x00" * stride
    heart = bytearray()
    for _ in range(300):
        heart += b"\x00" * (100 * 3) + b"\xd0\x20\x20" * 300 + b"\x00" * (100 * 3)
    rgb = black_row * 100 + bytes(heart) + black_row * 100
    assert artborder.content_box(rgb, w, h) is None


def test_crop_bars_keeps_dark_background_jpeg() -> None:
    """همان صحنه به‌صورت JPEG واقعی: بایت‌ها باید دست‌نخورده بمانند."""
    w = h = 500
    stride = w * 3
    black_row = b"\x00" * stride
    heart = bytearray()
    for _ in range(300):
        heart += b"\x00" * (100 * 3) + b"\xd0\x20\x20" * 300 + b"\x00" * (100 * 3)
    rgb = black_row * 100 + bytes(heart) + black_row * 100
    proc = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "500x500", "-i", "pipe:0",
         "-frames:v", "1", "-q:v", "2", "-y", "-f", "image2", "-c:v", "mjpeg", "pipe:1"],
        input=bytes(rgb), capture_output=True, timeout=30, check=False,
    )
    jpg = proc.stdout
    assert artborder.crop_bars(jpg) == jpg


def test_solid_color_image_untouched() -> None:
    # تصویرِ کاملاً یک‌رنگ: همه‌چیز «حاشیه» است ولی جعبه‌ی باقی‌مانده از
    # ۲×_MIN_BORDER کوچک‌تر می‌شود → None → تصویر دست‌نخورده می‌ماند.
    proc = subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
         "-i", "color=c=0xC8B428:s=300x300:d=0.04", "-frames:v", "1",
         "-q:v", "2", "-y", "-f", "image2", "-c:v", "mjpeg", "pipe:1"],
        capture_output=True, timeout=30, check=False,
    )
    jpg = proc.stdout
    assert artborder.crop_bars(jpg) == jpg
