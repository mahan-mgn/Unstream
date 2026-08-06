"""
اسپاتیفای از طریق Web API — فقط برای متادیتا.

اسپاتیفای فایل صوتی نمی‌دهد (و DRM دارد)، ولی لیست ترک‌های یک آلبوم یا پلی‌لیست
را دقیق می‌دهد. همان چیزی که برای پیدا کردن صوت از منابع باز لازم داریم.

بدون کلید هم پروژه کار می‌کند: `catalog` به مسیر قدیمی (عنوان از oEmbed و جستجو
در اپل/دیزر) برمی‌گردد — ولی آن مسیر فقط آلبوم را حدس می‌زند و پلی‌لیست را اصلاً
نمی‌تواند.
"""

from __future__ import annotations

import asyncio
import base64
import re
import time
from typing import Any

import httpx

from ..config import (
    SPOTIFY_API,
    SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET,
    SPOTIFY_TOKEN_URL,
)
from ..models import Album, AlbumDetail, SearchResults, Track

URL = re.compile(r"open\.spotify\.com/(?:intl-[a-z]{2}/)?(album|playlist|track)/([A-Za-z0-9]+)", re.I)

# صفحه‌بندی: اسپاتیفای برای آلبوم حداکثر ۵۰ و برای پلی‌لیست ۱۰۰ می‌دهد
ALBUM_PAGE = 50
PLAYLIST_PAGE = 100
MAX_TRACKS = 1000

_token: str | None = None
_token_expires = 0.0
_token_lock = asyncio.Lock()


def enabled() -> bool:
    return bool(SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET)


def parse_url(url: str) -> tuple[str, str] | None:
    if m := URL.search(url):
        return m.group(1).lower(), m.group(2)
    return None


async def _access_token(client: httpx.AsyncClient) -> str:
    """
    Client Credentials — بدون کاربر، فقط برای داده‌ی عمومی.
    توکن یک ساعت اعتبار دارد؛ زودتر از موعد تازه‌اش می‌کنیم تا وسط یک پلی‌لیست
    بزرگ منقضی نشود.
    """
    global _token, _token_expires

    async with _token_lock:
        if _token and time.time() < _token_expires:
            return _token

        secret = base64.b64encode(
            f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()
        ).decode()
        res = await client.post(
            SPOTIFY_TOKEN_URL,
            data={"grant_type": "client_credentials"},
            headers={
                "authorization": f"Basic {secret}",
                "content-type": "application/x-www-form-urlencoded",
            },
        )
        res.raise_for_status()
        body = res.json()
        _token = body["access_token"]
        _token_expires = time.time() + int(body.get("expires_in", 3600)) - 60
        return _token


async def _get(client: httpx.AsyncClient, path: str, **params: Any) -> dict[str, Any]:
    token = await _access_token(client)
    res = await client.get(
        f"{SPOTIFY_API}{path}",
        params=params,
        headers={"authorization": f"Bearer {token}"},
    )
    res.raise_for_status()
    return res.json()


