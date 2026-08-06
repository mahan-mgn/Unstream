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

from . import catalog, ydl
from .config import (
    AUDIO_SOURCES,
    DOWNLOAD_DIR,
    FFMPEG_LOCATION,
    HTTP_TIMEOUT,
    JS_RUNTIME,
)
from .downloader import safe_name
from .jobs import TERMINAL, manager
from .models import (
    AlbumDetail,
    DownloadAccepted,
    DownloadRequest,
    SearchResults,
    Track,
    ZipReady,
    ZipRequest,
)

USER_AGENT = "Unstream/0.1 (+local)"


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http = httpx.AsyncClient(
        timeout=HTTP_TIMEOUT,
        headers={"user-agent": USER_AGENT},
        follow_redirects=True,
    )
    yield
    await app.state.http.aclose()


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


@app.post("/api/downloads", response_model=DownloadAccepted)
async def create_download(req: DownloadRequest, request: Request) -> DownloadAccepted:
    track = await _track_for(request, req)
    job = manager.create(track, req.quality)
    return DownloadAccepted(jobId=job.id)


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
        elif provider in ("yt", "sc"):
            detail = await catalog.resolve_ref(client, req.sourceUrl)
            if detail and detail.tracks:
                return detail.tracks[0]
    except Exception:
        return None
    return None
