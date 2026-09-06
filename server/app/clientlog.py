"""
گزارشِ خطای سمتِ کاربر — روی همان سرورِ خودت.

چرا لازم است: WebView وقتی می‌ترکد، چیزی به تو نمی‌رسد. کاربر فقط می‌گوید
«اپ یک‌بار بسته شد» و هیچ ردی نیست. یک اندپوینتِ ساده که JS خطا را به آن
بفرستد، تنها راهِ دیدنِ کرش‌های واقعیِ همین نصب‌هاست — بدون سرویسِ بیرونی و
بدون حسابِ Sentry.

عمداً بی‌احرازِ هویت است (مثل بقیه‌ی این برنامه، روی شبکه‌ی شخصی) و عمداً
سبک: یک خط JSON در یک فایل. سقفِ حجم دارد چون لاگِ بی‌سقف روی یک VMِ رایگان
یعنی دیسکِ پر و سرورِ بالا-نیامده ختم می‌شود.
"""

from __future__ import annotations

import json
import time
from .config import DATA_DIR

LOG_PATH = DATA_DIR / "logs" / "client.jsonl"

# سقفِ حجم. بیشتر از این، قدیمی‌ها را نمی‌خواهیم — کرشِ تکراری حرفِ تازه‌ای
# برای گفتن ندارد و دیسکِ سرورِ خانگی مفت نیست.
MAX_BYTES = 512 * 1024

# رشته‌ها بریده می‌شوند: یک stackِ Web Audio می‌تواند چند صد کیلوبایت باشد و
# نوشتنش در هر خط، دیسک را می‌خورد
_MAX_FIELD = 4000


def _clip(value: object, limit: int = _MAX_FIELD) -> str:
    text = value if isinstance(value, str) else ("" if value is None else str(value))
    return text[:limit]


def record(entry: dict) -> bool:
    """یک خط اضافه می‌کند. False یعنی نتوانست بنویسد (دیسک/اجازه)."""
    row = {
        "at": round(time.time(), 1),
        "kind": _clip(entry.get("kind"), 32) or "error",
        "message": _clip(entry.get("message")),
        "stack": _clip(entry.get("stack")),
        "url": _clip(entry.get("url"), 300),
        "app": _clip(entry.get("app"), 40),
        "device": _clip(entry.get("device"), 200),
    }
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        if LOG_PATH.exists() and LOG_PATH.stat().st_size > MAX_BYTES:
            _trim()
        with LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        return True
    except OSError:
        return False


def _trim() -> None:
    """آخرین نصفِ فایل را نگه می‌دارد — قدیمی‌ترین خط‌ها بی‌ارزش‌ترین‌اند."""
    try:
        lines = LOG_PATH.read_text(encoding="utf-8").splitlines()
        keep = lines[len(lines) // 2 :]
        LOG_PATH.write_text("\n".join(keep) + "\n", encoding="utf-8")
    except OSError:
        pass


def recent(limit: int = 50) -> list[dict]:
    """چند خطِ آخر، تازه‌ترین اول — برای نگاه‌کردن از مرورگر."""
    if not LOG_PATH.exists():
        return []
    try:
        lines = LOG_PATH.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out: list[dict] = []
    for line in reversed(lines[-limit * 2 :]):
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict):
            out.append(row)
        if len(out) >= limit:
            break
    return out


__all__ = ["LOG_PATH", "record", "recent"]
