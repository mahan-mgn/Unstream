"""ترکیب provider ها: جستجوی همزمان و resolve کردن یک مرجع (id یا لینک) به آلبوم."""

from __future__ import annotations

import asyncio
import re

import httpx

from .models import AlbumDetail, Artist, ArtistDetail, SearchResults, Track
from .providers import deezer, itunes, spotify, ytdlp

# شناسه‌های داخلی: provider:kind:id
ID = re.compile(r"^(itunes|deezer|sp|yt|sc):(track|album|playlist|artist):(.+)$")


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


def _dedupe_artists(artists: list[Artist]) -> list[Artist]:
    """
    اپل و دیزر هر دو هنرمند می‌دهند. اپل عکس ندارد و دیزر دارد، پس وقتی یک نام
    از هر دو آمده باشد نسخه‌ی عکس‌دار می‌ماند.
    """
    best: dict[str, Artist] = {}
    for a in artists:
        key = a.name.strip().lower()
        current = best.get(key)
        if current is None or (not current.artworkUrl and a.artworkUrl):
            best[key] = a
    return list(best.values())


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
        result.artists += deez.artists

    if not result.tracks and not result.albums and not result.playlists:
        # هر دو provider افتاده‌اند — این خطا باید به کاربر برسد، نه نتیجه‌ی خالی
        for outcome in (apple, deez):
            if isinstance(outcome, BaseException):
                raise outcome

    result.tracks = _dedupe_tracks(result.tracks)
    result.artists = _dedupe_artists(result.artists)
    return result


async def _spotify_ref(client: httpx.AsyncClient, kind: str, ident: str) -> AlbumDetail | None:
    if kind == "album":
        return await spotify.album(client, ident)
    if kind == "playlist":
        return await spotify.playlist(client, ident)
    if kind == "track":
        return await spotify.track(client, ident)
    return None


async def _spotify_fallback(client: httpx.AsyncClient, ref: str) -> AlbumDetail | None:
    """
    بدون کلید API: عنوان را از oEmbed می‌گیریم و در اپل/دیزر می‌گردیم.

    فقط برای آلبوم و تک‌آهنگ کار می‌کند و همیشه هم درست نیست — پلی‌لیست از این
    راه اصلاً قابل بازسازی نیست. برای همین کلید اسپاتیفای ارزش ست کردن دارد.
    """
    title = await asyncio.to_thread(ytdlp.spotify_title, ref)
    if not title:
        return None
    results = await search(client, title)
    if results.albums:
        return await resolve_ref(client, results.albums[0].id)
    return None


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
        if provider == "sp" and spotify.enabled():
            return await _spotify_ref(client, kind, ident)
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

    if parsed := spotify.parse_url(ref):
        kind, ident = parsed
        if spotify.enabled():
            return await _spotify_ref(client, kind, ident)
        return await _spotify_fallback(client, ref)

    if ytdlp.YOUTUBE_URL.search(ref) or ytdlp.SOUNDCLOUD_URL.search(ref):
        return await asyncio.to_thread(ytdlp.extract, ref)

    return None


async def resolve_artist(client: httpx.AsyncClient, ref: str) -> ArtistDetail | None:
    """صفحه‌ی هنرمند از روی شناسه‌ی داخلی یا لینک اپل‌موزیک/دیزر."""
    ref = ref.strip()

    if m := ID.match(ref):
        provider, kind, ident = m.groups()
        if kind == "artist":
            if provider == "itunes":
                return await itunes.artist(client, ident)
            if provider == "deezer":
                return await deezer.artist(client, ident)
        return None

    if not ref.lower().startswith("http"):
        return None

    if (parsed := itunes.parse_url(ref)) and parsed[0] == "artist":
        return await itunes.artist(client, parsed[1])
    if (parsed := deezer.parse_url(ref)) and parsed[0] == "artist":
        return await deezer.artist(client, parsed[1])
    return None
