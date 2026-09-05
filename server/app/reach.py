"""
«اینترنتِ بین‌الملل هست یا نه؟»

در ایران قطعیِ بین‌الملل یعنی اینترنتِ ملی برقرار است: سرورِ خانگی از روی
وای‌فای در دسترس است، فایل‌ها پخش می‌شوند، پلی‌لیست‌ها باز می‌شوند — ولی هر
درخواستی به اپل/دیزر/اسپاتیفای/یوتیوب در تایم‌اوت می‌میرد. از دیدِ برنامه این
حالت نه «آنلاین» است نه «آفلاین»، و تا وقتی اسمی نداشت، به‌شکلِ یک مشتْ خطای
۵۰۲ِ بی‌ربط بیرون می‌زد.

اینجا آن حالت یک نامِ صریح می‌گیرد و بقیه‌ی برنامه بر اساسش تصمیم می‌گیرد:
کاتالوگ به کشِ محلی برمی‌گردد، دانلود به‌جای شکست در صف می‌نشیند، و فرانت
به‌جای «جستجو ناموفق بود» می‌گوید چه خبر است.

`navigator.onLine` این را نمی‌فهمد: از دیدِ گوشی، وای‌فای وصل است و اینترنت
هست. تنها جایی که می‌شود واقعاً فهمید، خودِ سرور است.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

from .config import (
    PROXY,
    REACH_INTERVAL,
    REACH_PROBES,
    REACH_RETRY_INTERVAL,
    REACH_STRIKES,
    REACH_TIMEOUT,
)

log = logging.getLogger(__name__)

# خطاهایی که یعنی «نرسیدیم»، در برابر خطاهایی که یعنی «رسیدیم ولی جواب بد بود».
# یک ۴۰۳ِ یوتیوب یا ۴۲۹ِ اسپاتیفای مشکلِ دسترسی نیست و نباید کلِ برنامه را به
# حالتِ اینترانت ببرد.
_UNREACHABLE = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.PoolTimeout,
    httpx.RemoteProtocolError,
)


class _State:
    """
    وضعیتِ فعلی، به‌علاوه‌ی زمانی که آخرین بار واقعاً بررسی شده.

    خوش‌بینانه شروع می‌شود: تا اولین پروب تمام نشده، رفتارِ برنامه همان رفتارِ
    عادی است. حدسِ بدبینانه در ثانیه‌ی اولِ بالا آمدنِ سرور یعنی اولین جستجوی
    کاربر بی‌دلیل به کش می‌رفت.
    """

    def __init__(self) -> None:
        self.online = True
        self.checked_at = 0.0
        self.reachable: tuple[str, ...] = ()
        # شکست‌های پشت‌سرهم. تا به `REACH_STRIKES` نرسد، وضعیت عوض نمی‌شود —
        # `REACH_STRIKES` در config توضیح می‌دهد چرا این نامتقارنی عمدی است.
        self.strikes = 0
        # وقتی چیزی وضعیت را عوض کرد، حلقه‌ی پس‌زمینه باید زودتر از موعد
        # دوباره بررسی کند — نه اینکه یک دوره‌ی کامل صبر کند
        self.wake = asyncio.Event()


_state = _State()


def online() -> bool:
    return _state.online


def snapshot() -> dict:
    """چیزی که `/api/net` و `/api/health` بیرون می‌دهند."""
    return {
        "online": _state.online,
        "checkedAt": _state.checked_at,
        "reachable": list(_state.reachable),
        "probes": list(REACH_PROBES),
        # بیرون می‌آید چون تشخیصِ اشتباه یک‌بار اتفاق افتاده و بدونِ دیدنِ این
        # عدد، «چرا رفت روی اینترانت؟» فقط قابل حدس‌زدن بود
        "strikes": _state.strikes,
    }


def _set(online_now: bool, reachable: tuple[str, ...] = ()) -> None:
    changed = online_now != _state.online
    _state.online = online_now
    _state.checked_at = time.time()
    _state.reachable = reachable
    if changed:
        log.info("وضعیت اینترنتِ بین‌الملل: %s", "برقرار" if online_now else "قطع (اینترانت)")
        try:
            _state.wake.set()
        except RuntimeError:
            pass  # هنوز حلقه‌ی رویدادی در کار نیست (تست‌های همگام)


def note_reachable() -> None:
    """
    یک درخواستِ واقعی به بالادست جواب داد.

    مجانی‌ترین سیگنالِ ممکن است: اگر جستجو همین الان از دیزر جواب گرفته، لازم
    نیست تا پروبِ بعدی صبر کنیم تا بفهمیم اینترنت برگشته. یک موفقیت بس است —
    شمارنده هم صفر می‌شود، وگرنه شکستِ نیم‌ساعتِ پیش با شکستِ بعدی جمع می‌شد
    و دو رویدادِ بی‌ربط به یک «قطعی» تبدیل می‌شدند.
    """
    _state.strikes = 0
    if not _state.online:
        _set(True, _state.reachable)


def note_unreachable(exc: BaseException) -> bool:
    """
    یک درخواستِ واقعی شکست خورد. اگر شکستش از جنسِ «نرسیدیم» بود، همین‌جا به
    حالتِ اینترانت می‌رویم.

    برمی‌گرداند که این خطا را نشانه‌ی قطعی دانستیم یا نه — صداکننده بر اساسش
    تصمیم می‌گیرد پیامِ «اینترانت» بدهد یا خطای واقعیِ خودش را.
    """
    if not isinstance(exc, _UNREACHABLE):
        # خطا ممکن است داخلِ ExceptionGroup یا `__cause__` پیچیده شده باشد؛
        # asyncio.gather و httpx هر دو این کار را می‌کنند
        cause = getattr(exc, "__cause__", None)
        if cause is None or not isinstance(cause, _UNREACHABLE):
            return False
    _strike()
    # همیشه True: این *درخواست* واقعاً به بالادست نرسید و باید سراغِ کش برود،
    # مستقل از اینکه هنوز به حدِ نصابِ «کلِ برنامه در حالتِ اینترانت» رسیده‌ایم
    # یا نه. جدا کردنِ این دو عمدی است — یک ریستِ اتفاقیِ TCP نباید جستجوی
    # زنده را برای همه‌ی درخواست‌های بعدی خاموش کند.
    return True


def _strike() -> None:
    """یک شکست ثبت می‌کند و اگر به حدِ نصاب رسید، وضعیت را «قطع» می‌کند."""
    _state.strikes += 1
    if _state.online and _state.strikes >= REACH_STRIKES:
        _set(False, ())
        try:
            _state.wake.set()
        except RuntimeError:
            pass


async def _probe(client: httpx.AsyncClient, url: str) -> str | None:
    """
    یک آدرس. *هر* پاسخِ HTTP یعنی رسیدیم — حتی ۴۰۴.

    چیزی که اندازه می‌گیریم دسترسیِ شبکه است نه سلامتِ API. اگر اپل امروز روی
    این مسیر ۴۰۳ بدهد، اینترنت همچنان وصل است و بردنِ برنامه به حالتِ اینترانت
    دقیقاً همان خطای پرهزینه‌ای است که این ماژول برای جلوگیری‌اش نوشته شده.
    """
    try:
        await client.get(url)
        return url
    except Exception:
        return None


async def check() -> bool:
    """یک دورِ کاملِ پروب. همه هم‌زمان — کندترینشان سقفِ زمان است، نه جمعشان."""
    if not REACH_PROBES:
        # پروبی تعریف نشده یعنی کاربر این قابلیت را نمی‌خواهد؛ همیشه آنلاین
        _set(True, ())
        return True

    async with httpx.AsyncClient(
        timeout=REACH_TIMEOUT, follow_redirects=True, proxy=PROXY
    ) as client:
        results = await asyncio.gather(*(_probe(client, url) for url in REACH_PROBES))

    reachable = tuple(url for url in results if url)
    if reachable:
        _state.strikes = 0
        _set(True, reachable)
    else:
        # زمانِ بررسی حتی وقتی به حدِ نصاب نرسیده‌ایم هم به‌روز می‌شود، وگرنه
        # `/api/net` یک `checkedAt` کهنه می‌داد و از بیرون به‌نظر می‌رسید حلقه
        # مرده است
        _state.checked_at = time.time()
        _state.reachable = ()
        _strike()
    return _state.online


async def verify(max_age: float) -> bool:
    """
    وضعیت را تازه می‌کند، ولی فقط اگر بررسیِ قبلی کهنه‌تر از `max_age` باشد.

    برای مسیرهایی است که می‌خواهند *قبل از* تسلیم شدن مطمئن شوند حرفِ ما هنوز
    درست است. سقفِ سن لازم است چون وگرنه هر درخواست یک پروبِ کامل می‌شد؛ با
    آن، هزینه‌ی بدترین حالت یک پروب در هر `max_age` ثانیه است.
    """
    if time.time() - _state.checked_at < max_age:
        return _state.online
    return await check()


async def loop() -> None:
    """
    حلقه‌ی پس‌زمینه.

    وقتی قطع است تندتر می‌پرسد: برگشتنِ اینترنت خبری است که کاربر منتظرش است
    (صفِ دانلودِ معوق همان لحظه راه می‌افتد)، ولی از دست رفتنش را همان درخواستِ
    شکست‌خورده‌ی بعدی فوراً گزارش می‌کند. پس هزینه‌ی پرسیدنِ زیاد فقط در حالتِ
    قطع پرداخت می‌شود، که دقیقاً همان‌جاست که ارزش دارد.
    """
    while True:
        try:
            await check()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug("پروبِ دسترسی شکست خورد", exc_info=True)

        # شکستِ ثبت‌شده‌ی بی‌نتیجه هم دورِ تند می‌خواهد: بدونش، تشخیصِ یک قطعیِ
        # واقعی دو دوره‌ی کامل (چهار دقیقه) طول می‌کشید — چون دورِ اول فقط یک
        # strike می‌گذاشت و وضعیت هنوز «آنلاین» بود
        pending = not _state.online or _state.strikes > 0
        delay = REACH_RETRY_INTERVAL if pending else REACH_INTERVAL
        _state.wake.clear()
        try:
            # با هر تغییرِ وضعیت زودتر بیدار می‌شود — تایم‌اوت حالتِ عادی است
            await asyncio.wait_for(_state.wake.wait(), timeout=delay)
        except asyncio.TimeoutError:
            pass
