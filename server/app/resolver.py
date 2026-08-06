"""
پیدا کردن بهترین نسخه‌ی قابل دانلود برای یک ترک.

متادیتا از اپل/دیزر می‌آید ولی فایل صوتی آنجا نیست. این ماژول با جستجو در یوتیوب
و امتیازدهی به نتایج، نزدیک‌ترین نسخه را انتخاب می‌کند — همان کاری که spotDL می‌کند.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from yt_dlp import YoutubeDL

from . import ydl
from .config import AUDIO_SOURCES
from .models import Track

# پیشوند جستجوی yt-dlp برای هر منبع
SEARCH_PREFIX = {"youtube": "ytsearch", "soundcloud": "scsearch"}

# عبارت‌هایی که تقریباً همیشه یعنی نسخه‌ی اشتباه
NEGATIVE = (
    "live",
    "cover",
    "remix",
    "karaoke",
    "instrumental",
    "reaction",
    "tutorial",
    "lesson",
    "concert",
    "اجرای زنده",
    "کاور",
    "ریمیکس",
    "بیکلام",
)
# نشانه‌های نسخه‌ی رسمی
POSITIVE = ("official audio", "official music", "topic", "full album", "audio")

CANDIDATES = 6


@dataclass
class Candidate:
    url: str
    title: str
    uploader: str
    duration_ms: int
    score: float
    source: str = "youtube"


def _normalize(text: str) -> str:
    """حذف اعراب، یکسان‌سازی ی/ک عربی، حذف پرانتز و علائم."""
    text = unicodedata.normalize("NFKC", text).lower()
    text = text.replace("ي", "ی").replace("ك", "ک").replace("ۀ", "ه")
    text = re.sub(r"[ً-ْ‌]", "", text)
    text = re.sub(r"[\(\[].*?[\)\]]", " ", text)
    text = re.sub(r"[^\w\s؀-ۿ]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _tokens(text: str) -> set[str]:
    return {t for t in _normalize(text).split() if len(t) > 1}


def _overlap(a: set[str], b: set[str]) -> float:
    if not a:
        return 0.0
    return len(a & b) / len(a)


def score_candidate(track: Track, title: str, uploader: str, duration_ms: int) -> float:
    """۰ تا ۱۰۰. مدت‌زمان مهم‌ترین سیگنال است چون جعل‌ناپذیرترین‌شان است."""
    haystack = _tokens(f"{title} {uploader}")

    title_match = _overlap(_tokens(track.title), haystack)
    artist_match = _overlap(_tokens(track.artist), haystack)
    score = title_match * 45 + artist_match * 25

    if track.durationMs and duration_ms:
        delta = abs(track.durationMs - duration_ms) / 1000
        if delta <= 2:
            score += 30
        elif delta <= 5:
            score += 22
        elif delta <= 10:
            score += 10
        elif delta > 30:
            score -= 35  # تقریباً حتماً ترک اشتباه است
    elif not duration_ms:
        score -= 5

    low = f"{title} {uploader}".lower()
    # عبارت منفی فقط وقتی بد است که خودِ عنوانِ ترک آن کلمه را نداشته باشد
    track_low = track.title.lower()
    for word in NEGATIVE:
        if word in low and word not in track_low:
            score -= 18
    for word in POSITIVE:
        if word in low:
            score += 6
            break

    return score


MIN_SCORE = 35.0
# بالاتر از این یعنی به تطابق مطمئنیم
GOOD_ENOUGH = 80.0
# حداکثر تعداد کاندیدی که جاب حاضر است امتحان کند
MAX_ATTEMPTS = 4


def _search_source(track: Track, source: str) -> list[Candidate]:
    prefix = SEARCH_PREFIX.get(source)
    if not prefix:
        return []

    query = f"{track.artist} - {track.title}".strip(" -")
    options = ydl.opts(
        skip_download=True,
        extract_flat="in_playlist",
        ignoreerrors=True,
    )
    with YoutubeDL(options) as y:
        info = y.extract_info(f"{prefix}{CANDIDATES}:{query}", download=False)

    found: list[Candidate] = []
    for entry in ((info or {}).get("entries") or []):
        if not entry:
            continue
        title = entry.get("title") or ""
        uploader = entry.get("uploader") or entry.get("channel") or ""
        duration_ms = int(float(entry.get("duration") or 0) * 1000)
        url = entry.get("webpage_url") or entry.get("url") or ""
        if not url:
            continue

        score = score_candidate(track, title, uploader, duration_ms)
        if score < MIN_SCORE:
            continue
        found.append(
            Candidate(
                url=url,
                title=title,
                uploader=uploader,
                duration_ms=duration_ms,
                score=score,
                source=source,
            )
        )
    return found


def resolve(track: Track) -> list[Candidate]:
    """
    کاندیدهای قابل دانلود را مرتب‌شده بر اساس امتیاز برمی‌گرداند.

    لیست برمی‌گردانیم نه یکی، چون «بهترین امتیاز» لزوماً «قابل دانلود» نیست:
    ویدیو ممکن است گیت ضدربات بخورد، ترک ساندکلاد DRM داشته باشد یا لینک مرده باشد.
    صدازننده تا اولین موفقیت پایین می‌رود.
    """
    # ترک‌هایی که خودشان از یوتیوب/ساندکلاد آمده‌اند، لینک مستقیم دارند
    if track.source in ("youtube", "soundcloud") and track.sourceUrl:
        return [
            Candidate(
                url=track.sourceUrl,
                title=track.title,
                uploader=track.artist,
                duration_ms=track.durationMs,
                score=100.0,
                source=track.source,
            )
        ]

    found: list[Candidate] = []
    for source in AUDIO_SOURCES:
        try:
            found += _search_source(track, source)
        except Exception:
            continue  # این منبع در دسترس نیست — بعدی

        # منبع بعدی را فقط وقتی می‌زنیم که تا اینجا تطابق قانع‌کننده‌ای نداریم.
        # جستجوی ساندکلاد حدود صد ثانیه طول می‌کشد؛ وقتی یوتیوب جواب خوب داده
        # پرداختن این هزینه روی هر ترک، «دانلود همه» را غیرقابل‌استفاده می‌کند.
        if any(c.score >= GOOD_ENOUGH for c in found):
            break

    found.sort(key=lambda c: c.score, reverse=True)
    return found[:MAX_ATTEMPTS]
