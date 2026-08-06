"""دانلود با yt-dlp، ترنسکد با ffmpeg، تگ‌گذاری با mutagen."""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from pathlib import Path

import httpx
from mutagen.id3 import APIC, ID3, TALB, TIT2, TPE1, TPE2
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover

from . import ydl
from .config import DOWNLOAD_DIR
from .models import Quality, Track

ProgressFn = Callable[[float], None]

BITRATE = {"128": "128", "320": "320"}


def safe_name(text: str) -> str:
    text = re.sub(r'[\\/:*?"<>|]', "-", text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text[:120] or "track"


def _ydl_opts(out_stem: Path, quality: Quality, on_progress: ProgressFn) -> dict:
    def hook(d: dict) -> None:
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
        done = d.get("downloaded_bytes") or 0
        if total:
            on_progress(min(99.0, done / total * 100))

    opts = ydl.opts(
        outtmpl=f"{out_stem}.%(ext)s",
        progress_hooks=[hook],
        format="bestaudio/best",
        # بین فرمت‌های صوتی، بیشترین بیت‌ریت را بردار — پیش‌فرض yt-dlp
        # گاهی استریم کم‌حجم‌تر را انتخاب می‌کند
        format_sort=["abr", "asr"],
        concurrent_fragment_downloads=4,
        postprocessors=[],
    )

    if quality in BITRATE:
        opts["postprocessors"].append(
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": BITRATE[quality],
            }
        )
    else:
        # «اورجینال»: بدون ترنسکد، فقط در ظرف m4a قرار می‌گیرد اگر ممکن باشد
        opts["format"] = "bestaudio[ext=m4a]/bestaudio/best"

    return opts


def _fetch_artwork(url: str | None) -> tuple[bytes, str] | None:
    if not url:
        return None
    try:
        res = httpx.get(url, timeout=10.0, follow_redirects=True)
        res.raise_for_status()
        mime = res.headers.get("content-type", "image/jpeg").split(";")[0]
        if not mime.startswith("image/"):
            return None
        return res.content, mime
    except Exception:
        return None


def _tag_mp3(path: Path, track: Track, cover: tuple[bytes, str] | None) -> None:
    audio = MP3(path, ID3=ID3)
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    assert tags is not None

    tags.delall("TIT2")
    tags.delall("TPE1")
    tags.delall("TALB")
    tags.delall("TPE2")
    tags.delall("TDRC")
    tags.delall("APIC")

    tags.add(TIT2(encoding=3, text=track.title))
    tags.add(TPE1(encoding=3, text=track.artist))
    if track.album:
        tags.add(TALB(encoding=3, text=track.album))
        tags.add(TPE2(encoding=3, text=track.artist))
    if cover:
        data, mime = cover
        tags.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=data))
    audio.save(v2_version=3)


def _tag_mp4(path: Path, track: Track, cover: tuple[bytes, str] | None) -> None:
    audio = MP4(path)
    audio["\xa9nam"] = track.title
    audio["\xa9ART"] = track.artist
    if track.album:
        audio["\xa9alb"] = track.album
        audio["aART"] = track.artist
    if cover:
        data, mime = cover
        fmt = MP4Cover.FORMAT_PNG if "png" in mime else MP4Cover.FORMAT_JPEG
        audio["covr"] = [MP4Cover(data, imageformat=fmt)]
    audio.save()


def describe(path: Path) -> str:
    """
    فرمت واقعیِ فایل تولیدشده، مثلاً «mp3 ۱۲۸».

    کیفیتِ درخواستی همیشه به‌دست نمی‌آید: اگر منبع خودش ۱۲۸ باشد، تبدیلش به ۳۲۰
    فقط حجم اضافه می‌کند و yt-dlp درست عمل می‌کند که ترنسکد نکند. ولی UI باید
    چیزی را نشان دهد که واقعاً گرفته، نه چیزی که خواسته بوده.
    """
    ext = path.suffix.lstrip(".")

    # ویندوز گاهی هندل فایل را چند میلی‌ثانیه بعد از بسته‌شدن آزاد می‌کند و
    # خواندن بلافاصله بعد از ffmpeg/mutagen شکست می‌خورد — یک بار دوباره تلاش کن
    for attempt in range(3):
        try:
            if ext == "mp3":
                from mutagen.mp3 import MP3

                bitrate = MP3(path).info.bitrate
            elif ext in ("m4a", "mp4"):
                bitrate = MP4(path).info.bitrate
            else:
                return ext
            return f"{ext} {int(bitrate / 1000)}" if bitrate else ext
        except Exception:
            if attempt == 2:
                return ext
            time.sleep(0.15)
    return ext


def tag(path: Path, track: Track) -> None:
    """تگ‌گذاری بر اساس پسوند. خطای تگ نباید کل دانلود را بسوزاند."""
    cover = _fetch_artwork(track.artworkUrl)
    try:
        if path.suffix == ".mp3":
            _tag_mp3(path, track, cover)
        elif path.suffix in (".m4a", ".mp4"):
            _tag_mp4(path, track, cover)
    except Exception:
        pass  # فایل صوتی سالم است؛ فقط تگ نخورد


def download(track: Track, url: str, quality: Quality, on_progress: ProgressFn) -> Path:
    """
    فایل را دانلود و ترنسکد می‌کند و مسیر نهایی را برمی‌گرداند.
    بلاک‌کننده است — باید در thread صدا زده شود.
    """
    from yt_dlp import YoutubeDL

    stem = DOWNLOAD_DIR / safe_name(f"{track.artist} - {track.title}")

    # glob با نام‌هایی که [ یا ] دارند اشتباه می‌گیرد، پس دستی فیلتر می‌کنیم
    def siblings() -> list[Path]:
        return [
            p
            for p in DOWNLOAD_DIR.iterdir()
            if p.is_file() and p.name.startswith(stem.name + ".")
        ]

    # بازمانده‌ی تلاش قبلی را پاک کن تا yt-dlp فایل تکراری نسازد
    for leftover in siblings():
        leftover.unlink(missing_ok=True)

    # نام محلی عمداً ydl نیست — ماژول ydl را سایه می‌انداخت
    with YoutubeDL(_ydl_opts(stem, quality, on_progress)) as y:
        y.extract_info(url, download=True)

    wanted = ".mp3" if quality in BITRATE else None
    produced = sorted(
        (p for p in siblings() if p.suffix != ".part"),
        key=lambda p: (p.suffix != wanted, -p.stat().st_size),
    )
    if not produced:
        raise FileNotFoundError("فایلی تولید نشد")

    return produced[0]
