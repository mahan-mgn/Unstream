"""
منطق خالص و بدون شبکه — بدون httpx یا python-telegram-bot، پس بدون mock هم
تست می‌شود.
"""

from __future__ import annotations

import re

from ..models import Album, Artist, Playlist, Source, Track

URL_RE = re.compile(r"^https?://", re.IGNORECASE)

# لینکِ صفحه‌ی هنرمند یا کاربر — همان تفکیکی که فرانت با `isArtistUrl` می‌کند.
# این‌ها آلبوم نیستند و از مسیرِ `resolve_ref` فقط «این لینک شناخته نشد»
# می‌گرفتند، در حالی که مرورگرِ پروفایلِ خودِ بات از قبل بلد است نشانشان بدهد.
PROFILE_URL_RE = re.compile(
    r"""^https?://(?:www\.|m\.)?(?:
          music\.apple\.com/[a-z]{2}/artist/
        | (?:www\.)?deezer\.com/(?:[a-z]{2}/)?(?:artist|profile)/
        | open\.spotify\.com/(?:intl-[a-z]{2}/)?(?:artist|user)/
        # ساندکلاد و یوتیوب بخشِ ثابتی برای «هنرمند» ندارند: پروفایلِ ساندکلاد
        # دقیقاً یک بخش دارد (ترک و ست بیشتر) و کانالِ یوتیوب با @/channel/c/user
        # شروع می‌شود، نه با watch یا playlist
        | soundcloud\.com/[\w.\-]+/?(?:[?\#].*)?$
        | youtube\.com/(?:@[\w.\-]+|channel/[\w\-]+|c/[\w.\-]+|user/[\w.\-]+)(?:/[a-z]+)?/?(?:[?\#].*)?$
    )""",
    re.IGNORECASE | re.VERBOSE,
)

# sendAudio بدون Local Bot API Server بیش از این را قبول نمی‌کند
TELEGRAM_FILE_LIMIT = 50 * 1024 * 1024

# طول مجاز دکمه‌ی inline در تلگرام محدود است؛ عنوان‌های بلند کوتاه می‌شوند
BUTTON_LABEL_MAX = 60

# سقفِ «همه رو بگیر» روی یک آلبوم/پلی‌لیست — صفِ طولانی‌تر فقط فلودِ تلگرام
# می‌شود؛ کاربر همچنان می‌تواند تک‌تکِ بقیه را از دکمه‌های انتخاب بگیرد
MAX_BATCH_DOWNLOAD = 30

# سقفِ مستندشده‌ی تلگرام برای thumbnail — رعایت نکردنش یعنی سرور رد می‌کند
THUMB_SIZE = 200
THUMB_MAX_BYTES = 200_000

SOURCE_EMOJI: dict[Source, str] = {
    "apple": "🍎",
    "deezer": "🎵",
    "spotify": "🟢",
    "youtube": "▶️",
    "soundcloud": "☁️",
}

SOURCE_NAME: dict[Source, str] = {
    "apple": "اپل‌موزیک",
    "deezer": "دیزر",
    "spotify": "اسپاتیفای",
    "youtube": "یوتیوب",
    "soundcloud": "ساندکلاد",
}


def source_badge(source: Source) -> str:
    return SOURCE_EMOJI.get(source, "🎧")


def progress_bar(percent: float, width: int = 10) -> str:
    """▓▓▓▓░░░░░░ — نوار پیشرفت متنی، بدون هیچ کتابخانه‌ی اضافه."""
    filled = round(width * max(0.0, min(100.0, percent)) / 100)
    return "▓" * filled + "░" * (width - filled)


# همان هفت گزینه‌ی QualityPicker.tsx — تجربه‌ی بات نباید از وب جدا بیفتد
QUALITY_ROWS: list[list[str]] = [["128", "192", "320"], ["m4a", "opus", "flac"], ["original"]]
QUALITY_LABEL: dict[str, str] = {"original": "اورجینال"}
DEFAULT_QUALITY = "320"


def quality_label(quality: str) -> str:
    return QUALITY_LABEL.get(quality, quality)


