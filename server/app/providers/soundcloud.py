"""
متادیتای ترک‌های ساندکلاد از api-v2 — عمومی، فقط client_id می‌خواهد.

چرا کنار yt-dlp یکی دیگر: استخراج تختِ (`extract_flat`) یک «ست» ساندکلاد فقط
شناسه و لینک ترک‌ها را برمی‌گرداند و عنوان/مدت/کاور را نه — همان چیزی که آلبوم
را با یک مشت ترکِ بی‌نام و «ناشناس» نشان می‌داد. استخراج کامل این‌ها را دارد،
ولی به ازای هر ترک چند درخواستِ فرمت می‌زند و یک ترکِ DRMدار کل آلبوم را
می‌ترکاند. این اندپوینت هر پنجاه ترک را در یک درخواست و بدون لمس فرمت‌ها می‌دهد.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

import httpx

from ..config import HTTP_TIMEOUT, SEARCH_LIMIT, YTDLP_PROXY
from ..models import Album, Artist, Playlist

API = "https://api-v2.soundcloud.com"

# api-v2 لیست شناسه‌های بلندتر از این را با ۴۰۰ رد می‌کند
BATCH = 50

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

_SCRIPT_SRC = re.compile(r'<script[^>]+src="([^"]+)"')
_CLIENT_ID = re.compile(r'client_id\s*:\s*"([0-9a-zA-Z]{32})"')
# اندازه در نام فایلِ کاور است؛ large یعنی ۱۰۰ پیکسل و برای گرید کم است
_ARTWORK_SIZE = re.compile(r"-[0-9a-z]+\.(jpg|png)$", re.I)

# client_id عمر دارد و عوض می‌شود. تا وقتی کار می‌کند نگهش می‌داریم تا هر آلبوم
# دو درخواستِ اضافه برای پیدا کردنش نزند.
_cached_id: str | None = None


def _http() -> httpx.Client:
    # همان پروکسی‌ای که yt-dlp با آن ساندکلاد را می‌خواند — اگر خودِ ساندکلاد
    # مستقیم در دسترس نباشد، این درخواست‌ها هم نیستند
    return httpx.Client(
        timeout=HTTP_TIMEOUT,
        proxy=YTDLP_PROXY,
        headers={"User-Agent": UA},
        follow_redirects=True,
    )


def _scrape_client_id(http: httpx.Client) -> str | None:
    """client_id را از جاوااسکریپتِ خودِ سایت درمی‌آورد — همان کاری که yt-dlp می‌کند."""
    page = http.get("https://soundcloud.com/")
    page.raise_for_status()
    # آخرین اسکریپت‌ها همان‌هایی‌اند که client_id در آن‌هاست
    for src in reversed(_SCRIPT_SRC.findall(page.text)):
        try:
            script = http.get(src)
            script.raise_for_status()
        except httpx.HTTPError:
            continue
        if m := _CLIENT_ID.search(script.text):
            return m.group(1)
    return None


def _fetch(http: httpx.Client, ids: list[str], client_id: str) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for i in range(0, len(ids), BATCH):
        res = http.get(
            f"{API}/tracks",
            params={"ids": ",".join(ids[i : i + BATCH]), "client_id": client_id},
        )
        res.raise_for_status()
        for row in res.json() or []:
            if row.get("id"):
                rows[str(row["id"])] = row
    return rows


def _with_client_id(
    call: Callable[[httpx.Client, str], Any], hint: str | None = None
) -> Any:
    """
    `call` را با یک client_id معتبر اجرا می‌کند و اگر سوخته بود یکی تازه می‌گیرد.

    `hint` همان client_id ای است که yt-dlp قبلاً کش کرده. اگر منقضی شده باشد
    ساندکلاد ۴۰۱ می‌دهد و یکی تازه از سایت درمی‌آوریم.
    """
    global _cached_id

    with _http() as http:
        known = list(dict.fromkeys(c for c in (_cached_id, hint) if c))
        for client_id in [*known, None]:
            if client_id is None:
                client_id = _scrape_client_id(http)
                if not client_id or client_id in known:
                    break
            try:
                out = call(http, client_id)
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (401, 403):
                    continue  # این شناسه سوخته — بعدی
                raise
            _cached_id = client_id
            return out

    raise httpx.HTTPError("client_id معتبری برای ساندکلاد پیدا نشد")


def tracks(ids: list[str], hint: str | None = None) -> dict[str, dict[str, Any]]:
    """ترک‌ها را با شناسه می‌گیرد؛ کلیدِ خروجی همان شناسه است."""
    return _with_client_id(lambda http, cid: _fetch(http, ids, cid), hint)


def _upsize(url: str | None) -> str | None:
    if not url:
        return None
    return _ARTWORK_SIZE.sub(r"-t500x500.\1", url)


def _artwork(row: dict[str, Any]) -> str | None:
    return _upsize(row.get("artwork_url") or (row.get("user") or {}).get("avatar_url"))


def as_entry(row: dict[str, Any]) -> dict[str, Any]:
    """ردیفِ api-v2 را به شکل یک entry ی yt-dlp درمی‌آورد."""
    user = row.get("user") or {}
    publisher = row.get("publisher_metadata") or {}
    duration = row.get("duration") or row.get("full_duration") or 0
    return {
        "title": row.get("title") or "",
        # فقط ترکِ رسماً منتشرشده ناشر دارد؛ بقیه با جدا کردن «هنرمند - عنوان»
        # از خودِ تیتر حدس زده می‌شوند
        "artist": publisher.get("artist") or "",
        "uploader": user.get("username") or "",
        "duration": duration / 1000,
        "thumbnail": _artwork(row),
        "webpage_url": row.get("permalink_url") or "",
    }


def _api(path: str, **params: Any) -> Any:
    """یک GET روی api-v2 با client_id معتبر — و اگر سوخته بود، با یکی تازه."""

    def call(http: httpx.Client, client_id: str) -> Any:
        res = http.get(f"{API}{path}", params={**params, "client_id": client_id})
        res.raise_for_status()
        return res.json()

    return _with_client_id(call)


def _collection(path: str, **params: Any) -> list[dict[str, Any]]:
    """
    اندپوینت‌های لیستی جواب را در `collection` می‌پیچند، ولی نه همه — بعضی‌شان
    (مثل ترک‌های یک کاربر) آرایه‌ی خالی می‌دهند.
    """
    body = _api(path, **params)
    if isinstance(body, list):
        return body
    return (body or {}).get("collection") or []


def _search(path: str, query: str, limit: int) -> list[dict[str, Any]]:
    return _collection(path, q=query, limit=limit)


def search_tracks(query: str, limit: int = SEARCH_LIMIT) -> list[dict[str, Any]]:
    """
    جستجوی ترک — خروجی entryهای yt-dlp شکل است، نه Track.

    عمداً از `scsearch` ی خودِ yt-dlp استفاده نمی‌کنیم: آن به ازای هر نتیجه یک
    استخراج جدا می‌زند، در حالی که این اندپوینت کل صفحه را با متادیتای کامل در
    یک درخواست می‌دهد.
    """
    return _entries(_search("/search/tracks", query, limit))


def _entries(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {**as_entry(row), "id": str(row["id"])}
        for row in rows
        # بی‌لینک یعنی غیرقابل دانلود، و BLOCK یعنی از این IP پخش نمی‌شود —
        # همان IP ای که خودِ دانلود هم از آن می‌رود، پس نتیجه‌ی مرده است
        if row.get("id") and row.get("permalink_url") and row.get("policy") != "BLOCK"
    ]


def _year(value: Any) -> int:
    """
    سالِ انتشار، یا صفر وقتی تاریخ بدشکل/غایب است.

    `int(...)`ِ مستقیم روی رشته‌ای که عدد نیست ValueError می‌داد و چون این
    تابع وسطِ ساختنِ نتیجه‌ی جستجو صدا زده می‌شود، یک ردیفِ خراب کلِ پاسخ را
    ۵۰۲ می‌کرد — نه فقط همان یک آلبوم را.
    """
    head = str(value or "")[:4]
    return int(head) if head.isdigit() else 0


def _album(row: dict[str, Any]) -> Album:
    return Album(
        # ساندکلاد آلبوم و پلی‌لیست را با یک نوع نگه می‌دارد و `extract` هم
        # همین شناسه را می‌سازد؛ دو جور نامیدنش صفحه‌ی آلبوم را می‌شکست
        id=f"sc:playlist:{row['id']}",
        title=row.get("title") or "",
        artist=(row.get("user") or {}).get("username") or "ناشناس",
        year=_year(row.get("release_date") or row.get("created_at")),
        artworkUrl=_artwork(row),
        trackCount=int(row.get("track_count") or 0),
        source="soundcloud",
        sourceUrl=row["permalink_url"],
    )


def _albums(rows: list[dict[str, Any]]) -> list[Album]:
    return [
        _album(row)
        for row in rows
        # آلبومِ بی‌ترک هم در نتایج می‌آید (ست ساخته شده و پر نشده) — کارتی که
        # باز کردنش به صفحه‌ی خالی می‌رسد
        if row.get("id") and row.get("permalink_url") and row.get("track_count")
    ]


def search_albums(query: str, limit: int = SEARCH_LIMIT) -> list[Album]:
    """
    آلبوم‌های ساندکلاد.

    اندپوینتش از `playlists` جداست و همین جدایی نکته‌ی اصلی است: ساندکلاد «ست»
    را هم برای آلبوم رسمی به کار می‌برد هم برای میکسِ دست‌ساز کاربر، و فقط این
    مسیر آن‌هایی را می‌دهد که خودِ هنرمند به‌عنوان آلبوم منتشر کرده.
    """
    return _albums(_search("/search/albums", query, limit))


# هشت‌تا، همان‌قدر که اپل و دیزر برای هنرمند برمی‌دارند. بیستِ SEARCH_LIMIT
# اینجا فقط دنبال‌کننده‌های هم‌نامِ خودِ هنرمند را به لیست می‌آورد.
USER_LIMIT = 8


def _user(row: dict[str, Any]) -> Artist:
    followers = int(row.get("followers_count") or 0)
    tracks_count = int(row.get("track_count") or 0)
    if followers:
        subtitle = f"{followers:,} دنبال‌کننده"
    elif tracks_count:
        subtitle = f"{tracks_count:,} آهنگ"
    else:
        subtitle = "ساندکلاد"
    return Artist(
        id=f"sc:artist:{row['id']}",
        name=row.get("username") or row.get("permalink") or "",
        artworkUrl=_avatar(row.get("avatar_url")),
        source="soundcloud",
        sourceUrl=row["permalink_url"],
        subtitle=subtitle,
        # ساندکلاد بین هنرمند و شنونده تفکیک ندارد، پس تنها چیزی که می‌شود به آن
        # تکیه کرد خودِ داده است: حسابی که هیچ ترکی منتشر نکرده و فقط پلی‌لیست
        # دارد، صفحه‌اش هم باید صفحه‌ی کاربر باشد نه هنرمند
        kind="artist" if tracks_count else "user",
    )


def search_users(query: str, limit: int = USER_LIMIT) -> list[Artist]:
    """
    کاربرها — همان چیزی که در ساندکلاد جای «هنرمند» را می‌گیرد.

    ساندکلاد بین هنرمند و شنونده تفکیک ندارد، پس نتیجه‌ی خام پر از حسابِ شنونده
    است. آن‌هایی که هیچ ترکی ندارند کنار می‌روند: کارتشان فقط به یک صفحه‌ی خالی
    می‌رسید — همان اتفاقی که برای «farhad mehrad» می‌افتاد، جایی که یک شنونده‌ی
    هم‌نام کارت می‌گرفت و صفحه‌اش نه آهنگی داشت نه آلبومی.
    """
    return [
        _user(row)
        for row in _search("/search/users", query, limit)
        if row.get("id") and row.get("permalink_url") and row.get("track_count")
    ]


def user(user_id: str) -> Artist | None:
    """سرِ صفحه‌ی یک کاربر."""
    row = _api(f"/users/{user_id}")
    if not isinstance(row, dict) or not row.get("id") or not row.get("permalink_url"):
        return None
    return _user(row)


def resolve_user_id(url: str) -> str | None:
    """
    شناسه‌ی عددیِ کاربر از روی لینکِ پروفایل.

    لینکِ ساندکلاد فقط نامِ مستعار دارد (`soundcloud.com/accia`) و بقیه‌ی
    اندپوینت‌ها شناسه‌ی عددی می‌خواهند. `/resolve` هر لینکی را می‌گیرد، پس
    نوعِ خروجی چک می‌شود: لینکِ ترک یا ست هم از همین راه جواب می‌گیرد و بدون
    این شرط، صفحه‌ی هنرمند با شناسه‌ی یک ترک ساخته می‌شد.
    """
    row = _api("/resolve", url=url)
    if not isinstance(row, dict) or row.get("kind") != "user" or not row.get("id"):
        return None
    return str(row["id"])


# ساندکلاد بیش از پنجاه ردیف در هر درخواست نمی‌دهد. با بیست‌وپنج، صفحه‌ی هنرمند
# نصفِ آهنگ‌هایی را که خودِ ساندکلاد نشان می‌دهد از دست می‌داد.
USER_TRACKS = 50
USER_ALBUMS = 50


def user_tracks(user_id: str, limit: int = USER_TRACKS) -> list[dict[str, Any]]:
    """
    ترک‌های خودِ کاربر — entryهای yt-dlp شکل، مثل `search_tracks`.

    ترتیبش همان تازه‌به‌قدیمِ خودِ api است؛ همان چیزی که در تبِ Tracks صفحه‌ی
    ساندکلاد می‌بینی.
    """
    return _entries(_collection(f"/users/{user_id}/tracks", limit=limit))


def user_albums(user_id: str, limit: int = USER_ALBUMS) -> list[Album]:
    """
    فقط آن ست‌هایی که کاربر به‌عنوان آلبوم منتشر کرده، از تازه به قدیم.

    `/playlists` هم داشتیم ولی هر میکسِ دست‌سازِ کاربر را می‌آورد و دیسکوگرافی را
    با «فولدرِ آهنگ‌های مورد علاقه» پر می‌کرد.
    """
    rows = _collection(f"/users/{user_id}/albums", limit=limit)
    # ستِ ساندکلاد گاهی تاریخ انتشار ندارد و فقط تاریخِ ساخت دارد
    rows.sort(key=lambda r: r.get("release_date") or r.get("created_at") or "", reverse=True)
    return _albums(rows)


USER_PLAYLISTS = 50


def _playlist(row: dict[str, Any]) -> Playlist:
    return Playlist(
        # همان شناسه‌ای که `_album` می‌سازد: ساندکلاد آلبوم و پلی‌لیست را با یک
        # نوع نگه می‌دارد و صفحه‌شان هم یکی است
        id=f"sc:playlist:{row['id']}",
        title=row.get("title") or "",
        owner=(row.get("user") or {}).get("username") or "ناشناس",
        trackCount=int(row.get("track_count") or 0),
        artworkUrl=_artwork(row),
        source="soundcloud",
        sourceUrl=row["permalink_url"],
    )


def user_playlists(user_id: str, limit: int = USER_PLAYLISTS) -> list[Playlist]:
    """
    ست‌هایی که کاربر ساخته و آلبوم نیستند — همان تبِ Playlists صفحه‌اش.

    مکملِ `user_albums` است نه جایگزینش: آنجا فقط انتشارهای رسمی می‌آید و
    اینجا میکس‌های دست‌ساز، و کارتشان هم در صفحه جای جدا دارد. حسابی که هیچ
    ترکی منتشر نکرده — که در ساندکلاد کم نیست — تمامِ محتوایش همین است.
    """
    rows = _collection(f"/users/{user_id}/playlists", limit=limit)
    return [
        _playlist(row)
        for row in rows
        # ستِ خالی کارتی است که باز کردنش به صفحه‌ی خالی می‌رسد، و آلبوم از
        # `user_albums` می‌آید — دو بار نشان دادنش فقط صفحه را تکراری می‌کند
        if row.get("id") and row.get("permalink_url") and row.get("track_count")
        and not row.get("is_album")
    ]


USER_LIKES = 50
USER_REPOSTS = 50


def _item_id(row: dict[str, Any]) -> Any:
    """شناسه‌ی ترک یا پلی‌لیستِ زیرِ یک آیتمِ لایک/ریپست — برای تشخیصِ تکراری."""
    nested = row.get("track") or row.get("playlist")
    return nested.get("id") if isinstance(nested, dict) else None


def _paged(path: str, limit: int) -> list[dict[str, Any]]:
    """
    برای اندپوینت‌هایی که `limit` را جدی نمی‌گیرند و باید دنبالِ `next_href`
    رفت — لایک‌ها و ریپست‌ها این‌جورند.

    ولی وقتی فیدِ واقعی تمام می‌شود، به‌جای خالی برگشتن، `next_href` باز هم پر
    می‌ماند و همان آیتم‌های قبلی (یا حتی از سرِ لیست) را دوباره می‌دهد — بدون
    ردیابیِ شناسه‌ها، حلقه هیچ‌وقت واقعاً تمام نمی‌شد و لیستِ لایک/ریپست پر از
    تکرار می‌شد. این‌جا به‌محض این‌که یک صفحه چیزِ تازه‌ای نداشته باشد، توقف
    می‌کنیم.
    """

    def call(http: httpx.Client, client_id: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        seen: set[Any] = set()
        url: str | None = f"{API}{path}"
        params: dict[str, Any] = {"limit": limit, "client_id": client_id}
        while url and len(rows) < limit:
            res = http.get(url, params=params)
            res.raise_for_status()
            body = res.json() or {}
            fresh: list[dict[str, Any]] = []
            for row in body.get("collection") or []:
                key = _item_id(row)
                if key is not None:
                    if key in seen:
                        continue
                    seen.add(key)
                fresh.append(row)
            if not fresh:
                break
            rows.extend(fresh)
            # next_href پارامترهای صفحه‌ی بعد را خودش دارد؛ فقط client_id کم دارد
            url = body.get("next_href")
            params = {"client_id": client_id}
        return rows[:limit]

    return _with_client_id(call)


def _liked_tracks(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    آیتم‌های لایک/ریپست هم ترک دارند هم پلی‌لیست، هر کدام زیرِ کلید خودشان
    (`track` یا `playlist`). این‌جا فقط طرف ترک را بیرون می‌کشد — پلی‌لیستِ
    لایک/ریپست‌شده جای دیگری (کتابخانه‌ی خودِ ساندکلاد) نمایش داده می‌شود، نه اینجا.
    """
    return [row["track"] for row in rows if isinstance(row.get("track"), dict)]


