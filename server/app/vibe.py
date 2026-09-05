"""
چت‌بات پیشنهاد پلی‌لیست بر اساس حال‌وهوا («وایب»).

مسیر تشخیص: اول Claude (اگر UNSTREAM_ANTHROPIC_API_KEY تنظیم شده)، وگرنه نگاشتِ
کلیدواژه‌ایِ فارسیِ زیر. هر دو مسیر یک شکل خروجی می‌دهند: یک وایبِ شناخته‌شده، یک
پاسخِ همدلانه‌ی فارسی، و چند پیشنهادِ (عنوان، هنرمند).

بعد از تشخیصِ وایب، build_playlist اول سراغِ پلی‌لیست‌های واقعیِ خودِ پلتفرم‌ها
می‌رود (دیزر/اسپاتیفای — همان چیزی که کاربر روی خودِ آن پلتفرم پیدا می‌کرد)، نه
ساختنِ یک لیستِ تک‌ترکی. فقط وقتی هیچ پلی‌لیستِ مناسبی پیدا نشد (پلتفرم قطع،
جستجوی خالی) به روشِ قدیمی برمی‌گردد: هر (عنوان، هنرمند) را در catalog.search
جستجو می‌کند — همان الگویی که رادیوی خودکار در فرانت (lib/radio.ts) استفاده
می‌کند. هیچ‌کدام از حس‌وحالِ عددیِ valence/energy استفاده نمی‌کنند چون آن دو فقط
برای ترک‌های از قبل دانلودشده موجودند (mood.py).

هر مسیر بی‌صدا شکست می‌خورد: بدون کلید، خطای شبکه/JSON، یا پلتفرمِ قطع، همیشه
یک پله پایین‌تر می‌افتد و هیچ‌وقت استثنا پرت نمی‌کند — چت نباید با یک قطعیِ گذرا
از کار بیفتد.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
from dataclasses import dataclass

import httpx

from . import catalog
from .config import ANTHROPIC_API_KEY, ANTHROPIC_MODEL
from .models import AlbumDetail, Playlist, SearchResults, Track, VibeRequest, VibeSuggestion
from .providers import deezer, spotify

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
# LLM محلیِ تشخیصِ حال‌وهوا؛ کوتاه‌تر از HTTP_TIMEOUT عمومی چون این یک فراخوانیِ
# تکی است، نه یک زنجیره‌ی provider که ذاتاً کند است
ANTHROPIC_TIMEOUT = 20.0

# سقفِ نهاییِ پلی‌لیست — بیشتر از این فقط صف را طولانی می‌کند بدون فایده
MAX_TRACKS = 10

# از استخرِ کنسرویِ هر وایب، هر بار همین تعداد به‌طور تصادفی انتخاب می‌شود —
# بدونش کلیک‌های پیاپیِ روی یک چیپ همیشه همان پلی‌لیست را می‌دادند
PICKS_PER_SUGGESTION = 10


@dataclass(frozen=True)
class VibeDef:
    label: str
    keywords: tuple[str, ...]
    reply: str
    picks: tuple[tuple[str, str], ...]


# شش وایبِ آماده — هم چیپ‌های فرانت روی همین کلیدها می‌زنند، هم LLM موظف است
# یکی از همین‌ها را برگرداند، هم کلیدواژه‌ها همین‌جا زندگی می‌کنند
VIBES: dict[str, VibeDef] = {
    "sad": VibeDef(
        label="😢 غمگین",
        keywords=("ناراحت", "غمگین", "غم", "حالم بده", "دلتنگ", "گریه", "افسرده", "بغض", "دپرس"),
        reply="می‌دونم حس بدی داری. این چندتا رو گذاشتم برات — بذار کنارت باشن.",
        picks=(
            ("گریه نکن", "شادمهر عقیلی"),
            ("بی قرار", "محسن یگانه"),
            ("بزن بارون", "فریدون فروغی"),
            ("چتر", "معین"),
            ("جمعه", "فرهاد مهراد"),
            ("مرد تنها", "فرهاد مهراد"),
            ("خداحافظ", "معین"),
            ("Someone Like You", "Adele"),
            ("Fix You", "Coldplay"),
            ("Say Something", "A Great Big World"),
            ("Skinny Love", "Bon Iver"),
            ("Hurt", "Johnny Cash"),
            ("Everybody Hurts", "R.E.M."),
            ("The Sound of Silence", "Simon & Garfunkel"),
            ("Yesterday", "The Beatles"),
        ),
    ),
    "happy": VibeDef(
        label="😊 شاد",
        keywords=("شاد", "خوشحال", "خوبم", "هیجان زده", "سرحال", "شادی"),
        reply="عالیه! بزن بریم با یه پلی‌لیست شاد.",
        picks=(
            ("شاد باش", "بنیامین بهادری"),
            ("بزن برقص", "شادمهر عقیلی"),
            ("قند عسل", "ماکان بند"),
            ("دیوونه", "بنیامین بهادری"),
            ("Happy", "Pharrell Williams"),
            ("Can't Stop the Feeling", "Justin Timberlake"),
            ("Good as Hell", "Lizzo"),
            ("Walking on Sunshine", "Katrina and the Waves"),
            ("I Gotta Feeling", "The Black Eyed Peas"),
            ("Dancing Queen", "ABBA"),
            ("Best Day of My Life", "American Authors"),
            ("Three Little Birds", "Bob Marley"),
            ("September", "Earth, Wind & Fire"),
            ("I Wanna Dance with Somebody", "Whitney Houston"),
        ),
    ),
    "energetic": VibeDef(
        label="🔥 پرانرژی",
        keywords=("پرانرژی", "انرژی", "ورزش", "باشگاه", "هیجان", "تمرین"),
        reply="بریم رو دور تند! این‌ها انرژیت رو می‌برن بالا.",
        picks=(
            ("Eye of the Tiger", "Survivor"),
            ("Uptown Funk", "Mark Ronson"),
            ("Don't Stop Me Now", "Queen"),
            ("Blinding Lights", "The Weeknd"),
            ("بزن برقص", "شادمهر عقیلی"),
            ("قند عسل", "ماکان بند"),
            ("دیوونه", "بنیامین بهادری"),
            ("جیگر", "احسان خواجه امیری"),
            ("Thunderstruck", "AC/DC"),
            ("Stronger", "Kanye West"),
            ("Levitating", "Dua Lipa"),
            ("Physical", "Dua Lipa"),
            ("Titanium", "David Guetta"),
        ),
    ),
    "calm": VibeDef(
        label="😌 آرام",
        keywords=("آروم", "آرامش", "ریلکس", "استرس", "خسته", "خواب", "سکوت"),
        reply="باشه، بریم رو یه ریتم آروم. نفس عمیق بکش.",
        picks=(
            ("Weightless", "Marconi Union"),
            ("River Flows in You", "Yiruma"),
            ("Holocene", "Bon Iver"),
            ("Clair de Lune", "Claude Debussy"),
            ("آروم جانم", "محسن چاوشی"),
            ("نفس", "همایون شجریان"),
            ("پرستو", "علیرضا قربانی"),
            ("باران", "کیهان کلهر"),
            ("Gymnopédie No. 1", "Erik Satie"),
            ("Watermark", "Enya"),
            ("The Night We Met", "Lord Huron"),
            ("Breathe Me", "Sia"),
        ),
    ),
    "romantic": VibeDef(
        label="❤️ عاشقانه",
        keywords=("عاشق", "عشق", "دلبر", "دلتنگتم", "دوستت دارم", "عاشقانه"),
        reply="چه حس قشنگی. این‌ها رو برای همین حال‌وهوا گذاشتم.",
        picks=(
            ("Perfect", "Ed Sheeran"),
            ("All of Me", "John Legend"),
            ("Thinking Out Loud", "Ed Sheeran"),
            ("At Last", "Etta James"),
            ("عاشقتم", "بنیامین بهادری"),
            ("تو خودتی", "احسان خواجه امیری"),
            ("دلبر", "همایون شجریان"),
            ("بی تو", "شادمهر عقیلی"),
            ("Can't Help Falling in Love", "Elvis Presley"),
            ("La Vie en Rose", "Edith Piaf"),
            ("Just the Way You Are", "Bruno Mars"),
            ("A Thousand Years", "Christina Perri"),
        ),
    ),
    "angry": VibeDef(
        label="😤 عصبانی",
        keywords=("عصبانی", "عصبانیت", "خشمگین", "کفری", "خشم"),
        reply="بریزش بیرون. این‌ها همون شدتی رو دارن که الان لازم داری.",
        picks=(
            ("Break Stuff", "Limp Bizkit"),
            ("Killing In the Name", "Rage Against the Machine"),
            ("Bulls on Parade", "Rage Against the Machine"),
            ("Smells Like Teen Spirit", "Nirvana"),
            ("Chop Suey!", "System of a Down"),
            ("Numb", "Linkin Park"),
            ("In the End", "Linkin Park"),
            ("Duality", "Slipknot"),
            ("Bodies", "Drowning Pool"),
            ("Given Up", "Linkin Park"),
            ("Freak on a Leash", "Korn"),
            ("Du Hast", "Rammstein"),
        ),
    ),
    "nostalgic": VibeDef(
        label="📼 نوستالژیک",
        keywords=("نوستالژی", "خاطره", "خاطرات", "یاد قدیما", "دلم برای قدیم تنگ شده", "دلتنگ گذشته"),
        reply="بریم سراغ خاطره‌ها. این‌ها می‌برنت به قدیما.",
        picks=(
            ("جمعه", "فرهاد مهراد"),
            ("مرد تنها", "فرهاد مهراد"),
            ("بی تو", "شادمهر عقیلی"),
            ("دلبر", "همایون شجریان"),
            ("In My Life", "The Beatles"),
            ("The Way We Were", "Barbra Streisand"),
            ("Photograph", "Ed Sheeran"),
            ("Summer of '69", "Bryan Adams"),
            ("Vincent", "Don McLean"),
            ("Landslide", "Fleetwood Mac"),
            ("Yesterday Once More", "Carpenters"),
        ),
    ),
    "focus": VibeDef(
        label="🎯 تمرکز",
        keywords=("تمرکز", "مطالعه", "درس خوندن", "کار دارم", "پروژه", "کنکور", "امتحان"),
        reply="باشه، یه پس‌زمینه‌ی بی‌کلام می‌ذارم که حواس‌پرتت نکنه.",
        picks=(
            ("River Flows in You", "Yiruma"),
            ("Clair de Lune", "Claude Debussy"),
            ("Gymnopédie No. 1", "Erik Satie"),
            ("Weightless", "Marconi Union"),
            ("Nuvole Bianche", "Ludovico Einaudi"),
            ("Divenire", "Ludovico Einaudi"),
            ("Comptine d'un autre été", "Yann Tiersen"),
            ("Spiegel im Spiegel", "Arvo Pärt"),
            ("باران", "کیهان کلهر"),
            ("نفس", "همایون شجریان"),
        ),
    ),
    "heartbreak": VibeDef(
        label="💔 دلشکسته",
        keywords=("دلشکسته", "شکست عشقی", "جدا شدیم", "ترکم کرد", "دلم شکست", "بهم زدیم"),
        reply="سخته... این آهنگ‌ها دقیقاً همون حسو دارن.",
        picks=(
            ("Someone Like You", "Adele"),
            ("When We Were Young", "Adele"),
            ("All Too Well", "Taylor Swift"),
            ("Back to December", "Taylor Swift"),
            ("Someone You Loved", "Lewis Capaldi"),
            ("Jar of Hearts", "Christina Perri"),
            ("Nothing Compares 2 U", "Sinéad O'Connor"),
            ("Skinny Love", "Bon Iver"),
            ("Say Something", "A Great Big World"),
            ("بی تو", "شادمهر عقیلی"),
            ("خداحافظ", "معین"),
        ),
    ),
}

# وقتی نه چیپی زده شده نه کلیدواژه‌ای تشخیص داده شد — چت هیچ‌وقت نباید دست‌خالی بماند
DISCOVER = VibeDef(
    label="🎵 پیشنهادی",
    keywords=(),
    reply="دقیق نفهمیدم چه حالی داری، ولی این‌ها رو این روزها خیلی‌ها گوش می‌دن.",
    picks=(
        ("Blinding Lights", "The Weeknd"),
        ("بی تو", "شادمهر عقیلی"),
        ("Perfect", "Ed Sheeran"),
        ("قند عسل", "ماکان بند"),
        ("Someone Like You", "Adele"),
        ("Happy", "Pharrell Williams"),
        ("Levitating", "Dua Lipa"),
        ("جمعه", "فرهاد مهراد"),
        ("Uptown Funk", "Mark Ronson"),
        ("Dancing Queen", "ABBA"),
    ),
)


# عبارت‌های جستجوی پلی‌لیست به‌ازای هر وایب — یک انگلیسی (پوششِ بهتر روی هر دو
# پلتفرم) و یک فارسی. کلیدها همان کلیدهای VIBES‌اند به‌علاوه‌ی "discover".
PLAYLIST_QUERIES: dict[str, tuple[str, str]] = {
    "sad": ("sad songs", "غمگین"),
    "happy": ("feel good hits", "شاد"),
    "energetic": ("workout motivation", "پرانرژی"),
    "calm": ("chill relax", "آرام"),
    "romantic": ("love songs", "عاشقانه"),
    "angry": ("rage metal", "خشمگین"),
    "nostalgic": ("throwback hits", "نوستالژی"),
    "focus": ("focus instrumental", "تمرکز و مطالعه"),
    "heartbreak": ("breakup songs", "دلشکسته"),
    "discover": ("today's top hits", "پلی لیست محبوب"),
}

# هر بار این تعداد پلی‌لیستِ واقعی قاطی می‌شود — هم تنوعِ پلتفرم هم طولِ پلی‌لیست
PLAYLIST_COUNT = 3
# از هر پلی‌لیستِ انتخاب‌شده همین تعداد ترکِ تصادفی برداشته می‌شود؛ کل پلی‌لیستِ
# صدتایی را نمی‌گیریم — فقط یک نمونه‌ی نماینده
TRACKS_PER_PLAYLIST = 6
# پلی‌لیستِ خیلی‌کوتاه معمولاً خالی یا بی‌ربط است (مثلاً پلی‌لیستِ شخصیِ یک‌ترکه)
MIN_PLAYLIST_TRACKS = 3


@dataclass
class VibeResult:
    vibe: str
    label: str
    reply: str
    picks: list[tuple[str, str]]


def _sample_picks(pool: tuple[tuple[str, str], ...]) -> list[tuple[str, str]]:
    """
    زیرمجموعه‌ی تصادفی از استخرِ یک وایب — همان چیپ که دوباره زده شود، پلی‌لیستِ
    یکسان ندهد. استخر کوچک‌تر از سهمیه بود یعنی همه‌اش برمی‌گردد.
    """
    if len(pool) <= PICKS_PER_SUGGESTION:
        return list(pool)
    return random.sample(pool, PICKS_PER_SUGGESTION)


def detect_from_keywords(text: str) -> str | None:
    """اولین وایبی که یکی از کلیدواژه‌هایش زیرمجموعه‌ی متن است، یا None."""
    normalized = text.strip()
    if not normalized:
        return None
    for key, definition in VIBES.items():
        if any(kw in normalized for kw in definition.keywords):
            return key
    return None


# --------- قیدهای صریح: «قدیمی»، «ایرانی/فارسی» ---------
#
# وایب («غمگین») یک محورِ حس‌وحال است. درخواست‌های واقعی گاهی یک محورِ دومِ
# مستقل هم دارند — دوره یا زبان («یک پلی‌لیست غمگین از آهنگ‌های قدیمی
# ایرانی»). detect_from_keywords/Claude فقط محورِ اول را می‌فهمند؛ این بخش
# محورِ دوم را از همان متن جدا می‌خواند تا هم استخرِ کنسروی هم جستجوی
# پلی‌لیستِ واقعی بر اساسش محدود شوند.

OLD_KEYWORDS = ("قدیمی", "قدیم", "کلاسیک", "دهه شصت", "دهه هفتاد")
PERSIAN_KEYWORDS = ("ایرانی", "فارسی", "پرشین")

# هنرمندانِ کلاسیکِ پاپِ فارسی — پیش از دورانِ پاپِ مدرنِ داخلی/تهرانجلسی.
# لیست عمداً کوتاه است: فقط اسم‌هایی که مطمئنیم واقعاً «قدیمی»‌اند، چون
# لیستِ کوتاهِ درست بهتر از لیستِ بلندِ نامطمئن است.
OLD_PERSIAN_ARTISTS = frozenset(
    {
        "فرهاد مهراد",
        "معین",
        "داریوش",
        "گوگوش",
        "ابی",
        "ویگن",
        "عارف",
        "حبیب",
        "فریدون فروغی",
        "کورش یغمایی",
        "هایده",
        "مهستی",
    }
)

_PERSIAN_SCRIPT = re.compile(r"[؀-ۿ]")


@dataclass(frozen=True)
class Qualifiers:
    old: bool = False
    persian_only: bool = False


def detect_qualifiers(text: str) -> Qualifiers:
    """قیدهای دوره/زبان را از متنِ کاربر می‌خواند — مستقل از تشخیصِ خودِ وایب."""
    normalized = text.strip()
    return Qualifiers(
        old=any(kw in normalized for kw in OLD_KEYWORDS),
        persian_only=any(kw in normalized for kw in PERSIAN_KEYWORDS),
    )


def _is_persian(artist: str) -> bool:
    return bool(_PERSIAN_SCRIPT.search(artist))


def _filter_picks(picks: list[tuple[str, str]], qualifiers: Qualifiers) -> list[tuple[str, str]]:
    """
    پیشنهادها را طبق قیدهای صریحِ کاربر محدود می‌کند. هر لایه فقط وقتی اعمال
    می‌شود که نتیجه‌ی غیرخالی بدهد — قیدِ سخت‌گیرانه‌تر نباید چت را دست‌خالی
    بگذارد، فقط باید تا جای ممکن دقیق‌تر کند.
    """
    if qualifiers.old:
        old = [p for p in picks if p[1] in OLD_PERSIAN_ARTISTS]
        if old:
            return old
    if qualifiers.persian_only:
        persian = [p for p in picks if _is_persian(p[1])]
        if persian:
            return persian
    return picks


def _describe_qualifiers(qualifiers: Qualifiers) -> str:
    if qualifiers.old and qualifiers.persian_only:
        return " از قدیمی‌های ایرونی برات گذاشتم."
    if qualifiers.old:
        return " از قدیمی‌ترها برات گذاشتم."
    if qualifiers.persian_only:
        return " همه‌شون ایرونی‌ان."
    return ""


def _parse_llm_json(raw: str) -> VibeResult | None:
    """
    پاسخِ Claude را به VibeResult تبدیل می‌کند؛ هر انحرافی از قرارداد (وایبِ
    ناشناس، picks خالی، آیتمِ بدشکل) کل پاسخ را رد می‌کند — نیمه‌معتبر بی‌فایده
    است، مسیر کلیدواژه‌ای جایگزینِ کاملی دارد.
    """
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None

    vibe = data.get("vibe")
    reply = data.get("reply")
    picks = data.get("picks")
    if vibe not in VIBES or not isinstance(reply, str) or not reply.strip():
        return None
    if not isinstance(picks, list) or not picks:
        return None

    cleaned: list[tuple[str, str]] = [
        (pick[0].strip(), pick[1].strip())
        for pick in picks
        if isinstance(pick, list)
        and len(pick) == 2
        and all(isinstance(p, str) and p.strip() for p in pick)
    ]
    if not cleaned:
        return None

    return VibeResult(vibe=vibe, label=VIBES[vibe].label, reply=reply.strip(), picks=cleaned)


async def _call_llm(client: httpx.AsyncClient, text: str) -> VibeResult | None:
    """
    تشخیصِ حال‌وهوا با Claude — بی‌صدا None برمی‌گرداند اگر کلید نباشد، شبکه
    بیفتد، یا پاسخ معتبر نباشد. suggest() در آن صورت به کلیدواژه می‌افتد.
    """
    if not ANTHROPIC_API_KEY:
        return None

    known = ", ".join(VIBES.keys())
    system = (
        "You read a short mood message in Persian or English and respond with "
        "STRICT JSON only — no prose, no markdown fences. Shape: "
        '{"vibe": one of [' + known + "], "
        '"reply": a short warm Persian reply (1-2 sentences, matches the mood), '
        '"picks": [[title, artist], ...]}. '
        "picks must be 8-10 REAL, well-known songs that genuinely fit the mood — "
        "never invent a song. Default to a mix of Persian and international "
        "songs, but the message may also state an explicit constraint beyond "
        "the mood — a language/origin (e.g. only Iranian/Persian songs), an "
        "era (e.g. old/classic vs. new), a decade, a genre, or a specific "
        "artist. When it does, every single pick MUST strictly satisfy that "
        "constraint instead of the default mix: a request for 'a sad playlist "
        "of old Iranian songs' must return ONLY real, well-known CLASSIC "
        "Persian songs (e.g. Farhad Mehrad, Dariush, Googoosh, Ebi, Vigen, "
        "Hayedeh) — no international songs and no modern Persian pop."
    )

    try:
        res = await client.post(
            ANTHROPIC_API_URL,
            json={
                "model": ANTHROPIC_MODEL,
                "max_tokens": 1024,
                "system": system,
                "messages": [{"role": "user", "content": text}],
            },
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            timeout=ANTHROPIC_TIMEOUT,
        )
        res.raise_for_status()
        blocks = res.json().get("content", [])
        raw = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        return _parse_llm_json(raw)
    except Exception:
        return None


async def suggest(client: httpx.AsyncClient, req: VibeRequest) -> VibeResult:
    """تصمیمِ نهایی: چیپِ صریح > Claude > کلیدواژه > پیش‌فرضِ عمومی."""
    if req.vibe and req.vibe in VIBES:
        definition = VIBES[req.vibe]
        return VibeResult(
            vibe=req.vibe, label=definition.label, reply=definition.reply, picks=_sample_picks(definition.picks)
        )

    message = (req.message or "").strip()
    if message:
        if llm_result := await _call_llm(client, message):
            return llm_result

        if key := detect_from_keywords(message):
            definition = VIBES[key]
            return VibeResult(
                vibe=key,
                label=definition.label,
                reply=definition.reply,
                picks=_sample_picks(definition.picks),
            )

    return VibeResult(
        vibe="discover", label=DISCOVER.label, reply=DISCOVER.reply, picks=_sample_picks(DISCOVER.picks)
    )


def _dedupe_key(track: Track) -> tuple[str, str]:
    return (track.title.strip().lower(), track.artist.strip().lower())


async def resolve_tracks(
    client: httpx.AsyncClient, picks: list[tuple[str, str]], exclude: set[str] = frozenset()
) -> list[Track]:
    """
    هر (عنوان، هنرمند) را در کاتالوگ جستجو می‌کند و اولین نتیجه را برمی‌دارد.
    شکستِ یک جستجو (provider افتاده، چیزی پیدا نشد) بقیه را خراب نمی‌کند —
    فقط همان یکی از پلی‌لیست جا می‌ماند.

    `exclude` شناسه‌ی ترک‌هایی است که فرانت قبلاً در همین گفتگو نشان داده —
    تضمینِ سخت‌افزاریِ «بدون تکرار» فقط اینجاست: چه پیشنهاد از استخرِ تصادفی
    بیاید چه از Claude، اگر به همان ترکِ قبلی برسد همین‌جا حذف می‌شود.
    """
    results = await asyncio.gather(
        *(catalog.search(client, f"{title} {artist}") for title, artist in picks),
        return_exceptions=True,
    )

    seen: set[tuple[str, str]] = set()
    tracks: list[Track] = []
    for outcome in results:
        if not isinstance(outcome, SearchResults) or not outcome.tracks:
            continue
        track = outcome.tracks[0]
        if track.id in exclude:
            continue
        key = _dedupe_key(track)
        if key in seen:
            continue
        seen.add(key)
        tracks.append(track)
        if len(tracks) >= MAX_TRACKS:
            break

    return tracks


async def _search_playlists(
    client: httpx.AsyncClient, vibe_key: str, qualifiers: Qualifiers = Qualifiers()
) -> list[Playlist]:
    """
    پلی‌لیست‌های واقعیِ کاربرها/پلتفرم‌ها برای این وایب — چند عبارتِ جستجو، چند
    پلتفرم، موازی. شکستِ یکی بقیه را خراب نمی‌کند؛ اسپاتیفای بدون کلید همیشه
    خودش خالی برمی‌گرداند (spotify.search_playlists).

    وقتی کاربر صریحاً «قدیمی» خواسته، عبارتِ فارسی با همان کلمه تقویت می‌شود.
    وقتی صریحاً «ایرانی/فارسی» خواسته، عبارتِ انگلیسی اصلاً جستجو نمی‌شود —
    آن عبارت تقریباً همیشه پلی‌لیستِ بین‌المللی برمی‌گرداند، همان چیزی که
    کاربر گفته نمی‌خواهد.
    """
    en_query, fa_query = PLAYLIST_QUERIES.get(vibe_key, PLAYLIST_QUERIES["discover"])
    if qualifiers.old:
        fa_query = f"قدیمی {fa_query}"

    searches = [deezer.search_playlists(client, fa_query)]
    if not qualifiers.persian_only:
        searches += [
            deezer.search_playlists(client, en_query),
            spotify.search_playlists(client, en_query),
        ]

    results = await asyncio.gather(*searches, return_exceptions=True)

    playlists: list[Playlist] = []
    for outcome in results:
        if isinstance(outcome, list):
            playlists += outcome
    return playlists


def _pick_playlists(candidates: list[Playlist]) -> list[Playlist]:
    """
    از میانِ پلی‌لیست‌های پیداشده، حداکثر PLAYLIST_COUNT تا را با تناوب بینِ
    منبع‌ها انتخاب می‌کند — تا وقتی دیزر و اسپاتیفای هر دو جواب داده باشند، هر
    دو در پلی‌لیستِ نهایی نماینده داشته باشند، نه اینکه یکی همه‌جا را بگیرد.
    """
    unique: dict[str, Playlist] = {}
    for p in candidates:
        if p.trackCount >= MIN_PLAYLIST_TRACKS:
            unique.setdefault(p.id, p)

    by_source: dict[str, list[Playlist]] = {}
    for p in unique.values():
        by_source.setdefault(p.source, []).append(p)
    for group in by_source.values():
        random.shuffle(group)

    picked: list[Playlist] = []
    sources = list(by_source)
    while len(picked) < PLAYLIST_COUNT and sources:
        for source in list(sources):
            group = by_source[source]
            if not group:
                sources.remove(source)
                continue
            picked.append(group.pop())
            if len(picked) >= PLAYLIST_COUNT:
                break

    return picked


async def _tracks_from_playlists(
    client: httpx.AsyncClient, playlists: list[Playlist], exclude: set[str]
) -> list[Track]:
    """
    هر پلی‌لیستِ انتخاب‌شده را کامل می‌گیرد (catalog.resolve_ref، هم دیزر هم
    اسپاتیفای را می‌شناسد) و از هرکدام یک زیرمجموعه‌ی تصادفیِ کوچک برمی‌دارد —
    نه کلِ پلی‌لیست را، که می‌تواند صدها ترک باشد.
    """
    details = await asyncio.gather(
        *(catalog.resolve_ref(client, p.sourceUrl or p.id) for p in playlists),
        return_exceptions=True,
    )

    pool: list[Track] = []
    for detail in details:
        if not isinstance(detail, AlbumDetail) or not detail.tracks:
            continue
        candidates = [t for t in detail.tracks if t.id not in exclude]
        random.shuffle(candidates)
        pool += candidates[:TRACKS_PER_PLAYLIST]

    random.shuffle(pool)
    seen: set[tuple[str, str]] = set()
    tracks: list[Track] = []
    for track in pool:
        key = _dedupe_key(track)
        if key in seen:
            continue
        seen.add(key)
        tracks.append(track)
        if len(tracks) >= MAX_TRACKS:
            break

    return tracks


def _describe_playlists(playlists: list[Playlist]) -> str:
    names = "، ".join(f"«{p.title}»" for p in playlists if p.title)
    return f" این‌ها رو از پلی‌لیستِ {names} آوردم." if names else ""


async def build_playlist(client: httpx.AsyncClient, req: VibeRequest) -> VibeSuggestion:
    """
    نقطه‌ی ورودیِ کاملِ چت‌بات: تشخیصِ وایب، بعد تلاش برای پلی‌لیستِ واقعیِ
    پلتفرم‌ها، و فقط اگر چیزی پیدا نشد برگشت به لیستِ تک‌ترکیِ قدیمی — چت
    هیچ‌وقت دست‌خالی نمی‌ماند.

    قیدهای صریحِ متن («قدیمی»، «ایرانی/فارسی» — detect_qualifiers) هم روی
    جستجوی پلی‌لیستِ واقعی هم روی استخرِ کنسروی اعمال می‌شوند، تا درخواستِ
    ترکیبی («غمگینِ قدیمیِ ایرانی») واقعاً همان را برگرداند، نه فقط وایبِ کلی.
    """
    result = await suggest(client, req)
    qualifiers = detect_qualifiers(req.message or "")
    exclude = set(req.excludeIds)

    candidates = await _search_playlists(client, result.vibe, qualifiers)
    chosen = _pick_playlists(candidates)

    reply = result.reply + _describe_qualifiers(qualifiers)
    tracks: list[Track] = []
    if chosen:
        tracks = await _tracks_from_playlists(client, chosen, exclude)
        if tracks:
            reply += _describe_playlists(chosen)

    if not tracks:
        tracks = await resolve_tracks(client, _filter_picks(result.picks, qualifiers), exclude)

    return VibeSuggestion(vibe=result.vibe, label=result.label, reply=reply, tracks=tracks)
