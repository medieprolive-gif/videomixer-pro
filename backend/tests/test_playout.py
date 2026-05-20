"""
Tests for /api/schedule (playout timeline) endpoints + /api/rooms/{room}/settings.
Covers create/get/patch/delete CRUD with persistence verification, plus auth checks.
"""
import io
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
).rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = os.environ.get("KK_TEST_PASSWORD", "kino123")


def _png_bytes() -> bytes:
    # Minimal 1x1 PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
        "890000000d4944415478da63f8cf00000003000100182d3e6e0000000049454e"
        "44ae426082"
    )


def _mp4_bytes(n: int = 2048) -> bytes:
    ftyp = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    pad = (b"KK" * ((n - len(ftyp)) // 2 + 1))[: n - len(ftyp)]
    return ftyp + pad


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(session):
    r = session.post(f"{API}/auth/login", json={"password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def video_id(session, auth):
    """Upload a short video that can be referenced in schedule items."""
    files = {"file": (f"TEST_playout_{uuid.uuid4().hex}.mp4", _mp4_bytes(), "video/mp4")}
    r = session.post(f"{API}/videos/upload", files=files, headers=auth)
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    yield vid
    session.delete(f"{API}/videos/{vid}", headers=auth)


@pytest.fixture(scope="module")
def image_id(session, auth):
    """Upload an image to be used as pre_plakat / global_bumper."""
    files = {"file": (f"TEST_plakat_{uuid.uuid4().hex}.png", _png_bytes(), "image/png")}
    r = session.post(f"{API}/videos/upload", files=files, headers=auth)
    assert r.status_code == 200, r.text
    iid = r.json()["id"]
    yield iid
    session.delete(f"{API}/videos/{iid}", headers=auth)


# ---------- Schedule CRUD ----------
class TestScheduleCRUD:
    def test_list_schedule_room_default(self, session):
        r = session.get(f"{API}/schedule", params={"room": "default"})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_requires_auth(self, session, video_id):
        when = (datetime.now(timezone.utc) + timedelta(days=2, hours=1)).isoformat()
        r = session.post(
            f"{API}/schedule",
            json={"room": "default", "scheduled_at": when, "media_id": video_id},
        )
        assert r.status_code == 401

    def test_create_unknown_media_404(self, session, auth):
        when = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        r = session.post(
            f"{API}/schedule",
            json={"room": "default", "scheduled_at": when, "media_id": "does-not-exist"},
            headers=auth,
        )
        assert r.status_code == 404

    def test_create_then_get_persists(self, session, auth, video_id, image_id):
        when_dt = datetime.now(timezone.utc) + timedelta(days=3, hours=2, minutes=15)
        when = when_dt.isoformat()
        payload = {
            "room": "default",
            "scheduled_at": when,
            "media_id": video_id,
            "title": "TEST_Playout Title",
            "next_up_text": "Coming up next!",
            "pre_plakat_id": image_id,
            "pre_plakat_duration": 7,
        }
        r = session.post(f"{API}/schedule", json=payload, headers=auth)
        assert r.status_code == 200, r.text
        body = r.json()
        sid = body["id"]
        try:
            assert body["media_id"] == video_id
            assert body["title"] == "TEST_Playout Title"
            assert body["next_up_text"] == "Coming up next!"
            assert body["pre_plakat_id"] == image_id
            assert abs(body["pre_plakat_duration"] - 7) < 0.01
            assert body["status"] == "scheduled"
            assert body["room"] == "default"
            # Now GET to verify persistence
            r2 = session.get(f"{API}/schedule", params={"room": "default"})
            assert r2.status_code == 200
            ids = [x["id"] for x in r2.json()]
            assert sid in ids
        finally:
            session.delete(f"{API}/schedule/{sid}", headers=auth)

    def test_patch_updates_text_and_persists(self, session, auth, video_id):
        when = (datetime.now(timezone.utc) + timedelta(days=4)).isoformat()
        r = session.post(
            f"{API}/schedule",
            json={"room": "default", "scheduled_at": when, "media_id": video_id, "title": "TEST_Edit"},
            headers=auth,
        )
        assert r.status_code == 200
        sid = r.json()["id"]
        try:
            r2 = session.patch(
                f"{API}/schedule/{sid}",
                json={"next_up_text": "Updated next-up", "title": "TEST_Edit_v2"},
                headers=auth,
            )
            assert r2.status_code == 200, r2.text
            data = r2.json()
            assert data["next_up_text"] == "Updated next-up"
            assert data["title"] == "TEST_Edit_v2"

            # Verify persistence via list
            lr = session.get(f"{API}/schedule", params={"room": "default"})
            entry = next((x for x in lr.json() if x["id"] == sid), None)
            assert entry is not None
            assert entry["next_up_text"] == "Updated next-up"
            assert entry["title"] == "TEST_Edit_v2"
        finally:
            session.delete(f"{API}/schedule/{sid}", headers=auth)

    def test_delete_removes_item(self, session, auth, video_id):
        when = (datetime.now(timezone.utc) + timedelta(days=5)).isoformat()
        r = session.post(
            f"{API}/schedule",
            json={"room": "default", "scheduled_at": when, "media_id": video_id, "title": "TEST_Delete"},
            headers=auth,
        )
        sid = r.json()["id"]
        d = session.delete(f"{API}/schedule/{sid}", headers=auth)
        assert d.status_code == 200
        assert d.json().get("ok") is True
        # Verify gone
        lr = session.get(f"{API}/schedule", params={"room": "default"})
        assert sid not in [x["id"] for x in lr.json()]

    def test_delete_unknown_404(self, session, auth):
        r = session.delete(f"{API}/schedule/{uuid.uuid4().hex}", headers=auth)
        assert r.status_code == 404

    def test_patch_unknown_404(self, session, auth):
        r = session.patch(
            f"{API}/schedule/{uuid.uuid4().hex}",
            json={"title": "x"},
            headers=auth,
        )
        assert r.status_code == 404

    def test_delete_requires_auth(self, session):
        r = session.delete(f"{API}/schedule/{uuid.uuid4().hex}")
        assert r.status_code == 401


# ---------- Room settings ----------
class TestRoomSettings:
    def test_get_default_settings(self, session):
        r = session.get(f"{API}/rooms/default/settings")
        assert r.status_code == 200
        body = r.json()
        assert body["room"] == "default"
        assert "global_bumper_id" in body
        assert "global_bumper_duration" in body

    def test_put_requires_auth(self, session):
        r = session.put(
            f"{API}/rooms/default/settings",
            json={"room": "default", "global_bumper_id": None, "global_bumper_duration": 5},
        )
        assert r.status_code == 401

    def test_put_then_get_persists(self, session, auth, image_id):
        # Save with image as bumper
        r = session.put(
            f"{API}/rooms/default/settings",
            json={"room": "default", "global_bumper_id": image_id, "global_bumper_duration": 9},
            headers=auth,
        )
        assert r.status_code == 200, r.text
        try:
            assert r.json()["global_bumper_id"] == image_id
            assert abs(r.json()["global_bumper_duration"] - 9) < 0.01
            # Re-fetch
            g = session.get(f"{API}/rooms/default/settings")
            assert g.json()["global_bumper_id"] == image_id
            assert abs(g.json()["global_bumper_duration"] - 9) < 0.01
        finally:
            # Reset
            session.put(
                f"{API}/rooms/default/settings",
                json={"room": "default", "global_bumper_id": None, "global_bumper_duration": 5},
                headers=auth,
            )


# ---------- /api/videos sanity (playout depends on it) ----------
class TestVideosForPlayout:
    def test_list_videos_ok(self, session):
        r = session.get(f"{API}/videos")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
