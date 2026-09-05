"""ترکیب provider ها: جستجوی همزمان و resolve کردن یک مرجع (id یا لینک) به آلبوم."""

from __future__ import annotations

import asyncio
import re
from itertools import zip_longest
from typing import TypeVar

import httpx

from .config import AUDIO_SOURCES
from .models import Album, AlbumDetail, Artist, ArtistDetail, Playlist, SearchResults, Track
from .providers import deezer, itunes, soundcloud, spotify, ytdlp

# شناسه‌های داخلی: provider:kind:id
ID = re.compile(r"^(itunes|deezer|sp|yt|sc):(track|album|playlist|artist|user):(.+)$")


_Row = TypeVar("_Row", Track, Album, Artist, Playlist)


def interleave(rows: list[_Row]) -> list[_Row]:
    """
    نوبتی از هر منبع می‌چیند: اولِ اپل، اولِ دیزر، اولِ اسپاتیفای، اولِ ساندکلاد،
    بعد دومی‌ها.

    قبلاً نتیجه‌ی هر provider پشت سرِ قبلی می‌نشست. بخش «همه» فقط پنج تای اول را
    نشان می‌دهد، پس هرچه منبع بیشتر می‌شد، منابعِ آخر بیشتر پشت اپل و اسپاتیفای
    گم می‌شدند — با چهار منبع، ساندکلاد عملاً هیچ‌وقت دیده نمی‌شد.

    ترتیبِ درونِ هر منبع دست‌نخورده می‌ماند؛ هر کاتالوگ خودش بر اساس ربط مرتب
    کرده و بهترین نتیجه‌ی هر کدام حالا در همان صفحه‌ی اول است.
    """
    buckets: dict[str, list[_Row]] = {}
    for row in rows:
        buckets.setdefault(row.source, []).append(row)
    return [row for turn in zip_longest(*buckets.values()) for row in turn if row is not None]


def _dedupe_tracks(tracks: list[Track]) -> list[Track]:
    """
    تکراری‌ها را فقط *درونِ* هر منبع حذف می‌کند، نه بینِ منابع.

    قبلاً کلید فقط (عنوان، هنرمند) بود و اپل اول می‌آمد، پس نسخه‌ی بقیه‌ی
    پلتفرم‌ها از همان ترک حذف می‌شد. نتیجه‌اش دقیقاً برعکسِ چیزی بود که به نظر
    می‌رسید: از ساندکلاد فقط ریمیکس و «slowed» می‌ماند — چون عنوانشان فرق دارد و
    برخورد نمی‌کنند — و خودِ ترکِ اصلی که با اپل هم‌نام بود می‌افتاد.

    حالا هر پلتفرم نسخه‌ی خودش را نشان می‌دهد و نشانِ منبع تفاوتشان را می‌گوید.
    یکتاسازی درونِ یک منبع سرِ جایش است: اپل همان ترک را هم از سینگل هم از آلبوم
    برمی‌گرداند و آن یکی واقعاً تکراری است.
    """
    seen: set[tuple[str, str, str]] = set()
    out: list[Track] = []
    for t in tracks:
        key = (t.source, t.title.strip().lower(), t.artist.strip().lower())
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
    return out


def _dedupe_artists(artists: list[Artist]) -> list[Artist]:
    """
    مثل `_dedupe_tracks`، فقط *درونِ* هر منبع یکتا می‌کند.

    قبلاً کلید فقط نام بود و نسخه‌ی عکس‌دار برنده می‌شد، پس از چهار پلتفرم یک
    کارت می‌ماند — جستجوی «Dorcci» فقط دیزر را نشان می‌داد و صفحه‌ی اسپاتیفای و
    ساندکلاد و اپلِ همان هنرمند اصلاً در دسترس نبود. حالا هر پلتفرم کارت خودش را
    دارد و کارت به صفحه‌ی همان پلتفرم می‌رود.

    یکتاسازی درونِ یک منبع سرِ جایش است (یک نام گاهی چند ردیف دارد) و در آن حالت
    ردیفِ عکس‌دار می‌ماند.
    """
    best: dict[tuple[str, str], Artist] = {}
    for a in artists:
        key = (a.source, a.name.strip().lower())
        current = best.get(key)
        if current is None or (not current.artworkUrl and a.artworkUrl):
            best[key] = a
    return list(best.values())


