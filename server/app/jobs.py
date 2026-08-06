"""
صف کارهای دانلود.

هر کار یک state ماشین است: queued → searching → downloading → tagging → ready | error.
yt-dlp بلاک‌کننده است، پس در thread اجرا می‌شود و پیشرفت را به حلقه‌ی asyncio پس می‌دهد.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from . import downloader, resolver
from .config import JOB_TTL_SECONDS, MAX_CONCURRENT_DOWNLOADS
from .models import DownloadProgress, Quality, Track


@dataclass
class Job:
    id: str
    track: Track
    quality: Quality
    progress: DownloadProgress
    path: Path | None = None
    task: asyncio.Task | None = None
    finished_at: float | None = None
    subscribers: set[asyncio.Queue[DownloadProgress]] = field(default_factory=set)


TERMINAL = ("ready", "error", "canceled")

# خطاهای خام yt-dlp برای کاربر بی‌معنی‌اند؛ به پیام قابل‌فهم ترجمه می‌شوند
_ERROR_HINTS = (
    ("not a bot", "یوتیوب احراز هویت می‌خواهد — UNSTREAM_COOKIES_BROWSER را ست کن"),
    ("DRM", "این نسخه DRM دارد و قابل دانلود نیست"),
    ("Private video", "این ویدیو خصوصی است"),
    ("Video unavailable", "این ویدیو در دسترس نیست"),
    ("HTTP Error 404", "لینک منبع پیدا نشد"),
    ("Requested format", "فرمت صوتی قابل دانلودی ارائه نشد"),
)


def _readable(raw: str) -> str:
    for needle, message in _ERROR_HINTS:
        if needle.lower() in raw.lower():
            return message
    return raw.replace("ERROR: ", "").strip()[:200] or "دانلود ناموفق بود"


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._slots = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
        self._loop: asyncio.AbstractEventLoop | None = None

    # ---------- ورودی عمومی ----------

    def create(self, track: Track, quality: Quality) -> Job:
        self._loop = asyncio.get_running_loop()
        self._sweep()

        job = Job(
            id=uuid.uuid4().hex[:12],
            track=track,
            quality=quality,
            progress=DownloadProgress(status="queued", percent=0),
        )
        self._jobs[job.id] = job
        job.task = asyncio.create_task(self._run(job))
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if not job or job.progress.status in TERMINAL:
            return False
        if job.task:
            job.task.cancel()
        return True

    async def subscribe(self, job: Job) -> asyncio.Queue[DownloadProgress]:
        """
        صف رویداد یک مشترک. وضعیت فعلی بلافاصله فرستاده می‌شود تا اگر کلاینت
        دیر وصل شد (یا کار خیلی زود تمام شد) هیچ رویدادی را از دست ندهد.
        """
        queue: asyncio.Queue[DownloadProgress] = asyncio.Queue()
        await queue.put(job.progress)
        if job.progress.status not in TERMINAL:
            job.subscribers.add(queue)
        return queue

    def unsubscribe(self, job: Job, queue: asyncio.Queue[DownloadProgress]) -> None:
        job.subscribers.discard(queue)

    # ---------- داخلی ----------

    def _emit(self, job: Job, **changes) -> None:
        job.progress = job.progress.model_copy(update=changes)
        if job.progress.status in TERMINAL:
            job.finished_at = time.time()
        for queue in list(job.subscribers):
            queue.put_nowait(job.progress)

    def _emit_threadsafe(self, job: Job, **changes) -> None:
        """از داخل thread دانلود صدا زده می‌شود."""
        if self._loop is not None:
            self._loop.call_soon_threadsafe(lambda: self._emit(job, **changes))

    async def _run(self, job: Job) -> None:
        try:
            async with self._slots:
                self._emit(job, status="searching", percent=0)

                candidates = await asyncio.to_thread(resolver.resolve, job.track)
                if not candidates:
                    self._emit(
                        job,
                        status="error",
                        error="نسخه‌ی قابل دانلودی برای این آهنگ پیدا نشد",
                    )
                    return

                # throttle: پروگرس‌هوک yt-dlp خیلی پرتکرار است
                last_sent = 0.0

                def on_progress(pct: float) -> None:
                    nonlocal last_sent
                    if pct - last_sent >= 1.0 or pct >= 99:
                        last_sent = pct
                        self._emit_threadsafe(job, status="downloading", percent=pct)

                path: Path | None = None
                last_error: str = ""

                # کاندید با بالاترین امتیاز لزوماً دانلودشدنی نیست (گیت ضدربات،
                # DRM، لینک مرده) — تا اولین موفقیت پایین می‌رویم
                for candidate in candidates:
                    last_sent = 0.0
                    self._emit(job, status="downloading", percent=0)
                    try:
                        path = await asyncio.to_thread(
                            downloader.download,
                            job.track,
                            candidate.url,
                            job.quality,
                            on_progress,
                        )
                        break
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:  # noqa: BLE001
                        last_error = str(exc)

                if path is None:
                    self._emit(
                        job,
                        status="error",
                        percent=0,
                        error=_readable(last_error),
                    )
                    return

                self._emit(job, status="tagging", percent=100)
                await asyncio.to_thread(downloader.tag, path, job.track)

                job.path = path
                self._emit(
                    job,
                    status="ready",
                    percent=100,
                    format=await asyncio.to_thread(downloader.describe, path),
                    fileUrl=f"/api/downloads/{job.id}/file",
                )

        except asyncio.CancelledError:
            self._emit(job, status="canceled", percent=0)
            raise
        except Exception as exc:  # noqa: BLE001 — هر خطایی باید به کلاینت برسد
            self._emit(job, status="error", error=_readable(str(exc)))

    def _sweep(self) -> None:
        """کارهای تمام‌شده‌ی قدیمی را از حافظه پاک می‌کند."""
        cutoff = time.time() - JOB_TTL_SECONDS
        stale = [
            jid
            for jid, j in self._jobs.items()
            if j.finished_at is not None and j.finished_at < cutoff
        ]
        for jid in stale:
            del self._jobs[jid]


manager = JobManager()
