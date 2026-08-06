"""
صف کارهای دانلود.

هر کار یک state ماشین است: queued → searching → downloading → tagging → ready | error.
yt-dlp بلاک‌کننده است، پس در thread اجرا می‌شود و پیشرفت را به حلقه‌ی asyncio پس می‌دهد.

دیتابیس منبع حقیقت است و حافظه فقط کش. کار تمام‌شده بعد از مدتی از کش بیرون
می‌رود ولی ردیفش می‌ماند — «کتابخانه» دقیقاً همین ردیف‌های موفق‌اند.
"""

from __future__ import annotations

import asyncio
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from . import db, downloader, resolver, verify
from .config import (
    DOWNLOAD_DIR,
    FILE_RETENTION_SECONDS,
    JOB_TTL_SECONDS,
    MAX_CONCURRENT_DOWNLOADS,
)
from .models import DownloadProgress, Quality, Track


@dataclass
class Job:
    id: str
    track: Track
    quality: Quality
    progress: DownloadProgress
    path: Path | None = None
    lyrics_path: Path | None = None
    bytes: int = 0
    created_at: float = field(default_factory=time.time)
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


def file_url(job_id: str) -> str:
    return f"/api/downloads/{job_id}/file"


def lyrics_url(job_id: str) -> str:
    return f"/api/downloads/{job_id}/lyrics"


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._slots = asyncio.Semaphore(MAX_CONCURRENT_DOWNLOADS)
        self._loop: asyncio.AbstractEventLoop | None = None

    # ---------- ورودی عمومی ----------

    def create(self, track: Track, quality: Quality) -> tuple[Job, bool]:
        """(کار، آیا از کتابخانه بازاستفاده شد)."""
        self._loop = asyncio.get_running_loop()
        self._sweep()

        if existing := self._reusable(track.id, quality):
            return existing, True

        job = Job(
            id=uuid.uuid4().hex[:12],
            track=track,
            quality=quality,
            progress=DownloadProgress(status="queued", percent=0),
        )
        self._jobs[job.id] = job
        db.insert_job(job.id, track, quality, "queued", job.created_at)
        job.task = asyncio.create_task(self._run(job))
        return job, False

    def get(self, job_id: str) -> Job | None:
        """کش، وگرنه دیتابیس. بعد از ری‌استارت سرور هم فایل‌های قدیمی پیدا می‌شوند."""
        if job := self._jobs.get(job_id):
            return job
        row = db.get_job(job_id)
        if row is None:
            return None
        job = self._from_row(row)
        self._jobs[job.id] = job
        return job

    def cancel(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if not job or job.progress.status in TERMINAL:
            return False
        if job.task:
            job.task.cancel()
        return True

    def forget(self, job_id: str) -> bool:
        """حذف کامل: فایل، متن، و ردیف دیتابیس."""
        job = self.get(job_id)
        if job is None:
            return False
        self.cancel(job_id)
        for path in (job.path, job.lyrics_path):
            if path:
                path.unlink(missing_ok=True)
        self._jobs.pop(job_id, None)
        db.delete_job(job_id)
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

    def _from_row(self, row: sqlite3.Row) -> Job:
        path = db.row_path(row)
        lyrics = Path(row["lyrics_path"]) if row["lyrics_path"] else None
        return Job(
            id=row["id"],
            track=Track.model_validate_json(row["track_json"]),
            quality=row["quality"],
            path=path,
            lyrics_path=lyrics,
            bytes=int(row["bytes"] or 0),
            created_at=float(row["created_at"]),
            finished_at=row["finished_at"],
            progress=DownloadProgress(
                status=row["status"],
                percent=100.0 if row["status"] == "ready" else 0.0,
                error=row["error"],
                warning=row["warning"],
                format=row["format"],
                fileUrl=file_url(row["id"]) if path else None,
                lyricsUrl=lyrics_url(row["id"]) if lyrics else None,
            ),
        )

    def _reusable(self, track_id: str, quality: Quality) -> Job | None:
        """
        همین ترک با همین کیفیت از قبل دانلود شده؟ پس دوباره نگیرش.

        این تنها جایی است که کتابخانه واقعاً به کار می‌آید: «دانلود همه»ی یک
        آلبومی که نصفش را قبلاً گرفته‌ای، فقط بقیه‌اش را می‌گیرد.
        """
        row = db.find_ready(track_id, quality)
        if row is None:
            return None
        job = self._jobs.get(row["id"]) or self._from_row(row)
        if job.path is None or not job.path.exists():
            # ردیف هست ولی فایل نیست (پاک‌سازی دیسک یا حذف دستی) — ردیف را هم ببر
            db.delete_job(row["id"])
            self._jobs.pop(row["id"], None)
            return None
        self._jobs[job.id] = job
        return job

    def _emit(self, job: Job, **changes) -> None:
        job.progress = job.progress.model_copy(update=changes)
        if job.progress.status in TERMINAL:
            job.finished_at = time.time()

        # درصد عمداً ذخیره نمی‌شود: صدها نوشتن در ثانیه برای عددی که
        # بعد از ری‌استارت هیچ معنایی ندارد.
        if "status" in changes:
            db.update_job(
                job.id,
                status=job.progress.status,
                error=job.progress.error,
                warning=job.progress.warning,
                format=job.progress.format,
                path=str(job.path) if job.path else None,
                lyrics_path=str(job.lyrics_path) if job.lyrics_path else None,
                bytes=job.bytes,
                finished_at=job.finished_at,
            )

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
                job.path = path
                job.lyrics_path = await asyncio.to_thread(
                    downloader.finalize, path, job.track
                )
                job.bytes = path.stat().st_size

                # فینگرپرینت صوتی فایل را رد نمی‌کند، فقط هشدار می‌دهد —
                # AcoustID روی موسیقی غیرغربی پوشش کاملی ندارد
                warning = await asyncio.to_thread(
                    verify.check, path, job.track.title, job.track.artist
                )

                self._emit(
                    job,
                    status="ready",
                    percent=100,
                    warning=warning,
                    format=await asyncio.to_thread(downloader.describe, path),
                    fileUrl=file_url(job.id),
                    lyricsUrl=lyrics_url(job.id) if job.lyrics_path else None,
                )

        except asyncio.CancelledError:
            self._emit(job, status="canceled", percent=0)
            raise
        except Exception as exc:  # noqa: BLE001 — هر خطایی باید به کلاینت برسد
            self._emit(job, status="error", error=_readable(str(exc)))

    def _sweep(self) -> None:
        """
        کش حافظه را کوتاه نگه می‌دارد. ردیف دیتابیس دست نمی‌خورد — کار موفق
        باید در کتابخانه بماند و `get()` هر وقت لازم شد دوباره از دیسک می‌خواندش.
        """
        cutoff = time.time() - JOB_TTL_SECONDS
        stale = [
            jid
            for jid, j in self._jobs.items()
            if j.finished_at is not None and j.finished_at < cutoff and not j.subscribers
        ]
        for jid in stale:
            del self._jobs[jid]


manager = JobManager()


# ---------- نگهداری ----------


def sweep_disk() -> dict[str, int]:
    """
    فایل‌های منقضی و یتیم را از دیسک پاک می‌کند.

    قبلاً هیچ‌کس این کار را نمی‌کرد: جاب از حافظه می‌رفت ولی فایلش می‌ماند و
    `server/downloads/` تا آخر عمر پروژه بزرگ می‌شد.
    """
    now = time.time()
    removed_files = 0
    removed_rows = 0

    if FILE_RETENTION_SECONDS > 0:
        for row in db.expired_files(now - FILE_RETENTION_SECONDS):
            for value in (row["path"], row["lyrics_path"]):
                if value:
                    Path(value).unlink(missing_ok=True)
            db.delete_job(row["id"])
            manager._jobs.pop(row["id"], None)
            removed_files += 1

    for job_id in db.expired_failures(now - JOB_TTL_SECONDS):
        db.delete_job(job_id)
        manager._jobs.pop(job_id, None)
        removed_rows += 1

    # فایلی که هیچ ردیفی مالکش نیست، بازمانده‌ی دانلود شکست‌خورده یا نسخه‌ی
    # قبل از دیتابیس است. مهلت یک‌ساعته می‌دهیم تا دانلود در جریان قربانی نشود.
    known = db.known_paths()
    orphans = 0
    for path in DOWNLOAD_DIR.iterdir():
        if not path.is_file() or str(path) in known:
            continue
        try:
            if now - path.stat().st_mtime < 3600:
                continue
            path.unlink(missing_ok=True)
            orphans += 1
        except OSError:
            continue

    return {"files": removed_files, "rows": removed_rows, "orphans": orphans}


async def sweep_loop(interval: float = 900.0) -> None:
    """حلقه‌ی پس‌زمینه‌ی نگهداری — در lifespan اپ بالا می‌آید."""
    while True:
        try:
            await asyncio.sleep(interval)
            await asyncio.to_thread(sweep_disk)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — نگهداری نباید سرور را بخواباند
            continue
