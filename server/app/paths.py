"""
چیدمان فایل‌ها در آرشیو.

روی دیسک هر جاب پوشه‌ی خودش را دارد و اسم فایل تخت است — این عمدی است و
`jobs.job_dir` دلیلش را توضیح می‌دهد. ولی چیزی که کاربر باز می‌کند آرشیو است، نه
پوشه‌ی سرور، و آنجا `هنرمند/آلبوم/۰۱ - عنوان.mp3` همان ساختاری است که هر
کتابخانه‌ی موسیقی (Navidrome، Plex، Poweramp) بدون تنظیمات می‌فهمد.

پس ساختار در لحظه‌ی تحویل ساخته می‌شود، نه در لحظه‌ی ذخیره. این‌طور نه برخورد
دو کیفیتِ یک ترک برمی‌گردد و نه تغییر الگو، فایل‌های قدیمی را بی‌صاحب می‌کند.
"""

from __future__ import annotations

import re

from .config import PATH_TEMPLATE
from .downloader import safe_name
from .models import Track

_PLACEHOLDER = re.compile(r"\{(\w+)\}")

# جداکننده‌هایی که وقتی مقدارِ کنارشان خالی می‌ماند، تنها و بی‌معنی می‌شوند
_DANGLING = re.compile(r"^[\s\-–_]+|[\s\-–_]+$")


def _values(track: Track) -> dict[str, str]:
    """مقدارهای قابل استفاده در الگو. غایب یعنی رشته‌ی خالی، نه «None»."""
    return {
        "artist": track.artist,
        # هنرمندِ آلبوم، نه هنرمندِ ترک: با {artist} آلبومی که چند ترکش مهمان
        # دارد به چند پوشه‌ی هم‌نام تقسیم می‌شد. نبودنش یعنی ترکِ تنها — همان
        # هنرمندِ خودِ ترک.
        "albumartist": track.albumArtist or track.artist,
        "album": track.album or "",
        "title": track.title,
        # دو رقمی تا مرتب‌سازی الفبایی همان ترتیب آلبوم را بدهد
        "track": f"{track.trackNumber:02d}" if track.trackNumber else "",
        "disc": str(track.discNumber) if track.discNumber else "",
        "year": str(track.year) if track.year else "",
        "genre": track.genre or "",
    }


def _tidy(segment: str) -> str:
    """
    یک بخش از مسیر، بعد از جایگذاری.

    وقتی مقداری خالی درمی‌آید، جداکننده‌اش می‌ماند: `{track} - {title}` برای
    ترکی بدون شماره «- عنوان» می‌شد. اینجا آن دنباله‌ها بریده می‌شوند.
    """
    return _DANGLING.sub("", re.sub(r"\s+", " ", segment)).strip(" .")


def render(track: Track, ext: str, template: str = PATH_TEMPLATE) -> str:
    """
    مسیر نسبیِ یک ترک در آرشیو، با `/` به‌عنوان جداکننده.

    مقدارها قبل از جایگذاری از `safe_name` می‌گذرند، پس عنوانی که خودش `/` یا
    `..` دارد نمی‌تواند از الگو بیرون بزند و پوشه‌ی جدید بسازد — این ورودی از
    کاتالوگ‌های بیرونی می‌آید و قابل اعتماد نیست.
    """
    values = _values(track)

    def substitute(match: re.Match[str]) -> str:
        value = values.get(match.group(1), "")
        # `safe_name` برای ورودی خالی «track» برمی‌گرداند — منطقی برای نام فایل،
        # فاجعه برای جای‌گذار: آلبومِ نامعلوم پوشه‌ای به اسم «track» می‌ساخت
        return safe_name(value) if value else ""

    filled = _PLACEHOLDER.sub(substitute, template)

    segments = [tidy for raw in filled.split("/") if (tidy := _tidy(raw))]
    if not segments:
        # الگویی که هیچ‌چیزِ پرشده‌ای نداشت — نام تخت همیشه بهتر از هیچ است
        segments = [safe_name(f"{track.artist} - {track.title}")]

    segments[-1] += ext
    return "/".join(segments)


def m3u(entries: list[tuple[Track, str]]) -> str:
    """
    پلی‌لیست M3U توسعه‌یافته، با مسیرهای نسبیِ همین آرشیو.

    `#EXTINF` طولِ ترک را به ثانیه می‌خواهد؛ `-1` یعنی نامعلوم و پلیرها با آن
    مشکلی ندارند. ترتیب همان ترتیبی است که ورودی داده شده — یعنی ترتیب آلبوم.
    """
    lines = ["#EXTM3U"]
    for track, path in entries:
        seconds = round(track.durationMs / 1000) if track.durationMs else -1
        lines.append(f"#EXTINF:{seconds},{track.artist} - {track.title}")
        lines.append(path)
    return "\n".join(lines) + "\n"
