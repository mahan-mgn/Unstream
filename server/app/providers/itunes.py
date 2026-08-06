"""iTunes Search API — عمومی، بدون کلید، سخاوتمند برای موسیقی فارسی."""

from __future__ import annotations

import asyncio
import re
from typing import Any

import httpx

from ..config import ITUNES_API, SEARCH_LIMIT
from ..models import Album, AlbumDetail, Artist, SearchResults, Track

# https://music.apple.com/us/album/mard-e-tanha/1801042661?i=1801042670
ALBUM_URL = re.compile(r"music\.apple\.com/[^/]+/album/[^/]*/(\d+)", re.I)
ARTIST_URL = re.compile(r"music\.apple\.com/[^/]+/artist/[^/]*/(\d+)", re.I)


def artwork(url: str | None, size: int = 300) -> str | None:
    """کاورهای اپل با اندازه در نام فایل می‌آیند؛ به اندازه‌ی دلخواه بزرگش می‌کنیم."""
    if not url:
        return None
    return re.sub(r"/\d+x\d+bb\.(jpg|png)", f"/{size}x{size}bb.\\1", url)


def _track(row: dict[str, Any]) -> Track:
    return Track(
        id=f"itunes:track:{row['trackId']}",
        title=row.get("trackName") or "",
        artist=row.get("artistName") or "",
        album=row.get("collectionName"),
        albumId=f"itunes:album:{row['collectionId']}" if row.get("collectionId") else None,
        durationMs=int(row.get("trackTimeMillis") or 0),
        artworkUrl=artwork(row.get("artworkUrl100")),
        source="apple",
        sourceUrl=row.get("trackViewUrl") or "",
        previewUrl=row.get("previewUrl"),
        explicit=row.get("trackExplicitness") == "explicit",
    )


def _album(row: dict[str, Any]) -> Album:
    return Album(
        id=f"itunes:album:{row['collectionId']}",
        title=row.get("collectionName") or "",
        artist=row.get("artistName") or "",
        year=int((row.get("releaseDate") or "0000")[:4] or 0),
        artworkUrl=artwork(row.get("artworkUrl100")),
        trackCount=int(row.get("trackCount") or 0),
        source="apple",
        sourceUrl=row.get("collectionViewUrl") or "",
    )


def _artist(row: dict[str, Any]) -> Artist:
    return Artist(
        id=f"itunes:artist:{row['artistId']}",
        name=row.get("artistName") or "",
        artworkUrl=None,  # iTunes Search عکس هنرمند نمی‌دهد
        source="apple",
        sourceUrl=row.get("artistLinkUrl") or "",
        subtitle=row.get("primaryGenreName") or "هنرمند",
    )


async def _get(client: httpx.AsyncClient, path: str, **params: Any) -> list[dict[str, Any]]:
    res = await client.get(f"{ITUNES_API}{path}", params=params)
    res.raise_for_status()
    # iTunes گاهی content-type اشتباه برمی‌گرداند، پس دستی پارس می‌کنیم
    return res.json().get("results", [])


async def search(client: httpx.AsyncClient, query: str) -> SearchResults:
    # سه فراخوانی مستقل‌اند — پشت‌سرهم زدنشان زمان جستجو را سه برابر می‌کند
    songs, albums, artists = await asyncio.gather(
        _get(client, "/search", term=query, entity="song", limit=SEARCH_LIMIT),
        _get(client, "/search", term=query, entity="album", limit=SEARCH_LIMIT),
        _get(client, "/search", term=query, entity="musicArtist", limit=8),
    )
    return SearchResults(
        query=query,
        tracks=[_track(r) for r in songs if r.get("trackId")],
        albums=[_album(r) for r in albums if r.get("collectionId")],
        artists=[_artist(r) for r in artists if r.get("artistId")],
        playlists=[],  # iTunes Search پلی‌لیست ندارد — از دیزر می‌آید
    )


async def album(client: httpx.AsyncClient, collection_id: str) -> AlbumDetail | None:
    rows = await _get(client, "/lookup", id=collection_id, entity="song", limit=200)
    head = next((r for r in rows if r.get("wrapperType") == "collection"), None)
    if head is None:
        return None

    # lookup از قبل به ترتیب دیسک/شماره‌ی ترک می‌آید
    tracks = [
        _track(r)
        for r in rows
        if r.get("wrapperType") == "track" and r.get("kind") == "song" and r.get("trackId")
    ]
    base = _album(head)
    return AlbumDetail(
        **base.model_dump(),
        durationMs=sum(t.durationMs for t in tracks),
        tracks=tracks,
    )


def parse_url(url: str) -> tuple[str, str] | None:
    """('album', id) اگر لینک اپل‌موزیک باشد."""
    if m := ALBUM_URL.search(url):
        return "album", m.group(1)
    if m := ARTIST_URL.search(url):
        return "artist", m.group(1)
    return None


__all__ = ["search", "album", "parse_url", "artwork"]
