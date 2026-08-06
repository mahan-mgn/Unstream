"""ترکیب provider ها: جستجوی همزمان و resolve کردن یک مرجع (id یا لینک) به آلبوم."""

from __future__ import annotations

import asyncio
import re

import httpx

from .models import AlbumDetail, SearchResults, Track
from .providers import deezer, itunes, ytdlp

# شناسه‌های داخلی: provider:kind:id
ID = re.compile(r"^(itunes|deezer|yt|sc):(track|album|playlist|artist):(.+)$")


def _dedupe_tracks(tracks: list[Track]) -> list[Track]:
    """یک ترک ممکن است هم در اپل هم در دیزر باشد؛ اپل را نگه می‌داریم."""
    seen: set[tuple[str, str]] = set()
    out: list[Track] = []
    for t in tracks:
        key = (t.title.strip().lower(), t.artist.strip().lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


async def search(client: httpx.AsyncClient, query: str) -> SearchResults:
    """اپل و دیزر را همزمان می‌زند. اگر یکی بیفتد، نتیجه‌ی دیگری همچنان برمی‌گردد."""
    apple, deez = await asyncio.gather(
        itunes.search(client, query),
        deezer.search(client, query),
        return_exceptions=True,
    )

    result = SearchResults(query=query)

    if isinstance(apple, SearchResults):
        result.tracks += apple.tracks
        result.albums += apple.albums
        result.artists += apple.artists
    if isinstance(deez, SearchResults):
        result.tracks += deez.tracks
        result.playlists += deez.playlists

    if not result.tracks and not result.albums and not result.playlists:
        # هر دو provider افتاده‌اند — این خطا باید به کاربر برسد، نه نتیجه‌ی خالی
        for outcome in (apple, deez):
            if isinstance(outcome, BaseException):
                raise outcome

    result.tracks = _dedupe_tracks(result.tracks)
    return result


async def resolve_ref(client: httpx.AsyncClient, ref: str) -> AlbumDetail | None:
    """
    ref می‌تواند شناسه‌ی داخلی (itunes:album:123) یا لینک هر کدام از سرویس‌ها باشد.
    خروجی همیشه AlbumDetail است — پلی‌لیست و تک‌آهنگ هم در همین قالب.
    """
    ref = ref.strip()

    if m := ID.match(ref):
        provider, kind, ident = m.groups()
        if provider == "itunes" and kind == "album":
            return await itunes.album(client, ident)
        if provider == "deezer" and kind == "album":
            return await deezer.album(client, ident)
        if provider == "deezer" and kind == "playlist":
            return await deezer.playlist(client, ident)
        if provider in ("yt", "sc"):
            base = "https://www.youtube.com/watch?v=" if provider == "yt" else ""
            if base:
                return await asyncio.to_thread(ytdlp.extract, base + ident)

    if not ref.lower().startswith("http"):
        return None

    if parsed := itunes.parse_url(ref):
        kind, ident = parsed
        if kind == "album":
            return await itunes.album(client, ident)

    if parsed := deezer.parse_url(ref):
        kind, ident = parsed
        if kind == "album":
            return await deezer.album(client, ident)
        if kind == "playlist":
            return await deezer.playlist(client, ident)

    if ytdlp.SPOTIFY_URL.search(ref):
        # بدون کلید API اسپاتیفای، عنوان را از oEmbed می‌گیریم و در اپل/دیزر می‌گردیم
        title = await asyncio.to_thread(ytdlp.spotify_title, ref)
        if not title:
            return None
        results = await search(client, title)
        if results.albums:
            return await resolve_ref(client, results.albums[0].id)
        return None

    if ytdlp.YOUTUBE_URL.search(ref) or ytdlp.SOUNDCLOUD_URL.search(ref):
        return await asyncio.to_thread(ytdlp.extract, ref)

    return None
