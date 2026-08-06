from __future__ import annotations

import asyncio
import json
import os
import tempfile
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

from . import catalog, db, jobs, verify, ydl
from .config import (
    AUDIO_SOURCES,
    DOWNLOAD_DIR,
    FFMPEG_LOCATION,
    FILE_RETENTION_SECONDS,
    HTTP_TIMEOUT,
    JS_RUNTIME,
    LYRICS_ENABLED,
)
from .downloader import safe_name
from .jobs import TERMINAL, manager
from .models import (
    AlbumDetail,
    ArtistDetail,
    DownloadAccepted,
    DownloadRequest,
    LibraryItem,
    LibraryPage,
    SearchResults,
    Track,
    ZipReady,
    ZipRequest,
)
from .providers import spotify

USER_AGENT = "Unstream/0.2 (+local)"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        headers={"user-agent": USER_AGENT},
        follow_redirects=True,
    )

    db.connect()
    # کاری که موقع خاموش شدن سرور نیمه‌کاره مانده هیچ‌وقت خودش تمام نمی‌شود
    db.mark_interrupted()
    await asyncio.to_thread(jobs.sweep_disk)
    sweeper = asyncio.create_task(jobs.sweep_loop())

    yield

    sweeper.cancel()
    await app.state.http.aclose()
    db.close()


app = FastAPI(title="Unstream API", lifespan=lifespan)

# فرانت در دِو روی 5174 است و از پروکسی Vite می‌آید، ولی اجرای مستقیم هم باید کار کند
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5174", "http://127.0.0.1:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "ffmpeg": FFMPEG_LOCATION or "یافت نشد",
        "audioSources": list(AUDIO_SOURCES),
        # یوتیوب هر سه را می‌خواهد؛ اگر یکی نباشد عملاً فقط ساندکلاد می‌ماند
        "youtube": {
            "cookies": ydl.has_cookies(),
            "poToken": ydl.has_potoken(),
            "jsRuntime": JS_RUNTIME or False,
        },
        # این‌ها اختیاری‌اند و نبودنشان فقط قابلیت را خاموش می‌کند، نه سرور را
        "features": {
            "lyrics": LYRICS_ENABLED,
            "spotify": spotify.enabled(),
            "acoustid": verify.available(),
            "fileRetentionDays": round(FILE_RETENTION_SECONDS / 86400, 1),
        },
    }


@app.get("/api/search", response_model=SearchResults)
async def search(q: str, request: Request) -> SearchResults:
    if not q.strip():
        raise HTTPException(400, "عبارت جستجو خالی است")
    try:
        return await catalog.search(request.app.state.http, q.strip())
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"جستجو ناموفق بود: {exc}") from exc


@app.get("/api/album", response_model=AlbumDetail)
async def album(ref: str, request: Request) -> AlbumDetail:
    try:
        detail = await catalog.resolve_ref(request.app.state.http, ref)
    except Exception as exc:
        raise HTTPException(502, f"دریافت آلبوم ناموفق بود: {exc}") from exc
    if detail is None:
        raise HTTPException(404, "این لینک شناخته نشد یا محتوایی نداشت")
    return detail


@app.get("/api/artist", response_model=ArtistDetail)
async def artist(ref: str, request: Request) -> ArtistDetail:
    try:
        detail = await catalog.resolve_artist(request.app.state.http, ref)
    except Exception as exc:
        raise HTTPException(502, f"دریافت هنرمند ناموفق بود: {exc}") from exc
    if detail is None:
        raise HTTPException(404, "این هنرمند پیدا نشد")
    return detail


@app.post("/api/downloads", response_model=DownloadAccepted)
async def create_download(req: DownloadRequest, request: Request) -> DownloadAccepted:
    track = await _track_for(request, req)
    job, reused = manager.create(track, req.quality)
    return DownloadAccepted(jobId=job.id, reused=reused)


# ---------- کتابخانه ----------


def _library_item(row) -> LibraryItem:
    return LibraryItem(
        jobId=row["id"],
        track=Track.model_validate_json(row["track_json"]),
        quality=row["quality"],
        format=row["format"],
        bytes=int(row["bytes"] or 0),
        fileUrl=jobs.file_url(row["id"]),
        lyricsUrl=jobs.lyrics_url(row["id"]) if row["lyrics_path"] else None,
        createdAt=float(row["created_at"]),
    )