# کیفیتِ تحویلِ خودکارِ انتشارِ تازه — همان چیزی که /follow قول می‌دهد. بالاترین
# کیفیتی که معمولاً زیر سقفِ فایلِ تلگرام می‌ماند؛ بالاتر از این (flac) یا
# به‌خاطر سقفِ ۵۰ مگ می‌افتد یا لینکِ مستقیم می‌خواهد، که برای «خودکار و بی‌صبر»
# سنگین است.
AUTO_QUALITY = "320"


def looks_like_url(text: str) -> bool:
    """لینک در برابر اسم آهنگ — تصمیم می‌گیرد بات سراغ resolve برود یا search."""
    return bool(URL_RE.match(text.strip()))


def looks_like_profile_url(text: str) -> bool:
    """
    لینکِ صفحه‌ی هنرمند یا کاربر، در برابر لینکِ آلبوم/پلی‌لیست/ترک.

    پروفایل ترک‌لیست ندارد که بشود «همه رو بگیر» کرد؛ مسیرش مرورگرِ پروفایل
    است، همان‌جا که آلبوم‌ها و پلی‌لیست‌هایش دکمه می‌شوند.
    """
    return bool(PROFILE_URL_RE.match(text.strip()))


def new_releases(last_release_id: str | None, albums: list[Album]) -> list[Album]:
    """
    انتشارهای تازه‌ی یک هنرمند از آخرین باری که دیده‌ایم.

    هر سه فراهم‌کننده‌ی دارای صفحه‌ی هنرمند (دیزر/اسپاتیفای/اپل‌موزیک) لیست را
    تازه‌به‌قدیم و با تاریخِ کامل مرتب می‌دهند، پس «تازه‌ها» یعنی همه‌ی ردیف‌های
    قبل از آخرین شناسه‌ی دیده‌شده. دو حالتِ لبه:

    - هنوز هیچ انتشاری ندیده‌ایم (آخرین شناسه خالی است): چیزی تازه نیست — این
      فقط اولین پرکردنِ وضعیت است، نه انبوهی از تاریخچه.
    - آخرین شناسه در لیست نیست (آی‌دی‌های قدیمی گاهی عوض می‌شوند): فقط
      تازه‌ترین را تازه حساب می‌کنیم، تا یک جابه‌جاییِ فهرست کلِ دیسکوگرافی را
      دوباره «منتشرشده» نکند و چت کاربر را پر نکند.
    """
    if not albums or not last_release_id:
        return []
    fresh: list[Album] = []
    for album in albums:
        if album.id == last_release_id:
            return fresh
        fresh.append(album)
    return fresh[:1]


def _truncate(label: str, limit: int = BUTTON_LABEL_MAX) -> str:
    if len(label) <= limit:
        return label
    return label[: limit - 1] + "…"


def format_track_button(track: Track) -> str:
    """برچسبِ دکمه‌ی انتخاب: عنوان — هنرمند، کوتاه‌شده اگر لازم بود."""
    return _truncate(f"{track.title} — {track.artist}")


def format_artist_button(name: str) -> str:
    """برچسبِ دکمه‌ی انتخابِ هنرمند در `/follow`، همان قاعده‌ی کوتاه‌سازیِ ترک‌ها."""
    return _truncate(name)


def format_artist_search_button(artist: Artist) -> str:
    """برچسبِ دکمه‌ی انتخابِ هنرمند در مرورگرِ پروفایل — با آمار (subtitle) کنارش."""
    return _truncate(f"{artist.name} — {artist.subtitle}")


def format_album_button(album: Album) -> str:
    return _truncate(f"{album.title} — {album.artist}")


def format_playlist_button(playlist: Playlist) -> str:
    return _truncate(f"{playlist.title} — {playlist.owner}")


def too_large_for_telegram(size_bytes: int) -> bool:
    return size_bytes > TELEGRAM_FILE_LIMIT


def audio_filename(track: Track, format_label: str | None) -> str:
    """
    نامِ فایلی که برای کاربر نمایش داده می‌شود.

    `format_label` گزارشِ واقعیِ سرور است (مثلاً «mp3 320»)، نه کیفیتِ
    درخواستی — همان قراردادِ بقیه‌ی UI. پسوند همان بخش اولش است.
    """
    ext = (format_label or "mp3").split()[0]
    return f"{track.artist} - {track.title}.{ext}"
