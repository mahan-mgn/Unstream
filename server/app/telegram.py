"""
هماهنگیِ «فرستادن به تلگرام» از سمت وب.

سرور خودش هیچ‌وقت با تلگرام حرف نمی‌زند — توکن دستِ پروسه‌ی بات است
(`app/bot/run.py`) که ممکن است اصلاً کانتینرِ جدایی باشد. پس این ماژول فقط سه
چیزِ کوچک را نگه می‌دارد:

  ۱. کدهای وصل‌شدن (pairing) — کوتاه‌عمر و فقط در حافظه؛ گم شدنشان با ری‌استارت
     اشکالی ندارد، کاربر یک دکمه دوباره می‌زند.
  ۲. حضورِ بات — بات هر بار که صف را می‌خواند خودش را معرفی می‌کند، پس وب
     می‌تواند به‌جای خطای گنگ بگوید «بات بالا نیست».
  ۳. بیدارباشِ صف — تا long-pollِ بات به‌محضِ کلیکِ کاربر برگردد، نه بعدِ
     تایم‌اوت.

خودِ صف ماندگار است و در `db.py` می‌نشیند.
"""

from __future__ import annotations

import asyncio
import secrets
import time

# عمرِ کدِ وصل‌شدن. آن‌قدر که فرصت شود تلگرام باز شود، نه آن‌قدر که کدی که
# روی صفحه‌ای فراموش‌شده مانده هنوز کار کند.
PAIR_TTL = 10 * 60

# بات پس از این مدت سکوت «پایین» حساب می‌شود. long-pollِ خودش حداکثر
# OUTBOX_WAIT ثانیه طول می‌کشد، پس این باید چند برابرش باشد.
PRESENCE_TTL = 90.0

# سقفِ انتظارِ long-pollِ صف (ثانیه). بیشتر از این یعنی پروکسی‌ها وسط قطع کنند.
OUTBOX_WAIT = 25.0

# حروفِ کد: بدون 0/O و 1/I تا وقتی کاربر دستی تایپش می‌کند اشتباه نشود
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 6

_codes: dict[str, float] = {}
_bot_username: str | None = None
_bot_seen_at: float = 0.0
_wakeup = asyncio.Event()


def reset() -> None:
    """فقط برای تست — حالتِ درون‌حافظه‌ای را خالی می‌کند."""
    global _bot_username, _bot_seen_at
    _codes.clear()
    _bot_username = None
    _bot_seen_at = 0.0
    _wakeup.clear()


# ---------- کدِ وصل‌شدن ----------


def _prune_codes(now: float) -> None:
    for code in [c for c, born in _codes.items() if now - born > PAIR_TTL]:
        del _codes[code]


def new_code(now: float | None = None) -> str:
    now = time.time() if now is None else now
    _prune_codes(now)
    code = "".join(secrets.choice(_ALPHABET) for _ in range(CODE_LENGTH))
    _codes[code] = now
    return code


def claim_code(code: str, now: float | None = None) -> bool:
    """
    True یعنی کد معتبر بود و همین‌جا مصرف شد.

    یک‌بارمصرف است: کدی که در چتی خرج شده نباید با فوروارد شدن، چتِ دیگری را
    هم به همین دستگاه وصل کند.
    """
    now = time.time() if now is None else now
    _prune_codes(now)
    return _codes.pop(code.strip().upper(), None) is not None


# ---------- حضورِ بات ----------


def heartbeat(username: str | None, now: float | None = None) -> None:
    global _bot_username, _bot_seen_at
    _bot_username = username or _bot_username
    _bot_seen_at = time.time() if now is None else now


def bot_username(now: float | None = None) -> str | None:
    """نامِ کاربریِ بات اگر همین حالا بالاست، وگرنه None."""
    now = time.time() if now is None else now
    return _bot_username if now - _bot_seen_at <= PRESENCE_TTL else None


def connected(now: float | None = None) -> bool:
    now = time.time() if now is None else now
    return _bot_seen_at > 0 and now - _bot_seen_at <= PRESENCE_TTL


def deep_link(code: str, username: str | None) -> str | None:
    """
    لینکی که تلگرام را روی همین بات باز می‌کند و خودش `/start link_<code>` را
    می‌فرستد — کاربر فقط «Start» را می‌زند و تمام.
    """
    return f"https://t.me/{username}?start=link_{code}" if username else None


# ---------- بیدارباشِ صف ----------


def notify() -> None:
    _wakeup.set()


def arm() -> None:
    """
    پیش از *اولین* claim صدا زده می‌شود تا بیدارباشی که بعدش می‌رسد گم نشود.

    قبلاً پاک‌کردنِ پرچم داخلِ `wait_for_job` بود و بینِ claimِ اول و شروعِ
    انتظار یک شکاف می‌ماند: کاری که دقیقاً همان‌جا در صف می‌نشست، هم از claim
    جا می‌ماند و هم بیدارباشش پاک می‌شد — و بات تا پایانِ تایم‌اوت (۲۵ ثانیه)
    بی‌کار می‌ماند با اینکه کار آماده بود.
    """
    _wakeup.clear()


async def wait_for_job(timeout: float = OUTBOX_WAIT) -> None:
    """
    تا رسیدنِ کارِ تازه یا تمام‌شدنِ مهلت صبر می‌کند. تایم‌اوت خطا نیست.

    پرچم را عمداً پاک نمی‌کند — این کارِ `arm()` است، قبل از اولین claim.
    """
    try:
        await asyncio.wait_for(_wakeup.wait(), timeout)
    except (TimeoutError, asyncio.TimeoutError):
        pass
