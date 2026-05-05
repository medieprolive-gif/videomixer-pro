from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Header, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import requests
import jwt as pyjwt
import asyncio
import json


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Config
APP_PASSWORD = os.environ['APP_PASSWORD']
JWT_SECRET = os.environ['JWT_SECRET']
APP_NAME = os.environ.get('APP_NAME', 'kinokontroll')
EMERGENT_KEY = os.environ.get('EMERGENT_LLM_KEY')
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
MAX_UPLOAD_MB = int(os.environ.get('MAX_UPLOAD_MB', '500'))
STREAM_CHUNK = 64 * 1024  # 64 KB

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ---------- Storage ----------
storage_key: Optional[str] = None


def init_storage() -> str:
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object_stream(path: str, file_obj, content_type: str, content_length: int) -> dict:
    """Stream a file-like object to storage without loading it fully into memory."""
    key = init_storage()
    headers = {
        "X-Storage-Key": key,
        "Content-Type": content_type,
        "Content-Length": str(content_length),
    }
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers=headers,
        data=file_obj,
        timeout=600,
    )
    resp.raise_for_status()
    return resp.json()


def open_object_stream(path: str, range_header: Optional[str] = None):
    """Open a streaming GET to storage. Returns the live requests.Response."""
    key = init_storage()
    headers = {"X-Storage-Key": key}
    if range_header:
        headers["Range"] = range_header
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers=headers,
        stream=True,
        timeout=120,
    )
    resp.raise_for_status()
    return resp


# ---------- App ----------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    # Ensure default room state exists
    await get_state_doc(DEFAULT_ROOM)
    yield
    client.close()


app = FastAPI(title="KinoKontroll API", lifespan=lifespan)
api_router = APIRouter(prefix="/api")


# ---------- Auth ----------
def create_token() -> str:
    payload = {
        "sub": "kinokontroll-user",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
        "iat": datetime.now(timezone.utc),
    }
    return pyjwt.encode(payload, JWT_SECRET, algorithm="HS256")


def verify_token(token: str) -> bool:
    try:
        pyjwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return True
    except Exception:
        return False


def require_auth(authorization: Optional[str] = Header(None), auth: Optional[str] = Query(None)) -> bool:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    elif auth:
        token = auth
    if not token or not verify_token(token):
        raise HTTPException(status_code=401, detail="Ikke autorisert")
    return True


class LoginRequest(BaseModel):
    password: str


@api_router.post("/auth/login")
async def login(req: LoginRequest):
    if req.password != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Feil passord")
    return {"token": create_token()}


@api_router.get("/auth/verify")
async def verify(_: bool = Depends(require_auth)):
    return {"ok": True}


# ---------- Video models ----------
class VideoOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    filename: str
    storage_path: str
    content_type: str
    size: int
    created_at: str
    has_thumbnail: bool = False


