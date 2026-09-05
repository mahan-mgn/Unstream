"""
منطق‌ِ app.bot.run — تنها فایلِ بات که قبلاً تست نداشت. برخلافِ test_bot_logic.py
که فقط توابعِ خالص را می‌زند، اینجا مسیرهای async (دانلود، تحویل، وضعیت) با
ApiClient و context.bot تقلبی واقعاً اجرا می‌شوند تا خطاهای زمانِ اجرا (نه فقط
منطقی) هم گیر بیفتند.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from telegram.error import BadRequest, NetworkError, TimedOut

from app.bot import run
from app.bot.logic import TELEGRAM_FILE_LIMIT
from app.models import AlbumDetail, DownloadProgress, SongInfo, TelegramJob


def _run(coro):
    return asyncio.run(coro)


class FakeSink:
    """جایگزینِ `_StatusSink` — فقط ادیت‌ها را ثبت می‌کند، به تلگرام کاری ندارد."""

    def __init__(self) -> None:
        self.edited: list[str] = []
        self.deleted = False

    async def edit(self, text: str, **kwargs) -> None:
        self.edited.append(text)

    async def delete(self) -> None:
        self.deleted = True


class FakeApi:
    def __init__(
        self,
        *,
        create_result: str = "job-1",
        create_exc: Exception | None = None,
        progress_events: list[DownloadProgress] | None = None,
        stream_exc: Exception | None = None,
        file_bytes: bytes | None = b"audio-bytes",
        song_info: SongInfo | None = None,
        lyrics: bytes | None = None,
    ) -> None:
        self.create_result = create_result
        self.create_exc = create_exc
        self.progress_events = progress_events or []
        self.stream_exc = stream_exc
        self._file_bytes = file_bytes
        self._song_info = song_info
        self._lyrics = lyrics

    async def create_download(self, track, quality):
        if self.create_exc:
            raise self.create_exc
        return self.create_result

    async def stream_progress(self, job_id):
        for event in self.progress_events:
            yield event
        if self.stream_exc:
            raise self.stream_exc

    def file_url(self, job_id: str) -> str:
        return f"https://example.com/dl/{job_id}"

    async def file_bytes(self, job_id: str):
        return self._file_bytes

    async def song_info(self, title: str, artist: str):
        return self._song_info

    async def raw_bytes(self, url: str):
        return b"img-bytes"

    async def lyrics_bytes(self, job_id: str):
        return self._lyrics


def _context(api: FakeApi) -> SimpleNamespace:
    return SimpleNamespace(bot_data={"api": api}, chat_data={}, bot=AsyncMock())


# ---------- توابعِ خالصِ فرمت‌بندی ----------


class TestFmtDuration:
    def test_formats_minutes_and_seconds(self):
        assert run._fmt_duration(185_000) == "3:05"

    def test_pads_single_digit_seconds(self):
        assert run._fmt_duration(60_000) == "1:00"


class TestTrackLine:
    def test_escapes_html_and_includes_source_badge(self, track):
        t = track.model_copy(update={"title": "<b>x</b>", "artist": "A & B"})
        line = run._track_line(t)
        assert "&lt;b&gt;x&lt;/b&gt;" in line
        assert "A &amp; B" in line
        assert line.startswith(run.source_badge(t.source))


class TestInfoCaption:
    def test_release_date_hidden_when_track_already_has_year(self, track):
        t = track.model_copy(update={"year": 1974})
        info = SongInfo(releaseDate="1974-05-01")
        caption = run._info_caption(t, info)
        assert "تاریخ انتشار" not in caption

    def test_release_date_shown_when_track_year_is_missing(self, track):
        t = track.model_copy(update={"year": None})
        info = SongInfo(releaseDate="1974-05-01")
        caption = run._info_caption(t, info)
        assert "تاریخ انتشار" in caption

    def test_writers_and_producers_included_when_present(self, track):
        info = SongInfo(writers=["A", "B"], producers=["C"])
        caption = run._info_caption(track, info)
        assert "آهنگساز" in caption
        assert "تهیه‌کننده" in caption

    def test_works_without_any_genius_info(self, track):
        caption = run._info_caption(track, None)
        assert "آهنگساز" not in caption
        assert "تهیه‌کننده" not in caption


# ---------- _StatusSink ----------


class TestStatusSink:
    def test_message_mode_edits_the_message(self):
        message = AsyncMock()
        context = SimpleNamespace(bot=AsyncMock())
        sink = run._StatusSink(context, message=message)

        _run(sink.edit("hello"))

        message.edit_text.assert_awaited_once_with("hello")

    def test_inline_mode_edits_via_bot(self):
        bot = AsyncMock()
        context = SimpleNamespace(bot=bot)
        sink = run._StatusSink(context, inline_message_id="abc")

        _run(sink.edit("hello"))

        bot.edit_message_text.assert_awaited_once_with("hello", inline_message_id="abc")

    def test_edit_swallows_exceptions_instead_of_killing_the_download(self):
        message = AsyncMock()
        message.edit_text.side_effect = RuntimeError("rate limited")
        context = SimpleNamespace(bot=AsyncMock())
        sink = run._StatusSink(context, message=message)

        _run(sink.edit("hello"))  # نباید بالا برود

    def test_delete_swallows_exceptions(self):
        message = AsyncMock()
        message.delete.side_effect = RuntimeError("already gone")
        context = SimpleNamespace(bot=AsyncMock())
        sink = run._StatusSink(context, message=message)

        _run(sink.delete())  # نباید بالا برود


# ---------- _run_download ----------


class TestRunDownload:
    def test_create_download_failure_is_reported(self, track):
        api = FakeApi(create_exc=RuntimeError("network down"))
        context = _context(api)
        sink = FakeSink()

        result = _run(run._run_download(context, track, sink))

        assert result is None
        assert any("شروع دانلود ناموفق بود" in t for t in sink.edited)

    def test_successful_download_returns_job_id_and_final_progress(self, track):
        ready = DownloadProgress(status="ready", percent=100, format="mp3 320")
        api = FakeApi(
            progress_events=[
                DownloadProgress(status="searching"),
                DownloadProgress(status="downloading", percent=50),
                ready,
            ]
        )
        context = _context(api)
        sink = FakeSink()

        job_id, final = _run(run._run_download(context, track, sink))

        assert job_id == "job-1"
        assert final is ready

    def test_stream_ending_without_a_ready_status_is_a_failure(self, track):
        api = FakeApi(progress_events=[])
        context = _context(api)
        sink = FakeSink()

        result = _run(run._run_download(context, track, sink))

        assert result is None
        assert sink.edited[-1] == "دانلود ناموفق بود."

    def test_server_reported_error_is_shown_verbatim(self, track):
        api = FakeApi(progress_events=[DownloadProgress(status="error", error="فایل قفل دارد")])
        context = _context(api)
        sink = FakeSink()

        result = _run(run._run_download(context, track, sink))

        assert result is None
        assert sink.edited[-1] == "فایل قفل دارد"

    def test_stream_exception_mid_download_is_reported(self, track):
        api = FakeApi(
            progress_events=[DownloadProgress(status="downloading", percent=10)],
            stream_exc=RuntimeError("connection reset"),
        )
        context = _context(api)
        sink = FakeSink()

        result = _run(run._run_download(context, track, sink))

        assert result is None
        assert any("دریافت وضعیت ناموفق بود" in t for t in sink.edited)


# ---------- _deliver ----------


class TestDeliver:
    def test_missing_file_is_reported_without_sending_anything(self, track):
        api = FakeApi(file_bytes=None)
        context = _context(api)
        sink = FakeSink()

        _run(run._deliver(context, 123, track, "job-1", sink, "mp3 320"))

        assert sink.edited == ["فایل آماده نبود."]
        context.bot.send_audio.assert_not_awaited()

    def test_oversized_file_gets_a_direct_link_instead_of_upload(self, track, monkeypatch):
        monkeypatch.setattr(run, "too_large_for_telegram", lambda n: True)
        api = FakeApi(file_bytes=b"x")
        context = _context(api)
        sink = FakeSink()

        _run(run._deliver(context, 123, track, "job-1", sink, "mp3 320"))

        assert any("مستقیم بگیرش" in t for t in sink.edited)
        context.bot.send_audio.assert_not_awaited()

    def test_normal_delivery_sends_audio_with_track_metadata(self, track, monkeypatch):
        monkeypatch.setattr(run, "too_large_for_telegram", lambda n: False)
        api = FakeApi(file_bytes=b"audio-bytes", lyrics=b"[00:01.00]lyric line")
        context = _context(api)
        sink = FakeSink()

        _run(run._deliver(context, 123, track, "job-1", sink, "mp3 320"))

        context.bot.send_audio.assert_awaited_once()
        _, kwargs = context.bot.send_audio.await_args
        assert kwargs["filename"] == run.audio_filename(track, "mp3 320")
        assert kwargs["title"] == track.title
        assert kwargs["performer"] == track.artist
        assert sink.deleted is True
        context.bot.send_document.assert_awaited_once()

    def test_thumbnail_fetch_crash_does_not_block_the_actual_file(self, track, monkeypatch):
        """
        رگرسیون: `_fetch_full_cover` قبلاً هم داخلِ try/except بود، ولی
        `_fetch_thumbnail` نبود — یک خطای غیرمنتظره (نه httpx.HTTPError، که
        خودِ raw_bytes قبلاً می‌گیرد) در گرفتنِ کاورِ کوچک کلِ ارسال را
        می‌ترکاند، با اینکه فایل صوتی از قبل آماده بود. حالا هر دو best-effort‌اند.
        """
        monkeypatch.setattr(run, "too_large_for_telegram", lambda n: False)
        t = track.model_copy(update={"artworkUrl": "https://example.com/cover.jpg"})
        api = FakeApi(file_bytes=b"audio-bytes")

        async def flaky_raw_bytes(url):
            raise RuntimeError("unexpected failure fetching artwork")

        api.raw_bytes = flaky_raw_bytes
        context = _context(api)
        sink = FakeSink()

        _run(run._deliver(context, 123, t, "job-1", sink, "mp3 320"))

        context.bot.send_audio.assert_awaited_once()
        _, kwargs = context.bot.send_audio.await_args
        assert kwargs["thumbnail"] is None
        context.bot.send_photo.assert_not_awaited()


    def test_upload_timeout_is_retried_before_giving_up(self, track, monkeypatch):
        """
        رگرسیون: آپلودِ چند-مگابایتی روی لینکِ ناپایدار گاهی در تلاشِ اول
        TimedOut می‌گرفت و همان‌جا کلِ ارسال شکست می‌خورد — دکمه‌ی وب قرمز
        می‌شد با اینکه یک تلاشِ دیگر جواب می‌داد.
        """
        monkeypatch.setattr(run, "too_large_for_telegram", lambda n: False)
        monkeypatch.setattr(run, "UPLOAD_RETRY", 0)
        api = FakeApi(file_bytes=b"audio-bytes")
        context = _context(api)
        context.bot.send_audio.side_effect = [TimedOut(), SimpleNamespace()]
        sink = FakeSink()

        _run(run._deliver(context, 123, track, "job-1", sink, "mp3 320"))

        assert context.bot.send_audio.await_count == 2
        assert sink.deleted is True

    def test_upload_uses_a_timeout_wide_enough_for_telegram_to_answer(
        self, track, monkeypatch
    ):
        """تلگرام بعدِ آپلود فایل را پردازش می‌کند و تازه بعدش جواب می‌دهد."""
        monkeypatch.setattr(run, "too_large_for_telegram", lambda n: False)
        api = FakeApi(file_bytes=b"audio-bytes")
        context = _context(api)
        sink = FakeSink()

        _run(run._deliver(context, 123, track, "job-1", sink, "mp3 320"))

        _, kwargs = context.bot.send_audio.await_args
        assert kwargs["read_timeout"] == run.UPLOAD_TIMEOUT
        assert kwargs["write_timeout"] == run.UPLOAD_TIMEOUT

    def test_bad_request_is_not_retried(self, track, monkeypatch):
        """
        BadRequest زیرِ NetworkError نشسته ولی خطای خودِ درخواست است — تکرارش
        فقط سه برابر معطلی است.
        """
        monkeypatch.setattr(run, "too_large_for_telegram", lambda n: False)
        monkeypatch.setattr(run, "UPLOAD_RETRY", 0)
        api = FakeApi(file_bytes=b"audio-bytes")
        context = _context(api)
        context.bot.send_audio.side_effect = BadRequest("chat not found")
        sink = FakeSink()

        with pytest.raises(RuntimeError):
            _run(run._deliver(context, 123, track, "job-1", sink, "mp3 320"))

        assert context.bot.send_audio.await_count == 1

    def test_dead_upload_falls_back_to_the_direct_link(self, track, monkeypatch):
        """
        فایل روی دیسکِ سرور آماده است؛ شکستِ آپلود نباید یعنی از دست رفتنش.
        خطا همچنان بالا می‌رود تا وبِ صف هم بداند نرسیده.
        """
        monkeypatch.setattr(run, "too_large_for_telegram", lambda n: False)
        monkeypatch.setattr(run, "UPLOAD_RETRY", 0)
        api = FakeApi(file_bytes=b"audio-bytes")
        context = _context(api)
        context.bot.send_audio.side_effect = NetworkError("connection reset")
        sink = FakeSink()

        with pytest.raises(RuntimeError):
            _run(run._deliver(context, 123, track, "job-1", sink, "mp3 320"))

        assert context.bot.send_audio.await_count == run.UPLOAD_ATTEMPTS
        assert any(api.file_url("job-1") in t for t in sink.edited)
        assert sink.deleted is False

    def test_lyrics_failure_does_not_fail_an_arrived_track(self, track, monkeypatch):
        """
        رگرسیون: فایلِ صوتی از قبل در چت نشسته بود ولی تایم‌اوتِ .lrc کلِ کارِ
        صف را «ناموفق» گزارش می‌کرد و دکمه‌ی وب قرمز می‌شد.
        """
        monkeypatch.setattr(run, "too_large_for_telegram", lambda n: False)
        api = FakeApi(file_bytes=b"audio-bytes", lyrics=b"[00:01.00]x")
        context = _context(api)
        context.bot.send_document.side_effect = TimedOut()
        sink = FakeSink()

        _run(run._deliver(context, 123, track, "job-1", sink, "mp3 320"))

        context.bot.send_audio.assert_awaited_once()
        assert sink.deleted is True


# ---------- کشِ inline ----------


class TestCacheInlineTrack:
    def test_round_trips_the_track(self, track):
        run._inline_cache.clear()
        run._inline_cache_at.clear()

        key = run._cache_inline_track(track)

        assert run._inline_cache[key] is track

    def test_expired_entries_are_evicted_on_next_insert(self, track, monkeypatch):
        run._inline_cache.clear()
        run._inline_cache_at.clear()

        clock = {"t": 1000.0}
        monkeypatch.setattr(run.time, "monotonic", lambda: clock["t"])

        old_key = run._cache_inline_track(track)
        clock["t"] += run._INLINE_CACHE_TTL + 1

        run._cache_inline_track(track)

        assert old_key not in run._inline_cache
        assert old_key not in run._inline_cache_at


# ---------- انتخاب از لیستِ کاندید (index-based callback data) ----------


class _Query:
    def __init__(self, data: str, message=None):
        self.data = data
        self.message = message
        self.answer = AsyncMock()
        self.edit_message_text = AsyncMock()


class _Update:
    def __init__(self, query):
        self.callback_query = query


class TestPickHandlers:
    def test_on_pick_with_stale_index_reports_gracefully(self, track):
        api = FakeApi()
        context = _context(api)
        context.chat_data["candidates"] = [track]
        message = AsyncMock()
        message.chat_id = 123
        query = _Query("pick:5", message=message)
        update = _Update(query)

        _run(run.on_pick(update, context))

        query.edit_message_text.assert_awaited_once()
        assert "معتبر نیست" in query.edit_message_text.await_args.args[0]

    def test_on_follow_pick_with_empty_candidates_reports_gracefully(self):
        context = _context(FakeApi())
        message = AsyncMock()
        query = _Query("followpick:0", message=message)
        update = _Update(query)

        _run(run.on_follow_pick(update, context))

        query.edit_message_text.assert_awaited_once()
        assert "دوباره" in query.edit_message_text.await_args.args[0]


# ---------- مرورگرِ پروفایلِ هنرمند: خطای شبکه نباید کاربر را در جا خشک کند ----------


class FlakyArtistApi(FakeApi):
    """`artist()` همیشه شکست می‌خورد — شبیه‌سازیِ یک بلیپِ شبکه/سرور."""

    async def artist(self, ref: str):
        raise RuntimeError("upstream unavailable")


class TestArtistProfileNetworkFailures:
    """
    رگرسیون: برخلافِ `_check_follows` که خطای `api.artist()` را از قبل می‌گرفت،
    مسیرهای مرورگرِ پروفایل (`_artist_profile_view`، `_artist_section_view`،
    `on_artist_follow`) این کار را نمی‌کردند — یک خطای شبکه‌ی معمولی کلِ
    هندلر را می‌ترکاند و دکمه‌ی کاربر بی‌جواب می‌ماند، به‌جای پیامِ «پیدا نشد».
    """

    def test_artist_profile_view_returns_none_instead_of_raising(self):
        context = _context(FlakyArtistApi())

        view = _run(run._artist_profile_view(context, "deezer:artist:1"))

        assert view is None

    def test_artist_section_view_returns_none_instead_of_raising(self):
        context = _context(FlakyArtistApi())

        view = _run(run._artist_section_view(context, "deezer:artist:1", "att"))

        assert view is None

    def test_on_artist_follow_reports_not_found_instead_of_raising(self):
        context = _context(FlakyArtistApi())
        message = AsyncMock()
        query = _Query("afollow:deezer:artist:1", message=message)
        update = _Update(query)

        _run(run.on_artist_follow(update, context))

        query.answer.assert_awaited_once()
        assert "پیدا نشد" in query.answer.await_args.args[0]


# ---------- وصل‌شدن به وب و صفِ «فرستادن به تلگرام» ----------


class _Chat:
    def __init__(self, chat_id=7, title=None, first_name=None, last_name=None, username=None):
        self.id = chat_id
        self.title = title
        self.first_name = first_name
        self.last_name = last_name
        self.username = username


def _message(chat: _Chat) -> AsyncMock:
    message = AsyncMock()
    message.chat = chat
    message.chat_id = chat.id
    return message


class PairingApi(FakeApi):
    def __init__(self, error: str | None = None) -> None:
        super().__init__()
        self.error = error
        self.claims: list[tuple[str, int, str]] = []

    async def claim_pair(self, code, chat_id, chat_title):
        self.claims.append((code, chat_id, chat_title))
        return self.error


class TestChatTitle:
    """اسمی که در وب کنارِ «وصل است» می‌نشیند — باید همیشه چیزی برای نشان دادن باشد."""

    def test_prefers_the_group_title(self):
        assert run._chat_title(_message(_Chat(title="گروهِ ما"))) == "گروهِ ما"

    def test_falls_back_to_the_persons_name(self):
        chat = _Chat(first_name="فرهاد", last_name="مهراد")

        assert run._chat_title(_message(chat)) == "فرهاد مهراد"

    def test_falls_back_to_the_username_then_the_id(self):
        assert run._chat_title(_message(_Chat(username="farhad"))) == "@farhad"
        assert run._chat_title(_message(_Chat(chat_id=42))) == "42"


class TestClaimLink:
    def test_valid_code_links_this_chat(self):
        api = PairingApi()
        message = _message(_Chat(chat_id=99, title="پیوی"))

        _run(run._claim_link(message, _context(api), " abc123 "))

        assert api.claims == [("abc123", 99, "پیوی")]
        assert "وصل شد" in message.reply_text.await_args.args[0]

    def test_rejected_code_shows_the_servers_reason(self):
        api = PairingApi(error="این کد معتبر نیست یا منقضی شده")
        message = _message(_Chat())

        _run(run._claim_link(message, _context(api), "abc123"))

        assert message.reply_text.await_args.args[0] == "این کد معتبر نیست یا منقضی شده"

    def test_bare_command_explains_instead_of_calling_the_server(self):
        api = PairingApi()
        message = _message(_Chat())

        _run(run._claim_link(message, _context(api), ""))

        assert api.claims == []
        assert "/link" in message.reply_text.await_args.args[0]


class OutboxApi(FakeApi):
    """FakeApi + باز کردنِ آلبوم، برای کارهای `kind="album"`."""

    def __init__(self, album=None, resolve_exc: Exception | None = None, **kwargs) -> None:
        super().__init__(**kwargs)
        self.album = album
        self.resolve_exc = resolve_exc
        self.qualities: list[str] = []

    async def create_download(self, track, quality):
        self.qualities.append(quality)
        return await super().create_download(track, quality)

    async def resolve_ref(self, ref):
        if self.resolve_exc:
            raise self.resolve_exc
        return self.album


def _application(api: FakeApi):
    """
    اپلیکیشنِ تقلبی برای `_run_outbox_job` — همان context معمولی را می‌دهد،
    چون کارِ صف نباید مسیرِ متفاوتی از پیامِ کاربر برود.
    """
    context = _context(api)
    return SimpleNamespace(
        bot_data={"api": api},
        context_types=SimpleNamespace(context=lambda app, chat_id=None: context),
    ), context


def _album_detail(tracks) -> AlbumDetail:
    return AlbumDetail(
        id="deezer:album:1",
        title="Mard-E Tanha",
        artist="Farhad Mehrad",
        source="deezer",
        sourceUrl="https://www.deezer.com/album/1",
        year=1978,
        trackCount=len(tracks),
        durationMs=sum(x.durationMs for x in tracks),
        tracks=tracks,
    )


def _ready_events():
    return [
        DownloadProgress(status="downloading", percent=50),
        DownloadProgress(status="ready", percent=100, format="mp3 320"),
    ]


class TestRunOutboxJob:
    """کارِ صف = همان مسیرِ همیشگیِ دانلود و ارسال، فقط بدون پیامِ کاربر."""

    def test_track_job_downloads_and_sends_with_the_requested_quality(self, track):
        api = OutboxApi(progress_events=_ready_events())
        application, context = _application(api)
        job = TelegramJob(id="s1", chatId=5, kind="track", quality="flac", title=track.title, track=track)

        error = _run(run._run_outbox_job(application, job))

        assert error is None
        assert api.qualities == ["flac"]
        context.bot.send_audio.assert_awaited_once()

    def test_album_job_sends_every_track(self, track):
        detail = _album_detail([track, track.model_copy(update={"id": "itunes:track:2"})])
        api = OutboxApi(album=detail, progress_events=_ready_events())
        application, context = _application(api)
        job = TelegramJob(id="s2", chatId=5, kind="album", quality="320", title=detail.title, ref="deezer:album:1")

        error = _run(run._run_outbox_job(application, job))

        assert error is None
        assert context.bot.send_audio.await_count == 2

    def test_empty_album_reports_instead_of_going_quiet(self, track):
        api = OutboxApi(album=_album_detail([]))
        application, _ = _application(api)
        job = TelegramJob(id="s2b", chatId=5, kind="album", quality="320", title="خالی", ref="deezer:album:1")

        assert _run(run._run_outbox_job(application, job)) is not None

    def test_unopenable_album_reports_the_reason(self):
        api = OutboxApi(resolve_exc=RuntimeError("۵۰۴"))
        application, _ = _application(api)
        job = TelegramJob(id="s3", chatId=5, kind="album", quality="320", title="آلبوم", ref="deezer:album:1")

        error = _run(run._run_outbox_job(application, job))

        assert error is not None and "۵۰۴" in error

    def test_missing_payload_reports_instead_of_raising(self):
        """
        ردیفِ ناقص در صف نباید حلقه را بترکاند — وگرنه دکمه‌ی وب تا ابد اسپینر
        نشان می‌دهد و بقیه‌ی صف هم پشتش می‌ماند.
        """
        application, _ = _application(OutboxApi())

        missing_track = _run(
            run._run_outbox_job(
                application, TelegramJob(id="s4", chatId=5, kind="track", quality="320", title="x")
            )
        )
        missing_ref = _run(
            run._run_outbox_job(
                application, TelegramJob(id="s5", chatId=5, kind="album", quality="320", title="x")
            )
        )

        assert missing_track is not None
        assert missing_ref is not None
