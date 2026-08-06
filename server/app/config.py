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

# جایی که فایل‌های دانلودشده نگه داشته می‌شوند
DOWNLOAD_DIR = Path(os.getenv("UNSTREAM_DOWNLOAD_DIR", BASE_DIR / "downloads"))
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

# چند دانلود همزمان — بیشتر از این هم به یوتیوب فشار می‌آورد هم throttle می‌خوریم
MAX_CONCURRENT_DOWNLOADS = int(os.getenv("UNSTREAM_CONCURRENCY", "3"))

# کارهای تمام‌شده بعد از این مدت از حافظه پاک می‌شوند (ثانیه)
JOB_TTL_SECONDS = int(os.getenv("UNSTREAM_JOB_TTL", "3600"))

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

# یوتیوب علاوه بر کوکی، PO Token هم می‌خواهد. سرورش در vendor/ بیلد می‌شود
# (نگاه کن به server/README یا setup_potoken.sh).
_default_pot = BASE_DIR / "vendor" / "bgutil-ytdlp-pot-provider" / "server"
POT_SERVER_HOME = os.getenv("UNSTREAM_POT_SERVER_HOME") or (
    str(_default_pot) if (_default_pot / "build" / "generate_once.js").exists() else None
)

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

ITUNES_API = "https://itunes.apple.com"
DEEZER_API = "https://api.deezer.com"

# APIهای بالادست گاهی بیست ثانیه هم طول می‌کشند؛ تایم‌اوت تنگ باعث خطای بی‌مورد می‌شود
HTTP_TIMEOUT = 30.0
SEARCH_LIMIT = 20