@api_router.post("/videos/upload", response_model=VideoOut)
async def upload_video(file: UploadFile = File(...), _: bool = Depends(require_auth)):
    if not file.content_type or not file.content_type.startswith("video/"):
        # allow common mp4 even if browser sends application/octet-stream
        ext = (file.filename or "").lower().split(".")[-1]
        if ext not in {"mp4", "webm", "mov", "mkv", "avi", "ogg"}:
            raise HTTPException(status_code=400, detail="Filen er ikke en gyldig videofil")

    ext = (file.filename or "video.mp4").split(".")[-1]
    video_id = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/videos/{video_id}.{ext}"
    content_type = file.content_type or "video/mp4"

    # Determine size without reading the whole file into memory.
    underlying = file.file
    underlying.seek(0, 2)  # seek to end
    size = underlying.tell()
    underlying.seek(0)

    if size <= 0:
        raise HTTPException(status_code=400, detail="Tom fil")
    if size > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"Filen er for stor (maks {MAX_UPLOAD_MB} MB)",
        )

    try:
        # Stream the SpooledTemporaryFile directly to storage in a thread
        # so we never load the whole video into memory and never block the loop.
        result = await asyncio.to_thread(
            put_object_stream, storage_path, underlying, content_type, size
        )
    except Exception as e:
        logger.error(f"Storage upload failed: {e}")
        raise HTTPException(status_code=500, detail="Lagring feilet")

    doc = {
        "id": video_id,
        "filename": file.filename,
        "storage_path": result["path"],
        "content_type": content_type,
        "size": result.get("size", size),
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.videos.insert_one(doc.copy())
    return VideoOut(**doc)


@api_router.get("/videos", response_model=List[VideoOut])
async def list_videos():
    items = await db.videos.find({"is_deleted": False}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    out = []
    for i in items:
        i["has_thumbnail"] = bool(i.get("thumbnail_path"))
        out.append(VideoOut(**i))
    return out


@api_router.post("/videos/{video_id}/thumbnail")
async def upload_thumbnail(video_id: str, file: UploadFile = File(...), _: bool = Depends(require_auth)):
    record = await db.videos.find_one({"id": video_id, "is_deleted": False}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Video ikke funnet")

    underlying = file.file
    underlying.seek(0, 2)
    size = underlying.tell()
    underlying.seek(0)
    if size <= 0 or size > 4 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ugyldig miniatyr")

    content_type = file.content_type or "image/jpeg"
    ext = "jpg" if "jpeg" in content_type else (content_type.split("/")[-1] or "jpg")
    thumb_path = f"{APP_NAME}/thumbnails/{video_id}.{ext}"

    try:
        result = await asyncio.to_thread(put_object_stream, thumb_path, underlying, content_type, size)
    except Exception as e:
        logger.error(f"Thumb upload failed: {e}")
        raise HTTPException(status_code=500, detail="Lagring av miniatyr feilet")

    await db.videos.update_one(
        {"id": video_id},
        {"$set": {"thumbnail_path": result["path"], "thumbnail_content_type": content_type}},
    )
    return {"ok": True, "path": result["path"]}


@api_router.get("/videos/{video_id}/thumbnail")
async def get_thumbnail(video_id: str):
    record = await db.videos.find_one({"id": video_id, "is_deleted": False}, {"_id": 0})
    if not record or not record.get("thumbnail_path"):
        raise HTTPException(status_code=404, detail="Ingen miniatyr")
    media_type = record.get("thumbnail_content_type") or "image/jpeg"
    try:
        resp = await asyncio.to_thread(open_object_stream, record["thumbnail_path"], None)
    except Exception as e:
        logger.error(f"Thumb fetch failed: {e}")
        raise HTTPException(status_code=500, detail="Klarte ikke hente miniatyr")

    headers_out = {"Cache-Control": "public, max-age=86400"}
    if "Content-Length" in resp.headers:
        headers_out["Content-Length"] = resp.headers["Content-Length"]

    def gen():
        try:
            for c in resp.iter_content(chunk_size=STREAM_CHUNK):
                if c:
                    yield c
        finally:
            try:
                resp.close()
            except Exception:
                pass

    return StreamingResponse(gen(), media_type=media_type, headers=headers_out)


@api_router.delete("/videos/{video_id}")
async def delete_video(video_id: str, _: bool = Depends(require_auth)):
    res = await db.videos.update_one({"id": video_id}, {"$set": {"is_deleted": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Video ikke funnet")
    # If the deleted clip is currently playing in any room, clear & broadcast.
    rooms = await db.playback_state.distinct("id")
    for room in rooms or [DEFAULT_ROOM]:
        state = await get_state_doc(room)
        if state.get("current_video_id") == video_id:
            state["current_video_id"] = None
            state["is_playing"] = False
            state["current_time"] = 0
            await save_state(state, room)
            await broadcast_state(state, room)
    return {"ok": True}


def _parse_range(range_header: Optional[str], total: int) -> Optional[tuple[int, int]]:
    if not range_header or not range_header.startswith("bytes=") or total <= 0:
        return None
    try:
        s, e = range_header[6:].split("-", 1)
        start = int(s) if s else 0
        end = int(e) if e else total - 1
        end = min(end, total - 1)
        start = max(0, start)
        if start > end:
            return None
        return start, end
    except Exception:
        return None


@api_router.get("/videos/{video_id}/stream")
async def stream_video(video_id: str, request: Request):
    record = await db.videos.find_one({"id": video_id, "is_deleted": False}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Video ikke funnet")

    range_header = request.headers.get("range") or request.headers.get("Range")
    media_type = record.get("content_type") or "video/mp4"
    storage_path = record["storage_path"]

    try:
        resp = await asyncio.to_thread(open_object_stream, storage_path, range_header)
    except Exception as e:
        logger.error(f"Storage fetch failed: {e}")
        raise HTTPException(status_code=500, detail="Klarte ikke å hente video")

    base_headers = {"Accept-Ranges": "bytes", "Cache-Control": "no-cache"}

    # Case 1: Storage natively honored Range -> pass-through 206
    if resp.status_code == 206:
        headers_out = dict(base_headers)
        for h in ("Content-Range", "Content-Length"):
            if h in resp.headers:
                headers_out[h] = resp.headers[h]

        def passthrough():
            try:
                for chunk in resp.iter_content(chunk_size=STREAM_CHUNK):
                    if chunk:
                        yield chunk
            finally:
                try:
                    resp.close()
                except Exception:
                    pass

        return StreamingResponse(passthrough(), status_code=206, media_type=media_type, headers=headers_out)

    # Storage returned full body (200). If client asked for a range, slice on-the-fly.
    try:
        total = int(resp.headers.get("Content-Length") or record.get("size") or 0)
    except (TypeError, ValueError):
        total = int(record.get("size") or 0)

    parsed = _parse_range(range_header, total)
    if parsed is not None:
        start, end = parsed
        length = end - start + 1
        headers_out = dict(base_headers)
        headers_out["Content-Range"] = f"bytes {start}-{end}/{total}"
        headers_out["Content-Length"] = str(length)

        def sliced():
            pos = 0
            remaining = length
            try:
                for chunk in resp.iter_content(chunk_size=STREAM_CHUNK):
                    if not chunk:
                        continue
                    c_start = pos
                    c_end = pos + len(chunk)
                    pos = c_end
                    if c_end <= start:
                        continue
                    if c_start > end:
                        break
                    local_start = max(0, start - c_start)
                    local_end = min(len(chunk), end - c_start + 1)
                    out = chunk[local_start:local_end]
                    if not out:
                        continue
                    if len(out) > remaining:
                        out = out[:remaining]
                    remaining -= len(out)
                    yield out
                    if remaining <= 0:
                        break
            finally:
                try:
                    resp.close()
                except Exception:
                    pass

        return StreamingResponse(sliced(), status_code=206, media_type=media_type, headers=headers_out)

    # No range requested -> stream full body
    headers_out = dict(base_headers)
    if "Content-Length" in resp.headers:
        headers_out["Content-Length"] = resp.headers["Content-Length"]

    def full_stream():
        try:
            for chunk in resp.iter_content(chunk_size=STREAM_CHUNK):
                if chunk:
                    yield chunk
        finally:
            try:
                resp.close()
            except Exception:
                pass

    return StreamingResponse(full_stream(), status_code=200, media_type=media_type, headers=headers_out)


# ---------- Playback state (per-room) ----------
DEFAULT_ROOM = "default"


def _default_state(room: str) -> Dict[str, Any]:
    return {
        "id": room,
        "current_video_id": None,
        "is_playing": False,
        "current_time": 0.0,
        "volume": 1.0,
        "muted": False,
        "loop": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _normalize_room(room: Optional[str]) -> str:
    r = (room or "").strip().lower()
    if not r:
        return DEFAULT_ROOM
    # Limit to safe slug chars
    safe = "".join(c for c in r if c.isalnum() or c in ("-", "_"))[:32]
    return safe or DEFAULT_ROOM


async def get_state_doc(room: str) -> Dict[str, Any]:
    room = _normalize_room(room)
    s = await db.playback_state.find_one({"id": room}, {"_id": 0})
    if not s:
        s = _default_state(room)
        await db.playback_state.insert_one(s.copy())
    return s


async def save_state(state: Dict[str, Any], room: str):
    room = _normalize_room(room)
    state["id"] = room
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.playback_state.update_one({"id": room}, {"$set": state}, upsert=True)


async def list_rooms() -> List[str]:
    rooms = await db.playback_state.distinct("id")
    return rooms or [DEFAULT_ROOM]


@api_router.get("/state")
async def get_state(room: str = Query(DEFAULT_ROOM)):
    return await get_state_doc(room)


@api_router.get("/rooms")
async def get_rooms():
    return {"rooms": await list_rooms()}


# ---------- WebSocket sync ----------
class ConnectionManager:
    """Tracks connected sockets per room."""

    def __init__(self):
        self.rooms: Dict[str, List[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, room: str):
        await ws.accept()
        async with self._lock:
            self.rooms.setdefault(room, []).append(ws)

    async def disconnect(self, ws: WebSocket, room: str):
        async with self._lock:
            sockets = self.rooms.get(room, [])
            if ws in sockets:
                sockets.remove(ws)

    async def broadcast(self, message: Dict[str, Any], room: str):
        async with self._lock:
            sockets = list(self.rooms.get(room, []))
        dead = []
        for s in sockets:
            try:
                await s.send_json(message)
            except Exception:
                dead.append(s)
        if dead:
            async with self._lock:
                live = self.rooms.get(room, [])
                for s in dead:
                    if s in live:
                        live.remove(s)

    async def broadcast_all(self, message: Dict[str, Any]):
        async with self._lock:
            rooms = list(self.rooms.keys())
        for r in rooms:
            await self.broadcast(message, r)


manager = ConnectionManager()


async def broadcast_state(state: Dict[str, Any], room: str):
    await manager.broadcast({"type": "state", "state": state}, room)


VALID_ACTIONS = {"play", "pause", "toggle", "next", "prev", "select", "seek", "volume", "mute", "loop", "time_update", "ended"}
# Actions that are passively reported by the (unauthenticated) display page.
PUBLIC_ACTIONS = {"ended"}


async def _advance_to_next(state: Dict[str, Any], ids: List[str], from_id: Optional[str]) -> Dict[str, Any]:
    """Advance playback to the next clip after `from_id`. Stops if at the end and no loop."""
    if not ids:
        state["current_video_id"] = None
        state["is_playing"] = False
        state["current_time"] = 0
        return state
    if from_id in ids:
        idx = ids.index(from_id)
        if idx + 1 < len(ids):
            state["current_video_id"] = ids[idx + 1]
            state["current_time"] = 0
            state["is_playing"] = True
        else:
            # Reached the end of the playlist
            if state.get("loop"):
                state["current_video_id"] = ids[0]
                state["current_time"] = 0
                state["is_playing"] = True
            else:
                state["is_playing"] = False
                state["current_time"] = 0
    else:
        state["current_video_id"] = ids[0]
        state["current_time"] = 0
        state["is_playing"] = True
    return state


@app.websocket("/api/ws")
async def websocket_endpoint(ws: WebSocket, room: str = Query(DEFAULT_ROOM)):
    room = _normalize_room(room)
    # Accept all; control actions require token, display passive actions are public
    await manager.connect(ws, room)
    try:
        # Send current state on connect
        s = await get_state_doc(room)
        await ws.send_json({"type": "state", "state": s})

        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            action = msg.get("action")
            if action not in VALID_ACTIONS:
                continue

            # Auth gate (display-only "ended" is allowed without token)
            if action not in PUBLIC_ACTIONS:
                token = msg.get("token")
                if not token or not verify_token(token):
                    await ws.send_json({"type": "error", "error": "unauthorized"})
                    continue

            state = await get_state_doc(room)
            videos = await db.videos.find({"is_deleted": False}, {"_id": 0}).sort("created_at", 1).to_list(1000)
            ids = [v["id"] for v in videos]

            if action == "play":
                state["is_playing"] = True
                if not state.get("current_video_id") and ids:
                    state["current_video_id"] = ids[0]
                    state["current_time"] = 0
            elif action == "pause":
                state["is_playing"] = False
            elif action == "toggle":
                state["is_playing"] = not state.get("is_playing", False)
                if state["is_playing"] and not state.get("current_video_id") and ids:
                    state["current_video_id"] = ids[0]
                    state["current_time"] = 0
            elif action == "next":
                cur = state.get("current_video_id")
                if cur in ids:
                    idx = ids.index(cur)
                    next_idx = (idx + 1) % len(ids)
                    state["current_video_id"] = ids[next_idx]
                elif ids:
                    state["current_video_id"] = ids[0]
                state["current_time"] = 0
                state["is_playing"] = True
            elif action == "prev":
                cur = state.get("current_video_id")
                if cur in ids:
                    idx = ids.index(cur)
                    prev_idx = (idx - 1) % len(ids)
                    state["current_video_id"] = ids[prev_idx]
                elif ids:
                    state["current_video_id"] = ids[0]
                state["current_time"] = 0
                state["is_playing"] = True
            elif action == "select":
                vid = msg.get("video_id")
                if vid in ids:
                    state["current_video_id"] = vid
                    state["current_time"] = 0
                    state["is_playing"] = True
            elif action == "seek":
                t = msg.get("time")
                if isinstance(t, (int, float)):
                    state["current_time"] = float(max(0, t))
            elif action == "volume":
                v = msg.get("volume")
                if isinstance(v, (int, float)):
                    state["volume"] = float(max(0, min(1, v)))
            elif action == "mute":
                state["muted"] = bool(msg.get("muted", not state.get("muted", False)))
            elif action == "loop":
                state["loop"] = bool(msg.get("loop", not state.get("loop", False)))
            elif action == "time_update":
                t = msg.get("time")
                if isinstance(t, (int, float)):
                    state["current_time"] = float(max(0, t))
            elif action == "ended":
                # Display reports the playing video ended. Confirm it's the current one,
                # then auto-advance (or stop). Browser handles loop natively when loop flag is on,
                # so this won't fire when loop is enabled.
                ended_id = msg.get("video_id")
                if ended_id == state.get("current_video_id"):
                    state = await _advance_to_next(state, ids, ended_id)

            await save_state(state, room)
            await broadcast_state(state, room)

    except WebSocketDisconnect:
        await manager.disconnect(ws, room)
    except Exception as e:
        logger.error(f"WS error: {e}")
        await manager.disconnect(ws, room)


# Register router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
