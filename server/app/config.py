import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# server/.env اگر بود بارگذاری می‌شود تا کوکی و بقیه‌ی تنظیمات لازم نباشد
# هر بار دستی export شوند. متغیر محیطیِ واقعی همیشه اولویت دارد.
try:
    from dotenv import load_dotenv

    load_dotenv(BASE_DIR / ".env", override=False)
except ImportError:
    pass


def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off", "")


# جایی که فایل‌های دانلودشده نگه داشته می‌شوند
DOWNLOAD_DIR = Path(os.getenv("UNSTREAM_DOWNLOAD_DIR", BASE_DIR / "downloads"))
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# دیتابیس SQLite — صف و کتابخانه اینجا دوام می‌آورند
DATA_DIR = Path(os.getenv("UNSTREAM_DATA_DIR", BASE_DIR / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.getenv("UNSTREAM_DB", DATA_DIR / "unstream.db"))

# چند دانلود همزمان — بیشتر از این هم به یوتیوب فشار می‌آورد هم throttle می‌خوریم
MAX_CONCURRENT_DOWNLOADS = int(os.getenv("UNSTREAM_CONCURRENCY", "3"))

# کارهای شکست‌خورده/لغوشده بعد از این مدت پاک می‌شوند (ثانیه).
# کارهای موفق پاک نمی‌شوند — آنها همان کتابخانه‌اند.
JOB_TTL_SECONDS = int(os.getenv("UNSTREAM_JOB_TTL", "3600"))

# فایل‌های دانلودشده بعد از این مدت از دیسک حذف می‌شوند (ثانیه، پیش‌فرض ۷ روز).
# صفر یعنی هیچ‌وقت — دیسک را خودت مدیریت می‌کنی.
FILE_RETENTION_SECONDS = int(os.getenv("UNSTREAM_FILE_RETENTION", str(7 * 24 * 3600)))

# ffmpeg برای ترنسکد و امبد کاور لازم است
FFMPEG_LOCATION = os.getenv("UNSTREAM_FFMPEG") or (
    str(Path(p).parent) if (p := shutil.which("ffmpeg")) else None
)

# یوتیوب برای استخراج سمت سرور احراز هویت می‌خواهد («Sign in to confirm you're not a bot»).
# یکی از این دو را ست کن، وگرنه فقط ساندکلاد به‌عنوان منبع صوت باقی می‌ماند.
#   UNSTREAM_COOKIES_FILE=C:\path\to\cookies.txt        (فرمت Netscape)
#   UNSTREAM_COOKIES_BROWSER=firefox                     (یا chrome/edge/brave)
COOKIES_FILE = os.getenv("UNSTREAM_COOKIES_FILE") or None
COOKIES_BROWSER = os.getenv("UNSTREAM_COOKIES_BROWSER") or None

# یوتیوب علاوه بر کوکی، PO Token هم می‌خواهد. دو حالت دارد:
#   ۱. اسکریپتی — سرورش در vendor/ بیلد می‌شود (setup_potoken.sh). حالت پیش‌فرض روی ویندوز.
#   ۲. HTTP — سرورش جدا بالاست و فقط آدرسش را می‌دهیم. حالت داکر.
_default_pot = BASE_DIR / "vendor" / "bgutil-ytdlp-pot-provider" / "server"
POT_SERVER_HOME = os.getenv("UNSTREAM_POT_SERVER_HOME") or (
    str(_default_pot) if (_default_pot / "build" / "generate_once.js").exists() else None
)
POT_BASE_URL = os.getenv("UNSTREAM_POT_BASE_URL") or None

# یوتیوب چالش امضا را با جاوااسکریپت می‌دهد و yt-dlp برای حلش به یک JS runtime
# نیاز دارد. پیش‌فرض خودش فقط deno را می‌پذیرد، پس اگر نبود سراغ node می‌رویم.
JS_RUNTIME = os.getenv("UNSTREAM_JS_RUNTIME") or next(
    (r for r in ("deno", "bun", "node") if shutil.which(r)), None
)

# ترتیب منابعی که برای پیدا کردن فایل صوتی امتحان می‌شوند
AUDIO_SOURCES = tuple(
    s.strip()
    for s in os.getenv("UNSTREAM_AUDIO_SOURCES", "youtube,soundcloud").split(",")
    if s.strip()
)

# متن آهنگ از LRCLIB — عمومی، بدون کلید. کنار فایل .lrc می‌سازد و در تگ هم می‌نشیند.
LYRICS_ENABLED = _flag("UNSTREAM_LYRICS", True)
LRCLIB_API = os.getenv("UNSTREAM_LRCLIB_API", "https://lrclib.net")

# اسپاتیفای API عمومی ندارد. بدون این دو، لینک اسپاتیفای فقط از روی عنوانِ
# oEmbed حدس زده می‌شود؛ با آنها آلبوم و پلی‌لیست دقیق خوانده می‌شوند.
# https://developer.spotify.com/dashboard → Client ID / Client Secret
SPOTIFY_CLIENT_ID = os.getenv("UNSTREAM_SPOTIFY_CLIENT_ID") or None
SPOTIFY_CLIENT_SECRET = os.getenv("UNSTREAM_SPOTIFY_CLIENT_SECRET") or None

# تأیید صوتی با AcoustID: بعد از دانلود، فینگرپرینت فایل را با کاتالوگ چک می‌کند
# تا مطمئن شویم واقعاً همان ترک است. به `fpcalc` (chromaprint) و یک کلید رایگان
# نیاز دارد: https://acoustid.org/new-application
ACOUSTID_KEY = os.getenv("UNSTREAM_ACOUSTID_KEY") or None
FPCALC = os.getenv("UNSTREAM_FPCALC") or shutil.which("fpcalc")

ITUNES_API = "https://itunes.apple.com"
DEEZER_API = "https://api.deezer.com"
SPOTIFY_API = "https://api.spotify.com/v1"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"

# APIهای بالادست گاهی بیست ثانیه هم طول می‌کشند؛ تایم‌اوت تنگ باعث خطای بی‌مورد می‌شود
HTTP_TIMEOUT = 30.0
SEARCH_LIMIT = 20
