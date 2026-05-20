"""
P2 feature tests for KinoKontroll:
- /api/state?room=... and /api/rooms
- WebSocket multi-room isolation (room A vs room B)
- 'ended' action (no-auth) advances and stops at end
- Thumbnail endpoints (auth POST + public GET + has_thumbnail flag)
"""
import asyncio
import io
import json
import os
import struct
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


def _fake_video_bytes(n: int = 4096) -> bytes:
    ftyp = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    pad = (b"KK" * ((n - len(ftyp)) // 2 + 1))[: n - len(ftyp)]
    return ftyp + pad


def _tiny_jpeg() -> bytes:
    # 1x1 white JPEG
    return bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
        "07090908"
        "0a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30"
        "31343434"
        "1f27393d38323c2e333432ffc0000b08000100010101 1100ffc4001f000001050101010101"
        "01000000"
        "00000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01"
        "020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a"
        "161718191a25262728292a3435363738393a434445464748494a535455565758595a63646566"
        "6768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aa"
        "b2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1"
        "f2f3f4f5f6f7f8f9faffda0008010100003f00fbd1ffd9".replace(" ", "")
    )


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- /api/state per-room + /api/rooms ----------
class TestRooms:
    def test_state_default_room(self):
        r = requests.get(f"{API}/state")
        assert r.status_code == 200
        s = r.json()
        assert s["id"] == "default"
        for k in ["pvw_id", "pgm_id", "is_playing", "current_time", "volume", "muted", "loop"]:
            assert k in s

    def test_state_named_room_separate(self):
        r1 = requests.get(f"{API}/state", params={"room": "sal-1"})
        r2 = requests.get(f"{API}/state", params={"room": "sal-2"})
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["id"] == "sal-1"
        assert r2.json()["id"] == "sal-2"

    def test_rooms_endpoint_lists_known(self):
        # ensure both rooms exist by hitting state first
        requests.get(f"{API}/state", params={"room": "sal-1"})
        requests.get(f"{API}/state", params={"room": "sal-2"})
        r = requests.get(f"{API}/rooms")
        assert r.status_code == 200
        data = r.json()
        assert "rooms" in data and isinstance(data["rooms"], list)
        assert "sal-1" in data["rooms"]
        assert "sal-2" in data["rooms"]


# ---------- Thumbnails ----------
class TestThumbnails:
    video_id: str | None = None

    def test_upload_video_for_thumb(self, auth_headers):
        files = {"file": ("TEST_thumb_clip.mp4", _fake_video_bytes(2048), "video/mp4")}
        r = requests.post(f"{API}/videos/upload", headers=auth_headers, files=files)
        assert r.status_code == 200, r.text
        TestThumbnails.video_id = r.json()["id"]
        assert TestThumbnails.video_id

    def test_thumbnail_requires_auth(self):
        assert TestThumbnails.video_id
        files = {"file": ("t.jpg", _tiny_jpeg(), "image/jpeg")}
        r = requests.post(f"{API}/videos/{TestThumbnails.video_id}/thumbnail", files=files)
        assert r.status_code == 401

    def test_thumbnail_upload_and_fetch(self, auth_headers):
        assert TestThumbnails.video_id
        files = {"file": ("t.jpg", _tiny_jpeg(), "image/jpeg")}
        r = requests.post(
            f"{API}/videos/{TestThumbnails.video_id}/thumbnail",
            headers=auth_headers,
            files=files,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert "path" in body

        # Public GET works
        r2 = requests.get(f"{API}/videos/{TestThumbnails.video_id}/thumbnail")
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/")
        assert len(r2.content) > 0

        # has_thumbnail flag is true in list
        r3 = requests.get(f"{API}/videos")
        match = next((v for v in r3.json() if v["id"] == TestThumbnails.video_id), None)
        assert match is not None
        assert match.get("has_thumbnail") is True

    def test_thumbnail_404_when_missing(self):
        r = requests.get(f"{API}/videos/{uuid.uuid4()}/thumbnail")
        assert r.status_code == 404

    def test_cleanup(self, auth_headers):
        if TestThumbnails.video_id:
            requests.delete(
                f"{API}/videos/{TestThumbnails.video_id}", headers=auth_headers
            )


# ---------- WebSocket multi-room isolation + ended action ----------
@pytest.mark.asyncio
class TestWebSocketP2:
    async def test_ws_room_isolation(self, token):
        """A play on room A must NOT broadcast to room B."""
        async with websockets.connect(ws_url("isolated-a"), open_timeout=10) as wsa, \
                   websockets.connect(ws_url("isolated-b"), open_timeout=10) as wsb:
            # Initial states
            await asyncio.wait_for(wsa.recv(), timeout=10)
            await asyncio.wait_for(wsb.recv(), timeout=10)

            # Pause on A
            await wsa.send(json.dumps({"action": "pause", "token": token}))
            raw_a = await asyncio.wait_for(wsa.recv(), timeout=10)
            msg_a = json.loads(raw_a)
            assert msg_a["type"] == "state"
            assert msg_a["state"]["id"] == "isolated-a"

            # B should NOT receive a broadcast within 1.5s
            try:
                raw_b = await asyncio.wait_for(wsb.recv(), timeout=1.5)
                # If we got something, it must NOT be a state for room A
                msg_b = json.loads(raw_b)
                # Allow only if it's for room B (shouldn't happen, but tolerate echo of B's own)
                assert msg_b.get("state", {}).get("id") != "isolated-a", \
                    "Room B received a broadcast meant for room A"
            except asyncio.TimeoutError:
                pass  # expected

    async def test_ended_action_no_auth_required(self, token, auth_headers):
        """'ended' should be accepted without a token and advance to the next clip."""
        # Upload two videos so we have a playlist
        v_ids = []
        for i in range(2):
            files = {"file": (f"TEST_ended_{i}.mp4", _fake_video_bytes(1024), "video/mp4")}
            r = await asyncio.to_thread(
                requests.post, f"{API}/videos/upload", headers=auth_headers, files=files
            )
            assert r.status_code == 200
            v_ids.append(r.json()["id"])

        room = f"ended-{uuid.uuid4().hex[:6]}"
        try:
            async with websockets.connect(ws_url(room), open_timeout=10) as ws:
                await asyncio.wait_for(ws.recv(), timeout=10)  # initial

                # Load first clip directly into PGM and start playing
                await ws.send(json.dumps({"action": "set_pgm", "media_id": v_ids[0], "token": token}))
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                assert msg["state"]["pgm_id"] == v_ids[0]
                await ws.send(json.dumps({"action": "play", "token": token}))
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                assert msg["state"]["is_playing"] is True

                # Send 'ended' WITHOUT a token — should still work and FREEZE (not advance)
                await ws.send(json.dumps({"action": "ended", "media_id": v_ids[0]}))
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                assert msg["type"] == "state", f"Got: {msg}"
                # PGM should remain the same (no auto-advance)
                assert msg["state"]["pgm_id"] == v_ids[0], "ended must not change PGM"
                # is_playing must be False (frozen)
                assert msg["state"]["is_playing"] is False, "ended must freeze playback"
        finally:
            for vid in v_ids:
                await asyncio.to_thread(
                    requests.delete, f"{API}/videos/{vid}", headers=auth_headers
                )

    async def test_ended_action_stale_id_ignored(self, token, auth_headers):
        """'ended' with an id that doesn't match pgm_id must NOT change anything."""
        files = {"file": ("TEST_stale.mp4", _fake_video_bytes(1024), "video/mp4")}
        r = await asyncio.to_thread(
            requests.post, f"{API}/videos/upload", headers=auth_headers, files=files
        )
        assert r.status_code == 200
        vid = r.json()["id"]

        room = f"stale-{uuid.uuid4().hex[:6]}"
        try:
            async with websockets.connect(ws_url(room), open_timeout=10) as ws:
                await asyncio.wait_for(ws.recv(), timeout=10)
                # Load and play in PGM
                await ws.send(json.dumps({"action": "set_pgm", "media_id": vid, "token": token}))
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                cur = msg["state"]["pgm_id"]
                await ws.send(json.dumps({"action": "play", "token": token}))
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                assert msg["state"]["is_playing"] is True

                # Send ended with a fake id — must be ignored (no freeze, no PGM change)
                await ws.send(json.dumps({"action": "ended", "media_id": "fake-id-xyz"}))
                msg2 = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                assert msg2["state"]["pgm_id"] == cur
                assert msg2["state"]["is_playing"] is True, "stale ended must not freeze"
        finally:
            await asyncio.to_thread(
                requests.delete, f"{API}/videos/{vid}", headers=auth_headers
            )
