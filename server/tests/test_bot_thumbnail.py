"""
کاورِ ردیفِ آهنگ در تلگرام.

تلگرام دو جای مختلف کاور نشان می‌دهد و از دو جای مختلف می‌گیردش: پلیرِ پایینِ
صفحه از تگِ داخلِ فایل می‌خواند و همیشه دارد، ولی *ردیفِ لیست* فقط همان
thumbnailی را می‌بیند که موقعِ `send_audio` داده‌ایم. نبودنِ آن یعنی آهنگی که
کاور دارد در لیست بی‌تصویر بنشیند — چیزی که وقتی thumbnail را هر بار دوباره از
CDN می‌گرفتیم، با یک تایم‌اوت اتفاق می‌افتاد.
"""

from __future__ import annotations

import asyncio

from app.bot import run as bot


class FakeApi:
    """فقط همان دو متدی که `_fetch_thumbnail` صدا می‌زند."""

    def __init__(self, thumb: bytes | None = None, raw: bytes | None = None):
        self._thumb = thumb
        self._raw = raw
        self.thumb_calls: list[str] = []
        self.raw_calls: list[str] = []

    async def thumb_bytes(self, job_id: str) -> bytes | None:
        self.thumb_calls.append(job_id)
        return self._thumb

    async def raw_bytes(self, url: str) -> bytes | None:
        self.raw_calls.append(url)
        return self._raw


ARTWORK = "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"


def test_the_servers_copy_is_preferred(track):
    """
    سرور کاور را از داخلِ فایلِ دانلودشده درمی‌آورد — بدونِ هیچ درخواستی به
    بیرون. تا وقتی جواب می‌دهد، نباید اصلاً سراغِ CDN رفت.
    """
    api = FakeApi(thumb=b"\xff\xd8server")

    result = asyncio.run(bot._fetch_thumbnail(api, ARTWORK, "job1"))

    assert result is not None
    assert api.thumb_calls == ["job1"]
    assert api.raw_calls == []


def test_the_cdn_is_the_fallback_when_the_server_has_none(track):
    """فایلِ بی‌کاور هنوز می‌تواند از خودِ کاتالوگ کاور بگیرد."""
    api = FakeApi(thumb=None, raw=b"\xff\xd8cdn")

    result = asyncio.run(bot._fetch_thumbnail(api, ARTWORK, "job1"))

    assert result is not None
    assert api.thumb_calls == ["job1"]
    # پله‌ی حساب‌شده اول امتحان می‌شود، نه آدرسِ خامِ ۵۰۰ پیکسلی
    assert api.raw_calls[0].endswith(f"-t{bot.THUMB_SIZE}x{bot.THUMB_SIZE}.jpg")


def test_without_a_job_only_the_cdn_is_available():
    """نتیجه‌ی inline قبل از دانلود هنوز فایلی روی سرور ندارد."""
    api = FakeApi(thumb=b"unused", raw=b"\xff\xd8cdn")

    result = asyncio.run(bot._fetch_thumbnail(api, ARTWORK, None))

    assert result is not None
    assert api.thumb_calls == []
    assert api.raw_calls


def test_nothing_anywhere_sends_without_a_cover():
    """بی‌کاور فرستادن بدتر از نفرستادنِ فایل نیست — نباید خطا بدهد."""
    api = FakeApi(thumb=None, raw=None)

    assert asyncio.run(bot._fetch_thumbnail(api, ARTWORK, "job1")) is None


def test_an_oversized_cdn_cover_is_rejected_not_sent():
    """بالای سقفِ تلگرام، خودِ تلگرام ردش می‌کند و ردیف بی‌تصویر می‌ماند."""
    api = FakeApi(thumb=None, raw=b"x" * (bot.THUMB_MAX_BYTES + 1))

    assert asyncio.run(bot._fetch_thumbnail(api, ARTWORK, "job1")) is None
