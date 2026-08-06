"""مدل‌های داده — دقیقاً آینه‌ی src/lib/types.ts در فرانت."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Source = Literal["apple", "deezer", "soundcloud", "spotify", "youtube"]

# سه تا بیت‌ریت mp3، سه کدک مشخص، و «اورجینال» یعنی دست‌نخورده.
# کدک‌های بی‌اتلاف روی منبع باکیفیتِ لاسی فقط حجم اضافه می‌کنند — ولی انتخابش با کاربر است.
Quality = Literal["128", "192", "320", "m4a", "opus", "flac", "original"]

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


class ArtistDetail(Artist):
    """صفحه‌ی هنرمند: چند ترک محبوب به‌علاوه‌ی دیسکوگرافی."""

    topTracks: list[Track] = Field(default_factory=list)
    albums: list[Album] = Field(default_factory=list)


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
    # فایل سالم است ولی چیزی مشکوک بوده — مثلاً AcoustID ترک دیگری را شناخته
    warning: str | None = None
    # آدرس فایل .lrc اگر متن هم‌زمان‌شده پیدا شده باشد
    lyricsUrl: str | None = None


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
    # اگر همین ترک با همین کیفیت از قبل در کتابخانه بوده، دوباره دانلود نمی‌شود
    reused: bool = False


class LibraryItem(BaseModel):
    """یک فایل آماده روی دیسک. همان جاب موفق است، از زاویه‌ی کتابخانه."""

    jobId: str
    track: Track
    quality: Quality
    format: str | None = None
    bytes: int = 0
    fileUrl: str
    lyricsUrl: str | None = None
    createdAt: float


class LibraryPage(BaseModel):
    items: list[LibraryItem]
    total: int
    totalBytes: int


class ZipRequest(BaseModel):
    jobIds: list[str]
    # نام فایل zip؛ معمولاً عنوان آلبوم
    name: str = "unstream"


class ZipReady(BaseModel):
    """آدرس دانلود آرشیو — خودِ فایل در درخواست بعدی می‌آید."""

    url: str
    bytes: int
    files: int
