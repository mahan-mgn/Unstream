"""
امتیازدهی resolver — قلب پروژه و ظریف‌ترین بخشش.

هر عددی که اینجا تست می‌شود یک تصمیم است، نه یک ثابت دلخواه: اگر آستانه‌ها را
جابه‌جا کنی یا نرمال‌سازی فارسی را خراب کنی، خروجی «فایل اشتباه با تگ درست»
می‌شود — بدترین حالت ممکن، چون کاربر متوجه نمی‌شود.
"""

from __future__ import annotations

import pytest

from app.resolver import GOOD_ENOUGH, MIN_SCORE, _normalize, _overlap, _tokens, score_candidate


def score(track, title, uploader="", duration_ms=None):
    return score_candidate(
        track, title, uploader, track.durationMs if duration_ms is None else duration_ms
    )


class TestNormalize:
    def test_arabic_letters_become_persian(self):
        assert _normalize("مهدي كريمي") == _normalize("مهدی کریمی")

    def test_diacritics_are_dropped(self):
        assert _normalize("مُحَمَّد") == "محمد"

    def test_bracketed_parts_are_removed(self):
        assert _normalize("Shabaneh (Live at Vienna)") == "shabaneh"
        assert _normalize("Barf [Remastered]") == "barf"

    def test_punctuation_collapses_to_space(self):
        assert _normalize("Mard-e   Tanha!!") == "mard e tanha"

    def test_tokens_drop_single_characters(self):
        # «e» در «Mard-e Tanha» نویز است و نباید در تطابق وزن بگیرد
        assert _tokens("Mard-e Tanha") == {"mard", "tanha"}


class TestOverlap:
    def test_empty_wanted_is_zero(self):
        assert _overlap(set(), {"a"}) == 0.0

    def test_full_containment_is_one(self):
        assert _overlap({"a", "b"}, {"a", "b", "c"}) == 1.0

    def test_partial(self):
        assert _overlap({"a", "b"}, {"a"}) == 0.5


class TestScoring:
    def test_exact_match_is_confident(self, track):
        result = score(track, "Farhad Mehrad - Mard-e Tanha")
        assert result >= GOOD_ENOUGH

    def test_unrelated_title_falls_below_threshold(self, track):
        assert score(track, "Cooking pasta in 10 minutes", "FoodChannel") < MIN_SCORE

    def test_duration_is_the_strongest_signal(self, track):
        """عنوانِ یکسان ولی طولِ خیلی متفاوت، تقریباً همیشه ترک اشتباه است."""
        same = score(track, "Farhad Mehrad - Mard-e Tanha")
        off = score(track, "Farhad Mehrad - Mard-e Tanha", duration_ms=track.durationMs + 90_000)
        assert same - off == pytest.approx(65, abs=1)  # ۳۰ امتیاز مثبت + ۳۵ منفی

    def test_close_duration_still_scores_well(self, track):
        near = score(track, "Farhad Mehrad - Mard-e Tanha", duration_ms=track.durationMs + 1500)
        assert near >= GOOD_ENOUGH

    def test_missing_duration_is_only_mildly_penalized(self, track):
        assert score(track, "Farhad Mehrad - Mard-e Tanha", duration_ms=0) > MIN_SCORE

    @pytest.mark.parametrize("word", ["live", "cover", "karaoke", "کاور", "ریمیکس"])
    def test_negative_words_are_penalized(self, track, word):
        clean = score(track, "Farhad Mehrad - Mard-e Tanha")
        dirty = score(track, f"Farhad Mehrad - Mard-e Tanha {word}")
        assert dirty < clean

    def test_negative_word_inside_the_real_title_is_not_penalized(self, track):
        """اگر خودِ ترک «Live» نام دارد، جریمه کردنش یعنی هیچ‌وقت پیدایش نکنیم."""
        track.title = "Live and Let Die"
        titled = score(track, f"{track.artist} - Live and Let Die")

        track.title = "Let Die"
        # همان کاندید، ولی حالا «live» کلمه‌ی اضافه‌ای است که در عنوان ترک نیست
        extra = score(track, f"{track.artist} - Live and Let Die")

        assert titled >= GOOD_ENOUGH
        assert titled - extra == pytest.approx(18, abs=0.01)

    def test_official_upload_gets_a_nudge(self, track):
        plain = score(track, "Farhad Mehrad - Mard-e Tanha", "Some Channel")
        official = score(track, "Farhad Mehrad - Mard-e Tanha (Official Audio)", "Some Channel")
        assert official > plain

    def test_persian_query_matches_persian_upload(self):
        from app.models import Track

        fa = Track(
            id="deezer:track:9",
            title="مرد تنها",
            artist="فرهاد مهراد",
            durationMs=185_000,
            source="deezer",
            sourceUrl="x",
        )
        # آپلود با «ي» و «ك» عربی — همان چیزی که در یوتیوب فراوان است
        assert score_candidate(fa, "فرهاد مهراد - مرد تنهاي", "", 185_000) > MIN_SCORE

    def test_artist_in_channel_name_counts(self, track):
        """کانال‌های Topic عنوانِ خالی دارند و نام هنرمند فقط در uploader است."""
        with_channel = score(track, "Mard-e Tanha", "Farhad Mehrad - Topic")
        without = score(track, "Mard-e Tanha", "Random Uploads")
        assert with_channel > without