def user_likes(user_id: str, limit: int = USER_LIKES) -> list[dict[str, Any]]:
    """ترک‌هایی که خودِ کاربر لایک کرده — همان تبِ Likes در صفحه‌ی ساندکلاد."""
    return _entries(_liked_tracks(_paged(f"/users/{user_id}/likes", limit)))


def user_reposts(user_id: str, limit: int = USER_REPOSTS) -> list[dict[str, Any]]:
    """
    ترک‌هایی که خودِ کاربر ریپست کرده — همان تبِ Reposts در صفحه‌ی ساندکلاد.

    برخلاف بقیه‌ی اندپوینت‌های این فایل، زیرِ `/users/{id}/reposts` نیست
    (۴۰۴ می‌دهد)؛ فیدِ ریپست از `/stream/...` می‌آید، همان مسیری که خودِ
    ساندکلاد برای این تب می‌خواند — و آن هم هر بار فقط پنج‌تا می‌دهد.
    """
    return _entries(_liked_tracks(_paged(f"/stream/users/{user_id}/reposts", limit)))


def _avatar(url: str | None) -> str | None:
    """
    آواتارِ پیش‌فرضِ ساندکلاد یک تصویر خاکستریِ یکسان برای همه است. با None
    برگرداندنش، فرانت جای آن حرفِ اولِ نام را با رنگِ پایدارِ خودش می‌گذارد که
    از یک آدمکِ تکراری در همه‌ی ردیف‌ها خواناتر است.
    """
    if not url or "default_avatar" in url:
        return None
    return _upsize(url)


