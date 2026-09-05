"""
نقطه‌ی ورود بات تلگرام — یک کلاینت تازه برای همون API، نه یک مسیر دانلود جدا.

اجرا: `python -m app.bot.run` (کنار سرور اصلی که باید بالا باشد).
بدون UNSTREAM_TELEGRAM_BOT_TOKEN بی‌صدا خارج می‌شود — قابلیتِ اختیاری است.
"""

from __future__ import annotations

import asyncio
import html
import logging
import sys
import time
import uuid
from logging.handlers import RotatingFileHandler
from pathlib import Path

from telegram import (
    BotCommand,
    ForceReply,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InputFile,
    InputMediaAudio,
    InlineQueryResultArticle,
    InputTextMessageContent,
    Message,
    Update,
)
from telegram.constants import ParseMode
from telegram.error import BadRequest, NetworkError
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    ChosenInlineResultHandler,
    CommandHandler,
    ContextTypes,
    InlineQueryHandler,
    MessageHandler,
    filters,
)
from telegram.request import HTTPXRequest

from ..artwork import EMBED as ARTWORK_EMBED
from ..artwork import at_most as artwork_at_most
from ..artwork import resized as resized_artwork
from ..config import (
    BOT_DB_PATH,
    FOLLOW_POLL_INTERVAL,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CACHE_CHAT_ID,
    TELEGRAM_PROXY,
)
from ..models import (
    Album,
    Artist,
    ArtistDetail,
    DownloadProgress,
    Follow,
    FollowRequest,
    LibraryItem,
    Playlist,
    SongInfo,
    TelegramJob,
    Track,
)
from . import store
from .client import ApiClient, Unavailable
from .logic import (
    AUTO_QUALITY,
    DEFAULT_QUALITY,
    MAX_BATCH_DOWNLOAD,
    QUALITY_ROWS,
    SOURCE_NAME,
    THUMB_MAX_BYTES,
    THUMB_SIZE,
    audio_filename,
    format_album_button,
    format_artist_button,
    format_artist_search_button,
    format_playlist_button,
    format_track_button,
    looks_like_profile_url,
    looks_like_url,
    new_releases,
    progress_bar,
    quality_label,
    source_badge,
    too_large_for_telegram,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

# لاگِ ماندگار کنارِ دیتابیسِ بات.
#
# بات معمولاً از یک ترمینال بالا می‌آید و خروجی‌اش با بسته‌شدنِ آن پنجره می‌رود.
# نتیجه‌اش این بود که وقتی چیزی سرِ ارسال اشتباه می‌رفت — thumbnailی که نیامد،
# کاوری که گرفته نشد — هیچ ردی نمی‌ماند و تنها راهِ فهمیدنش نگاه کردن به خودِ
# پیامِ تلگرام بود. حالا همان WARNINGها روی دیسک هم می‌نشینند.
try:
    BOT_LOG_PATH = Path(BOT_DB_PATH).with_name("bot.log")
    _file_log = RotatingFileHandler(
        BOT_LOG_PATH, maxBytes=2_000_000, backupCount=2, encoding="utf-8"
    )
    _file_log.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logging.getLogger().addHandler(_file_log)
except OSError:
    # دیسکِ پر یا مسیرِ فقط-خواندنی نباید جلوی بالا آمدنِ بات را بگیرد
    BOT_LOG_PATH = None

# httpx در INFO آدرسِ کاملِ هر درخواست را می‌نویسد و توکنِ بات داخلِ خودِ
# URL است (`api.telegram.org/bot<TOKEN>/getUpdates`) — یعنی هر جا خروجیِ بات
# به فایل برود، توکن هم با آن می‌رود. خطاهای واقعیِ شبکه در WARNING به بالا
# همچنان دیده می‌شوند، پس چیزی برای عیب‌یابی از دست نمی‌رود.
logging.getLogger("httpx").setLevel(logging.WARNING)

log = logging.getLogger("unstream.bot")

# چند نتیجه‌ی اول جستجو/آلبوم/کتابخانه — بیشترش فقط اسکرول اضافه در تلگرام است
MAX_RESULTS = 8
# ادیتِ پیام روی هر تیکِ درصد، به rate limit تلگرام می‌خورد
EDIT_INTERVAL = 2.0

# سقفِ فایلی که برای شناسایی گرفته می‌شود — همان حدِ سمتِ سرور
MAX_IDENTIFY_BYTES = 25 * 1024 * 1024

# ---------- آپلودِ فایل به تلگرام ----------
#
# تنها جای بات که چند مگابایت روی سیم می‌رود، و همان‌جا هم بود که ارسال از وب
# با «Timed out» می‌مرد. دو دلیل داشت و هر دو اینجا جواب می‌گیرند:
#
#   ۱. تلگرام بعد از تمام‌شدنِ آپلود تازه فایل را پردازش می‌کند و بعد جواب
#      می‌دهد؛ read_timeoutِ عمومی (۶۰ ثانیه) برای همین *انتظارِ بعد از
#      آپلود* کوتاه بود، نه برای خودِ فرستادن. پس مخصوصِ این فراخوانی بالا
#      برده می‌شود، نه روی کلِ کلاینت — وگرنه یک send_messageِ گیرکرده هم
#      پنج دقیقه معطل می‌ماند.
#   ۲. روی لینکِ ناپایدار، اولین تلاش گاهی وسطِ راه قطع می‌شود. یک بار دیگر
#      امتحان‌کردن تفاوتِ «نرسید» و «کند بود» را عملاً از بین می‌برد.
UPLOAD_ATTEMPTS = 3
UPLOAD_RETRY = 3.0
UPLOAD_TIMEOUT = 300.0

# پسوندی که سرور از روی آن تصمیم می‌گیرد فایل را چطور دیکد کند
_MIME_EXT = {
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/flac": ".flac",
    "audio/wav": ".wav",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
}

STATUS_LABEL = {
    "queued": "در صف…",
    "searching": "در حال جستجو…",
    "tagging": "در حال تگ‌گذاری…",
}

# دکمه‌های /start — هرکدوم یک «مُد» را در chat_data می‌گذارد و یک ForceReply
# می‌فرستد؛ پیامِ بعدیِ کاربر (در on_text) طبق همین مُد مسیرش فرق می‌کند.
MODE_PROMPT = {
    "artist": "اسم هنرمند رو بفرست:",
    "album": "اسم آلبوم رو بفرست:",
    "playlist": "اسم پلی‌لیست رو بفرست:",
    "track": "اسم آهنگ یا لینک رو بفرست:",
}
MODE_PLACEHOLDER = {
    "artist": "اسم هنرمند…",
    "album": "اسم آلبوم…",
    "playlist": "اسم پلی‌لیست…",
    "track": "اسم آهنگ یا لینک…",
}

SECTION_TITLE = {
    "att": "⭐ آهنگ‌های محبوب",
    "aal": "💿 آلبوم‌ها",
    "apl": "📃 پلی‌لیست‌ها",
    "ard": "📻 رادیو",
    "are": "🔗 هنرمندهای مرتبط",
}


def _api(context: ContextTypes.DEFAULT_TYPE) -> ApiClient:
    return context.bot_data["api"]


class _StatusSink:
    """
    پیامِ وضعیتِ یک دانلود — چه پیامِ معمولیِ یک چت، چه پیامِ inline.

    مسیرِ inline پیامِ ما نیست (تلگرام خودش نتیجه‌ی inline را فرستاده)، پس فقط
    `inline_message_id` داریم و باید با `bot.edit_message_text` ادیتش کنیم؛
    آن هم قابلِ حذف نیست. رابطِ یکسان یعنی `_run_download` نباید بداند کدام
    مسیر است.
    """

    def __init__(
        self,
        context: ContextTypes.DEFAULT_TYPE,
        *,
        message: Message | None = None,
        inline_message_id: str | None = None,
    ) -> None:
        self._bot = context.bot
        self._message = message
        self._inline_id = inline_message_id

    async def edit(self, text: str, **kwargs) -> None:
        try:
            if self._message is not None:
                await self._message.edit_text(text, **kwargs)
            else:
                await self._bot.edit_message_text(
                    text, inline_message_id=self._inline_id, **kwargs
                )
        except Exception:
            pass  # ادیتِ ناموفق (rate limit یا متنِ تکراری) نباید دانلود را متوقف کند

    async def delete(self) -> None:
        if self._message is not None:
            try:
                await self._message.delete()
            except Exception:
                pass


def _track_line(track: Track) -> str:
    """سرتیترِ پیامِ وضعیت — بج منبع + عنوانِ پررنگ + هنرمند. HTML‌ایمن."""
    return f"{source_badge(track.source)} <b>{html.escape(track.title)}</b> — {html.escape(track.artist)}"


async def _fetch_thumbnail(
    api: ApiClient, artwork_url: str | None, job_id: str | None = None
) -> InputFile | None:
    """
    کاورِ کوچکِ روی فایل صوتی — همان چیزی که تلگرام در *لیستِ* آهنگ‌ها نشان
    می‌دهد. با پلیرِ پایینِ صفحه فرق دارد: آن کاور را از تگِ داخلِ فایل می‌خواند
    و همیشه دارد، ولی ردیفِ لیست فقط همین thumbnail را می‌بیند. نبودنش یعنی
    آهنگی که کاور دارد، در لیست بی‌تصویر بنشیند.

    اول از خودِ سرور، که آن را از داخلِ فایلِ دانلودشده درمی‌آورد — بدونِ هیچ
    درخواستی به بیرون. گرفتنِ کاور از CDN فقط پشتیبان است: همان بود که گاهی
    تایم‌اوت می‌داد یا به پروکسی نمی‌رسید و ردیف بی‌تصویر می‌ماند.

    شکست در هر مرحله فقط یعنی بدون کاور بفرست، نه خطا.
    """
    if job_id and (data := await api.thumb_bytes(job_id)):
        return InputFile(data, filename="cover.jpg")

    for url in artwork_at_most(artwork_url, THUMB_SIZE):
        data = await api.raw_bytes(url)
        if not data:
            continue
        if len(data) > THUMB_MAX_BYTES:
            # پله‌ای بزرگ‌تر از سقفِ تلگرام — گزینه‌ی بعدی شاید کوچک‌تر باشد
            log.warning("کاورِ %s برای thumbnail بزرگ است (%d بایت)", url, len(data))
            continue
        return InputFile(data, filename="cover.jpg")
    if artwork_url:
        log.warning("هیچ نسخه‌ای از کاورِ %s برای thumbnail نشد", artwork_url)
    return None


async def _fetch_full_cover(api: ApiClient, track: Track, info: SongInfo | None) -> bytes | None:
    """
    کاورِ کاملِ کارتِ اطلاعات — نه thumbnailِ کوچکِ روی فایل صوتی، همان محدودیتِ
    ۲۰۰ کیلوبایتی اینجا در کار نیست چون send_photo نه thumbnail.

    اولویت با کاورِ خودِ کاتالوگ است (در بزرگ‌ترین پله‌ی ممکن، `artwork.EMBED`) و
    Genius فقط وقتی می‌آید که کاتالوگ کاوری نداشته باشد. برعکسش — که قبلاً بود —
    یعنی کارتِ اطلاعات کاوری نشان بدهد که با thumbnailِ فایل، با کاورِ امبدشده
    داخلش و با آنچه کاربر در اسپاتیفای/ساندکلاد دیده یکی نیست؛ حتی وقتی Genius
    درست هم تطبیق داده باشد، تصویرش لزوماً همان کاورِ آن انتشار نیست.
    """
    # مثل thumbnail، بیش از یک آدرس: پله‌ی حساب‌شده ممکن است روی آن CDN نباشد و
    # آن‌وقت کارتِ اطلاعات بی‌تصویر می‌ماند در حالی که کاور موجود است
    for url in artwork_at_most(track.artworkUrl, ARTWORK_EMBED):
        if data := await api.raw_bytes(url):
            return data
    if info and info.artworkUrl:
        return await api.raw_bytes(info.artworkUrl)
    return None


def _fmt_duration(duration_ms: int) -> str:
    total = duration_ms // 1000
    return f"{total // 60}:{total % 60:02d}"


def _info_caption(track: Track, info: SongInfo | None) -> str:
    """کپشنِ کارتِ اطلاعات — چیزهایی که همیشه از خودِ track داریم + هرچه Genius اضافه داد."""
    lines = [_track_line(track), f"⏱ {_fmt_duration(track.durationMs)}"]
    if track.album:
        lines.append(f"💿 آلبوم: {html.escape(track.album)}")
    if track.year:
        lines.append(f"📅 سال: {track.year}")
    if track.genre:
        lines.append(f"🎼 ژانر: {html.escape(track.genre)}")
    if info and info.writers:
        lines.append(f"✍️ آهنگساز: {html.escape('، '.join(info.writers))}")
    if info and info.producers:
        lines.append(f"🎚 تهیه‌کننده: {html.escape('، '.join(info.producers))}")
    if info and info.releaseDate and not track.year:
        lines.append(f"📅 تاریخ انتشار: {html.escape(info.releaseDate)}")
    return "\n".join(lines)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return

    # لینکِ عمیقِ دکمه‌ی «فرستادن به تلگرام» در وب: t.me/<bot>?start=link_<code>
    # تلگرام payload را به‌عنوان اولین آرگومانِ /start می‌دهد، پس کاربر فقط
    # «Start» را می‌زند و کدی تایپ نمی‌کند.
    if context.args and context.args[0].startswith(LINK_PAYLOAD_PREFIX):
        await _claim_link(update.message, context, context.args[0][len(LINK_PAYLOAD_PREFIX) :])
        return

    keyboard = [
        [
            InlineKeyboardButton("🧑‍🎤 هنرمند", callback_data="mode:artist"),
            InlineKeyboardButton("💿 آلبوم", callback_data="mode:album"),
        ],
        [
            InlineKeyboardButton("📃 پلی‌لیست", callback_data="mode:playlist"),
            InlineKeyboardButton("🎧 آهنگ", callback_data="mode:track"),
        ],
    ]
    await update.message.reply_text(
        "سلام! یکی از دکمه‌ها رو بزن، یا مستقیم اسم آهنگ/لینک رو بفرست.\n"
        "لینک اسپاتیفای/دیزر/اپل‌موزیک/یوتیوب/ساندکلاد قبول است "
        "(لینکِ آلبوم/پلی‌لیست دکمه‌ی «دانلود همه» هم می‌ده).\n"
        "با @نام‌بات آهنگ هم می‌تونی از هر چتی جستجو کنی، بدون اومدن اینجا.\n"
        "با /help بقیه‌ی دستورها رو ببین.",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def on_mode_button(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """دکمه‌های هنرمند/آلبوم/پلی‌لیست/آهنگِ /start — مُد را ست می‌کند و منتظرِ پیامِ بعدی می‌ماند."""
    query = update.callback_query
    if query is None or query.data is None:
        return
    await query.answer()

    mode = query.data.split(":", 1)[1]
    if mode == "track":
        context.chat_data.pop("search_mode", None)
    else:
        context.chat_data["search_mode"] = mode

    if query.message is not None:
        await query.message.reply_text(
            MODE_PROMPT[mode],
            reply_markup=ForceReply(input_field_placeholder=MODE_PLACEHOLDER[mode]),
        )


async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    current = context.chat_data.get("quality", DEFAULT_QUALITY)
    await update.message.reply_text(
        "اسم آهنگ رو بفرست یا لینک اسپاتیفای/دیزر/اپل‌موزیک/یوتیوب/ساندکلاد.\n"
        "لینکِ آلبوم/پلی‌لیست دکمه‌ی «دانلود همه» هم می‌ده.\n"
        "با @نام‌بات آهنگ از هر چتی می‌تونی جستجو و ارسال کنی.\n"
        "با دکمه‌های /start مستقیم می‌تونی سراغ هنرمند/آلبوم/پلی‌لیست بری "
        "و پروفایل هنرمند (آهنگ‌های محبوب، دیسکوگرافی، مرتبط، رادیو) رو ببینی.\n\n"
        "/quality — کیفیت پیش‌فرض دانلود رو عوض کن\n"
        "/library — دانلودهای قبلی رو بدون صبر دوباره بگیر\n"
        "/follow — دنبال‌کردنِ یک هنرمند؛ انتشارِ تازه‌اش خودکار با فایل و کاور می‌آید\n"
        "/unfollow — دیگه دنبال نکردنِ یک هنرمند\n"
        "/following — لیستِ هنرمندهای دنبال‌شده\n"
        "/link — وصل‌کردنِ این چت به وب، تا دکمه‌ی تلگرامِ هر آهنگ/آلبوم اینجا بفرستد\n\n"
        f"کیفیت فعلی: {quality_label(current)}"
    )


async def quality_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    current = context.chat_data.get("quality", DEFAULT_QUALITY)
    keyboard = [
        [
            InlineKeyboardButton(
                f"✓ {quality_label(q)}" if q == current else quality_label(q),
                callback_data=f"q:{q}",
            )
            for q in row
        ]
        for row in QUALITY_ROWS
    ]
    await update.message.reply_text(
        f"کیفیت فعلی: {quality_label(current)}\nیکی رو انتخاب کن:",
        reply_markup=InlineKeyboardMarkup(keyboard),
    )


async def on_quality_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None:
        return
    await query.answer()
    quality = query.data.split(":", 1)[1]
    context.chat_data["quality"] = quality
    await query.edit_message_text(f"کیفیت روی «{quality_label(quality)}» ست شد.")


async def library_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    query = " ".join(context.args) if context.args else ""
    api = _api(context)
    try:
        page = await api.library(query)
    except Exception:
        await update.message.reply_text("گرفتن کتابخانه ناموفق بود.")
        return

    if not page.items:
        await update.message.reply_text("چیزی تو کتابخانه نیست.")
        return

    items = page.items[:MAX_RESULTS]
    context.chat_data["library"] = {item.jobId: item for item in items}
    keyboard = [
        [
            InlineKeyboardButton(
                f"{source_badge(item.track.source)} {format_track_button(item.track)}",
                callback_data=f"lib:{item.jobId}",
            )
        ]
        for item in items
    ]
    await update.message.reply_text(
        "بزن تا دوباره برات بفرستم:", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def on_library_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None or query.message is None:
        return
    await query.answer()

    job_id = query.data.split(":", 1)[1]
    items: dict[str, LibraryItem] = context.chat_data.get("library", {})
    item = items.get(job_id)
    if item is None:
        await query.edit_message_text("این مورد دیگر در دسترس نیست — دوباره /library بزن.")
        return

    await query.edit_message_text(
        f"{_track_line(item.track)}\nدر حال آماده‌سازی…", parse_mode=ParseMode.HTML
    )
    # فایل از قبل روی دیسک آماده است — نه دانلود دوباره، نه انتظار SSE
    sink = _StatusSink(context, message=query.message)
    await _deliver(context, query.message.chat_id, item.track, item.jobId, sink, item.format)


async def on_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None or not update.message.text:
        return
    text = update.message.text.strip()
    api = _api(context)

    # دکمه‌ی هنرمند/آلبوم/پلی‌لیستِ /start مُد را روی این پیام گذاشته — فقط
    # همین یک پیام را تحت تاثیر قرار می‌دهد (pop، نه get)
    mode = context.chat_data.pop("search_mode", None)
    if mode == "artist":
        await _artist_search(update.message, context, text)
        return
    if mode in ("album", "playlist"):
        await _collection_search(update.message, context, text, kind=mode)
        return

    # لینکِ پروفایل (هنرمند، یا کاربری که فقط پلی‌لیستِ عمومی دارد) ترک‌لیست
    # ندارد و از مسیرِ پایین فقط «این لینک شناخته نشد» می‌گرفت — مرورگرِ
    # پروفایل، که آلبوم‌ها و پلی‌لیست‌هایش را دکمه می‌کند، جای اوست
    if looks_like_profile_url(text):
        await _artist_search(update.message, context, text)
        return

    # فقط لینکِ آلبوم/پلی‌لیست «همه رو بگیر» می‌گیرد — نتایجِ جستجو نسخه‌های
    # جایگزینِ یک ترک‌اند، نه اعضای یک مجموعه
    batchable = looks_like_url(text)

    if batchable:
        try:
            detail = await api.resolve_ref(text)
        except Exception:
            await update.message.reply_text("این لینک شناخته نشد یا محتوایی نداشت.")
            return
        tracks = detail.tracks
    else:
        try:
            results = await api.search(text)
        except Exception:
            await update.message.reply_text("جستجو ناموفق بود — دوباره امتحان کن.")
            return
        tracks = results.tracks

    await _send_track_picker(context, update.message, tracks, batchable=batchable)


async def on_media(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    «این چه آهنگی بود؟» — ویس، فایل صوتی یا ویدیو که بیاید، با فینگرپرینت
    آکوستیک شناسایی می‌شود و بعد همان مسیرِ همیشگیِ انتخاب/دانلود ادامه می‌دهد.

    فایل از سرورِ تلگرام گرفته و همان‌طور خام به `/api/identify` داده می‌شود؛
    بات هیچ تبدیلی نمی‌کند — ffmpeg سمتِ سرور هست و اینجا نه.
    """
    message = update.message
    if message is None:
        return

    media = (
        message.voice
        or message.audio
        or message.video
        or message.video_note
        or (message.document if _is_media_document(message.document) else None)
    )
    if media is None:
        return

    if media.file_size and media.file_size > MAX_IDENTIFY_BYTES:
        await message.reply_text("فایل بزرگ است — یک تکه‌ی کوتاه‌تر (ده تا سی ثانیه) بفرست.")
        return

    status = await message.reply_text("🎧 دارم گوش می‌دم…")
    try:
        handle = await context.bot.get_file(media.file_id)
        data = bytes(await handle.download_as_bytearray())
    except Exception:
        await status.edit_text("فایل از تلگرام گرفته نشد — دوباره بفرست.")
        return

    try:
        result = await _api(context).identify(data, _media_filename(media))
    except Unavailable as exc:
        await status.edit_text(str(exc))
        return

    if not result.matches:
        await status.edit_text(
            "نشناختمش. شناساییِ رایگان فقط فایلِ کاملِ آهنگ را می‌شناسد — نه صدایی "
            "که از بلندگو ضبط شده. اسمش را بفرست تا از راه معمول بگردم."
        )
        return

    best = result.matches[0]
    # بعضی سرویس‌ها عددِ اطمینان نمی‌دهند؛ ساختنِ یک «۱۰۰٪» الکی فقط اعتمادِ
    # بی‌جا می‌سازد
    confidence = (
        f"\n<i>اطمینان {round(best.score * 100)}٪</i>" if best.score is not None else ""
    )
    await status.edit_text(
        f"🎵 <b>{html.escape(best.title)}</b>\n{html.escape(best.artist)}{confidence}",
        parse_mode=ParseMode.HTML,
    )

    if result.tracks:
        # نتیجه‌های کاتالوگ همان لیستِ «کدوم یکی؟»ِ همیشگی‌اند — تک‌نتیجه‌ای
        # مستقیم دانلود می‌شود، چندتایی دکمه می‌گیرد
        await _send_track_picker(context, message, result.tracks, batchable=False)
        return

    # شناسایی درست بوده ولی کاتالوگ در دسترس نبوده؛ لااقل اسم را داریم
    await message.reply_text(f"{best.artist} — {best.title}\nبفرستش تا دانلودش کنم.")


def _is_media_document(document) -> bool:
    """
    فایلی که به‌جای «صوت» به‌عنوان «داکیومنت» فرستاده شده.

    تلگرام هر فایلی را داکیومنت می‌فرستد اگر فرستنده گزینه‌ی «فایل» را زده
    باشد؛ بدون این، همان mp3 با یک تیکِ متفاوت نادیده می‌رفت.
    """
    if document is None:
        return False
    mime = (document.mime_type or "").lower()
    return mime.startswith(("audio/", "video/"))


def _media_filename(media) -> str:
    """
    نامِ فایل فقط برای پسوندش مهم است — سرور از روی همان تصمیم می‌گیرد که
    مستقیم به fpcalc بدهد یا اول از ffmpeg رد کند.
    """
    name = getattr(media, "file_name", None)
    if name:
        return name
    mime = (getattr(media, "mime_type", "") or "").lower()
    return "clip" + _MIME_EXT.get(mime, ".ogg")


async def _send_track_picker(
    context: ContextTypes.DEFAULT_TYPE, message: Message, tracks: list[Track], *, batchable: bool
) -> None:
    """
    لیستِ «کدوم یکی؟» — چه از جستجوی متنی/لینک، چه از باز کردنِ یک آلبوم/پلی‌لیست
    از مرورگرِ هنرمند. کاملِ لیست ذخیره می‌شود (نه فقط MAX_RESULTS تای نمایشی)
    تا «همه رو بگیر» چیزی از آلبوم/پلی‌لیست جا نگذارد.
    """
    if not tracks:
        await message.reply_text("چیزی پیدا نشد.")
        return

    # لینکِ تک‌آهنگ یا نتیجه‌ی تک‌ترکه: دکمه لازم نیست، مستقیم برو سراغ دانلود
    if len(tracks) == 1:
        await _download_and_send(context, message.chat_id, tracks[0])
        return

    context.chat_data["candidates"] = tracks
    picks = tracks[:MAX_RESULTS]
    keyboard = [
        [
            InlineKeyboardButton(
                f"{source_badge(t.source)} {format_track_button(t)}", callback_data=f"pick:{i}"
            )
        ]
        for i, t in enumerate(picks)
    ]
    prompt = "کدوم یکی؟"
    if batchable:
        keyboard.append(
            [InlineKeyboardButton(f"⬇️ دانلود همه ({len(tracks)})", callback_data="all")]
        )
        prompt = "کدوم یکی؟ یا همه رو یکجا بگیر:"
    await message.reply_text(prompt, reply_markup=InlineKeyboardMarkup(keyboard))


async def _open_collection(context: ContextTypes.DEFAULT_TYPE, message: Message, ref: str) -> None:
    """باز کردنِ یک آلبوم/پلی‌لیست — چه از جستجوی متنیِ مُد آلبوم/پلی‌لیست، چه از مرورگرِ هنرمند."""
    api = _api(context)
    try:
        detail = await api.resolve_ref(ref)
    except Exception:
        detail = None
    if detail is None:
        await message.reply_text("این مورد باز نشد.")
        return
    await _send_track_picker(context, message, detail.tracks, batchable=True)


async def _collection_search(
    update_message: Message, context: ContextTypes.DEFAULT_TYPE, text: str, *, kind: str
) -> None:
    """مُدِ «آلبوم»/«پلی‌لیست» روی /start — جستجوی نام یا resolve مستقیمِ لینک."""
    api = _api(context)

    if looks_like_url(text):
        await _open_collection(context, update_message, text)
        return

    try:
        results = await api.search(text)
    except Exception:
        await update_message.reply_text("جستجو ناموفق بود — دوباره امتحان کن.")
        return

    items = results.albums if kind == "album" else results.playlists
    if not items:
        await update_message.reply_text("چیزی پیدا نشد.")
        return

    if len(items) == 1:
        await _open_collection(context, update_message, items[0].sourceUrl or items[0].id)
        return

    picks = items[:MAX_RESULTS]
    label = format_album_button if kind == "album" else format_playlist_button
    context.chat_data["collection_candidates"] = picks
    keyboard = [
        [
            InlineKeyboardButton(
                f"{source_badge(x.source)} {label(x)}", callback_data=f"cl:{i}"
            )
        ]
        for i, x in enumerate(picks)
    ]
    await update_message.reply_text("کدوم یکی؟", reply_markup=InlineKeyboardMarkup(keyboard))


async def on_collection_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None or query.message is None:
        return

    items: list = context.chat_data.get("collection_candidates", [])
    try:
        index = int(query.data.split(":", 1)[1])
        item = items[index]
    except (ValueError, IndexError):
        await query.answer("این انتخاب دیگر معتبر نیست.", show_alert=True)
        return
    await query.answer()

    await query.edit_message_text(f"{source_badge(item.source)} {item.title}")
    await _open_collection(context, query.message, item.sourceUrl or item.id)


async def on_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None or query.message is None:
        return
    await query.answer()

    candidates: list[Track] = context.chat_data.get("candidates", [])
    try:
        index = int(query.data.split(":", 1)[1])
        track = candidates[index]
    except (ValueError, IndexError):
        await query.edit_message_text("این انتخاب دیگر معتبر نیست — دوباره جستجو کن.")
        return

    await query.edit_message_text(_track_line(track), parse_mode=ParseMode.HTML)
    await _download_and_send(context, query.message.chat_id, track)


async def on_download_all(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.message is None:
        return
    await query.answer()

    tracks: list[Track] = context.chat_data.get("candidates", [])
    if not tracks:
        await query.edit_message_text("این لیست دیگر معتبر نیست — لینک را دوباره بفرست.")
        return

    batch = tracks[:MAX_BATCH_DOWNLOAD]
    note = (
        f" (فقط {MAX_BATCH_DOWNLOAD} تای اول)" if len(tracks) > MAX_BATCH_DOWNLOAD else ""
    )
    await query.edit_message_text(f"دانلودِ {len(batch)} آهنگ{note} شروع شد…")
    await _download_all(context, query.message.chat_id, batch)


async def _download_all(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    tracks: list[Track],
    quality: str | None = None,
    *,
    keep: bool = True,
) -> None:
    """
    صفِ ترتیبی برای «دانلود همه». هر ترک همان مسیرِ تک‌آهنگ را طی می‌کند (پیامِ
    وضعیتِ خودش، کاور، لیریک)؛ فقط یک شمارنده‌ی بالای صف اضافه می‌شود تا کاربر
    بداند کجای آلبوم است. شکستِ یک ترک بقیه‌ی صف را متوقف نمی‌کند.
    """
    total = len(tracks)
    summary = await context.bot.send_message(chat_id, f"صفِ آلبوم — 0/{total}")
    done = 0
    for track in tracks:
        await _download_and_send(context, chat_id, track, quality, keep=keep)
        done += 1
        try:
            await summary.edit_text(f"صفِ آلبوم — {done}/{total}")
        except Exception:
            pass
    try:
        await summary.edit_text(f"صفِ آلبوم تمام شد ✅ {done}/{total}")
    except Exception:
        pass


async def _download_and_send(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    track: Track,
    quality: str | None = None,
    *,
    keep: bool = True,
) -> None:
    """
    `quality` را فقط مسیرهایی می‌دهند که خودشان انتخابش کرده‌اند (دکمه‌ی وب)؛
    None یعنی همان کیفیتِ پیش‌فرضِ همین چت. `keep=False` یعنی «فقط تلگرام» —
    پس از ارسال، فایل و ردیفِ جاب پاک می‌شوند و کتابخانه نمی‌بیندشان.
    """
    status = await context.bot.send_message(
        chat_id, f"{_track_line(track)}\nدر صف…", parse_mode=ParseMode.HTML
    )
    sink = _StatusSink(context, message=status)

    result = await _run_download(context, track, sink, quality)
    if result is None:
        return
    job_id, final = result
    await _deliver(context, chat_id, track, job_id, sink, final.format, keep=keep)


async def _run_download(
    context: ContextTypes.DEFAULT_TYPE,
    track: Track,
    sink: _StatusSink,
    quality: str | None = None,
) -> tuple[str, DownloadProgress] | None:
    """جاب را می‌سازد و SSE را دنبال می‌کند. None یعنی شکست — پیام از قبل ادیت شده."""
    api = _api(context)
    quality = quality or context.chat_data.get("quality", DEFAULT_QUALITY)

    try:
        job_id = await api.create_download(track, quality)
    except Exception as exc:
        await sink.edit(f"شروع دانلود ناموفق بود: {exc}")
        return None

    header = _track_line(track)
    final: DownloadProgress | None = None
    last_text, last_edit = "", 0.0
    try:
        async for progress in api.stream_progress(job_id):
            final = progress
            if progress.status == "downloading":
                bar = progress_bar(progress.percent)
                text = f"{header}\n{bar} {progress.percent:.0f}٪ — در حال دانلود"
            else:
                label = STATUS_LABEL.get(progress.status, progress.status)
                text = f"{header}\n{label}"
            now = time.monotonic()
            if text != last_text and now - last_edit >= EDIT_INTERVAL:
                last_text, last_edit = text, now
                await sink.edit(text, parse_mode=ParseMode.HTML)
    except Exception as exc:
        await sink.edit(f"دریافت وضعیت ناموفق بود: {exc}")
        return None

    if final is None or final.status != "ready":
        await sink.edit((final.error if final else None) or "دانلود ناموفق بود.")
        return None
    return job_id, final


async def _upload_audio(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    *,
    data: bytes,
    track: Track,
    format_label: str | None,
    thumb: InputFile | None,
) -> Message:
    """
    `send_audio` با مهلتِ آپلود و تلاشِ دوباره.

    خطای شبکه را قورت نمی‌دهد: بعد از آخرین تلاش همان استثنا بالا می‌رود تا
    صدازننده تصمیم بگیرد چه به کاربر بگوید.
    """
    # مقدارِ اولیه فقط برای وقتی است که حلقه اصلاً نچرخد؛ در عمل همیشه با
    # خطای آخرین تلاش جایگزین می‌شود.
    last: NetworkError = NetworkError("آپلود به تلگرام نشد.")
    for attempt in range(1, UPLOAD_ATTEMPTS + 1):
        try:
            return await context.bot.send_audio(
                chat_id,
                audio=data,
                filename=audio_filename(track, format_label),
                title=track.title,
                performer=track.artist,
                thumbnail=thumb,
                read_timeout=UPLOAD_TIMEOUT,
                write_timeout=UPLOAD_TIMEOUT,
            )
        except BadRequest:
            # زیرِ NetworkError نشسته ولی خطای خودِ درخواست است (فایلِ بزرگ،
            # چتِ ناموجود) — تلاشِ دوباره جوابش را عوض نمی‌کند.
            raise
        except NetworkError as exc:
            last = exc
            log.warning(
                "آپلودِ %s به تلگرام در تلاشِ %d/%d نشد: %s",
                track.title,
                attempt,
                UPLOAD_ATTEMPTS,
                exc,
            )
            if attempt < UPLOAD_ATTEMPTS:
                await asyncio.sleep(UPLOAD_RETRY)
    raise last


async def _deliver(
    context: ContextTypes.DEFAULT_TYPE,
    chat_id: int,
    track: Track,
    job_id: str,
    sink: _StatusSink,
    format_label: str | None,
    *,
    keep: bool = True,
) -> None:
    """
    فایلِ آماده را می‌گیرد و می‌فرستد — چه تازه دانلود شده باشد چه از
    کتابخانه (`/library`) دوباره خواسته شده باشد.

    `keep=False` یعنی «فقط تلگرام»: بعد از رسیدنِ موفقِ فایل (و متن)، فایل و
    ردیفِ جاب پاک می‌شوند. شکستِ آپلود پاک‌سازی را رد می‌کند تا فایلِ روی سرور
    از طریق لینکِ مستقیم از دست نرود.
    """
    api = _api(context)
    # فایل و اطلاعاتِ Genius ربطی به هم ندارند — همزمان بگیر، نه پشتِ سرِ هم
    data, info = await asyncio.gather(
        api.file_bytes(job_id), api.song_info(track.title, track.artist)
    )
    if data is None:
        await sink.edit("فایل آماده نبود.")
        return

    if too_large_for_telegram(len(data)):
        await sink.edit(
            "این فایل بزرگ‌تر از حدی است که تلگرام قبول می‌کند — "
            f"مستقیم بگیرش:\n{api.file_url(job_id)}"
        )
        return

    # کارتِ اطلاعات: شکستِ گرفتنِ کاور/اطلاعات نباید جلوی رسیدنِ خودِ فایل را
    # بگیرد — best-effort، جدا از مسیر اصلی
    try:
        cover = await _fetch_full_cover(api, track, info)
        if cover:
            await context.bot.send_photo(
                chat_id,
                photo=cover,
                caption=_info_caption(track, info),
                parse_mode=ParseMode.HTML,
            )
    except Exception:
        log.warning("فرستادن کارتِ اطلاعات برای %s ناموفق بود", track.title, exc_info=True)

    await sink.edit(f"{_track_line(track)}\nدر حال ارسال…", parse_mode=ParseMode.HTML)
    # مثل کاورِ کاملِ بالا، best-effort است — شکستِ گرفتنِ thumbnail نباید
    # جلوی رسیدنِ خودِ فایل صوتی را بگیرد
    try:
        thumb = await _fetch_thumbnail(api, track.artworkUrl, job_id)
    except Exception:
        thumb = None
        log.warning("گرفتنِ thumbnail برای %s ناموفق بود", track.title, exc_info=True)

    try:
        await _upload_audio(
            context, chat_id, data=data, track=track, format_label=format_label, thumb=thumb
        )
    except NetworkError as exc:
        # فایل روی دیسکِ سرور هست و از LAN می‌شود گرفتش — همان راهی که برای
        # فایلِ بزرگ‌تر از حدِ تلگرام هم می‌رود. پیامِ وضعیت را با لینک نگه
        # می‌داریم تا آهنگ به‌خاطرِ یک قطعیِ لحظه‌ای کلاً از دست نرود.
        await sink.edit(
            f"{_track_line(track)}\nآپلود به تلگرام نشد — مستقیم بگیرش:\n{api.file_url(job_id)}",
            parse_mode=ParseMode.HTML,
        )
        raise RuntimeError(f"آپلود به تلگرام نشد ({exc}) — فایل روی سرور آماده است.") from exc

    await sink.delete()

    # فایلِ صوتی از قبل رسیده؛ نرسیدنِ .lrc نباید کلِ ارسال را «ناموفق» کند —
    # دکمه‌ی وب همان لحظه قرمز می‌شد در حالی که آهنگ در چت نشسته بود.
    try:
        lyrics = await api.lyrics_bytes(job_id)
        if lyrics:
            await context.bot.send_document(
                chat_id,
                document=lyrics,
                filename=f"{track.artist} - {track.title}.lrc",
                read_timeout=UPLOAD_TIMEOUT,
                write_timeout=UPLOAD_TIMEOUT,
            )
    except Exception:
        log.warning("فرستادنِ متنِ %s ناموفق بود", track.title, exc_info=True)

    if not keep:
        # «فقط تلگرام»: فایل رسیده، پس اثری در کتابخانه نماند. DELETE هم فایل
        # و هم ردیفِ دیتابیس را برمی‌دارد؛ شکستش فقط هشدار است — پیگیریِ دکمه‌ی
        # وب قبلاً با رسیدنِ آپلود تمام شده و نباید حالا قرمز شود.
        try:
            await api.delete_download(job_id)
        except Exception:
            log.warning("پاک‌سازیِ «فقط تلگرام» برای %s ناموفق بود", track.title, exc_info=True)


# ---------- inline mode ----------

# نتیجه‌ی inline فقط یک id کوتاه دارد (محدودیتِ تلگرام)، نه کلِ ترک؛ همان id
# را روی این کش نگه می‌داریم تا وقتی کاربر یکی را انتخاب کرد (chosen_inline_result)
# بدانیم واقعاً چه چیزی انتخاب شده. TTL کوتاه چون نتایجِ inline زودگذرند.
_INLINE_CACHE_TTL = 600.0
_inline_cache: dict[str, Track] = {}
_inline_cache_at: dict[str, float] = {}


def _cache_inline_track(track: Track) -> str:
    now = time.monotonic()
    cutoff = now - _INLINE_CACHE_TTL
    for key in [k for k, at in _inline_cache_at.items() if at < cutoff]:
        _inline_cache.pop(key, None)
        _inline_cache_at.pop(key, None)

    key = uuid.uuid4().hex[:16]
    _inline_cache[key] = track
    _inline_cache_at[key] = now
    return key


async def on_inline_query(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    جستجو از هر چتی با `@botname آهنگ`، بدون باز کردن پی‌وی بات.

    لینک اینجا پشتیبانی نمی‌شود — resolve یک آلبوم/پلی‌لیست ممکن است طول
    بکشد و inline query چند ثانیه بیشتر مهلت نمی‌دهد؛ برای لینک همچنان باید
    مستقیم به بات پیام داد.
    """
    query = update.inline_query
    text = query.query.strip()
    if not text or looks_like_url(text):
        await query.answer([], cache_time=1, is_personal=True)
        return

    api = _api(context)
    try:
        results = await api.search(text)
    except Exception:
        await query.answer([], cache_time=1, is_personal=True)
        return

    articles = []
    for track in results.tracks[:MAX_RESULTS]:
        key = _cache_inline_track(track)
        thumb = resized_artwork(track.artworkUrl, THUMB_SIZE) if track.artworkUrl else None
        articles.append(
            InlineQueryResultArticle(
                id=key,
                title=f"{source_badge(track.source)} {track.title}",
                description=track.artist,
                thumbnail_url=thumb,
                input_message_content=InputTextMessageContent(
                    f"{_track_line(track)}\nدر صف…", parse_mode=ParseMode.HTML
                ),
            )
        )
    await query.answer(articles, cache_time=5, is_personal=True)


async def on_chosen_inline_result(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """
    کاربر یکی از نتایجِ inline را زد — همان پیامِ متنی که در `input_message_content`
    ساختیم الان در آن چت نشسته و ما فقط `inline_message_id`اش را داریم.
    """
    chosen = update.chosen_inline_result
    log.info(
        "chosen_inline_result: result_id=%s inline_message_id=%s",
        chosen.result_id,
        chosen.inline_message_id,
    )
    try:
        if chosen.inline_message_id is None:
            return
        track = _inline_cache.pop(chosen.result_id, None)
        _inline_cache_at.pop(chosen.result_id, None)
        if track is None:
            await context.bot.edit_message_text(
                "این نتیجه دیگر معتبر نیست — دوباره جستجو کن.",
                inline_message_id=chosen.inline_message_id,
            )
            return

        sink = _StatusSink(context, inline_message_id=chosen.inline_message_id)
        result = await _run_download(context, track, sink)
        if result is None:
            return
        job_id, final = result
        await _deliver_inline(context, chosen.inline_message_id, track, job_id, final.format)
    except Exception:
        log.exception("on_chosen_inline_result کلاً شکست خورد")


async def _deliver_inline(
    context: ContextTypes.DEFAULT_TYPE,
    inline_message_id: str,
    track: Track,
    job_id: str,
    format_label: str | None,
) -> None:
    """
    برخلافِ چتِ معمولی، اینجا نمی‌شود مستقیم فایل فرستاد: ادیتِ پیامِ inline
    فقط `file_id` یا URL قبول می‌کند، نه آپلودِ تازه. اگر چتِ کش تنظیم شده
    باشد، فایل یک‌بار آنجا فرستاده می‌شود تا `file_id` بگیرد و همان روی پیامِ
    inline بنشیند؛ وگرنه فقط لینکِ مستقیمِ فایل نشان داده می‌شود.
    """
    api = _api(context)
    sink = _StatusSink(context, inline_message_id=inline_message_id)
    data = await api.file_bytes(job_id)
    if data is None:
        await sink.edit("فایل آماده نبود.")
        return

    if too_large_for_telegram(len(data)) or TELEGRAM_CACHE_CHAT_ID is None:
        await sink.edit(
            f"{_track_line(track)}\nآماده شد — بگیرش:\n{api.file_url(job_id)}",
            parse_mode=ParseMode.HTML,
        )
        return

    try:
        thumb = await _fetch_thumbnail(api, track.artworkUrl, job_id)
        cached = await _upload_audio(
            context,
            TELEGRAM_CACHE_CHAT_ID,
            data=data,
            track=track,
            format_label=format_label,
            thumb=thumb,
        )
        await context.bot.edit_message_media(
            inline_message_id=inline_message_id,
            media=InputMediaAudio(
                media=cached.audio.file_id,
                title=track.title,
                performer=track.artist,
                caption=_track_line(track),
                parse_mode=ParseMode.HTML,
            ),
        )
    except Exception:
        log.warning("تحویلِ inline برای %s ناموفق بود", track.title, exc_info=True)
        await sink.edit(
            f"{_track_line(track)}\nآماده شد — بگیرش:\n{api.file_url(job_id)}",
            parse_mode=ParseMode.HTML,
        )


# ---------- دنبال‌کردنِ هنرمند ----------


# ---------- وصل‌شدن به وب و صفِ «فرستادن به تلگرام» ----------
#
# وب توکنِ تلگرام ندارد و نمی‌داند چت کیست، پس دو تکه لازم است: یک کدِ
# یک‌بارمصرف که این چت را به آن نصب وصل می‌کند، و یک صف که دکمه‌ی وب رویش
# ردیف می‌گذارد و همین‌جا برداشته می‌شود. خودِ دانلود و ارسال همان مسیرِ
# همیشگیِ بات است — هیچ کدِ موازی‌ای برای وب نوشته نشده.

LINK_PAYLOAD_PREFIX = "link_"

# وقفه‌ی تلاش دوباره وقتی سرور در دسترس نیست — نه آن‌قدر تند که لاگ پر شود
OUTBOX_RETRY = 5.0

# سقفِ انتظارِ هر long-poll (ثانیه). باید با telegram.OUTBOX_WAIT سمت سرور جور
# باشد؛ سرور خودش هم بیشتر از آن صبر نمی‌کند.
OUTBOX_WAIT = 25.0


def _chat_title(message: Message) -> str:
    """اسمی که در وب کنارِ «وصل است» نشان داده می‌شود."""
    chat = message.chat
    if chat.title:
        return chat.title
    name = " ".join(x for x in (chat.first_name, chat.last_name) if x)
    return name or (f"@{chat.username}" if chat.username else str(chat.id))


async def _claim_link(message: Message, context: ContextTypes.DEFAULT_TYPE, code: str) -> None:
    code = code.strip()
    if not code:
        await message.reply_text("کد را هم بنویس: /link ABC123 — کد را از دکمه‌ی تلگرامِ وب بگیر.")
        return

    error = await _api(context).claim_pair(code, message.chat_id, _chat_title(message))
    if error:
        await message.reply_text(error)
        return
    await message.reply_text(
        "وصل شد ✅\n"
        "از این به بعد هر آهنگ یا آلبومی که در وب دکمه‌ی تلگرامش را بزنی، "
        "کامل همین‌جا می‌آید."
    )


async def link_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """`/link ABC123` — همان کدی که وب نشان می‌دهد، برای وقتی لینکِ عمیق باز نشد."""
    if update.message is None:
        return
    await _claim_link(update.message, context, context.args[0] if context.args else "")


async def _run_outbox_job(application: Application, job: TelegramJob) -> str | None:
    """
    یک کارِ صف. برگشتی None یعنی موفق، وگرنه دلیلِ شکست تا در وب دیده شود.

    context را دستی می‌سازیم چون این کار از هیچ آپدیتی نیامده — ولی همان
    context معمولی است، پس `_download_and_send` فرقی بین این مسیر و پیامِ
    کاربر نمی‌بیند.
    """
    context = application.context_types.context(application, chat_id=job.chatId)

    if job.kind == "track":
        if job.track is None:
            return "خودِ آهنگ در صف نبود."
        await _download_and_send(context, job.chatId, job.track, job.quality, keep=job.keep)
        return None

    if not job.ref:
        return "لینکِ آلبوم در صف نبود."
    try:
        album = await _api(context).resolve_ref(job.ref)
    except Exception as exc:
        return f"باز کردنِ آلبوم ناموفق بود: {exc}"
    if not album.tracks:
        return "این آلبوم ترکی نداشت."

    batch = album.tracks[:MAX_BATCH_DOWNLOAD]
    note = f" (فقط {MAX_BATCH_DOWNLOAD} تای اول)" if len(album.tracks) > MAX_BATCH_DOWNLOAD else ""
    await context.bot.send_message(
        job.chatId,
        f"از وب: <b>{html.escape(album.title)}</b> — {len(batch)} آهنگ{note}",
        parse_mode=ParseMode.HTML,
    )
    await _download_all(context, job.chatId, batch, job.quality, keep=job.keep)
    return None


async def _outbox_loop(application: Application) -> None:
    """
    long-pollِ همیشگی روی صفِ سرور.

    خطای شبکه فقط یعنی سرور هنوز بالا نیست یا ری‌استارت شده — کمی صبر و دوباره؛
    خطای خودِ کار به سرور گزارش می‌شود تا دکمه‌ی وب از حالتِ «در حال ارسال»
    دربیاید و کاربر معطلِ اسپینری نماند که هیچ‌وقت تمام نمی‌شود.
    """
    api = _api_from_app(application)
    username = application.bot_data.get("username")
    await api.register(username)

    while True:
        try:
            job = await api.next_telegram_job(username, OUTBOX_WAIT)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.debug("خواندنِ صفِ تلگرام ناموفق بود", exc_info=True)
            await asyncio.sleep(OUTBOX_RETRY)
            continue

        if job is None:
            continue

        try:
            error = await _run_outbox_job(application, job)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.warning("کارِ صفِ تلگرام شکست خورد", exc_info=True)
            error = str(exc)
        await api.finish_telegram_job(job.id, error)


async def follow_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    text = " ".join(context.args) if context.args else ""
    if not text.strip():
        await update.message.reply_text(
            "اسم هنرمند یا لینک صفحه‌اش رو بعد از /follow بفرست؛ مثلاً:\n"
            "/follow Farhad Mehrad"
        )
        return

    api = _api(context)
    try:
        if looks_like_url(text):
            detail = await api.artist(text)
            artists: list = [detail] if detail else []
        else:
            results = await api.search(text)
            artists = list(results.artists)
    except Exception:
        await update.message.reply_text("پیدا کردنِ هنرمند ناموفق بود.")
        return

    if not artists:
        await update.message.reply_text("هنرمندی پیدا نشد.")
        return

    if len(artists) == 1:
        await _follow_artist(update.message, context, artists[0])
        return

    picks = artists[:MAX_RESULTS]
    context.chat_data["artist_candidates"] = picks
    keyboard = [
        [
            InlineKeyboardButton(
                f"{source_badge(a.source)} {format_artist_button(a.name)}",
                callback_data=f"followpick:{i}",
            )
        ]
        for i, a in enumerate(picks)
    ]
    await update.message.reply_text("کدوم یکی؟", reply_markup=InlineKeyboardMarkup(keyboard))


async def _follow_artist(message: Message, context: ContextTypes.DEFAULT_TYPE, artist) -> None:
    """
    دنبال‌کردن را در سرور ثبت می‌کند؛ اگر جزئیاتِ کامل (با آلبوم‌ها) از قبل نداریم
    (مسیرِ جستجو فقط کارتِ خلاصه می‌دهد)، یک `artist()` دیگر برای seed کردنِ
    آخرین انتشار لازم است — بدونش، اولین چکِ پس‌زمینه هر آلبومِ قدیمی را هم
    «تازه» حساب می‌کرد و برای هر هنرمند یک پیامِ کاذب می‌فرستاد.
    """
    api = _api(context)
    detail = artist if isinstance(artist, ArtistDetail) else await api.artist(artist.sourceUrl)

    latest = detail.albums[0] if detail and detail.albums else None
    try:
        state = await api.add_follow(
            message.chat_id,
            FollowRequest(
                artistId=artist.id,
                artistName=artist.name,
                artistSourceUrl=artist.sourceUrl,
                source=artist.source,
                artworkUrl=artist.artworkUrl,
                lastReleaseId=latest.id if latest else None,
                lastReleaseTitle=latest.title if latest else None,
            ),
        )
    except Exception:
        await message.reply_text("ثبتِ دنبال‌کردن ناموفق بود — سرور در دسترس نیست؟")
        return
    if state.created:
        await message.reply_text(
            f"{source_badge(artist.source)} دنبال‌کردنِ «{artist.name}» شروع شد — "
            "هر انتشارِ تازه‌ای را خودکار با فایل، کاور و لینکش همین‌جا می‌فرستم."
        )
    else:
        await message.reply_text(f"«{artist.name}» از قبل دنبال می‌شد.")


async def on_follow_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None or query.message is None:
        return
    await query.answer()

    candidates = context.chat_data.get("artist_candidates", [])
    try:
        index = int(query.data.split(":", 1)[1])
        artist = candidates[index]
    except (ValueError, IndexError):
        await query.edit_message_text("این انتخاب دیگر معتبر نیست — دوباره /follow بزن.")
        return

    await query.edit_message_text(f"{source_badge(artist.source)} {artist.name}")
    await _follow_artist(query.message, context, artist)


async def unfollow_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    try:
        follows = await _api(context).follows(update.message.chat_id)
    except Exception:
        await update.message.reply_text("گرفتنِ لیستِ دنبال‌شده‌ها ناموفق بود.")
        return
    if not follows:
        await update.message.reply_text("چیزی دنبال نمی‌کنی.")
        return

    keyboard = [
        [InlineKeyboardButton(f"✕ {f.artistName}", callback_data=f"unfollow:{f.artistId}")]
        for f in follows
    ]
    await update.message.reply_text(
        "کدوم رو دیگه دنبال نکنم؟", reply_markup=InlineKeyboardMarkup(keyboard)
    )


async def on_unfollow_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None or query.message is None:
        return
    await query.answer()

    artist_id = query.data.split(":", 1)[1]
    try:
        removed = await _api(context).remove_follow(query.message.chat_id, artist_id)
    except Exception:
        await query.edit_message_text("حذف ناموفق بود — سرور در دسترس نیست؟")
        return
    await query.edit_message_text("دیگه دنبال نمی‌شود." if removed else "این مورد پیدا نشد.")


async def following_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message is None:
        return
    try:
        follows = await _api(context).follows(update.message.chat_id)
    except Exception:
        await update.message.reply_text("گرفتنِ لیستِ دنبال‌شده‌ها ناموفق بود.")
        return
    if not follows:
        await update.message.reply_text("چیزی دنبال نمی‌کنی — با /follow شروع کن.")
        return

    lines = [f"{source_badge(f.source)} {f.artistName}" for f in follows]
    await update.message.reply_text("دنبال‌شده‌ها:\n" + "\n".join(f"• {l}" for l in lines))


# ---------- مرورگرِ هنرمند ----------


async def _artist_search(message: Message, context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    """مُدِ «هنرمند» روی /start — همان جستجوی دوشاخه‌ی `follow_cmd` (لینک یا اسم)."""
    api = _api(context)
    try:
        if looks_like_url(text):
            detail = await api.artist(text)
            if detail is None:
                await message.reply_text("هنرمندی پیدا نشد.")
                return
            await _reply_artist_profile(message, await _artist_profile_view(context, detail))
            return
        results = await api.search(text)
    except Exception:
        await message.reply_text("جستجوی هنرمند ناموفق بود.")
        return

    artists = results.artists
    if not artists:
        await message.reply_text("هنرمندی پیدا نشد.")
        return

    if len(artists) == 1:
        view = await _artist_profile_view(context, artists[0].id)
        if view is None:
            await message.reply_text("این هنرمند پیدا نشد.")
            return
        await _reply_artist_profile(message, view)
        return

    picks = artists[:MAX_RESULTS]
    context.chat_data["browse_artist_candidates"] = picks
    keyboard = [
        [
            InlineKeyboardButton(
                f"{source_badge(a.source)} {format_artist_search_button(a)}",
                callback_data=f"ba:{i}",
            )
        ]
        for i, a in enumerate(picks)
    ]
    await message.reply_text("کدوم یکی؟", reply_markup=InlineKeyboardMarkup(keyboard))


async def _artist_profile_view(
    context: ContextTypes.DEFAULT_TYPE, ref_or_detail: str | ArtistDetail
) -> tuple[str, InlineKeyboardMarkup] | None:
    """
    متن + کیبورد صفحه‌ی پروفایل هنرمند — None یعنی پیدا نشد.

    ورودی یا ref است یا یک `ArtistDetail` از قبل آماده (وقتی جستجو با لینک
    خودش کاملش داده)، همان الگوی `_follow_artist`.
    """
    api = _api(context)
    if isinstance(ref_or_detail, ArtistDetail):
        detail = ref_or_detail
    else:
        try:
            detail = await api.artist(ref_or_detail)
        except Exception:
            log.warning("گرفتنِ پروفایلِ %s ناموفق بود", ref_or_detail, exc_info=True)
            detail = None
    if detail is None:
        return None

    # کش می‌شود تا رفت‌وبرگشت بین بخش‌ها (`_artist_section_view`) یک هنرمند را
    # دوباره fetch نکند
    context.chat_data["artist_view"] = {"ref": detail.id, "detail": detail}

    text = (
        f"{source_badge(detail.source)} <b>{html.escape(detail.name)}</b>\n"
        f"{html.escape(detail.subtitle)}"
    )

    rows: list[list[InlineKeyboardButton]] = []
    if detail.topTracks:
        rows.append([InlineKeyboardButton("⭐ آهنگ‌های محبوب", callback_data=f"att:{detail.id}")])
    if detail.albums:
        rows.append(
            [
                InlineKeyboardButton(
                    f"💿 آلبوم‌ها ({len(detail.albums)})", callback_data=f"aal:{detail.id}"
                )
            ]
        )
    if detail.playlists:
        rows.append([InlineKeyboardButton("📃 پلی‌لیست‌ها", callback_data=f"apl:{detail.id}")])
    if detail.radio:
        rows.append([InlineKeyboardButton("📻 رادیو", callback_data=f"ard:{detail.id}")])
    if detail.related:
        rows.append([InlineKeyboardButton("🔗 هنرمندهای مرتبط", callback_data=f"are:{detail.id}")])
    rows.append([InlineKeyboardButton("➕ دنبال کردن", callback_data=f"afollow:{detail.id}")])

    return text, InlineKeyboardMarkup(rows)


async def _reply_artist_profile(message: Message, view: tuple[str, InlineKeyboardMarkup]) -> None:
    text, keyboard = view
    await message.reply_text(text, reply_markup=keyboard, parse_mode=ParseMode.HTML)


async def _edit_artist_profile(query, view: tuple[str, InlineKeyboardMarkup]) -> None:
    text, keyboard = view
    await query.edit_message_text(text, reply_markup=keyboard, parse_mode=ParseMode.HTML)


async def _artist_section_view(
    context: ContextTypes.DEFAULT_TYPE, ref: str, section: str
) -> tuple[str, InlineKeyboardMarkup] | None:
    """
    متن + کیبورد یک بخش از صفحه‌ی هنرمند (آهنگ محبوب/آلبوم/پلی‌لیست/رادیو/مرتبط).

    از `artist_view` (آخرین هنرمندِ دیده‌شده) استفاده می‌کند تا رفت‌وبرگشت بین
    بخش‌ها یک هنرمند را دوباره fetch نکند.
    """
    cached = context.chat_data.get("artist_view")
    if cached and cached.get("ref") == ref:
        detail = cached["detail"]
    else:
        try:
            detail = await _api(context).artist(ref)
        except Exception:
            log.warning("گرفتنِ پروفایلِ %s ناموفق بود", ref, exc_info=True)
            detail = None
        if detail is None:
            return None
        context.chat_data["artist_view"] = {"ref": ref, "detail": detail}

    if section in ("att", "ard"):
        items: list[Track] = detail.topTracks if section == "att" else detail.radio
        context.chat_data["artist_view_tracks"] = items
        rows = [
            [
                InlineKeyboardButton(
                    f"{source_badge(t.source)} {format_track_button(t)}", callback_data=f"tk:{i}"
                )
            ]
            for i, t in enumerate(items[:MAX_RESULTS])
        ]
    elif section == "aal":
        albums: list[Album] = detail.albums
        context.chat_data["artist_view_albums"] = albums
        rows = [
            [InlineKeyboardButton(format_album_button(a), callback_data=f"ab:{i}")]
            for i, a in enumerate(albums[:MAX_RESULTS])
        ]
    elif section == "apl":
        playlists: list[Playlist] = detail.playlists
        context.chat_data["artist_view_playlists"] = playlists
        rows = [
            [InlineKeyboardButton(format_playlist_button(p), callback_data=f"pl:{i}")]
            for i, p in enumerate(playlists[:MAX_RESULTS])
        ]
    else:  # are — هرکدام مستقیم به پروفایل همان هنرمند می‌رود، نیازی به index ندارد
        related: list[Artist] = detail.related
        rows = [
            [
                InlineKeyboardButton(
                    f"{source_badge(a.source)} {format_artist_search_button(a)}",
                    callback_data=f"au:{a.id}",
                )
            ]
            for a in related[:MAX_RESULTS]
        ]

    rows.append([InlineKeyboardButton("🔙 بازگشت", callback_data=f"au:{ref}")])
    return SECTION_TITLE[section], InlineKeyboardMarkup(rows)


async def on_browse_artist_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """انتخاب از لیستِ «کدوم یکی؟»ی جستجوی هنرمند (مُد «هنرمند» روی /start)."""
    query = update.callback_query
    if query is None or query.data is None:
        return

    candidates: list[Artist] = context.chat_data.get("browse_artist_candidates", [])
    try:
        index = int(query.data.split(":", 1)[1])
        artist = candidates[index]
    except (ValueError, IndexError):
        await query.answer("این انتخاب دیگر معتبر نیست.", show_alert=True)
        return
    await query.answer()

    view = await _artist_profile_view(context, artist.id)
    if view is None:
        await query.edit_message_text("این هنرمند پیدا نشد.")
        return
    await _edit_artist_profile(query, view)


async def on_artist_open(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """`au:{ref}` — پروفایل هنرمند: بازگشت از یک بخش، یا رفتن به یک هنرمندِ مرتبط."""
    query = update.callback_query
    if query is None or query.data is None:
        return
    await query.answer()

    ref = query.data.split(":", 1)[1]
    view = await _artist_profile_view(context, ref)
    if view is None:
        await query.edit_message_text("این هنرمند دیگر پیدا نشد.")
        return
    await _edit_artist_profile(query, view)


async def on_artist_section(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """`att:`/`aal:`/`apl:`/`ard:`/`are:` — یک بخش از صفحه‌ی هنرمند."""
    query = update.callback_query
    if query is None or query.data is None:
        return
    await query.answer()

    section, ref = query.data.split(":", 1)
    view = await _artist_section_view(context, ref, section)
    if view is None:
        await query.edit_message_text("این هنرمند دیگر پیدا نشد.")
        return
    text, keyboard = view
    await query.edit_message_text(text, reply_markup=keyboard)


async def on_artist_follow(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """دکمه‌ی «➕ دنبال کردن» روی کارتِ پروفایل — همان `_follow_artist` موجود."""
    query = update.callback_query
    if query is None or query.data is None or query.message is None:
        return

    ref = query.data.split(":", 1)[1]
    cached = context.chat_data.get("artist_view")
    if cached and cached.get("ref") == ref:
        detail = cached["detail"]
    else:
        try:
            detail = await _api(context).artist(ref)
        except Exception:
            log.warning("گرفتنِ پروفایلِ %s ناموفق بود", ref, exc_info=True)
            detail = None
    if detail is None:
        await query.answer("این هنرمند دیگر پیدا نشد.", show_alert=True)
        return
    await query.answer()
    await _follow_artist(query.message, context, detail)


async def on_artist_track_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """انتخابِ یک ترک از «آهنگ‌های محبوب» یا «رادیو»ی صفحه‌ی هنرمند."""
    query = update.callback_query
    if query is None or query.data is None or query.message is None:
        return

    items: list[Track] = context.chat_data.get("artist_view_tracks", [])
    try:
        index = int(query.data.split(":", 1)[1])
        track = items[index]
    except (ValueError, IndexError):
        await query.answer("این انتخاب دیگر معتبر نیست.", show_alert=True)
        return
    await query.answer()

    await query.edit_message_text(_track_line(track), parse_mode=ParseMode.HTML)
    await _download_and_send(context, query.message.chat_id, track)


async def on_artist_album_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None or query.message is None:
        return

    albums: list[Album] = context.chat_data.get("artist_view_albums", [])
    try:
        index = int(query.data.split(":", 1)[1])
        album = albums[index]
    except (ValueError, IndexError):
        await query.answer("این انتخاب دیگر معتبر نیست.", show_alert=True)
        return
    await query.answer()

    await query.edit_message_text(f"💿 {album.title}")
    await _open_collection(context, query.message, album.sourceUrl or album.id)


async def on_artist_playlist_pick(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if query is None or query.data is None or query.message is None:
        return

    playlists: list[Playlist] = context.chat_data.get("artist_view_playlists", [])
    try:
        index = int(query.data.split(":", 1)[1])
        pl = playlists[index]
    except (ValueError, IndexError):
        await query.answer("این انتخاب دیگر معتبر نیست.", show_alert=True)
        return
    await query.answer()

    await query.edit_message_text(f"📃 {pl.title}")
    await _open_collection(context, query.message, pl.sourceUrl or pl.id)


async def _auto_send_release(
    application: Application,
    api: ApiClient,
    f: Follow,
    album: Album,
) -> bool:
    """
    تحویلِ خودکارِ یک انتشارِ تازه: کاورِ باکیفیت + لینکِ پلتفرم، بعد خودِ
    فایل‌ها (تک‌آهنگ یا کلِ آلبوم) با کیفیتِ خودکار.

    هیچ شکستی نباید انتشار را گم کند — اگر ارسالِ فایل‌ها نشد، لااقل همان خبرِ
    قدیمی با لینکِ پلتفرم می‌رسد تا کاربر خودش بتواند بگیرد. برگشتیِ تابع
    می‌گوید آیا اصلاً خبری به چت رسید — اگر نه، صداکننده «دیده‌شده» ثبت نمی‌کند
    تا در چکِ بعدی دوباره امتحان شود.
    """
    bot = application.bot
    badge = source_badge(album.source)
    platform = SOURCE_NAME.get(album.source, str(album.source))

    async def _announce(failed: bool = False) -> bool:
        """خبرِ انتشار + کاور + لینک؛ `failed` یعنی فایل‌ها نرسیدند و فقط خبر می‌دهیم."""
        text = (
            f"🆕 {badge} <b>{html.escape(f.artistName)}</b> یه اثر تازه منتشر کرد:\n"
            f"💿 <b>{html.escape(album.title)}</b>"
        )
        if album.sourceUrl:
            text += f'\n🔗 <a href="{album.sourceUrl}">لینک در {platform}</a>'
        if failed:
            text += (
                "\n⚠️ فرستادنِ فایل‌ها نشد — از لینک بالا بگیرش."
                if album.sourceUrl
                else "\n⚠️ فرستادنِ فایل‌ها نشد."
            )
        try:
            if album.artworkUrl:
                for url in artwork_at_most(album.artworkUrl, ARTWORK_EMBED):
                    if data := await api.raw_bytes(url):
                        await bot.send_photo(
                            f.chatId, photo=data, caption=text, parse_mode=ParseMode.HTML
                        )
                        return True
            await bot.send_message(f.chatId, text, parse_mode=ParseMode.HTML)
            return True
        except Exception:
            log.warning("خبرِ انتشارِ %s به %s نرسید", album.title, f.chatId, exc_info=True)
            return False

    try:
        resolved = await api.resolve_ref(album.sourceUrl or album.id)
    except Exception:
        resolved = None
        log.warning("باز کردنِ انتشارِ %s برای %s نشد", album.title, f.artistName, exc_info=True)

    tracks = resolved.tracks if resolved else []
    if not tracks:
        return await _announce(failed=True)

    announced = await _announce()

    context = application.context_types.context(application, chat_id=f.chatId)
    try:
        if len(tracks) == 1:
            await _download_and_send(context, f.chatId, tracks[0], AUTO_QUALITY)
        else:
            await _download_all(
                context, f.chatId, tracks[:MAX_BATCH_DOWNLOAD], AUTO_QUALITY
            )
    except Exception:
        # خودِ مسیرِ دانلود پیامِ خطا/لینکِ مستقیمش را در چت گذاشته؛ اینجا فقط
        # ثبت می‌شود تا در لاگِ فایل ردش بماند
        log.warning("ارسالِ خودکارِ %s کامل نشد", album.title, exc_info=True)
    return announced


async def _check_follows(application: Application) -> None:
    """
    حلقه‌ی پس‌زمینه: انتشارهای تازه‌ی هر هنرمندِ دنبال‌شده را پیدا و خودکار
    تحویل می‌دهد. چند کاربر ممکن است یک هنرمند را دنبال کنند — صفحه‌ی هنرمند
    فقط یک‌بار به‌ازای هر هنرمند گرفته می‌شود، نه هر ردیف.
    """
    api = _api_from_app(application)
    try:
        follows = await api.follows()
    except Exception:
        log.warning("گرفتنِ لیستِ دنبال‌شده‌ها از سرور نشد", exc_info=True)
        return
    if not follows:
        return

    cache: dict[str, ArtistDetail | None] = {}
    for f in follows:
        if f.artistSourceUrl not in cache:
            try:
                cache[f.artistSourceUrl] = await api.artist(f.artistSourceUrl)
            except Exception:
                cache[f.artistSourceUrl] = None

        detail = cache[f.artistSourceUrl]
        if detail is None or not detail.albums:
            continue

        latest = detail.albums[0]
        if f.lastReleaseId is None:
            # اولین چک: فقط پرکردنِ وضعیت، بدونِ ارسالِ تاریخچه‌ی قدیمی
            await api.mark_follow_seen(f.id, latest.id, latest.title)
            continue
        if latest.id == f.lastReleaseId:
            continue

        # قدیمی‌ترِ تازه‌ها اول، تا ترتیبِ پیام‌ها ترتیبِ واقعیِ انتشار باشد
        for album in reversed(new_releases(f.lastReleaseId, detail.albums)):
            delivered = await _auto_send_release(application, api, f, album)
            if delivered:
                await api.mark_follow_seen(f.id, album.id, album.title)
            else:
                # خبری به چت نرسید؛ ادامه دادن فقط شکستِ بعدی را هم می‌بلعد —
                # در چکِ بعدی از همین‌جا دوباره
                break


async def _migrate_follows(application: Application) -> None:
    """
    یک‌بار در بالا آمدن: ردیف‌های bot.dbِ نسخه‌های قدیمی به دیتابیسِ سرور
    منتقل می‌شوند تا وب هم همان‌ها را ببیند.

    اگر سرور پایین باشد یا ردیفی نرسد، پاک‌کردن انجام نمی‌شود — مهاجرت
    idempotent است (کلیکِ دوباره روی ردیفِ موجود خطا نیست) و در بالا آمدنِ
    بعدی از اول امتحان می‌شود.
    """
    legacy = await asyncio.to_thread(store.all_follows)
    if not legacy:
        return

    api = _api_from_app(application)
    moved = 0
    for f in legacy:
        try:
            await api.add_follow(
                f.chat_id,
                FollowRequest(
                    artistId=f.artist_id,
                    artistName=f.artist_name,
                    artistSourceUrl=f.artist_source_url,
                    source=f.source,
                    artworkUrl=f.artwork_url,
                    lastReleaseId=f.last_release_id,
                    lastReleaseTitle=f.last_release_title,
                ),
            )
            moved += 1
        except Exception:
            log.warning("مهاجرتِ دنبال‌کردنِ %s نشد", f.artist_name, exc_info=True)

    if moved == len(legacy):
        await asyncio.to_thread(store.clear_all)
        log.info("%d دنبال‌کردن قدیمی به سرور منتقل شد.", moved)


async def _follow_poll_loop(application: Application) -> None:
    """
    JobQueue داخلیِ PTB نیامده (وابسته به APScheduler است، در requirements
    نیست)؛ همان الگوی `jobs.sweep_loop` سمت سرور — یک تسکِ ساده که در
    `post_init` بالا می‌آید.
    """
    while True:
        try:
            await asyncio.sleep(FOLLOW_POLL_INTERVAL)
            await _check_follows(application)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.warning("چک‌کردنِ دنبال‌شده‌ها ناموفق بود", exc_info=True)


async def _post_init(application: Application) -> None:
    """منوی «/» کنار جعبه‌ی پیام — تلگرام همین‌جا نگهش می‌دارد، نه سمت ما."""
    await application.bot.set_my_commands(
        [
            BotCommand("start", "شروع و راهنمای سریع"),
            BotCommand("help", "راهنما"),
            BotCommand("library", "دیدن/گرفتن دوباره‌ی دانلودهای قبلی"),
            BotCommand("quality", "تغییر کیفیت پیش‌فرض"),
            BotCommand("follow", "دنبال‌کردنِ هنرمند؛ انتشارِ تازه خودکار می‌رسد"),
            BotCommand("unfollow", "دیگر دنبال نکردنِ یک هنرمند"),
            BotCommand("following", "لیستِ هنرمندهای دنبال‌شده"),
            BotCommand("link", "وصل‌کردنِ این چت به نسخه‌ی وب"),
        ]
    )
    # نامِ کاربری برای لینکِ عمیقی که وب نشان می‌دهد (t.me/<bot>?start=link_…)
    application.bot_data["username"] = (await application.bot.get_me()).username
    # ردیف‌های bot.dbِ قدیمی پیش از اولین چک به سرور می‌روند، وگرنه دنبال‌شده‌های
    # کاربر از نسخه‌ی قبل یک‌بار «تازه» حساب می‌شدند و اسپم می‌شد
    await _migrate_follows(application)
    application.bot_data["follow_task"] = asyncio.create_task(_follow_poll_loop(application))
    application.bot_data["outbox_task"] = asyncio.create_task(_outbox_loop(application))


async def _shutdown(application: Application) -> None:
    for key in ("follow_task", "outbox_task"):
        task: asyncio.Task | None = application.bot_data.get(key)
        if task is not None:
            task.cancel()
    await _api_from_app(application).aclose()
    await asyncio.to_thread(store.close)


def _api_from_app(application: Application) -> ApiClient:
    return application.bot_data["api"]


def main() -> None:
    if not TELEGRAM_BOT_TOKEN:
        log.info("UNSTREAM_TELEGRAM_BOT_TOKEN ست نشده — بات غیرفعال می‌ماند.")
        sys.exit(0)

    # پایتون ۳.۱۴ دیگر لوپ را خودکار نمی‌سازد (asyncio.get_event_loop بدون
    # لوپِ جاری خطا می‌دهد)، و run_polling داخلی PTB 21.x هنوز به همان متکی
    # است — قبل از صدا زدنش خودمان یکی می‌سازیم و جاری‌اش می‌کنیم.
    asyncio.set_event_loop(asyncio.new_event_loop())

    # پیش‌فرضِ PTB (۵ ثانیه‌ی خواندن/نوشتن) برای آپلود فایل صوتی چند-مگابایتی
    # کوتاه است — send_audio/send_photo با شبکه‌ی معمولی همین‌جا TimedOut
    # می‌گرفت با اینکه خودِ فایل رسیده بود. media_write_timeout مخصوص
    # آپلودهاست؛ read_timeout هم باید بالا برود چون تلگرام بعد از آپلود قبل
    # از پاسخ دادن پردازش می‌کند. سقفِ واقعیِ آپلود اما اینجا نیست: خودِ
    # `_upload_audio` مهلتِ بازتری (UPLOAD_TIMEOUT) به فراخوانیِ خودش می‌دهد،
    # تا یک send_messageِ گیرکرده به‌خاطرِ آن پنج دقیقه معطل نماند.
    #
    # پروکسی روی *هر دو* کلاینت لازم است: PTB برای getUpdates کلاینتِ جدا
    # می‌سازد، و اگر فقط این یکی پروکسی داشته باشد بات اصلاً آپدیت نمی‌گیرد.
    request = HTTPXRequest(
        connection_pool_size=8,
        connect_timeout=15.0,
        read_timeout=60.0,
        write_timeout=60.0,
        media_write_timeout=120.0,
        proxy=TELEGRAM_PROXY,
    )
    updates_request = HTTPXRequest(
        connection_pool_size=1,
        connect_timeout=15.0,
        read_timeout=60.0,
        write_timeout=30.0,
        proxy=TELEGRAM_PROXY,
    )
    if TELEGRAM_PROXY:
        log.info("تلگرام از پروکسی می‌رود.")

    app = (
        Application.builder()
        .token(TELEGRAM_BOT_TOKEN)
        .request(request)
        .get_updates_request(updates_request)
        .post_init(_post_init)
        .post_shutdown(_shutdown)
        .build()
    )
    app.bot_data["api"] = ApiClient()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("help", help_cmd))
    app.add_handler(CommandHandler("quality", quality_cmd))
    app.add_handler(CommandHandler("library", library_cmd))
    app.add_handler(CommandHandler("follow", follow_cmd))
    app.add_handler(CommandHandler("unfollow", unfollow_cmd))
    app.add_handler(CommandHandler("following", following_cmd))
    app.add_handler(CommandHandler("link", link_cmd))
    app.add_handler(CallbackQueryHandler(on_pick, pattern=r"^pick:\d+$"))
    app.add_handler(CallbackQueryHandler(on_download_all, pattern=r"^all$"))
    app.add_handler(CallbackQueryHandler(on_quality_pick, pattern=r"^q:"))
    app.add_handler(CallbackQueryHandler(on_library_pick, pattern=r"^lib:"))
    app.add_handler(CallbackQueryHandler(on_follow_pick, pattern=r"^followpick:\d+$"))
    app.add_handler(CallbackQueryHandler(on_unfollow_pick, pattern=r"^unfollow:"))
    app.add_handler(CallbackQueryHandler(on_mode_button, pattern=r"^mode:"))
    app.add_handler(CallbackQueryHandler(on_collection_pick, pattern=r"^cl:\d+$"))
    app.add_handler(CallbackQueryHandler(on_browse_artist_pick, pattern=r"^ba:\d+$"))
    app.add_handler(CallbackQueryHandler(on_artist_open, pattern=r"^au:"))
    app.add_handler(CallbackQueryHandler(on_artist_follow, pattern=r"^afollow:"))
    app.add_handler(CallbackQueryHandler(on_artist_section, pattern=r"^(att|aal|apl|ard|are):"))
    app.add_handler(CallbackQueryHandler(on_artist_track_pick, pattern=r"^tk:\d+$"))
    app.add_handler(CallbackQueryHandler(on_artist_album_pick, pattern=r"^ab:\d+$"))
    app.add_handler(CallbackQueryHandler(on_artist_playlist_pick, pattern=r"^pl:\d+$"))
    app.add_handler(InlineQueryHandler(on_inline_query))
    app.add_handler(ChosenInlineResultHandler(on_chosen_inline_result))
    app.add_handler(
        MessageHandler(
            filters.VOICE | filters.AUDIO | filters.VIDEO | filters.VIDEO_NOTE | filters.Document.ALL,
            on_media,
        )
    )
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))

    log.info("بات تلگرام بالا آمد.")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
