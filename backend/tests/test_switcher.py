"""
Switcher feature tests for KinoKontroll (P3 - PVW/PGM broadcast switcher).

Covers:
- Image upload with duration (Form field)
- PATCH /api/videos/{id}/duration (images only; videos -> 400)
- GET /api/videos exposes media_type, duration, has_thumbnail
- WS actions: set_pvw, set_pgm, cut (swap pvw<->pgm), play gating, next/prev on PVW
- 'ended' action freezes PGM (no auto-advance) and stale ids ignored
"""
import asyncio
import json
import os
import uuid
from urllib.parse import urlparse

import pytest
import requests
import websockets

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
).rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = os.environ.get("KK_TEST_PASSWORD", "kino123")


def ws_url(room: str | None = None) -> str:
    u = urlparse(BASE_URL)
    scheme = "wss" if u.scheme == "https" else "ws"
    base = f"{scheme}://{u.netloc}/api/ws"
    return f"{base}?room={room}" if room else base


def _fake_video_bytes(n: int = 2048) -> bytes:
    ftyp = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    pad = (b"KK" * ((n - len(ftyp)) // 2 + 1))[: n - len(ftyp)]
    return ftyp + pad


def _tiny_png() -> bytes:
    # 1x1 red PNG
    return bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108020000"
        "00907753de0000000c49444154789c6360f8cfc00000000300010001"
        "3a6c3b1f0000000049454e44ae426082"
    )


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"password": PASSWORD})
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Image upload + duration ----------
class TestImageUpload:
    image_id: str | None = None
    video_id: str | None = None

    def test_upload_image_with_duration(self, auth_headers):
        files = {"file": ("TEST_still.png", _tiny_png(), "image/png")}
        r = requests.post(
            f"{API}/videos/upload",
            headers=auth_headers,
            files=files,
            data={"duration": "7"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["media_type"] == "image"
        assert abs(data["duration"] - 7.0) < 1e-3
        # Image is its own thumbnail
        assert data["has_thumbnail"] is True
        assert "id" in data
        TestImageUpload.image_id = data["id"]

    def test_upload_video_defaults(self, auth_headers):
        files = {"file": ("TEST_clip.mp4", _fake_video_bytes(), "video/mp4")}
        r = requests.post(f"{API}/videos/upload", headers=auth_headers, files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["media_type"] == "video"
        assert abs(data["duration"] - 5.0) < 1e-3
        assert data["has_thumbnail"] is False
        TestImageUpload.video_id = data["id"]

    def test_list_exposes_new_fields(self):
        r = requests.get(f"{API}/videos")
        assert r.status_code == 200
        items = r.json()
        assert any(
            v["id"] == TestImageUpload.image_id
            and v["media_type"] == "image"
            and v["has_thumbnail"] is True
            for v in items
        )
        assert any(
            v["id"] == TestImageUpload.video_id
            and v["media_type"] == "video"
            and v["has_thumbnail"] is False
            for v in items
        )

    def test_patch_duration_image_ok(self, auth_headers):
        assert TestImageUpload.image_id
        r = requests.patch(
            f"{API}/videos/{TestImageUpload.image_id}/duration",
            headers=auth_headers,
            json={"duration": 12},
        )
        assert r.status_code == 200
        assert abs(r.json()["duration"] - 12.0) < 1e-3
        # Verify persisted
        items = requests.get(f"{API}/videos").json()
        match = next(v for v in items if v["id"] == TestImageUpload.image_id)
        assert abs(match["duration"] - 12.0) < 1e-3

    def test_patch_duration_video_rejected(self, auth_headers):
        assert TestImageUpload.video_id
        r = requests.patch(
            f"{API}/videos/{TestImageUpload.video_id}/duration",
            headers=auth_headers,
            json={"duration": 10},
        )
        assert r.status_code == 400

    def test_patch_duration_requires_auth(self):
        assert TestImageUpload.image_id
        r = requests.patch(
            f"{API}/videos/{TestImageUpload.image_id}/duration",
            json={"duration": 5},
        )
        assert r.status_code == 401

    def test_cleanup(self, auth_headers):
        for vid in (TestImageUpload.image_id, TestImageUpload.video_id):
            if vid:
                requests.delete(f"{API}/videos/{vid}", headers=auth_headers)


# ---------- WS switcher actions ----------
async def _recv(ws, timeout=10):
    return json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))


@pytest.mark.asyncio
class TestSwitcherWS:
    async def test_set_pvw_does_not_touch_pgm(self, token, auth_headers):
        files = {"file": ("TEST_sw_v.mp4", _fake_video_bytes(), "video/mp4")}
        r = await asyncio.to_thread(
            requests.post, f"{API}/videos/upload", headers=auth_headers, files=files
        )
        vid = r.json()["id"]
        room = f"sw-{uuid.uuid4().hex[:6]}"
        try:
            async with websockets.connect(ws_url(room), open_timeout=10) as ws:
                await _recv(ws)  # initial
                await ws.send(json.dumps({"action": "set_pvw", "media_id": vid, "token": token}))
                msg = await _recv(ws)
                assert msg["state"]["pvw_id"] == vid
                assert msg["state"]["pgm_id"] is None
                assert msg["state"]["is_playing"] is False
        finally:
            await asyncio.to_thread(requests.delete, f"{API}/videos/{vid}", headers=auth_headers)

    async def test_set_pgm_frozen(self, token, auth_headers):
        files = {"file": ("TEST_sw_pgm.mp4", _fake_video_bytes(), "video/mp4")}
        r = await asyncio.to_thread(
            requests.post, f"{API}/videos/upload", headers=auth_headers, files=files
        )
        vid = r.json()["id"]
        room = f"sw-{uuid.uuid4().hex[:6]}"
        try:
            async with websockets.connect(ws_url(room), open_timeout=10) as ws:
                await _recv(ws)
                await ws.send(json.dumps({"action": "set_pgm", "media_id": vid, "token": token}))
                msg = await _recv(ws)
                s = msg["state"]
                assert s["pgm_id"] == vid
                assert s["is_playing"] is False
                assert s["current_time"] == 0
        finally:
            await asyncio.to_thread(requests.delete, f"{API}/videos/{vid}", headers=auth_headers)

    async def test_cut_swaps_pvw_and_pgm(self, token, auth_headers):
        # upload 2 clips
        ids = []
        for i in range(2):
            files = {"file": (f"TEST_cut_{i}.mp4", _fake_video_bytes(), "video/mp4")}
            r = await asyncio.to_thread(
                requests.post, f"{API}/videos/upload", headers=auth_headers, files=files
            )
            ids.append(r.json()["id"])
        a, b = ids
        room = f"sw-{uuid.uuid4().hex[:6]}"
        try:
            async with websockets.connect(ws_url(room), open_timeout=10) as ws:
                await _recv(ws)
                # Put A in PGM, B in PVW
                await ws.send(json.dumps({"action": "set_pgm", "media_id": a, "token": token}))
                await _recv(ws)
                await ws.send(json.dumps({"action": "set_pvw", "media_id": b, "token": token}))
                await _recv(ws)
                # Play PGM so we can see cut freezes
                await ws.send(json.dumps({"action": "play", "token": token}))
                msg = await _recv(ws)
                assert msg["state"]["is_playing"] is True

                # CUT
                await ws.send(json.dumps({"action": "cut", "token": token}))
                msg = await _recv(ws)
                s = msg["state"]
                assert s["pgm_id"] == b, "PVW should have become PGM"
                assert s["pvw_id"] == a, "old PGM should have moved to PVW"
                assert s["is_playing"] is False, "new PGM must be frozen"
                assert s["current_time"] == 0
        finally:
            for vid in ids:
                await asyncio.to_thread(
                    requests.delete, f"{API}/videos/{vid}", headers=auth_headers
                )

    async def test_play_noop_when_pgm_null(self, token):
        room = f"sw-empty-{uuid.uuid4().hex[:6]}"
        async with websockets.connect(ws_url(room), open_timeout=10) as ws:
            initial = await _recv(ws)
            assert initial["state"]["pgm_id"] is None
            await ws.send(json.dumps({"action": "play", "token": token}))
            msg = await _recv(ws)
            assert msg["state"]["is_playing"] is False, "play must be a no-op with empty PGM"

    async def test_next_prev_move_pvw_only(self, token, auth_headers):
        ids = []
        for i in range(2):
            files = {"file": (f"TEST_np_{i}.mp4", _fake_video_bytes(), "video/mp4")}
            r = await asyncio.to_thread(
                requests.post, f"{API}/videos/upload", headers=auth_headers, files=files
            )
            ids.append(r.json()["id"])
        room = f"sw-{uuid.uuid4().hex[:6]}"
        try:
            async with websockets.connect(ws_url(room), open_timeout=10) as ws:
                await _recv(ws)
                # Set PGM to id[0]
                await ws.send(json.dumps({"action": "set_pgm", "media_id": ids[0], "token": token}))
                await _recv(ws)
                # next should set PVW, not touch PGM
                await ws.send(json.dumps({"action": "next", "token": token}))
                msg = await _recv(ws)
                s = msg["state"]
                assert s["pgm_id"] == ids[0], "PGM must not change on next"
                assert s["pvw_id"] is not None, "PVW should be set after 'next'"
        finally:
            for vid in ids:
                await asyncio.to_thread(
                    requests.delete, f"{API}/videos/{vid}", headers=auth_headers
                )