async def _soundcloud_search(query: str) -> SearchResults:
    """
    ساندکلاد با httpx همگام نوشته شده (چون از مسیر yt-dlp هم صدا زده می‌شود)،
    پس در thread می‌رود. ترک و آلبوم و هنرمند سه اندپوینت جدا هستند و پشت‌سرهم
    زدنشان زمان هر جستجو را سه برابر می‌کرد.
    """
    tracks, albums, users = await asyncio.gather(
        asyncio.to_thread(ytdlp.soundcloud_search, query),
        asyncio.to_thread(soundcloud.search_albums, query),
        asyncio.to_thread(soundcloud.search_users, query),
        return_exceptions=True,
    )
    # هنرمند در این شرط نمی‌آید: خالی بودنش فقط چند کارت را کم می‌کند، ولی بالا
    # رفتنِ خطایش می‌توانست جستجویی که ترک و آلبوم داشت را خراب کند
    if isinstance(tracks, BaseException) and isinstance(albums, BaseException):
        raise tracks  # هر دو افتاده‌اند؛ یکی باید بالا برود وگرنه بی‌صدا رد می‌شود
    return SearchResults(
        query=query,
        tracks=tracks if isinstance(tracks, list) else [],
        albums=albums if isinstance(albums, list) else [],
        artists=users if isinstance(users, list) else [],
    )


async def search(client: httpx.AsyncClient, query: str) -> SearchResults:
    """
    کاتالوگ‌ها را همزمان می‌زند. اگر یکی بیفتد، نتیجه‌ی بقیه همچنان برمی‌گردد.

    دو تای آخر شرطی‌اند: اسپاتیفای بدون کلید حتی توکن هم نمی‌گیرد و هر جستجو یک
    خطای بی‌فایده می‌شد، و ساندکلاد وقتی از AUDIO_SOURCES بیرون است یعنی کاربر
    نمی‌خواهد از آنجا صدا بیاید — پس نتیجه‌اش هم فقط شلوغی است.
    """
    optional = {
        "spotify": spotify.enabled(),
        # اندپوینتِ پلی‌لیستِ اسپاتیفای جدا از `spotify.search` است (همان دلیلِ
        # docstring خودش: ممکن است روی این کلید محدود باشد) — پس جدا و با
        # return_exceptions می‌آید تا اگر افتاد، بقیه‌ی جستجو را پایین نکشد؛
        # فقط بخشِ پلی‌لیست‌ها یک منبع کمتر می‌شود.
        "spotify_playlists": spotify.enabled(),
        "soundcloud": "soundcloud" in AUDIO_SOURCES,
    }
    apple, deez, *rest = await asyncio.gather(
        itunes.search(client, query),
        deezer.search(client, query),
        *([spotify.search(client, query)] if optional["spotify"] else []),
        *([spotify.search_playlists(client, query)] if optional["spotify_playlists"] else []),
        *([_soundcloud_search(query)] if optional["soundcloud"] else []),
        return_exceptions=True,
    )
    # `strict=True` عمدی است: ترتیبِ این دو باید دقیقاً یکی بماند و تنها چیزی
    # که تضمینش می‌کند همان ترتیبِ نوشتنِ `optional` و آرگومان‌های `gather` است.
    # اگر روزی یکی جابه‌جا شود، بدونِ این، نتیجه‌ی یک provider بی‌صدا به نامِ
    # دیگری می‌نشست — و «اسپاتیفای نتیجه نداد» ای می‌دیدیم که در واقع
    # ساندکلاد بود.
    extra = dict(zip((k for k, on in optional.items() if on), rest, strict=True))

    result = SearchResults(query=query)

    if isinstance(apple, SearchResults):
        result.tracks += apple.tracks
        result.albums += apple.albums
        result.artists += apple.artists
    if isinstance(deez, SearchResults):
        result.tracks += deez.tracks
        result.albums += deez.albums
        result.playlists += deez.playlists
        result.artists += deez.artists
    # این دو آخر می‌آیند تا در dedupe، نسخه‌ی اپل/دیزر برنده بماند: کاتالوگ‌های
    # رسمی متادیتای تمیز و پیش‌نمایش قابل‌پخش دارند و ساندکلاد عنوانِ آپلودکننده.
    if isinstance(spot := extra.get("spotify"), SearchResults):
        result.tracks += spot.tracks
        result.albums += spot.albums
        result.artists += spot.artists
    if isinstance(spot_playlists := extra.get("spotify_playlists"), list):
        result.playlists += spot_playlists
    if isinstance(cloud := extra.get("soundcloud"), SearchResults):
        result.tracks += cloud.tracks
        result.albums += cloud.albums
        result.artists += cloud.artists

    if not result.tracks and not result.albums and not result.playlists:
        # همه‌ی provider ها افتاده‌اند — این خطا باید به کاربر برسد، نه نتیجه‌ی خالی
        for outcome in (apple, deez, *rest):
            if isinstance(outcome, BaseException):
                raise outcome

    # اول یکتاسازی (که ترتیبِ اولویتِ بالا را لازم دارد)، بعد چیدنِ نوبتی
    result.tracks = interleave(_dedupe_tracks(result.tracks))
    result.artists = interleave(_dedupe_artists(result.artists))
    result.albums = interleave(result.albums)
    result.playlists = interleave(result.playlists)
    return result


