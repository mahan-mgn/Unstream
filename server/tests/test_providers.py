"""تشخیص لینک و نگاشت متادیتا — جایی که یک regex اشتباه، کل ورودی را می‌بلعد."""

from __future__ import annotations

import pytest

from app.catalog import ID, _dedupe_artists, _dedupe_tracks
from app.models import Artist, Track
from app.providers import deezer, itunes, spotify


def _track(title: str, artist: str, source: str = "apple") -> Track:
    return Track(
        id=f"{source}:{title}", title=title, artist=artist, durationMs=1, source=source, sourceUrl="x"
    )


class TestUrlParsing:
    @pytest.mark.parametrize(
        "url,expected",
        [
            ("https://open.spotify.com/album/1A2B3c", ("album", "1A2B3c")),
            ("https://open.spotify.com/playlist/37i9dQ", ("playlist", "37i9dQ")),
            ("https://open.spotify.com/track/abc123?si=xyz", ("track", "abc123")),
            # لینکی که اپ موبایل می‌سازد، بخش زبان دارد
            ("https://open.spotify.com/intl-fa/album/xyz", ("album", "xyz")),
        ],
    )
    def test_spotify(self, url, expected):
        assert spotify.parse_url(url) == expected

    def test_spotify_rejects_other_hosts(self):
        assert spotify.parse_url("https://example.com/album/1") is None

    @pytest.mark.parametrize(
        "url,expected",
        [
            ("https://www.deezer.com/album/12345", ("album", "12345")),
            ("https://www.deezer.com/fa/playlist/999", ("playlist", "999")),
            ("https://www.deezer.com/en/artist/42", ("artist", "42")),
        ],
    )
    def test_deezer(self, url, expected):
        assert deezer.parse_url(url) == expected

    def test_apple(self):
        assert itunes.parse_url(
            "https://music.apple.com/us/album/mard-e-tanha/1801042661?i=1801042670"
        ) == ("album", "1801042661")
        assert itunes.parse_url("https://music.apple.com/us/artist/farhad/500") == (
            "artist",
            "500",
        )


class TestInternalIds:
    @pytest.mark.parametrize(
        "ident",
        ["itunes:album:1", "deezer:playlist:2", "sp:track:abc", "yt:track:dQw4", "sc:track:x"],
    )
    def test_accepted(self, ident):
        assert ID.match(ident)

    @pytest.mark.parametrize("ident", ["spotify:album:1", "itunes:banana:1", "just-a-string"])
    def test_rejected(self, ident):
        assert ID.match(ident) is None


class TestArtwork:
    def test_size_is_rewritten(self):
        url = "https://is1.mzstatic.com/image/thumb/x/100x100bb.jpg"
        assert itunes.artwork(url, 600).endswith("600x600bb.jpg")

    def test_none_stays_none(self):
        assert itunes.artwork(None) is None


class TestDedupe:
    def test_tracks_keep_first_occurrence(self):
        rows = [_track("Barf", "Farhad"), _track("barf", "FARHAD", "deezer")]
        assert [t.source for t in _dedupe_tracks(rows)] == ["apple"]

    def test_artists_prefer_the_one_with_a_photo(self):
        """اپل عکس هنرمند نمی‌دهد و دیزر می‌دهد — کارت بدون عکس باید کنار برود."""
        apple = Artist(
            id="itunes:artist:1", name="Farhad Mehrad", artworkUrl=None,
            source="apple", sourceUrl="x", subtitle="Pop",
        )
        deez = Artist(
            id="deezer:artist:2", name="farhad mehrad", artworkUrl="http://img",
            source="deezer", sourceUrl="y", subtitle="۵ آلبوم",
        )
        merged = _dedupe_artists([apple, deez])
        assert len(merged) == 1
        assert merged[0].artworkUrl == "http://img"

    def test_artists_with_different_names_both_survive(self):
        def make(i, name):
            return Artist(
                id=f"a{i}", name=name, artworkUrl=None, source="apple",
                sourceUrl="x", subtitle="",
            )

        assert len(_dedupe_artists([make(1, "A"), make(2, "B")])) == 2


class TestSpotifyMapping:
    def test_track_row_becomes_track(self):
        row = {
            "id": "abc",
            "name": "Barf",
            "duration_ms": 240_000,
            "explicit": True,
            "artists": [{"name": "Farhad"}, {"name": "Guest"}],
            "album": {"id": "alb", "name": "Barf", "images": [{"url": "http://i"}]},
            "external_urls": {"spotify": "http://open"},
        }
        t = spotify._track(row)
        assert t.id == "sp:track:abc"
        assert t.artist == "Farhad, Guest"
        assert t.albumId == "sp:album:alb"
        assert t.source == "spotify"
        assert t.explicit is True

    def test_missing_id_yields_none(self):
        assert spotify._track({}) is None
