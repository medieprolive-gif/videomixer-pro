from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Header, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import Response, StreamingResponse
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


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=300,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=120,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------- App ----------
app = FastAPI(title="KinoKontroll API")
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
    data = await file.read()

    try:
        result = put_object(storage_path, data, file.content_type or "video/mp4")
    except Exception as e:
        logger.error(f"Storage upload failed: {e}")
        raise HTTPException(status_code=500, detail="Lagring feilet")

    doc = {
        "id": video_id,
        "filename": file.filename,
        "storage_path": result["path"],
        "content_type": file.content_type or "video/mp4",
        "size": result.get("size", len(data)),
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.videos.insert_one(doc.copy())
    return VideoOut(**doc)


@api_router.get("/videos", response_model=List[VideoOut])
async def list_videos():
    items = await db.videos.find({"is_deleted": False}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    return [VideoOut(**i) for i in items]


@api_router.delete("/videos/{video_id}")
async def delete_video(video_id: str, _: bool = Depends(require_auth)):
    res = await db.videos.update_one({"id": video_id}, {"$set": {"is_deleted": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Video ikke funnet")
    # If deleted video is current, clear it
    state = await get_state_doc()
    if state.get("current_video_id") == video_id:
        state["current_video_id"] = None
        state["is_playing"] = False
        state["current_time"] = 0
        await save_state(state)
        await broadcast_state(state)
    return {"ok": True}


@api_router.get("/videos/{video_id}/stream")
async def stream_video(video_id: str, request: Request):
    record = await db.videos.find_one({"id": video_id, "is_deleted": False}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Video ikke funnet")

    try:
        data, content_type = get_object(record["storage_path"])
    except Exception as e:
        logger.error(f"Storage fetch failed: {e}")
        raise HTTPException(status_code=500, detail="Klarte ikke å hente video")

    media_type = record.get("content_type") or content_type or "video/mp4"
    total = len(data)
    range_header = request.headers.get("range") or request.headers.get("Range")

    if range_header and range_header.startswith("bytes="):
        try:
            range_str = range_header.replace("bytes=", "").strip()
            start_s, end_s = range_str.split("-", 1)
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else total - 1
            end = min(end, total - 1)
            chunk = data[start:end + 1]
            headers = {
                "Content-Range": f"bytes {start}-{end}/{total}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(chunk)),
                "Cache-Control": "no-cache",
            }
            return Response(content=chunk, status_code=206, media_type=media_type, headers=headers)
        except Exception:
            pass

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(total),
        "Cache-Control": "no-cache",
    }
    return Response(content=data, media_type=media_type, headers=headers)


# ---------- Playback state (single shared room) ----------
DEFAULT_STATE: Dict[str, Any] = {
    "id": "global",
    "current_video_id": None,
    "is_playing": False,
    "current_time": 0.0,
    "volume": 1.0,
    "muted": False,
    "loop": False,
    "updated_at": datetime.now(timezone.utc).isoformat(),
}


async def get_state_doc() -> Dict[str, Any]:
    s = await db.playback_state.find_one({"id": "global"}, {"_id": 0})
    if not s:
        s = DEFAULT_STATE.copy()
        await db.playback_state.insert_one(s.copy())
    return s


async def save_state(state: Dict[str, Any]):
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.playback_state.update_one({"id": "global"}, {"$set": state}, upsert=True)


@api_router.get("/state")
async def get_state():
    return await get_state_doc()


# ---------- WebSocket sync ----------
class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self.active.append(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            if ws in self.active:
                self.active.remove(ws)

    async def broadcast(self, message: Dict[str, Any]):
        async with self._lock:
            sockets = list(self.active)
        dead = []
        for s in sockets:
            try:
                await s.send_json(message)
            except Exception:
                dead.append(s)
        if dead:
            async with self._lock:
                for s in dead:
                    if s in self.active:
                        self.active.remove(s)


manager = ConnectionManager()


async def broadcast_state(state: Dict[str, Any]):
    await manager.broadcast({"type": "state", "state": state})


VALID_ACTIONS = {"play", "pause", "toggle", "next", "prev", "select", "seek", "volume", "mute", "loop", "time_update"}


@app.websocket("/api/ws")
async def websocket_endpoint(ws: WebSocket):
    # Accept all; control actions require token
    await manager.connect(ws)
    try:
        # Send current state on connect
        s = await get_state_doc()
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

            # Auth check for control actions (display only listens, doesn't send)
            token = msg.get("token")
            if not token or not verify_token(token):
                await ws.send_json({"type": "error", "error": "unauthorized"})
                continue

            state = await get_state_doc()
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
                if state.get("current_video_id") in ids:
                    idx = ids.index(state["current_video_id"])
                    next_idx = (idx + 1) % len(ids) if ids else 0
                    state["current_video_id"] = ids[next_idx] if ids else None
                elif ids:
                    state["current_video_id"] = ids[0]
                state["current_time"] = 0
                state["is_playing"] = True
            elif action == "prev":
                if state.get("current_video_id") in ids:
                    idx = ids.index(state["current_video_id"])
                    prev_idx = (idx - 1) % len(ids) if ids else 0
                    state["current_video_id"] = ids[prev_idx] if ids else None
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
                # Display reports current time so control timeline stays in sync
                t = msg.get("time")
                if isinstance(t, (int, float)):
                    state["current_time"] = float(max(0, t))

            await save_state(state)
            await broadcast_state(state)

    except WebSocketDisconnect:
        await manager.disconnect(ws)
    except Exception as e:
        logger.error(f"WS error: {e}")
        await manager.disconnect(ws)


# ---------- Lifecycle ----------
@app.on_event("startup")
async def startup():
    try:
        init_storage()
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    # Ensure state doc
    await get_state_doc()


@app.on_event("shutdown")
async def shutdown():
    client.close()


# Register router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