@app.get("/api/library", response_model=LibraryPage)
async def library(q: str = "", limit: int = 50, offset: int = 0) -> LibraryPage:
    limit = max(1, min(limit, 200))
    rows, total, total_bytes = await asyncio.to_thread(
        db.library, q, limit, max(0, offset)
    )
    # ردیفی که فایلش دیگر نیست نباید در کتابخانه دیده شود
    items = [
        _library_item(row)
        for row in rows
        if row["path"] and Path(row["path"]).exists()
    ]
    return LibraryPage(items=items, total=total, totalBytes=total_bytes)


@app.delete("/api/library/{job_id}")
async def library_delete(job_id: str) -> dict:
    if not manager.forget(job_id):
        raise HTTPException(404, "این مورد در کتابخانه نبود")
    return {"ok": True}


# آرشیوهای ساخته‌شده: token -> (مسیر، نام فایل، زمان ساخت)
# تک‌مصرف نیستند چون مرورگر گاهی همان URL دانلود را چند بار می‌زند؛
# با pop کردن، تلاش‌های بعدی ۴۰۴ می‌گرفتند.
_archives: dict[str, tuple[Path, str, float]] = {}
ARCHIVE_TTL = 900.0


def _sweep_archives() -> None:
    cutoff = time.time() - ARCHIVE_TTL
    for token in [t for t, (_, _, at) in _archives.items() if at < cutoff]:
        path, _, _ = _archives.pop(token)
        path.unlink(missing_ok=True)


# باید قبل از روت‌های /{job_id} بیاید: FastAPI به‌ترتیب تعریف مچ می‌کند و
# وگرنه «zip» را job_id می‌فهمد و ۴۰۵ برمی‌گرداند.
@app.post("/api/downloads/zip", response_model=ZipReady)
async def create_zip(req: ZipRequest) -> ZipReady:
    """
    ZIP را می‌سازد و فقط آدرسش را برمی‌گرداند — نه خود فایل را.

    عمداً دومرحله‌ای است: پاسخی که content-disposition دارد را مرورگر مستقیم
    به‌عنوان دانلود می‌قاپد و fetch هیچ بدنه‌ای نمی‌بیند. با برگرداندن URL،
    کلاینت مرورگر را به آن می‌فرستد و دانلود بومی و بدون مصرف حافظه انجام می‌شود.
    """
    files: list[Path] = []
    seen: set[str] = set()
    for job_id in req.jobIds:
        job = manager.get(job_id)
        if job is None or job.path is None or not job.path.exists():
            continue
        if job.path.name in seen:
            continue
        seen.add(job.path.name)
        files.append(job.path)
        # متن هم‌زمان‌شده کنار فایل صوتی می‌رود تا پلیرها خودشان پیدایش کنند
        if job.lyrics_path and job.lyrics_path.exists():
            files.append(job.lyrics_path)

    if not files:
        raise HTTPException(404, "هیچ فایل آماده‌ای برای بسته‌بندی نبود")

    # روی دیسک ساخته می‌شود، نه در حافظه: یک آلبوم می‌تواند صدها مگابایت باشد.
    # ZIP_STORED چون mp3 از قبل فشرده است و دفلیت فقط CPU می‌سوزاند.
    def build() -> Path:
        handle, tmp = tempfile.mkstemp(suffix=".zip", dir=DOWNLOAD_DIR)
        os.close(handle)
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as archive:
            for path in files:
                archive.write(path, arcname=path.name)
        return Path(tmp)

    _sweep_archives()
    archive_path = await asyncio.to_thread(build)
    token = uuid.uuid4().hex[:12]
    _archives[token] = (archive_path, f"{safe_name(req.name)}.zip", time.time())

    return ZipReady(
        url=f"/api/downloads/zip/{token}",
        bytes=archive_path.stat().st_size,
        files=len(files),
    )


