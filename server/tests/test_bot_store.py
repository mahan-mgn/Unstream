"""
تست‌های کشِ قدیمیِ بات (`store`) — که حالا فقط خواندنِ ردیف‌ها برای مهاجرت و
خالی‌کردنشان بعد از موفقیت را نگه داشته است. SQLite واقعی روی فایلِ موقت،
بدون شبکه و بدون mock.
"""

from __future__ import annotations

import time

import pytest

from app.bot import store


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    """هر تست دیتابیسِ خودش را دارد — ردیفِ تستِ قبلی نباید دیده شود."""
    monkeypatch.setattr(store, "BOT_DB_PATH", tmp_path / "bot.db")
    yield
    store.close()


def _seed(chat_id: int, artist_id: str, name: str) -> None:
    """درجِ مستقیم — خودِ `add` عمداً حذف شده تا مسیرِ نوشتن یکی بماند (سرور)."""
    conn = store._db()
    conn.execute(
        """INSERT INTO follows
           (chat_id, artist_id, artist_name, artist_source_url, source,
            artwork_url, last_release_id, last_release_title, created_at)
           VALUES (?, ?, ?, ?, 'spotify', NULL, 'a1', 'Album One', ?)""",
        (chat_id, artist_id, name, "https://open.spotify.com/artist/x", time.time()),
    )
    conn.commit()


class TestAllFollows:
    def test_returns_follows_across_every_chat(self):
        _seed(1, "sp:artist:1", "Farhad")
        _seed(2, "sp:artist:2", "Dariush")
        names = {f.artist_name for f in store.all_follows()}
        assert names == {"Farhad", "Dariush"}

    def test_empty_when_no_legacy_rows(self):
        assert store.all_follows() == []

    def test_row_maps_to_legacy_fields(self):
        _seed(7, "sp:artist:1", "Farhad")
        [f] = store.all_follows()
        assert f.chat_id == 7
        assert f.artist_id == "sp:artist:1"
        assert f.last_release_id == "a1"
        assert f.last_release_title == "Album One"


class TestClearAll:
    def test_empties_the_legacy_table(self):
        _seed(1, "sp:artist:1", "Farhad")
        store.clear_all()
        assert store.all_follows() == []

    def test_clearing_twice_is_fine(self):
        store.clear_all()
        store.clear_all()
