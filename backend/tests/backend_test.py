"""
Backend regression tests for KinoKontroll.
Covers: auth, video CRUD + range streaming, playback state, and WebSocket sync.
"""
import asyncio
import io
import json
import os
import struct
import uuid

import pytest
import requests
import websockets
from urllib.parse import urlparse

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"
PASSWORD = "kino123"


def ws_url() -> str:
    u = urlparse(BASE_URL)
    scheme = "wss" if u.scheme == "https" else "ws"
    return f"{scheme}://{u.netloc}/api/ws"


# ---- Minimal-looking "video" bytes: not actually decodable but backend only stores/streams bytes ----
def _fake_video_bytes(n: int = 2048) -> bytes:
    # ftyp + random payload
    ftyp = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    pad = (b"KK" * ((n - len(ftyp)) // 2 + 1))[: n - len(ftyp)]
    return ftyp + pad


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def token(session):
    r = session.post(f"{API}/auth/login", json={"password": PASSWORD})
    assert r.status_code == 200, r.text
    t = r.json().get("token")
    assert t
    return t


@pytest.fixture(scope="session")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- Auth ----------
class TestAuth:
    def test_login_success(self, session):
        r = session.post(f"{API}/auth/login", json={"password": PASSWORD})
        assert r.status_code == 200
        data = r.json()
        assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 10

    def test_login_wrong_password(self, session):
        r = session.post(f"{API}/auth/login", json={"password": "wrong"})
        assert r.status_code == 401

    def test_verify_with_token(self, session, auth_headers):
        r = session.get(f"{API}/auth/verify", headers=auth_headers)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_verify_without_token(self, session):
        r = requests.get(f"{API}/auth/verify")
        assert r.status_code == 401


# ---------- Playback state ----------
class TestState:
    def test_default_state(self):
        r = requests.get(f"{API}/state")
        assert r.status_code == 200
        s = r.json()
        for k in ["pvw_id", "pgm_id", "is_playing", "current_time", "volume", "muted", "loop"]:
            assert k in s


# ---------- Videos CRUD + stream ----------
class TestVideos:
    uploaded_id = None

    def test_list_videos_public(self):
        r = requests.get(f"{API}/videos")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_upload_requires_auth(self):
        files = {"file": ("TEST_clip.mp4", _fake_video_bytes(), "video/mp4")}
        r = requests.post(f"{API}/videos/upload", files=files)
        assert r.status_code == 401

    def test_upload_success_and_visible(self, auth_headers):
        files = {"file": ("TEST_clip.mp4", _fake_video_bytes(4096), "video/mp4")}
        r = requests.post(f"{API}/videos/upload", headers=auth_headers, files=files)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["filename"] == "TEST_clip.mp4"
        assert data["content_type"].startswith("video/")
        assert data["size"] > 0
        assert "id" in data
        TestVideos.uploaded_id = data["id"]

        # Verify listing contains it
        r2 = requests.get(f"{API}/videos")
        ids = [v["id"] for v in r2.json()]
        assert TestVideos.uploaded_id in ids

    def test_stream_full(self):
        assert TestVideos.uploaded_id, "upload must succeed first"
        r = requests.get(f"{API}/videos/{TestVideos.uploaded_id}/stream")
        assert r.status_code == 200
        assert r.headers.get("Accept-Ranges") == "bytes"
        assert len(r.content) > 0

    def test_stream_range(self):
        assert TestVideos.uploaded_id
        r = requests.get(
            f"{API}/videos/{TestVideos.uploaded_id}/stream",
            headers={"Range": "bytes=0-99"},
        )
        assert r.status_code == 206
        cr = r.headers.get("Content-Range", "")
        assert cr.startswith("bytes 0-99/")
        assert len(r.content) == 100

    def test_delete_requires_auth(self):
        assert TestVideos.uploaded_id
        r = requests.delete(f"{API}/videos/{TestVideos.uploaded_id}")
        assert r.status_code == 401

    def test_delete_soft(self, auth_headers):
        assert TestVideos.uploaded_id
        r = requests.delete(f"{API}/videos/{TestVideos.uploaded_id}", headers=auth_headers)
        assert r.status_code == 200
        # Should no longer be in list
        r2 = requests.get(f"{API}/videos")
        ids = [v["id"] for v in r2.json()]
        assert TestVideos.uploaded_id not in ids
        # Stream should 404
        r3 = requests.get(f"{API}/videos/{TestVideos.uploaded_id}/stream")
        assert r3.status_code == 404

    def test_delete_unknown(self, auth_headers):
        r = requests.delete(f"{API}/videos/{uuid.uuid4()}", headers=auth_headers)
        assert r.status_code == 404


# ---------- WebSocket ----------
@pytest.mark.asyncio
class TestWebSocket:
    async def test_ws_initial_state(self):
        async with websockets.connect(ws_url(), open_timeout=10) as ws:
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            msg = json.loads(raw)
            assert msg["type"] == "state"
            assert "state" in msg
            assert "is_playing" in msg["state"]

    async def test_ws_unauthorized_action(self):
        async with websockets.connect(ws_url(), open_timeout=10) as ws:
            await asyncio.wait_for(ws.recv(), timeout=10)  # initial state
            await ws.send(json.dumps({"action": "play"}))  # no token
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            msg = json.loads(raw)
            assert msg.get("type") == "error"
            assert msg.get("error") == "unauthorized"

    async def test_ws_authorized_pause_broadcast(self, token):
        async with websockets.connect(ws_url(), open_timeout=10) as ws:
            await asyncio.wait_for(ws.recv(), timeout=10)  # initial state
            await ws.send(json.dumps({"action": "pause", "token": token}))
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            msg = json.loads(raw)
            assert msg["type"] == "state"
            assert msg["state"]["is_playing"] is False

    async def test_ws_volume_and_loop(self, token):
        async with websockets.connect(ws_url(), open_timeout=10) as ws:
            await asyncio.wait_for(ws.recv(), timeout=10)
            await ws.send(json.dumps({"action": "volume", "volume": 0.42, "token": token}))
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            msg = json.loads(raw)
            assert abs(msg["state"]["volume"] - 0.42) < 1e-3

            await ws.send(json.dumps({"action": "loop", "loop": True, "token": token}))
            raw = await asyncio.wait_for(ws.recv(), timeout=10)
            msg = json.loads(raw)
            assert msg["state"]["loop"] is True