def _art(images: list[dict] | None) -> str | None:
    if not images:
        return None
    # اسپاتیفای از بزرگ به کوچک می‌دهد؛ متوسط برای کاور کافی است و سریع‌تر لود می‌شود
    mid = images[len(images) // 2] if len(images) > 1 else images[0]
    return mid.get("url")


def _artists(row: dict[str, Any]) -> str:
    names = [a.get("name", "") for a in (row.get("artists") or []) if a.get("name")]
    return ", ".join(names)


def _track(row: dict[str, Any], album_row: dict[str, Any] | None = None) -> Track | None:
    if not row or not row.get("id"):
        return None
    alb = row.get("album") or album_row or {}
    return Track(
        id=f"sp:track:{row['id']}",
        title=row.get("name") or "",
        artist=_artists(row) or _artists(alb),
        album=alb.get("name"),
        albumId=f"sp:album:{alb['id']}" if alb.get("id") else None,
        durationMs=int(row.get("duration_ms") or 0),
        artworkUrl=_art(alb.get("images")),
        source="spotify",
        sourceUrl=(row.get("external_urls") or {}).get("spotify")
        or f"https://open.spotify.com/track/{row['id']}",
        previewUrl=row.get("preview_url"),
        explicit=bool(row.get("explicit")),
    )


def _album_head(row: dict[str, Any]) -> Album:
    return Album(
        id=f"sp:album:{row['id']}",
        title=row.get("name") or "",
        artist=_artists(row),
        year=int((row.get("release_date") or "0000")[:4] or 0),
        artworkUrl=_art(row.get("images")),
        trackCount=int(row.get("total_tracks") or 0),
        source="spotify",
        sourceUrl=(row.get("external_urls") or {}).get("spotify")
        or f"https://open.spotify.com/album/{row['id']}",
    )


async def _all_pages(
    client: httpx.AsyncClient, path: str, page: int, **params: Any
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    offset = 0
    while offset < MAX_TRACKS:
        body = await _get(client, path, limit=page, offset=offset, **params)
        batch = body.get("items") or []
        items += batch
        if len(batch) < page or not body.get("next"):
            break
        offset += page
    return items


async def album(client: httpx.AsyncClient, album_id: str) -> AlbumDetail | None:
    head = await _get(client, f"/albums/{album_id}")
    if not head.get("id"):
        return None

    # صفحه‌ی اول ترک‌ها داخل خود پاسخ آلبوم است؛ فقط اگر بیشتر بود صفحه می‌زنیم
    rows = (head.get("tracks") or {}).get("items") or []
    if (head.get("tracks") or {}).get("next"):
        rows = await _all_pages(client, f"/albums/{album_id}/tracks", ALBUM_PAGE)

    tracks = [t for r in rows if (t := _track(r, head))]
    base = _album_head(head)
    return AlbumDetail(
        **base.model_dump(),
        durationMs=sum(t.durationMs for t in tracks),
        tracks=tracks,
    )


async def playlist(client: httpx.AsyncClient, playlist_id: str) -> AlbumDetail | None:
    head = await _get(client, f"/playlists/{playlist_id}", fields="id,name,owner,images,external_urls")
    if not head.get("id"):
        return None

    rows = await _all_pages(client, f"/playlists/{playlist_id}/tracks", PLAYLIST_PAGE)
    tracks: list[Track] = []
    for row in rows:
        # آیتم پلی‌لیست می‌تواند پادکست باشد یا ترکِ حذف‌شده (track = null)
        item = row.get("track") or {}
        if item.get("type") not in (None, "track"):
            continue
        if t := _track(item):
            tracks.append(t)

    owner = (head.get("owner") or {}).get("display_name") or "Spotify"
    return AlbumDetail(
        id=f"sp:playlist:{head['id']}",
        title=head.get("name") or "",
        artist=owner,
        year=0,
        artworkUrl=_art(head.get("images")),
        trackCount=len(tracks),
        source="spotify",
        sourceUrl=(head.get("external_urls") or {}).get("spotify")
        or f"https://open.spotify.com/playlist/{head['id']}",
        durationMs=sum(t.durationMs for t in tracks),
        tracks=tracks,
    )


async def track(client: httpx.AsyncClient, track_id: str) -> AlbumDetail | None:
    """تک‌آهنگ هم در قالب AlbumDetail برمی‌گردد تا فرانت مسیر جدا لازم نداشته باشد."""
    row = await _get(client, f"/tracks/{track_id}")
    single = _track(row)
    if single is None:
        return None
    alb = row.get("album") or {}
    return AlbumDetail(
        id=f"sp:track:{row['id']}",
        title=single.title,
        artist=single.artist,
        year=int((alb.get("release_date") or "0000")[:4] or 0),
        artworkUrl=single.artworkUrl,
        trackCount=1,
        source="spotify",
        sourceUrl=single.sourceUrl,
        durationMs=single.durationMs,
        tracks=[single],
    )


async def search(client: httpx.AsyncClient, query: str, limit: int = 10) -> SearchResults:
    """جستجوی اسپاتیفای فقط وقتی صدا زده می‌شود که کلید ست باشد."""
    body = await _get(client, "/search", q=query, type="album,track", limit=limit)
    tracks = [t for r in ((body.get("tracks") or {}).get("items") or []) if (t := _track(r))]
    albums = [
        _album_head(r) for r in ((body.get("albums") or {}).get("items") or []) if r.get("id")
    ]
    return SearchResults(query=query, tracks=tracks, albums=albums)
