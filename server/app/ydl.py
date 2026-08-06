"""گزینه‌های مشترک yt-dlp — یک جا تا احراز هویت و تنظیمات شبکه همه‌جا یکسان باشد."""

from __future__ import annotations

from .config import (
    COOKIES_BROWSER,
    COOKIES_FILE,
    FFMPEG_LOCATION,
    JS_RUNTIME,
    POT_BASE_URL,
    POT_SERVER_HOME,
)

BASE_OPTS: dict = {
    "quiet": True,
    "no_warnings": True,
    "noprogress": True,
    "noplaylist": True,
    "retries": 3,
    "fragment_retries": 3,
}


def auth_opts() -> dict:
    """
    چیزهایی که یوتیوب برای استخراج سمت سرور لازم دارد.

    سه گیت مستقل وجود دارد و هر سه باید باز شوند، وگرنه یوتیوب یا «not a bot»
    می‌دهد یا لیست فرمت خالی برمی‌گرداند:
      ۱. گیت ضدربات   → کوکی مرورگر یا کوکی‌فایل
      ۲. PO Token     → سرور bgutil که در vendor/ بیلد شده
      ۳. چالش امضا/n  → yt-dlp-ejs به‌علاوه‌ی یک JS runtime
    """
    opts: dict = {}

    if COOKIES_FILE:
        opts["cookiefile"] = COOKIES_FILE
    elif COOKIES_BROWSER:
        opts["cookiesfrombrowser"] = (COOKIES_BROWSER, None, None, None)

    # PO Token دو راه دارد و پلاگین هر دو را می‌شناسد: اسکریپت محلی (ویندوز، بدون
    # داکر) یا سرور HTTP جدا (داکر). اگر آدرس HTTP داده شده باشد همان ارجح است،
    # چون سرورش یک بار بالا می‌آید و node را برای هر توکن دوباره اجرا نمی‌کند.
    if POT_BASE_URL:
        opts["extractor_args"] = {"youtubepot-bgutilhttp": {"base_url": [POT_BASE_URL]}}
    elif POT_SERVER_HOME:
        opts["extractor_args"] = {
            "youtubepot-bgutilscript": {"server_home": [POT_SERVER_HOME]},
        }

    if JS_RUNTIME:
        # پیش‌فرض yt-dlp فقط deno است؛ باید صریح فعالش کنیم
        opts["js_runtimes"] = {JS_RUNTIME: {}}

    return opts


def opts(**extra) -> dict:
    """گزینه‌های پایه + احراز هویت + ffmpeg، به‌علاوه‌ی هر چیزی که صدازننده بدهد."""
    merged = {**BASE_OPTS, **auth_opts()}
    if FFMPEG_LOCATION:
        merged["ffmpeg_location"] = FFMPEG_LOCATION
    merged.update(extra)
    return merged


def has_cookies() -> bool:
    return bool(COOKIES_FILE or COOKIES_BROWSER)


def has_jsruntime() -> bool:
    return bool(JS_RUNTIME)


def has_potoken() -> bool:
    return bool(POT_BASE_URL or POT_SERVER_HOME)