@app.get("/api/downloads/zip/{token}")
async def fetch_zip(token: str) -> FileResponse:
    entry = _archives.get(token)
    if entry is None or not entry[0].exists():
        raise HTTPException(404, "این آرشیو منقضی شده — دوباره بساز")

    path, filename, _ = entry
    return FileResponse(path, filename=filename, media_type="application/zip")


@app.get("/api/downloads/{job_id}/events")
async def download_events(job_id: str, request: Request) -> StreamingResponse:
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(404, "این کار پیدا نشد")

    queue = await manager.subscribe(job)

    async def stream():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    progress = await asyncio.wait_for(queue.get(), timeout=15.0)
                except TimeoutError:
                    yield ": keep-alive\n\n"  # جلوگیری از بسته شدن اتصال توسط پروکسی
                    continue

                yield f"data: {json.dumps(progress.model_dump(), ensure_ascii=False)}\n\n"
                if progress.status in TERMINAL:
                    break
        finally:
            manager.unsubscribe(job, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )


@app.delete("/api/downloads/{job_id}")
async def cancel_download(job_id: str) -> dict:
    if not manager.cancel(job_id):
        raise HTTPException(404, "کاری برای لغو نبود")
    return {"ok": True}


@app.get("/api/downloads/{job_id}/file")
async def download_file(job_id: str) -> FileResponse:
    job = manager.get(job_id)
    if job is None or job.path is None or not job.path.exists():
        raise HTTPException(404, "فایل آماده نیست")
    return FileResponse(
        job.path,
        filename=job.path.name,
        media_type="application/octet-stream",
    )


@app.get("/api/downloads/{job_id}/lyrics")
async def download_lyrics(job_id: str) -> FileResponse:
    job = manager.get(job_id)
    if job is None or job.lyrics_path is None or not job.lyrics_path.exists():
        raise HTTPException(404, "متن هم‌زمان‌شده‌ای برای این آهنگ نیست")
    return FileResponse(
        job.lyrics_path,
        filename=job.lyrics_path.name,
        media_type="text/plain; charset=utf-8",
    )


async def _track_for(request: Request, req: DownloadRequest) -> Track:
    """
    فرانت فقط trackId و sourceUrl می‌فرستد. اگر متادیتا همراهش آمده باشد از آن
    استفاده می‌کنیم، وگرنه از روی id بازسازی‌اش می‌کنیم تا تگ‌ها درست دربیایند.
    """
    if req.title and req.artist:
        return Track(
            id=req.trackId,
            title=req.title,
            artist=req.artist,
            album=req.album,
            durationMs=req.durationMs or 0,
            artworkUrl=req.artworkUrl,
            source=_source_of(req.trackId),
            sourceUrl=req.sourceUrl,
        )

    if found := await _lookup_track(request, req):
        return found

    raise HTTPException(400, "متادیتای این آهنگ پیدا نشد")


def _source_of(track_id: str) -> str:
    prefix = track_id.split(":", 1)[0]
    return {
        "itunes": "apple",
        "deezer": "deezer",
        "sp": "spotify",
        "yt": "youtube",
        "sc": "soundcloud",
    }.get(prefix, "youtube")


async def _lookup_track(request: Request, req: DownloadRequest) -> Track | None:
    """بازیابی متادیتای ترک از روی شناسه‌ی داخلی."""
    client = request.app.state.http
    provider, _, ident = (req.trackId.split(":", 2) + ["", ""])[:3]

    try:
        if provider == "itunes":
            rows = (
                await client.get(
                    "https://itunes.apple.com/lookup", params={"id": ident}
                )
            ).json().get("results", [])
            if rows:
                from .providers.itunes import _track

                return _track(rows[0])
        elif provider == "deezer":
            row = (await client.get(f"https://api.deezer.com/track/{ident}")).json()
            if row.get("id"):
                from .providers.deezer import _track

                return _track(row)
        elif provider == "sp" and spotify.enabled():
            detail = await spotify.track(client, ident)
            if detail and detail.tracks:
                return detail.tracks[0]
        elif provider in ("yt", "sc"):
            detail = await catalog.resolve_ref(client, req.sourceUrl)
            if detail and detail.tracks:
                return detail.tracks[0]
    except Exception:
        return None
    return None
