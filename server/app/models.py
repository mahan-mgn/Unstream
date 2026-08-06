"""مدل‌های داده — دقیقاً آینه‌ی src/lib/types.ts در فرانت."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Source = Literal["apple", "deezer", "soundcloud", "spotify", "youtube"]
Quality = Literal["128", "320", "original"]
JobStatus = Literal[
    "queued", "searching", "downloading", "tagging", "ready", "error", "canceled"
]


class Track(BaseModel):
    id: str
    title: str
    artist: str
    album: str | None = None
    albumId: str | None = None
    durationMs: int
    artworkUrl: str | None = None
    source: Source
    sourceUrl: str
    previewUrl: str | None = None
    explicit: bool = False


class Artist(BaseModel):
    id: str
    name: str
    artworkUrl: str | None = None
    source: Source
    sourceUrl: str
    subtitle: str


class Album(BaseModel):
    id: str
    title: str
    artist: str
    year: int
    artworkUrl: str | None = None
    trackCount: int
    source: Source
    sourceUrl: str


class Playlist(BaseModel):
    id: str
    title: str
    owner: str
    trackCount: int
    artworkUrl: str | None = None
    source: Source
    sourceUrl: str


class AlbumDetail(Album):
    durationMs: int
    tracks: list[Track]


class SearchResults(BaseModel):
    query: str
    tracks: list[Track] = Field(default_factory=list)
    artists: list[Artist] = Field(default_factory=list)
    albums: list[Album] = Field(default_factory=list)
    playlists: list[Playlist] = Field(default_factory=list)


class DownloadProgress(BaseModel):
    status: JobStatus
    percent: float = 0
    error: str | None = None
    fileUrl: str | None = None
    format: str | None = None


class DownloadRequest(BaseModel):
    trackId: str
    sourceUrl: str
    quality: Quality = "320"
    # فرانت این‌ها را نمی‌فرستد ولی اگر بفرستد، از جستجوی متادیتای دوباره جلوگیری می‌شود
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    durationMs: int | None = None
    artworkUrl: str | None = None


class DownloadAccepted(BaseModel):
    jobId: str


class ZipRequest(BaseModel):
    jobIds: list[str]
    # نام فایل zip؛ معمولاً عنوان آلبوم
    name: str = "unstream"


class ZipReady(BaseModel):
    """آدرس دانلود آرشیو — خودِ فایل در درخواست بعدی می‌آید."""

    url: str
    bytes: int
    files: int