async def _spotify_ref(client: httpx.AsyncClient, kind: str, ident: str) -> AlbumDetail | None:
    if kind == "album":
        return await spotify.album(client, ident)
    if kind == "playlist":
        return await spotify.playlist(client, ident)
    if kind == "track":
        return await spotify.track(client, ident)
    return None


async def _spotify_fallback(client: httpx.AsyncClient, ref: str) -> AlbumDetail | None:
    """
    بدون کلید API: عنوان را از oEmbed می‌گیریم و در اپل/دیزر می‌گردیم.

    فقط برای آلبوم و تک‌آهنگ کار می‌کند و همیشه هم درست نیست — پلی‌لیست از این
    راه اصلاً قابل بازسازی نیست. برای همین کلید اسپاتیفای ارزش ست کردن دارد.
    """
    title = await asyncio.to_thread(ytdlp.spotify_title, ref)
    if not title:
        return None
    results = await search(client, title)
    if results.albums:
        return await resolve_ref(client, results.albums[0].id)
    return None


async def resolve_ref(client: httpx.AsyncClient, ref: str) -> AlbumDetail | None:
    """
    ref می‌تواند شناسه‌ی داخلی (itunes:album:123) یا لینک هر کدام از سرویس‌ها باشد.
    خروجی همیشه AlbumDetail است — پلی‌لیست و تک‌آهنگ هم در همین قالب.
    """
    ref = ref.strip()

    if m := ID.match(ref):
        provider, kind, ident = m.groups()
        if provider == "itunes" and kind == "album":
            return await itunes.album(client, ident)
        if provider == "deezer" and kind == "album":
            return await deezer.album(client, ident)
        if provider == "deezer" and kind == "playlist":
            return await deezer.playlist(client, ident)
        if provider == "sp" and spotify.enabled():
            return await _spotify_ref(client, kind, ident)
        if provider == "yt":
            # پلی‌لیست شناسه‌ی list دارد نه v؛ ساختن watch?v= از آن، لینک مرده بود
            url = (
                f"https://www.youtube.com/playlist?list={ident}"
                if kind == "playlist"
                else f"https://www.youtube.com/watch?v={ident}"
            )
            return await asyncio.to_thread(ytdlp.extract, url)
        if provider == "sc":
            # ساندکلاد از شناسه‌ی عددی لینک‌سازی نمی‌شود — فقط با لینک کامل می‌آید
            return None

    if not ref.lower().startswith("http"):
        return None

    if parsed := itunes.parse_url(ref):
        kind, ident = parsed
        if kind == "album":
            return await itunes.album(client, ident)

    if parsed := deezer.parse_url(ref):
        kind, ident = parsed
        if kind == "album":
            return await deezer.album(client, ident)
        if kind == "playlist":
            return await deezer.playlist(client, ident)

    if parsed := spotify.parse_url(ref):
        kind, ident = parsed
        # صفحه‌ی کاربر آلبوم نیست؛ مسیرش `resolve_artist` است. بدون این شرط،
        # مسیرِ بی‌کلیدِ پایین عنوانِ oEmbed را در اپل/دیزر می‌گشت و یک آلبومِ
        # بی‌ربط به‌جای پروفایل برمی‌گرداند.
        if kind == "user":
            return None
        if spotify.enabled():
            return await _spotify_ref(client, kind, ident)
        return await _spotify_fallback(client, ref)

    if ytdlp.YOUTUBE_URL.search(ref) or ytdlp.SOUNDCLOUD_URL.search(ref):
        return await asyncio.to_thread(ytdlp.extract, ref)

    return None


