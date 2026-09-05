"""
منطق خالصِ بات تلگرام — بدون شبکه، بدون mock برای httpx/telegram.
"""

from __future__ import annotations

import pytest

from app.bot.logic import (
    AUTO_QUALITY,
    TELEGRAM_FILE_LIMIT,
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
from app.models import Album


def _album(id: str, title: str = "T") -> Album:
    return Album(
        id=id, title=title, artist="A", year=2026, trackCount=1,
        source="spotify", sourceUrl="https://x",
    )


class TestLooksLikeUrl:
    def test_recognizes_http_and_https(self):
        assert looks_like_url("https://open.spotify.com/track/x")
        assert looks_like_url("http://example.com")

    def test_rejects_plain_search_text(self):
        assert not looks_like_url("مرد تنها فرهاد مهراد")

    def test_ignores_surrounding_whitespace(self):
        assert looks_like_url("  https://deezer.com/track/1  ")


class TestLooksLikeProfileUrl:
    """
    پروفایل ترک‌لیست ندارد، پس نباید به مسیرِ «همه رو بگیر» برود — و برعکس،
    لینکِ آلبوم/ترک نباید سر از مرورگرِ پروفایل دربیاورد.
    """

    @pytest.mark.parametrize(
        "url",
        [
            "https://open.spotify.com/artist/6jj9lOTeZC28LkPoXK9hiT",
            "https://open.spotify.com/user/31qajthebaf2bgwqnanhyrdpplte?si=ec90",
            "https://www.deezer.com/en/profile/2529",
            "https://music.apple.com/us/artist/farhad/500",
            "https://soundcloud.com/accia",
            "https://www.youtube.com/@NoCopyrightSounds/playlists",
        ],
    )
    def test_profiles(self, url):
        assert looks_like_profile_url(url)

    @pytest.mark.parametrize(
        "url",
        [
            "https://open.spotify.com/album/1A2B",
            "https://open.spotify.com/playlist/37i9dQ",
            "https://soundcloud.com/dorcci/gonah",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "مرد تنها فرهاد مهراد",
        ],
    )
    def test_everything_else(self, url):
        assert not looks_like_profile_url(url)


class TestFormatTrackButton:
    def test_joins_title_and_artist(self, track):
        assert format_track_button(track) == "Mard-e Tanha — Farhad Mehrad"

    def test_truncates_long_labels(self, track):
        long_track = track.model_copy(update={"title": "T" * 80})
        label = format_track_button(long_track)
        assert len(label) == 60
        assert label.endswith("…")


class TestTooLargeForTelegram:
    def test_under_limit_is_fine(self):
        assert not too_large_for_telegram(TELEGRAM_FILE_LIMIT - 1)

    def test_over_limit_is_rejected(self):
        assert too_large_for_telegram(TELEGRAM_FILE_LIMIT + 1)


class TestAudioFilename:
    def test_uses_first_word_of_format_as_extension(self, track):
        assert audio_filename(track, "mp3 320") == "Farhad Mehrad - Mard-e Tanha.mp3"

    def test_falls_back_to_mp3_when_format_is_missing(self, track):
        assert audio_filename(track, None) == "Farhad Mehrad - Mard-e Tanha.mp3"


class TestProgressBar:
    def test_zero_percent_is_all_empty(self):
        assert progress_bar(0, width=10) == "░" * 10

    def test_hundred_percent_is_all_filled(self):
        assert progress_bar(100, width=10) == "▓" * 10

    def test_fifty_percent_is_half_and_half(self):
        assert progress_bar(50, width=10) == "▓" * 5 + "░" * 5

    def test_clamps_out_of_range_values(self):
        assert progress_bar(-10, width=10) == "░" * 10
        assert progress_bar(150, width=10) == "▓" * 10

    def test_rounds_to_nearest_bar(self):
        assert progress_bar(42, width=10) == "▓" * 4 + "░" * 6


class TestSourceBadge:
    def test_known_sources_get_specific_emoji(self):
        assert source_badge("apple") == "🍎"
        assert source_badge("deezer") == "🎵"
        assert source_badge("spotify") == "🟢"
        assert source_badge("youtube") == "▶️"
        assert source_badge("soundcloud") == "☁️"


class TestFormatArtistButton:
    def test_passes_short_names_through(self):
        assert format_artist_button("Farhad Mehrad") == "Farhad Mehrad"

    def test_truncates_long_names(self):
        label = format_artist_button("A" * 80)
        assert len(label) == 60
        assert label.endswith("…")


class TestFormatArtistSearchButton:
    def test_includes_subtitle(self, artist):
        assert format_artist_search_button(artist) == "Farhad Mehrad — 34 آلبوم"

    def test_truncates_long_combined_label(self, artist):
        long_artist = artist.model_copy(update={"name": "A" * 80})
        label = format_artist_search_button(long_artist)
        assert len(label) == 60
        assert label.endswith("…")


class TestFormatAlbumButton:
    def test_joins_title_and_artist(self, album):
        assert format_album_button(album) == "Mard-E Tanha — Farhad Mehrad"

    def test_truncates_long_labels(self, album):
        long_album = album.model_copy(update={"title": "T" * 80})
        label = format_album_button(long_album)
        assert len(label) == 60
        assert label.endswith("…")


class TestFormatPlaylistButton:
    def test_joins_title_and_owner(self, playlist):
        assert format_playlist_button(playlist) == "بهترین‌های فرهاد — ناشناس"

    def test_truncates_long_labels(self, playlist):
        long_playlist = playlist.model_copy(update={"title": "T" * 80})
        label = format_playlist_button(long_playlist)
        assert len(label) == 60
        assert label.endswith("…")


class TestQualityLabel:
    def test_original_gets_persian_label(self):
        assert quality_label("original") == "اورجینال"

    def test_bitrates_pass_through_unchanged(self):
        assert quality_label("320") == "320"
        assert quality_label("flac") == "flac"


class TestNewReleases:
    """لیست تازه‌به‌قدیم است: تازه‌ها همه‌ی ردیف‌های قبل از آخرین شناسه‌ی دیده‌شده."""

    def test_no_seed_means_nothing_new(self):
        # اولین پرکردنِ وضعیت نباید کلِ دیسکوگرافی را «تازه» کند
        assert new_releases(None, [_album("a1")]) == []

    def test_unchanged_list_means_nothing_new(self):
        assert new_releases("a1", [_album("a1"), _album("a0")]) == []

    def test_single_new_release_on_top(self):
        albums = [_album("a2", "جدید"), _album("a1"), _album("a0")]
        [fresh] = new_releases("a1", albums)
        assert fresh.id == "a2"

    def test_several_new_releases_keep_newest_first(self):
        # خودِ تابع ترتیبِ فهرست را نگه می‌دارد؛ صداکننده برای ترتیبِ ارسال برعکسش می‌کند
        albums = [_album("a3"), _album("a2"), _album("a1")]
        assert [a.id for a in new_releases("a1", albums)] == ["a3", "a2"]

    def test_unknown_last_id_sends_only_the_latest(self):
        # شناسه‌ی ذخیره‌شده از فهرست افتاده — کلِ تاریخچه دوباره ارسال نمی‌شود
        albums = [_album("a9"), _album("a8")]
        [fresh] = new_releases("gone", albums)
        assert fresh.id == "a9"

    def test_empty_discography(self):
        assert new_releases("a1", []) == []


class TestAutoQuality:
    def test_auto_quality_is_the_highest_usual_fit_for_telegram(self):
        assert AUTO_QUALITY == "320"
