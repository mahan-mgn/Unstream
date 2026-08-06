"""Deezer API — عمومی و بدون کلید. تنها منبع ما برای پلی‌لیست."""

from __future__ import annotations

import asyncio
import re
from typing import Any

import httpx

from ..config import DEEZER_API, SEARCH_LIMIT
from ..models import Album, AlbumDetail, Playlist, SearchResults, Track

ALBUM_URL = re.compile(r"deezer\.com/(?:[a-z]{2}/)?album/(\d+)", re.I)
PLAYLIST_URL = re.compile(r"deezer\.com/(?:[a-z]{2}/)?playlist/(\d+)", re.I)
TRACK_URL = re.compile(r"deezer\.com/(?:[a-z]{2}/)?track/(\d+)", re.I)


def _track(row: dict[str, Any], album_row: dict[str, Any] | None = None) -> Track:
    alb = row.get("album") or album_row or {}
    artist = row.get("artist") or {}
    return Track(
        id=f"deezer:track:{row['id']}",
        title=row.get("title_short") or row.get("title") or "",
        artist=artist.get("name") or "",
        album=alb.get("title"),
        albumId=f"deezer:album:{alb['id']}" if alb.get("id") else None,
        durationMs=int(row.get("duration") or 0) * 1000,
        artworkUrl=alb.get("cover_medium") or alb.get("cover"),
        source="deezer",
        sourceUrl=row.get("link") or f"https://www.deezer.com/track/{row['id']}",
        previewUrl=row.get("preview"),
        explicit=bool(row.get("explicit_lyrics")),
    )


def _album(row: dict[str, Any]) -> Album:
    artist = row.get("artist") or {}
    return Album(
        id=f"deezer:album:{row['id']}",
        title=row.get("title") or "",
        artist=artist.get("name") or "",
        year=int((row.get("release_date") or "0000")[:4] or 0),
        artworkUrl=row.get("cover_medium") or row.get("cover"),
        trackCount=int(row.get("nb_tracks") or 0),
        source="deezer",
        sourceUrl=row.get("link") or f"https://www.deezer.com/album/{row['id']}",
    )


def _playlist(row: dict[str, Any]) -> Playlist:
    creator = row.get("user") or row.get("creator") or {}
    return Playlist(
        id=f"deezer:playlist:{row['id']}",
        title=row.get("title") or "",
        owner=creator.get("name") or "ناشناس",
        trackCount=int(row.get("nb_tracks") or 0),
        artworkUrl=row.get("picture_medium") or row.get("picture"),
        source="deezer",
        sourceUrl=row.get("link") or f"https://www.deezer.com/playlist/{row['id']}",
    )


async def _get(client: httpx.AsyncClient, path: str, **params: Any) -> dict[str, Any]:
    res = await client.get(f"{DEEZER_API}{path}", params=params)
    res.raise_for_status()
    body = res.json()
    if isinstance(body, dict) and "error" in body and body["error"]:
        raise httpx.HTTPError(str(body["error"]))
    return body


async def search(client: httpx.AsyncClient, query: str) -> SearchResults:
    tracks, playlists = await asyncio.gather(
        _get(client, "/search/track", q=query, limit=SEARCH_LIMIT),
        _get(client, "/search/playlist", q=query, limit=SEARCH_LIMIT),
    )
    return SearchResults(
        query=query,
        tracks=[_track(r) for r in tracks.get("data", []) if r.get("id")],
        playlists=[_playlist(r) for r in playlists.get("data", []) if r.get("id")],
    )


async def album(client: httpx.AsyncClient, album_id: str) -> AlbumDetail | None:
    row = await _get(client, f"/album/{album_id}")
    if not row.get("id"):
        return None
    tracks = [_track(t, row) for t in (row.get("tracks") or {}).get("data", [])]
    base = _album(row)
    return AlbumDetail(
        **base.model_dump(),
        durationMs=sum(t.durationMs for t in tracks),
        tracks=tracks,
    )


async def playlist(client: httpx.AsyncClient, playlist_id: str) -> AlbumDetail | None:
    """پلی‌لیست را هم به شکل AlbumDetail برمی‌گردانیم تا فرانت یک صفحه بیشتر لازم نداشته باشد."""
    row = await _get(client, f"/playlist/{playlist_id}")
    if not row.get("id"):
        return None
    tracks = [_track(t) for t in (row.get("tracks") or {}).get("data", []) if t.get("id")]
    creator = row.get("creator") or {}
    return AlbumDetail(
        id=f"deezer:playlist:{row['id']}",
        title=row.get("title") or "",
        artist=creator.get("name") or "پلی‌لیست",
        year=0,
        artworkUrl=row.get("picture_medium") or row.get("picture"),
        trackCount=len(tracks),
        source="deezer",
        sourceUrl=row.get("link") or f"https://www.deezer.com/playlist/{row['id']}",
        durationMs=sum(t.durationMs for t in tracks),
        tracks=tracks,
    )


def parse_url(url: str) -> tuple[str, str] | None:
    if m := ALBUM_URL.search(url):
        return "album", m.group(1)
    if m := PLAYLIST_URL.search(url):
        return "playlist", m.group(1)
    if m := TRACK_URL.search(url):
        return "track", m.group(1)
    return None