# پرکردنِ بخش آهنگ‌ها از روی تازه‌ترین انتشارها، وقتی خودِ پلتفرم لیستِ محبوب‌ها
# را نمی‌دهد. سه انتشار برای رسیدن به یک لیستِ آبرومند بس است و بیشترش فقط
# درخواستِ اضافه است.
FALLBACK_ALBUMS = 3
FALLBACK_TRACKS = 12

# کمتر از این، لیستِ ناقص است نه لیست. دیزر برای هنرمندی با هفت آلبوم فقط یک ترک
# برگرداند؛ آن یک ترک نباید جلوی پر شدنِ بقیه را بگیرد.
MIN_TRACKS = 5


async def _fill_tracks(client: httpx.AsyncClient, detail: ArtistDetail) -> ArtistDetail:
    """
    بخش آهنگ‌ها را از تازه‌ترین انتشارهای خودِ هنرمند کامل می‌کند.

    دو پلتفرم لیستِ محبوب‌ها را نمی‌دهند و صفحه‌شان فقط گرید آلبوم می‌شد: دیزر
    برای `/artist/{id}/top` از این IP یا خالی برمی‌گرداند یا یک‌دو ترک (حتی برای
    هنرمندهای بزرگ)، و اسپاتیفای اندپوینت `top-tracks` را روی کلیدهای حالت توسعه
    بسته. آلبوم‌ها که هستند، و ترک‌های داخلشان دقیقاً همان داده‌ی خودِ پلتفرم است.

    اینجاست نه در providerها چون `resolve_ref` از قبل هر چهار پلتفرم را می‌شناسد؛
    یک پیاده‌سازی برای همه.
    """
    if len(detail.topTracks) >= MIN_TRACKS or not detail.albums:
        return detail

    # سینگل‌ها آخر: یک آلبومِ دوازده‌ترکه در یک درخواست همان لیستی را می‌دهد که سه
    # سینگل نمی‌دهند. شرط روی «یک ترک» است نه «کم‌ترک»، چون دیزر در این اندپوینت
    # تعداد را نمی‌دهد و صفرِ نامعلوم نباید سینگل حساب شود. مرتب‌سازی پایدار است،
    # پس ترتیبِ تازه‌به‌قدیمِ درونِ هر دسته دست‌نخورده می‌ماند.
    picks = sorted(detail.albums, key=lambda a: a.trackCount == 1)[:FALLBACK_ALBUMS]

    found = await asyncio.gather(
        *(resolve_ref(client, a.sourceUrl or a.id) for a in picks),
        return_exceptions=True,
    )
    # آن چند ترکی که پلتفرم داده بود اول می‌مانند — همان‌ها محبوب‌های واقعی‌اند،
    # و همان‌ها هستند که در آلبوم هم تکرار می‌شوند
    tracks = list(detail.topTracks)
    seen = {t.id for t in tracks}
    for outcome in found:
        if not isinstance(outcome, AlbumDetail):
            continue
        for track in outcome.tracks:
            if track.id in seen:
                continue
            seen.add(track.id)
            tracks.append(track)

    detail.topTracks = tracks[:FALLBACK_TRACKS]
    return detail