def hydrate(entries: list[dict[str, Any]], hint: str | None = None) -> list[dict[str, Any]]:
    """
    entryهای ناقصِ یک ست یا صفحه‌ی کاربر را سرِ جا پر می‌کند.

    استخراج تختِ یک «ست» نه عنوان می‌دهد نه آپلودکننده، ولی استخراج تختِ صفحه‌ی
    «همه‌ی ترک‌ها»ی یک کاربر عنوان را می‌دهد و آپلودکننده را نه — چک کردن فقط
    عنوان اینجا را نادیده می‌گرفت و «Artist - Title» جدا نمی‌شد، پس هر ترکِ صفحه‌ی
    هنرمند «ناشناس» می‌ماند. شرط باید هر دو را بخواهد.

    شکست اینجا کشنده نیست: آلبوم با عنوانِ حدس‌زده از روی لینک نشان داده می‌شود،
    که از هیچ بهتر است و دانلود را هم زمین نمی‌زند.
    """
    missing = [e for e in entries if e.get("id") and not (e.get("title") and e.get("uploader"))]
    if not missing:
        return entries

    try:
        rows = tracks([str(e["id"]) for e in missing], hint)
    except Exception:
        return entries

    for entry in missing:
        if row := rows.get(str(entry["id"])):
            entry.update(as_entry(row))
    return entries
