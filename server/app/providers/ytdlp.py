"""
استخراج متادیتا با yt-dlp — برای یوتیوب و ساندکلاد که API عمومی راحتی ندارند.
همه‌ی توابع بلاک‌کننده‌اند و باید در thread اجرا شوند.
"""

from __future__ import annotations

import re
from typing import Any

from yt_dlp import YoutubeDL

from .. import ydl
from ..models import AlbumDetail, Source, Track

YOUTUBE_URL = re.compile(r"(youtube\.com|youtu\.be)", re.I)
SOUNDCLOUD_URL = re.compile(r"soundcloud\.com", re.I)
SPOTIFY_URL = re.compile(r"open\.spotify\.com/(album|playlist|track)/([A-Za-z0-9]+)", re.I)

def _flat_opts() -> dict:
    return ydl.opts(skip_download=True, extract_flat="in_playlist", noplaylist=False)


def _source_of(url: str) -> Source:
    if SOUNDCLOUD_URL.search(url):
        return "soundcloud"
    return "youtube"


def _entry_to_track(entry: dict[str, Any], source: Source, album: str | None) -> Track:
    # extract_flat عنوان را خام می‌دهد؛ «Artist - Title» را جدا می‌کنیم
    raw = entry.get("title") or ""
    uploader = entry.get("uploader") or entry.get("channel") or entry.get("artist") or ""
    artist = entry.get("artist") or ""
    title = entry.get("track") or raw

    if not artist:
        if " - " in raw:
            artist, title = (p.strip() for p in raw.split(" - ", 1))
        else:
            artist = re.sub(r"\s*-\s*Topic$", "", uploader).strip()

    thumbs = entry.get("thumbnails") or []
    art = entry.get("thumbnail") or (thumbs[-1].get("url") if thumbs else None)

    vid = entry.get("id") or ""
    return Track(
        id=f"{'sc' if source == 'soundcloud' else 'yt'}:track:{vid}",
        title=title or raw,
        artist=artist or uploader or "ناشناس",
        album=album,
        durationMs=int(float(entry.get("duration") or 0) * 1000),
        artworkUrl=art,
        source=source,
        sourceUrl=entry.get("webpage_url") or entry.get("url") or "",
        previewUrl=None,
    )


def extract(url: str) -> AlbumDetail | None:
    """
    یک لینک یوتیوب/ساندکلاد را به AlbumDetail تبدیل می‌کند.
    ویدیو/ترک تکی هم به شکل آلبومِ تک‌آهنگه برمی‌گردد تا فرانت یک مسیر بیشتر نداشته باشد.
    """
    source = _source_of(url)
    with YoutubeDL(_flat_opts()) as y:
        info = y.extract_info(url, download=False)

    if not info:
        return None

    entries = [e for e in (info.get("entries") or []) if e]
    is_playlist = bool(entries)
    title = info.get("title") or "بدون عنوان"

    if is_playlist:
        tracks = [_entry_to_track(e, source, title) for e in entries]
    else:
        tracks = [_entry_to_track(info, source, None)]

    thumbs = info.get("thumbnails") or []
    art = info.get("thumbnail") or (thumbs[-1].get("url") if thumbs else None)
    if not art and tracks:
        art = tracks[0].artworkUrl

    kind = "playlist" if is_playlist else "track"
    return AlbumDetail(
        id=f"{'sc' if source == 'soundcloud' else 'yt'}:{kind}:{info.get('id') or ''}",
        title=title,
        artist=info.get("uploader") or info.get("channel") or (tracks[0].artist if tracks else ""),
        year=int(str(info.get("release_year") or info.get("upload_date") or "0")[:4] or 0),
        artworkUrl=art,
        trackCount=len(tracks),
        source=source,
        sourceUrl=info.get("webpage_url") or url,
        durationMs=sum(t.durationMs for t in tracks),
        tracks=tracks,
    )


def spotify_title(url: str) -> str | None:
    """
    اسپاتیفای بدون کلید API قابل خواندن نیست. ولی oEmbed عمومی است و عنوان را می‌دهد،
    و با همان عنوان می‌شود در اپل/دیزر جستجو کرد.
    """
    import httpx

    try:
        res = httpx.get(
            "https://open.spotify.com/oembed", params={"url": url}, timeout=8.0
        )
        res.raise_for_status()
        return res.json().get("title")
    except Exception:
        return None
