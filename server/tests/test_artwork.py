"""بزرگ کردن آدرس کاور — هر CDN قاعده‌ی خودش را دارد."""

from __future__ import annotations

import pytest

from app import artwork


class TestApple:
    def test_size_in_the_filename_is_rewritten(self):
        url = "https://is1-ssl.mzstatic.com/image/thumb/Music/abc/source/100x100bb.jpg"

        assert artwork.resized(url, 1400).endswith("/1400x1400bb.jpg")

    def test_png_keeps_its_extension(self):
        url = "https://is1-ssl.mzstatic.com/image/thumb/Music/abc/source/100x100bb.png"

        assert artwork.resized(url, 500).endswith("/500x500bb.png")


class TestDeezer:
    def test_size_is_rewritten_and_quality_options_survive(self):
        url = "https://e-cdns-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg"

        assert artwork.resized(url, 1000) == (
            "https://e-cdns-images.dzcdn.net/images/cover/abc123/1000x1000-000000-80-0-0.jpg"
        )

    def test_size_is_capped_at_what_the_cdn_actually_has(self):
        """بالای ۱۰۰۰ دیزر چیزی ندارد — بزرگ‌شده‌ی همان است، فقط سنگین‌تر."""
        url = "https://e-cdns-images.dzcdn.net/images/cover/abc123/250x250-000000-80-0-0.jpg"

        assert "/1000x1000-" in artwork.resized(url, artwork.EMBED)

    def test_url_without_quality_options_still_works(self):
        url = "https://e-cdns-images.dzcdn.net/images/cover/abc123/250x250.jpg"

        assert artwork.resized(url, 500).endswith("/500x500.jpg")


class TestSoundCloud:
    def test_small_sizes_use_the_fixed_ladder(self):
        url = "https://i1.sndcdn.com/artworks-abc-large.jpg"

        assert artwork.resized(url, 500) == "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"

    def test_beyond_the_ladder_falls_back_to_the_original(self):
        """ساندکلاد اندازه‌ی دلخواه نمی‌سازد؛ بالاتر از ۱۰۸۰ فقط `original` هست."""
        url = "https://i1.sndcdn.com/artworks-abc-large.jpg"

        assert artwork.resized(url, 1400) == "https://i1.sndcdn.com/artworks-abc-original.jpg"

    def test_an_already_upgraded_url_can_be_upgraded_again(self):
        url = "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"

        assert artwork.resized(url, 1400).endswith("-original.jpg")

    @pytest.mark.parametrize(
        ("asked", "step"),
        [(200, 200), (500, 500), (1080, 1080), (50, 50)],
    )
    def test_the_real_steps_are_used_as_is(self, asked, step):
        url = "https://i1.sndcdn.com/artworks-abc-large.jpg"

        assert artwork.resized(url, asked).endswith(f"-t{step}x{step}.jpg")

    @pytest.mark.parametrize("asked", [320, 400, 640, 800, 1000])
    def test_a_size_soundcloud_does_not_have_climbs_to_one_it_does(self, asked):
        """
        ساندکلاد فقط همان چند فایل را دارد و بقیه ۴۰۴ می‌دهند — از جمله
        `t320x320` و `t640x640` که ساختنِ `t{size}x{size}` از روی هر عددی
        تولیدشان می‌کرد. آن ۴۰۴ هم بی‌صدا بود: کاور فقط ناپدید می‌شد، چه در
        thumbnailِ تلگرام و چه در کاورِ امبدشده.
        """
        url = "https://i1.sndcdn.com/artworks-abc-large.jpg"
        got = artwork.resized(url, asked)

        assert got.endswith(".jpg")
        tail = got.rsplit("-", 1)[1].removesuffix(".jpg")
        assert tail == "original" or int(tail.split("x")[0].lstrip("t")) in artwork._SOUNDCLOUD_STEPS

    def test_the_chosen_step_is_never_smaller_than_asked(self):
        """کوچک‌تر یعنی کاورِ تار — و آن تارِ داخل فایل تا ابد می‌ماند."""
        url = "https://i1.sndcdn.com/artworks-abc-large.jpg"

        assert artwork.resized(url, 320).endswith("-t500x500.jpg")
        assert artwork.resized(url, 640).endswith("-t1080x1080.jpg")

    def test_candidates_step_down_through_sizes_that_exist(self):
        """
        `original` روی ترک‌های قدیمی نیست. بدون پله‌ی میانی، نبودنش یعنی سقوط
        یک‌باره از «اصل» به ۵۰۰ — در حالی که `t1080x1080` همان‌جا هست.
        """
        url = "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"

        assert artwork.candidates(url) == [
            "https://i1.sndcdn.com/artworks-abc-original.jpg",
            "https://i1.sndcdn.com/artworks-abc-t1080x1080.jpg",
            "https://i1.sndcdn.com/artworks-abc-t500x500.jpg",
        ]


class TestYouTube:
    def test_youtube_music_cover_is_rewritten(self):
        url = "https://lh3.googleusercontent.com/abc=w544-h544-l90-rj"

        assert artwork.resized(url, 1200) == "https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj"

    def test_video_thumbnail_climbs_to_maxres(self):
        url = "https://i.ytimg.com/vi/abc/hqdefault.jpg"

        assert artwork.resized(url, 1400) == "https://i.ytimg.com/vi/abc/maxresdefault.jpg"

    def test_small_request_stays_on_a_size_that_always_exists(self):
        url = "https://i.ytimg.com/vi/abc/maxresdefault.jpg"

        assert artwork.resized(url, 320) == "https://i.ytimg.com/vi/abc/hqdefault.jpg"


