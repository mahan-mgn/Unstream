"""
تأیید صوتی با AcoustID — اختیاری.

resolver فقط از روی عنوان و مدت‌زمان تصمیم می‌گیرد؛ هیچ‌کدام به خودِ صوت نگاه
نمی‌کنند. یک ویدیوی «Artist - Title» با همان طول می‌تواند کاور، ریمستر یا کلاً
چیز دیگری باشد. فینگرپرینت آکوستیک تنها سیگنالی است که واقعاً صدا را می‌بیند.

بی‌صدا از کار می‌افتد: بدون کلید یا بدون `fpcalc` هیچ اتفاقی نمی‌افتد و دانلود
دست‌نخورده می‌ماند. نتیجه‌ی منفی هم فایل را رد نمی‌کند — فقط هشدار می‌دهد،
چون خودِ AcoustID روی موسیقی غیرغربی پوشش کاملی ندارد.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import httpx

from .config import ACOUSTID_KEY, FPCALC
from .resolver import _overlap, _tokens

LOOKUP_URL = "https://api.acoustid.org/v2/lookup"
_TIMEOUT = 12.0

# زیر این حد، عنوانی که AcoustID شناخته ربطی به چیزی که خواسته‌ایم ندارد
MATCH_THRESHOLD = 0.4
# نتیجه‌ای که خودِ AcoustID هم مطمئنش نیست، ارزش هشدار دادن ندارد
MIN_CONFIDENCE = 0.5


def available() -> bool:
    return bool(ACOUSTID_KEY and FPCALC)


def _fingerprint(path: Path) -> tuple[int, str] | None:
    try:
        out = subprocess.run(
            [str(FPCALC), "-json", str(path)],
            capture_output=True,
            text=True,
            timeout=60,
            check=True,
        )
        body = json.loads(out.stdout)
        return int(body["duration"]), body["fingerprint"]
    except Exception:
        return None


def check(path: Path, title: str, artist: str) -> str | None:
    """
    پیام هشدار اگر فایل با ترکِ درخواستی نخواند، وگرنه None.

    بلاک‌کننده است — از داخل thread دانلود صدا زده می‌شود.
    """
    if not available() or not path.exists():
        return None

    fp = _fingerprint(path)
    if fp is None:
        return None
    duration, fingerprint = fp

    try:
        res = httpx.post(
            LOOKUP_URL,
            data={
                "client": ACOUSTID_KEY,
                "duration": duration,
                "fingerprint": fingerprint,
                "meta": "recordings",
            },
            timeout=_TIMEOUT,
        )
        res.raise_for_status()
        results = res.json().get("results") or []
    except Exception:
        return None

    recordings = [
        (r.get("score") or 0.0, rec)
        for r in results
        for rec in (r.get("recordings") or [])
        if rec.get("title")
    ]
    if not recordings:
        return None  # ترک در کاتالوگ نیست — نه تأیید، نه رد

    score, best = max(recordings, key=lambda pair: pair[0])
    if score < MIN_CONFIDENCE:
        return None

    known_artists = " ".join(a.get("name", "") for a in (best.get("artists") or []))
    wanted = _tokens(f"{title} {artist}")
    got = _tokens(f"{best['title']} {known_artists}")

    if _overlap(wanted, got) >= MATCH_THRESHOLD:
        return None

    label = f"{known_artists} — {best['title']}".strip(" —")
    return f"فینگرپرینت صوتی این فایل را «{label}» شناخت، نه «{artist} — {title}»"
