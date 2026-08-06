"""دانلود با yt-dlp، ترنسکد با ffmpeg، تگ‌گذاری با mutagen."""

from __future__ import annotations

import base64
import re
import time
from collections.abc import Callable
from pathlib import Path

import httpx
from mutagen.flac import FLAC, Picture
from mutagen.id3 import APIC, ID3, TALB, TIT2, TPE1, TPE2, USLT
from mutagen.mp3 import MP3
from mutagen.mp4 import MP4, MP4Cover
from mutagen.oggopus import OggOpus

from . import ydl
from .config import DOWNLOAD_DIR, LYRICS_ENABLED
from .models import Quality, Track
from .providers import lrclib

ProgressFn = Callable[[float], None]

# mp3 با بیت‌ریت مشخص
BITRATE = {"128": "128", "192": "192", "320": "320"}

# کدک‌های دیگر. opus بیت‌ریت می‌خواهد (ffmpeg برایش quality-scale ندارد)؛
# flac و m4a نه — flac بی‌اتلاف است و m4a وقتی منبع خودش aac باشد فقط کپی می‌شود.
CODEC_BITRATE: dict[str, str | None] = {"m4a": None, "opus": "160", "flac": None}

# پسوندی که از هر کیفیت انتظار داریم — برای انتخاب فایل درست بعد از ترنسکد
EXT: dict[str, str] = {
    **{q: ".mp3" for q in BITRATE},
    "m4a": ".m4a",
    "opus": ".opus",
    "flac": ".flac",
}


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
    elif quality in CODEC_BITRATE:
        if quality == "m4a":
            # اگر منبع از قبل aac باشد، yt-dlp فقط ظرف را عوض می‌کند و
            # ترنسکد دوباره‌ی لاسی‌به‌لاسی اتفاق نمی‌افتد
            opts["format"] = "bestaudio[ext=m4a]/bestaudio/best"
        step: dict = {"key": "FFmpegExtractAudio", "preferredcodec": quality}
        if bitrate := CODEC_BITRATE[quality]:
            step["preferredquality"] = bitrate
        opts["postprocessors"].append(step)
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


def _picture(cover: tuple[bytes, str]) -> Picture:
    """بلوک تصویر استاندارد FLAC — در Opus هم همین بلوک base64 می‌شود."""
    data, mime = cover
    pic = Picture()
    pic.data = data
    pic.type = 3  # جلد جلو
    pic.mime = mime
    pic.desc = "Cover"
    return pic


def _tag_mp3(path: Path, track: Track, cover, lyrics) -> None:
    audio = MP3(path, ID3=ID3)
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    assert tags is not None

    for frame in ("TIT2", "TPE1", "TALB", "TPE2", "TDRC", "APIC", "USLT"):
        tags.delall(frame)

    tags.add(TIT2(encoding=3, text=track.title))
    tags.add(TPE1(encoding=3, text=track.artist))
    if track.album:
        tags.add(TALB(encoding=3, text=track.album))
        tags.add(TPE2(encoding=3, text=track.artist))
    if cover:
        data, mime = cover
        tags.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=data))
    if lyrics and lyrics.plain:
        # USLT متنِ بدون زمان است؛ نسخه‌ی هم‌زمان‌شده در فایل .lrc کنارش می‌نشیند
        tags.add(USLT(encoding=3, lang="und", desc="", text=lyrics.plain))
    audio.save(v2_version=3)


def _tag_mp4(path: Path, track: Track, cover, lyrics) -> None:
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
    if lyrics and lyrics.plain:
        audio["\xa9lyr"] = lyrics.plain
    audio.save()


def _tag_flac(path: Path, track: Track, cover, lyrics) -> None:
    audio = FLAC(path)
    audio["title"] = track.title
    audio["artist"] = track.artist
    if track.album:
        audio["album"] = track.album
        audio["albumartist"] = track.artist
    if lyrics and lyrics.plain:
        audio["lyrics"] = lyrics.plain
    if cover:
        audio.clear_pictures()
        audio.add_picture(_picture(cover))
    audio.save()


def _tag_opus(path: Path, track: Track, cover, lyrics) -> None:
    audio = OggOpus(path)
    audio["title"] = track.title
    audio["artist"] = track.artist
    if track.album:
        audio["album"] = track.album
        audio["albumartist"] = track.artist
    if lyrics and lyrics.plain:
        audio["lyrics"] = lyrics.plain
    if cover:
        # Ogg تگ باینری ندارد؛ قرارداد این است که بلوک FLAC را base64 کنیم
        audio["metadata_block_picture"] = [
            base64.b64encode(_picture(cover).write()).decode("ascii")
        ]
    audio.save()


_TAGGERS = {
    ".mp3": _tag_mp3,
    ".m4a": _tag_mp4,
    ".mp4": _tag_mp4,
    ".flac": _tag_flac,
    ".opus": _tag_opus,
}


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
                bitrate = MP3(path).info.bitrate
            elif ext in ("m4a", "mp4"):
                bitrate = MP4(path).info.bitrate
            elif ext == "opus":
                bitrate = OggOpus(path).info.bitrate
            elif ext == "flac":
                info = FLAC(path).info
                # flac بی‌اتلاف است؛ عمق بیت و نرخ نمونه گویاتر از بیت‌ریت‌اند
                return f"flac {info.bits_per_sample}/{int(info.sample_rate / 1000)}"
            else:
                return ext
            return f"{ext} {int(bitrate / 1000)}" if bitrate else ext
        except Exception:
            if attempt == 2:
                return ext
            time.sleep(0.15)
    return ext


def fetch_lyrics(track: Track):
    """متن آهنگ، یا None. خطا هیچ‌وقت بالا نمی‌رود — متن جزء اختیاری است."""
    if not LYRICS_ENABLED:
        return None
    try:
        return lrclib.fetch(track.title, track.artist, track.album, track.durationMs)
    except Exception:
        return None


def write_lrc(path: Path, lyrics) -> Path | None:
    """
    متن هم‌زمان‌شده را کنار فایل صوتی می‌نویسد.

    هم‌نام بودن با فایل صوتی قرارداد عملاً جهانی است — VLC، foobar2000، Poweramp
    و بقیه بدون تنظیمات پیدایش می‌کنند.
    """
    if not lyrics or not lyrics.synced:
        return None
    lrc = path.with_suffix(".lrc")
    try:
        lrc.write_text(lyrics.synced, encoding="utf-8")
        return lrc
    except Exception:
        return None


def tag(path: Path, track: Track, lyrics=None) -> None:
    """تگ‌گذاری بر اساس پسوند. خطای تگ نباید کل دانلود را بسوزاند."""
    cover = _fetch_artwork(track.artworkUrl)
    tagger = _TAGGERS.get(path.suffix.lower())
    if tagger is None:
        return
    try:
        tagger(path, track, cover, lyrics)
    except Exception:
        pass  # فایل صوتی سالم است؛ فقط تگ نخورد


def finalize(path: Path, track: Track) -> Path | None:
    """متن را می‌گیرد، تگ می‌زند و .lrc را می‌نویسد. مسیر .lrc را برمی‌گرداند."""
    lyrics = fetch_lyrics(track)
    tag(path, track, lyrics)
    return write_lrc(path, lyrics)


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

    wanted = EXT.get(quality)
    produced = sorted(
        (p for p in siblings() if p.suffix not in (".part", ".lrc")),
        key=lambda p: (p.suffix != wanted, -p.stat().st_size),
    )
    if not produced:
        raise FileNotFoundError("فایلی تولید نشد")

    return produced[0]