class TestSpotify:
    """
    اسپاتیفای اندازه‌ی دلخواه ندارد؛ کدِ اندازه داخلِ خودِ شناسه‌ی تصویر است و
    فقط چند پله دارد. نشناختنِ این قاعده یعنی همیشه نسخه‌ی ۶۴۰ برمی‌گشت — که
    برای thumbnailِ تلگرام (سقفِ ۲۰۰ کیلوبایت) گاهی بزرگ‌تر از حد مجاز است و
    فایل بی‌کاور فرستاده می‌شد، با اینکه کاور داخلِ خودِ فایل نشسته بود.
    """

    ALBUM = "https://i.scdn.co/image/ab67616d0000b273" + "1" * 24
    ARTIST = "https://i.scdn.co/image/ab6761610000e5eb" + "2" * 24

    def test_a_thumbnail_request_drops_to_the_smaller_step(self):
        assert artwork.resized(self.ALBUM, 200) == self.ALBUM.replace("0000b273", "00001e02")

    def test_the_step_is_never_smaller_than_asked(self):
        """۳۰۰ دقیقاً یک پله است و ۳۰۱ باید برود پله‌ی بالاتر، نه پایین‌تر."""
        assert artwork.resized(self.ALBUM, 300).endswith("00001e02" + "1" * 24)
        assert artwork.resized(self.ALBUM, 301) == self.ALBUM

    def test_beyond_the_largest_step_stays_at_the_largest(self):
        """بالاتر از ۶۴۰ چیزی وجود ندارد — کاورِ امبدشده همان بزرگ‌ترین است."""
        assert artwork.resized(self.ALBUM, artwork.EMBED) == self.ALBUM

    def test_artist_photos_have_their_own_ladder(self):
        """کدِ اندازه‌ی عکسِ هنرمند با کاورِ آلبوم فرق دارد؛ قاطی‌شان ۴۰۴ می‌دهد."""
        assert artwork.resized(self.ARTIST, 200) == self.ARTIST.replace("0000e5eb", "00005174")
        assert artwork.resized(self.ARTIST, artwork.EMBED) == self.ARTIST

    def test_an_unknown_image_kind_is_left_alone(self):
        """پلی‌لیست و بقیه‌ی تصویرها پله‌های دیگری دارند — حدس زدن یعنی ۴۰۴."""
        url = "https://i.scdn.co/image/ab67706c0000da84" + "3" * 24

        assert artwork.resized(url, 200) == url


class TestUnknownHosts:
    def test_an_unrecognized_url_is_left_alone(self):
        """منبع جدید نباید باعث شود کاور کلاً ناپدید شود."""
        url = "https://example.com/cover.jpg"

        assert artwork.resized(url, 1400) == url

    @pytest.mark.parametrize("empty", [None, ""])
    def test_nothing_in_nothing_out(self, empty):
        assert artwork.resized(empty) is None
        assert artwork.candidates(empty) == []


class TestCandidates:
    def test_largest_comes_first_and_the_original_is_the_safety_net(self):
        url = "https://i.ytimg.com/vi/abc/hqdefault.jpg"

        assert artwork.candidates(url) == [
            "https://i.ytimg.com/vi/abc/maxresdefault.jpg",
            "https://i.ytimg.com/vi/abc/hqdefault.jpg",
        ]

    def test_no_duplicates_when_the_steps_collapse(self):
        """
        بزرگ‌ترین پله‌ی اسپاتیفای ۶۴۰ است، پس هم EMBED و هم DISPLAY همان‌جا
        می‌نشینند — یک گزینه بیشتر نداریم.
        """
        url = "https://i.scdn.co/image/ab67616d0000b273" + "0" * 24

        assert artwork.candidates(url) == [url]

    def test_apple_offers_smaller_sizes_as_middle_steps(self):
        stem = "https://is1-ssl.mzstatic.com/image/thumb/Music/abc/source"
        url = f"{stem}/100x100bb.jpg"

        assert artwork.candidates(url) == [
            f"{stem}/{artwork.EMBED}x{artwork.EMBED}bb.jpg",
            f"{stem}/1080x1080bb.jpg",
            f"{stem}/{artwork.DISPLAY}x{artwork.DISPLAY}bb.jpg",
            url,
        ]


class TestAtMost:
    """
    گزینه‌های کاور برای جایی که سقفِ اندازه دارد — thumbnailِ تلگرام.

    بیش از یکی لازم است چون پله‌ی حساب‌شده همیشه روی آن CDN نیست؛ اولین ۴۰۴
    یعنی فایلِ صوتیِ بی‌کاور در تلگرام، با اینکه کاور داخلِ خودِ فایل هست.
    """

    def test_the_computed_step_comes_first_and_the_raw_url_is_the_safety_net(self):
        url = "https://i1.sndcdn.com/artworks-abc-t500x500.jpg"

        assert artwork.at_most(url, 200) == [
            "https://i1.sndcdn.com/artworks-abc-t200x200.jpg",
            url,
        ]

    def test_an_unknown_cdn_collapses_to_the_single_url_it_gave_us(self):
        url = "https://example.com/cover.jpg"

        assert artwork.at_most(url, 200) == [url]

    @pytest.mark.parametrize("empty", [None, ""])
    def test_nothing_in_nothing_out(self, empty):
        assert artwork.at_most(empty, 200) == []
