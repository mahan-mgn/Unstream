"""
دنبال‌کردنِ هنرمند از سمتِ وب — `/api/follows`.

ردیف‌ها در دیتابیسِ سرور می‌نشینند (نه bot.db) تا هم وب بتواند هنرمند دنبال
کند و هم باتِ پس‌زمینه همان‌ها را بخواند. مقصدِ اطلاع‌رسانی چتِ وصل‌شده است،
پس `chatId` روی هر ردیف می‌نشیند.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import reach
from app.main import app

ARTIST = {
    "artistId": "deezer:artist:1",
    "artistName": "Farhad Mehrad",
    "artistSourceUrl": "https://www.deezer.com/artist/1",
    "source": "deezer",
    "artworkUrl": "https://e-cdns-images.dzcdn.net/images/artist/x/1000x1000-000000.jpg",
    "lastReleaseId": "deezer:album:9",
    "lastReleaseTitle": "Akhbar-e Etemad",
}


@pytest.fixture
def client(fresh_db, monkeypatch):
    monkeypatch.setattr(reach, "REACH_PROBES", ())
    with TestClient(app) as c:
        yield c


class TestAdd:
    def test_first_follow_is_created(self, client):
        res = client.post("/api/follows", params={"chatId": 1}, json=ARTIST)
        assert res.status_code == 200
        body = res.json()
        assert body["followed"] is True
        assert body["created"] is True
        assert body["follow"]["artistName"] == "Farhad Mehrad"
        # seedِ آخرین انتشار می‌آید، وگرنه اولین چکِ بات تاریخچه را اسپم می‌کند
        assert body["follow"]["lastReleaseId"] == "deezer:album:9"

    def test_second_follow_of_same_artist_is_not_an_error(self, client):
        client.post("/api/follows", params={"chatId": 1}, json=ARTIST)
        body = client.post("/api/follows", params={"chatId": 1}, json=ARTIST).json()
        assert body["followed"] is True
        assert body["created"] is False

    def test_same_artist_from_another_chat_is_its_own_row(self, client):
        client.post("/api/follows", params={"chatId": 1}, json=ARTIST)
        body = client.post("/api/follows", params={"chatId": 2}, json=ARTIST).json()
        assert body["created"] is True
        assert len(client.get("/api/follows").json()) == 2


class TestList:
    def test_filters_by_chat(self, client):
        client.post("/api/follows", params={"chatId": 1}, json=ARTIST)
        client.post(
            "/api/follows",
            params={"chatId": 2},
            json={**ARTIST, "artistId": "deezer:artist:2", "artistName": "Dariush"},
        )
        names = {f["artistName"] for f in client.get("/api/follows", params={"chatId": 1}).json()}
        assert names == {"Farhad Mehrad"}

    def test_no_chat_returns_everything(self, client):
        client.post("/api/follows", params={"chatId": 1}, json=ARTIST)
        assert len(client.get("/api/follows").json()) == 1


class TestState:
    def test_unfollowed_artist_reports_false(self, client):
        body = client.get(
            "/api/follows/state", params={"chatId": 1, "artistId": "deezer:artist:1"}
        ).json()
        assert body["followed"] is False
        assert body["follow"] is None

    def test_followed_in_another_chat_does_not_leak(self, client):
        client.post("/api/follows", params={"chatId": 9}, json=ARTIST)
        body = client.get(
            "/api/follows/state", params={"chatId": 1, "artistId": "deezer:artist:1"}
        ).json()
        assert body["followed"] is False


class TestRemove:
    def test_removes_only_that_chats_row(self, client):
        client.post("/api/follows", params={"chatId": 1}, json=ARTIST)
        client.post("/api/follows", params={"chatId": 2}, json=ARTIST)
        res = client.delete(
            "/api/follows", params={"chatId": 1, "artistId": ARTIST["artistId"]}
        )
        assert res.json() == {"ok": True}
        assert len(client.get("/api/follows").json()) == 1

    def test_missing_row_returns_false(self, client):
        res = client.delete(
            "/api/follows", params={"chatId": 1, "artistId": "deezer:artist:nope"}
        )
        assert res.json() == {"ok": False}


class TestMarkSeen:
    def test_updates_the_stored_latest_release(self, client):
        follow = client.post("/api/follows", params={"chatId": 1}, json=ARTIST).json()["follow"]
        res = client.patch(
            "/api/follows/seen",
            params={"id": follow["id"], "releaseId": "deezer:album:10", "releaseTitle": "Novin"},
        )
        assert res.json() == {"ok": True}
        [row] = client.get("/api/follows", params={"chatId": 1}).json()
        assert row["lastReleaseId"] == "deezer:album:10"
        assert row["lastReleaseTitle"] == "Novin"