async def resolve_artist(client: httpx.AsyncClient, ref: str) -> ArtistDetail | None:
    """
    صفحه‌ی هنرمند از روی شناسه‌ی داخلی یا لینک اپل‌موزیک/دیزر.

    هر چهار پلتفرم را می‌شناسد چون نتایج جستجو هم به‌ازای هر پلتفرم یک کارت
    می‌دهد؛ کارتی که صفحه‌اش باز نشود، فقط یک ۴۰۴ است.
    """
    detail = await _artist_page(client, ref.strip())
    return None if detail is None else await _fill_tracks(client, detail)


async def _artist_page(client: httpx.AsyncClient, ref: str) -> ArtistDetail | None:
    if m := ID.match(ref):
        provider, kind, ident = m.groups()
        if kind == "artist":
            if provider == "itunes":
                return await itunes.artist(client, ident)
            if provider == "deezer":
                return await deezer.artist(client, ident)
            if provider == "sp" and spotify.enabled():
                return await spotify.artist(client, ident)
            if provider == "sc":
                return await asyncio.to_thread(ytdlp.soundcloud_artist, ident)
            if provider == "yt":
                return await asyncio.to_thread(ytdlp.youtube_channel, _channel_url(ident))
        if kind == "user":
            return await _user_page(client, provider, ident)
        return None

    if not ref.lower().startswith("http"):
        return None

    if (parsed := itunes.parse_url(ref)) and parsed[0] == "artist":
        return await itunes.artist(client, parsed[1])
    if parsed := deezer.parse_url(ref):
        if parsed[0] == "artist":
            return await deezer.artist(client, parsed[1])
        if parsed[0] == "user":
            return await deezer.user(client, parsed[1])
    if parsed := spotify.parse_url(ref):
        if parsed[0] == "artist" and spotify.enabled():
            return await spotify.artist(client, parsed[1])
        # صفحه‌ی کاربر برخلاف بقیه‌ی اسپاتیفای کلید نمی‌خواهد
        if parsed[0] == "user":
            return await spotify.user(client, parsed[1])
    if ytdlp.SOUNDCLOUD_PROFILE_URL.match(ref):
        return await asyncio.to_thread(ytdlp.soundcloud_user, ref)
    if ytdlp.CHANNEL_URL.search(ref):
        return await asyncio.to_thread(ytdlp.youtube_channel, ref)
    return None


def _channel_url(channel_id: str) -> str:
    return f"https://www.youtube.com/channel/{channel_id}"


async def _user_page(client: httpx.AsyncClient, provider: str, ident: str) -> ArtistDetail | None:
    """
    صفحه‌ی کاربرِ عادی — کسی که هنرمند نیست و فقط پلی‌لیستِ عمومی دارد.

    اپل اینجا نیست: اپل‌موزیک صفحه‌ی عمومیِ کاربر روی وب ندارد و پلی‌لیستِ
    به‌اشتراک‌گذاشته‌ی کاربرش خودش یک لینکِ پلی‌لیست است، که از قبل کار می‌کند.
    """
    if provider == "sp":
        return await spotify.user(client, ident)
    if provider == "deezer":
        return await deezer.user(client, ident)
    if provider == "sc":
        return await asyncio.to_thread(ytdlp.soundcloud_artist, ident)
    if provider == "yt":
        return await asyncio.to_thread(ytdlp.youtube_channel, _channel_url(ident))
    return None
