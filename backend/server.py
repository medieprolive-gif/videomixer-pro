from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Form, Header, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import StreamingResponse, FileResponse
from contextlib import asynccontextmanager
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import time
import logging
import subprocess
import tempfile
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


# ---------- Broadcast scheduler ----------
async def _next_scheduled_after(room: str, after_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    q: Dict[str, Any] = {"room": room, "status": "scheduled"}
    if after_id:
        q["id"] = {"$ne": after_id}
    return await db.schedule.find_one(q, {"_id": 0}, sort=[("scheduled_at", 1)])


async def _play_pre_plakat(item: Dict[str, Any]):
    state = await get_state_doc(item["room"])
    state["pgm_id"] = item.get("pre_plakat_id")
    state["pvw_id"] = item.get("media_id")
    state["current_time"] = 0
    state["is_playing"] = True
    state["next_up_text"] = item.get("title") or ""
    await save_state(state, item["room"])
    await broadcast_state(state, item["room"])
    await db.schedule.update_one({"id": item["id"]}, {"$set": {"status": "pre_playing"}})


async def _play_main_item(item: Dict[str, Any]):
    state = await get_state_doc(item["room"])
    state["pgm_id"] = item["media_id"]
    state["current_time"] = 0
    state["is_playing"] = True
    state["next_up_text"] = item.get("next_up_text") or ""
    nxt = await _next_scheduled_after(item["room"], after_id=item["id"])
    state["pvw_id"] = nxt.get("media_id") if nxt else None
    await save_state(state, item["room"])
    await broadcast_state(state, item["room"])
    await db.schedule.update_one({"id": item["id"]}, {"$set": {"status": "played"}})


async def scheduler_tick():
    now = datetime.now(timezone.utc)
    # Items currently in pre_playing — advance to main when scheduled_at hits
    pre_items = await db.schedule.find(
        {"status": "pre_playing"}, {"_id": 0}
    ).to_list(50)
    for item in pre_items:
        s = item["scheduled_at"]
        if isinstance(s, str):
            s = datetime.fromisoformat(s)
        if s.tzinfo is None:
            s = s.replace(tzinfo=timezone.utc)
        if s <= now:
            await _play_main_item(item)

    # Scheduled items due (with pre-plakat consideration). When an item has no
    # explicit pre_plakat configured we fall back to the room-level global
    # bumper, which gives users a single global pre-roll that auto-plays before
    # every scheduled program.
    items = await db.schedule.find(
        {"status": "scheduled"}, {"_id": 0}
    ).sort("scheduled_at", 1).to_list(500)
    settings_cache: Dict[str, Optional[Dict[str, Any]]] = {}
    for item in items:
        s = item["scheduled_at"]
        if isinstance(s, str):
            s = datetime.fromisoformat(s)
        if s.tzinfo is None:
            s = s.replace(tzinfo=timezone.utc)
        pre_id = item.get("pre_plakat_id")
        pre_dur = float(item.get("pre_plakat_duration") or 0)
        if not pre_id or pre_dur <= 0:
            room = item.get("room") or DEFAULT_ROOM
            if room not in settings_cache:
                settings_cache[room] = await db.room_settings.find_one(
                    {"room": room}, {"_id": 0}
                )
            rs = settings_cache[room]
            if rs and rs.get("global_bumper_id"):
                pre_id = rs["global_bumper_id"]
                pre_dur = float(rs.get("global_bumper_duration") or 5.0)
        if pre_id and pre_dur > 0:
            pre_start = s - timedelta(seconds=pre_dur)
            if pre_start <= now < s:
                await _play_pre_plakat(
                    {**item, "pre_plakat_id": pre_id, "pre_plakat_duration": pre_dur}
                )
                continue
        if s <= now:
            await _play_main_item(item)


async def scheduler_loop():
    while True:
        try:
            await asyncio.sleep(2)
            await scheduler_tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("scheduler tick failed")


async def _expire_bumper(room: str, bumper_id: str, sleep_for: float):
    """Clear PGM after the bumper has run, so the Display can fall back to
    program overview / idle until the next scheduled item starts."""
    try:
        await asyncio.sleep(max(0.5, float(sleep_for)))
    except asyncio.CancelledError:
        raise
    try:
        state = await get_state_doc(room)
        # Only clear if state still shows our bumper (user may have overridden).
        if state.get("pgm_id") == bumper_id:
            state["pgm_id"] = None
            state["is_playing"] = False
            state["current_time"] = 0
            await save_state(state, room)
            await broadcast_state(state, room)
    except Exception:
        logger.exception("expire bumper failed")


# ---------- App ----------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    await get_state_doc(DEFAULT_ROOM)

    sched_task = asyncio.create_task(scheduler_loop())
    streams_task = asyncio.create_task(streams_idle_cleanup_loop())
    logger.info("Broadcast scheduler started")
    yield
    sched_task.cancel()
    streams_task.cancel()
    # Stop any active stream transcoders
    for sid in list(_active_streams.keys()):
        try:
            await _stop_stream_locked(sid)
        except Exception:
            pass
    try:
        await sched_task
    except asyncio.CancelledError:
        pass
    try:
        await streams_task
    except asyncio.CancelledError:
        pass
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


# ---------- Media models ----------
class VideoOut(BaseModel):
    """Represents a media item (video, image, or live stream)."""

    model_config = ConfigDict(extra="ignore")
    id: str
    filename: str
    storage_path: str = ""  # empty for streams
    content_type: str = ""
    size: int = 0
    created_at: str
    has_thumbnail: bool = False
    media_type: str = "video"  # "video" | "image" | "stream" | "audio"
    duration: float = 5.0  # seconds
    category: str = "content"  # "content" (timeline media) | "asset" (logo/bg/bumper/music)
    # Live-stream fields (only when media_type == "stream")
    stream_url: Optional[str] = None
    stream_protocol: Optional[str] = None  # "srt" | "rtmp"
    stream_mode: Optional[str] = None  # "caller" | "listener" (SRT only)


class StreamCreate(BaseModel):
    name: str
    stream_url: str
    stream_protocol: str  # "srt" | "rtmp"
    stream_mode: Optional[str] = "caller"


VIDEO_EXTS = {"mp4", "webm", "mov", "mkv", "avi", "ogg"}
IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp", "bmp"}
AUDIO_EXTS = {"mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"}


def _detect_media_type(content_type: Optional[str], filename: Optional[str]) -> Optional[str]:
    ct = (content_type or "").lower()
    if ct.startswith("video/"):
        return "video"
    if ct.startswith("image/"):
        return "image"
    if ct.startswith("audio/"):
        return "audio"
    ext = (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if ext in VIDEO_EXTS:
        return "video"
    if ext in IMAGE_EXTS:
        return "image"
    if ext in AUDIO_EXTS:
        return "audio"
    return None


def _probe_duration_seconds(path: str) -> float:
    """Return container duration via ffprobe, 0.0 on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            return float((result.stdout or "0").strip() or 0)
    except Exception:
        logger.exception("ffprobe failed for %s", path)
    return 0.0


@api_router.post("/videos/upload", response_model=VideoOut)
async def upload_video(
    file: UploadFile = File(...),
    duration: Optional[float] = Form(None),
    category: Optional[str] = Form(None),
    _: bool = Depends(require_auth),
):
    media_type = _detect_media_type(file.content_type, file.filename)
    if media_type is None:
        raise HTTPException(
            status_code=400, detail="Ikke en gyldig video-, bilde- eller lydfil"
        )

    default_ext = {"video": "mp4", "image": "jpg", "audio": "mp3"}[media_type]
    ext = (file.filename or f"media.{default_ext}").split(".")[-1]
    media_id = str(uuid.uuid4())
    folder = {"video": "videos", "image": "images", "audio": "audio"}[media_type]
    storage_path = f"{APP_NAME}/{folder}/{media_id}.{ext}"
    default_content_type = {
        "video": "video/mp4",
        "image": "image/jpeg",
        "audio": "audio/mpeg",
    }[media_type]
    content_type = file.content_type or default_content_type

    # Determine size without reading the whole file into memory.
    underlying = file.file
    underlying.seek(0, 2)
    size = underlying.tell()
    underlying.seek(0)

    if size <= 0:
        raise HTTPException(status_code=400, detail="Tom fil")
    if size > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"Filen er for stor (maks {MAX_UPLOAD_MB} MB)",
        )

    # For videos and audio, write to a tempfile so we can ffprobe it for the
    # actual duration BEFORE uploading. Then re-stream from disk to object storage.
    probed_duration = 0.0
    tmp_path: Optional[str] = None
    if media_type in ("video", "audio"):
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            tmp_path = tmp.name
            while True:
                chunk = underlying.read(64 * 1024)
                if not chunk:
                    break
                tmp.write(chunk)
        probed_duration = await asyncio.to_thread(
            _probe_duration_seconds, tmp_path
        )

    try:
        if tmp_path:
            with open(tmp_path, "rb") as fh:
                result = await asyncio.to_thread(
                    put_object_stream, storage_path, fh, content_type, size
                )
        else:
            result = await asyncio.to_thread(
                put_object_stream, storage_path, underlying, content_type, size
            )
    except Exception as e:
        logger.error(f"Storage upload failed: {e}")
        raise HTTPException(status_code=500, detail="Lagring feilet")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    # Resolve duration:
    #  - video / audio: ffprobe-derived (fallback 0)
    #  - image: client-supplied display duration (default 5s)
    if media_type in ("video", "audio"):
        safe_duration = float(probed_duration or 0.0)
    else:
        safe_duration = 5.0
        if duration is not None:
            try:
                safe_duration = max(1.0, min(3600.0, float(duration)))
            except (TypeError, ValueError):
                safe_duration = 5.0

    # Category: explicit user choice OR sensible default (audio always asset).
    cat = (category or "").strip().lower()
    if cat not in ("content", "asset"):
        cat = "asset" if media_type == "audio" else "content"

    doc = {
        "id": media_id,
        "filename": file.filename,
        "storage_path": result["path"],
        "content_type": content_type,
        "size": result.get("size", size),
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "media_type": media_type,
        "duration": safe_duration,
        "category": cat,
    }
    # For images, the file itself is its own thumbnail.
    if media_type == "image":
        doc["thumbnail_path"] = result["path"]
        doc["thumbnail_content_type"] = content_type
    await db.videos.insert_one(doc.copy())
    doc["has_thumbnail"] = bool(doc.get("thumbnail_path"))
    return VideoOut(**doc)


class DurationUpdate(BaseModel):
    duration: float


class TrimRequest(BaseModel):
    start: float
    end: float


@api_router.post("/videos/{video_id}/trim", response_model=VideoOut)
async def trim_video(video_id: str, payload: TrimRequest, _: bool = Depends(require_auth)):
    record = await db.videos.find_one({"id": video_id, "is_deleted": False}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Video ikke funnet")
    if record.get("media_type") != "video":
        raise HTTPException(status_code=400, detail="Bare videoklipp kan trimmes")

    start = max(0.0, float(payload.start))
    end = max(start + 0.1, float(payload.end))
    duration = end - start
    if duration < 0.1 or duration > 7200:
        raise HTTPException(status_code=400, detail="Ugyldig trim-område")

    src_path = record["storage_path"]
    src_ext = src_path.rsplit(".", 1)[-1] if "." in src_path else "mp4"

    src_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{src_ext}")
    dst_tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
    src_tmp.close()
    dst_tmp.close()

    try:
        # 1. Download source from storage
        def download():
            resp = open_object_stream(src_path)
            try:
                with open(src_tmp.name, "wb") as f:
                    for chunk in resp.iter_content(chunk_size=64 * 1024):
                        if chunk:
                            f.write(chunk)
            finally:
                try:
                    resp.close()
                except Exception:
                    pass

        await asyncio.to_thread(download)

        # 2. Run ffmpeg with precise re-encode
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-ss", f"{start:.3f}",
            "-i", src_tmp.name,
            "-t", f"{duration:.3f}",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            dst_tmp.name,
        ]
        proc = await asyncio.to_thread(
            subprocess.run, cmd, capture_output=True, timeout=900
        )
        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", errors="ignore")[:500]
            logger.error(f"ffmpeg trim failed: {err}")
            raise HTTPException(status_code=500, detail="Trimming feilet")

        new_size = os.path.getsize(dst_tmp.name)
        if new_size <= 0:
            raise HTTPException(status_code=500, detail="Trimming gav tom fil")

        # 3. Upload trimmed file back (replacing original at same logical path)
        new_storage_path = src_path
        if not src_path.endswith(".mp4"):
            new_storage_path = src_path.rsplit(".", 1)[0] + ".mp4"

        def upload_new():
            with open(dst_tmp.name, "rb") as nf:
                return put_object_stream(new_storage_path, nf, "video/mp4", new_size)

        result = await asyncio.to_thread(upload_new)

        # 4. Update DB
        update = {
            "storage_path": result["path"],
            "content_type": "video/mp4",
            "size": result.get("size", new_size),
        }
        await db.videos.update_one({"id": video_id}, {"$set": update})
        record.update(update)
        record["has_thumbnail"] = bool(record.get("thumbnail_path"))
        record.setdefault("media_type", "video")
        record.setdefault("duration", 5.0)
        return VideoOut(**record)

    finally:
        for p in (src_tmp.name, dst_tmp.name):
            try:
                os.unlink(p)
            except Exception:
                pass


@api_router.patch("/videos/{video_id}/duration")
async def update_duration(video_id: str, payload: DurationUpdate, _: bool = Depends(require_auth)):
    record = await db.videos.find_one({"id": video_id, "is_deleted": False}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Media ikke funnet")
    if record.get("media_type") != "image":
        raise HTTPException(status_code=400, detail="Varighet kan kun settes på stillbilder")
    safe = max(1.0, min(3600.0, float(payload.duration)))
    await db.videos.update_one({"id": video_id}, {"$set": {"duration": safe}})
    return {"ok": True, "duration": safe}


class FilenamePatch(BaseModel):
    filename: str


class CategoryPatch(BaseModel):
    category: str  # "content" | "asset"


@api_router.patch("/videos/{video_id}/filename")
async def update_filename(video_id: str, payload: FilenamePatch, _: bool = Depends(require_auth)):
    name = (payload.filename or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Filnavn kan ikke være tomt")
    if len(name) > 240:
        raise HTTPException(status_code=400, detail="Filnavn er for langt (maks 240 tegn)")
    res = await db.videos.update_one(
        {"id": video_id, "is_deleted": False}, {"$set": {"filename": name}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Media ikke funnet")
    return {"ok": True, "filename": name}


@api_router.patch("/videos/{video_id}/category")
async def update_category(video_id: str, payload: CategoryPatch, _: bool = Depends(require_auth)):
    cat = (payload.category or "").strip().lower()
    if cat not in ("content", "asset"):
        raise HTTPException(status_code=400, detail="Kategori må være content eller asset")
    res = await db.videos.update_one(
        {"id": video_id, "is_deleted": False}, {"$set": {"category": cat}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Media ikke funnet")
    return {"ok": True, "category": cat}


@api_router.get("/videos", response_model=List[VideoOut])
async def list_videos():
    items = await db.videos.find({"is_deleted": False}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    out = []
    for i in items:
        i["has_thumbnail"] = bool(i.get("thumbnail_path"))
        i.setdefault("media_type", "video")
        i.setdefault("duration", 5.0)
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
    # If the deleted clip is currently in any room's PVW or PGM, clear & broadcast.
    rooms = await db.playback_state.distinct("id")
    for room in rooms or [DEFAULT_ROOM]:
        state = await get_state_doc(room)
        changed = False
        if state.get("pgm_id") == video_id:
            state["pgm_id"] = None
            state["is_playing"] = False
            state["current_time"] = 0
            changed = True
        if state.get("pvw_id") == video_id:
            state["pvw_id"] = None
            changed = True
        if changed:
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
        "pvw_id": None,
        "pgm_id": None,
        "is_playing": False,
        "current_time": 0.0,
        "volume": 1.0,
        "muted": False,
        "loop": False,
        "next_up_text": "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def _migrate_state(s: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure legacy state docs have all expected fields."""
    if "pgm_id" not in s:
        s["pgm_id"] = s.pop("current_video_id", None)
    if "pvw_id" not in s:
        s["pvw_id"] = None
    if "next_up_text" not in s:
        s["next_up_text"] = ""
    return s


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
    else:
        s = _migrate_state(s)
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


# ---------- Room settings (global bumper + program overview) ----------
class RoomSettingsModel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    room: str
    global_bumper_id: Optional[str] = None
    global_bumper_duration: float = 5.0
    program_overview_enabled: bool = False
    program_overview_logo_id: Optional[str] = None
    program_overview_background_id: Optional[str] = None
    program_overview_text_color: str = "#FFFFFF"
    program_overview_duration: float = 8.0
    program_overview_music_id: Optional[str] = None
    program_overview_music_volume: float = 0.6


def _settings_doc_from_payload(room: str, payload: RoomSettingsModel) -> Dict[str, Any]:
    return {
        "room": room,
        "global_bumper_id": payload.global_bumper_id,
        "global_bumper_duration": float(payload.global_bumper_duration or 5.0),
        "program_overview_enabled": bool(payload.program_overview_enabled),
        "program_overview_logo_id": payload.program_overview_logo_id,
        "program_overview_background_id": payload.program_overview_background_id,
        "program_overview_text_color": payload.program_overview_text_color or "#FFFFFF",
        "program_overview_duration": float(payload.program_overview_duration or 8.0),
        "program_overview_music_id": payload.program_overview_music_id,
        "program_overview_music_volume": max(
            0.0, min(1.0, float(payload.program_overview_music_volume or 0.6))
        ),
    }


def _settings_with_defaults(room: str, s: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    base = {
        "room": room,
        "global_bumper_id": None,
        "global_bumper_duration": 5.0,
        "program_overview_enabled": False,
        "program_overview_logo_id": None,
        "program_overview_background_id": None,
        "program_overview_text_color": "#FFFFFF",
        "program_overview_duration": 8.0,
        "program_overview_music_id": None,
        "program_overview_music_volume": 0.6,
    }
    if s:
        base.update({k: v for k, v in s.items() if k in base})
    return base


@api_router.get("/rooms/{room}/settings", response_model=RoomSettingsModel)
async def get_room_settings(room: str):
    room = _normalize_room(room)
    s = await db.room_settings.find_one({"room": room}, {"_id": 0})
    return RoomSettingsModel(**_settings_with_defaults(room, s))


@api_router.put("/rooms/{room}/settings", response_model=RoomSettingsModel)
async def set_room_settings(room: str, payload: RoomSettingsModel, _: bool = Depends(require_auth)):
    room = _normalize_room(room)
    doc = _settings_doc_from_payload(room, payload)
    await db.room_settings.update_one({"room": room}, {"$set": doc}, upsert=True)
    return RoomSettingsModel(**doc)


# ---------- Schedule (broadcast playout) ----------
class ScheduleIn(BaseModel):
    room: str = DEFAULT_ROOM
    scheduled_at: datetime
    media_id: str
    title: Optional[str] = ""
    next_up_text: Optional[str] = ""
    pre_plakat_id: Optional[str] = None
    pre_plakat_duration: Optional[float] = 0.0
    duration_minutes: Optional[int] = 15


class SchedulePatch(BaseModel):
    scheduled_at: Optional[datetime] = None
    media_id: Optional[str] = None
    title: Optional[str] = None
    next_up_text: Optional[str] = None
    pre_plakat_id: Optional[str] = None
    pre_plakat_duration: Optional[float] = None
    duration_minutes: Optional[int] = None
    status: Optional[str] = None


class ScheduleOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str
    room: str
    scheduled_at: str
    media_id: str
    title: str = ""
    next_up_text: str = ""
    pre_plakat_id: Optional[str] = None
    pre_plakat_duration: float = 0.0
    duration_minutes: int = 15
    status: str = "scheduled"
    created_at: str


def _serialize_schedule(item: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(item)
    s = out.get("scheduled_at")
    if isinstance(s, datetime):
        # MongoDB returns naive datetimes (UTC). Tag them with UTC tz so the
        # ISO string contains "+00:00" — otherwise the browser parses the bare
        # ISO as LOCAL time, which causes the displayed hour to shift by the
        # client's UTC offset (e.g. Norway summer = -2h, winter = -1h).
        if s.tzinfo is None:
            s = s.replace(tzinfo=timezone.utc)
        out["scheduled_at"] = s.isoformat()
    return out


# ---------- Live streams (SRT/RTMP → HLS via ffmpeg) ----------
STREAMS_ROOT = Path("/tmp/kk_streams")
STREAMS_ROOT.mkdir(parents=True, exist_ok=True)
# In-process registry of running ffmpeg transcoders.
# Shape: {media_id: {"proc": Popen, "dir": Path, "last_access": float}}
_active_streams: Dict[str, Dict[str, Any]] = {}
_streams_lock = asyncio.Lock()


def _stream_input_args(record: Dict[str, Any]) -> List[str]:
    url = record.get("stream_url") or ""
    proto = (record.get("stream_protocol") or "").lower()
    if proto == "srt":
        mode = (record.get("stream_mode") or "caller").lower()
        # Append mode= parameter if not already present.
        if "mode=" not in url:
            sep = "&" if "?" in url else "?"
            url = f"{url}{sep}mode={mode}"
        return ["-f", "mpegts", "-i", url]
    return ["-i", url]


def _spawn_ffmpeg_for_stream(media_id: str, record: Dict[str, Any]) -> Path:
    """Start an ffmpeg process that pulls the SRT/RTMP source and writes HLS
    segments to /tmp/kk_streams/{media_id}/. Returns the output directory."""
    out_dir = STREAMS_ROOT / media_id
    out_dir.mkdir(parents=True, exist_ok=True)
    # Clean any stale segments
    for f in out_dir.glob("*"):
        try:
            f.unlink()
        except Exception:
            pass

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "warning",
        "-fflags",
        "+nobuffer",
        "-rw_timeout",
        "5000000",
        *_stream_input_args(record),
        # Re-encode to broadly compatible H.264 + AAC for hls.js.
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-tune",
        "zerolatency",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-b:a",
        "128k",
        "-f",
        "hls",
        "-hls_time",
        "2",
        "-hls_list_size",
        "6",
        "-hls_flags",
        "delete_segments+omit_endlist+independent_segments",
        "-hls_segment_filename",
        str(out_dir / "seg_%05d.ts"),
        str(out_dir / "stream.m3u8"),
    ]
    logger.info("Starting ffmpeg for stream %s: %s", media_id, " ".join(cmd))
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
    )
    return out_dir, proc


async def _stop_stream_locked(media_id: str):
    info = _active_streams.pop(media_id, None)
    if not info:
        return
    proc = info.get("proc")
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            await asyncio.to_thread(proc.wait, 5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    out_dir = info.get("dir")
    if out_dir and isinstance(out_dir, Path):
        for f in out_dir.glob("*"):
            try:
                f.unlink()
            except Exception:
                pass
        try:
            out_dir.rmdir()
        except Exception:
            pass


async def streams_idle_cleanup_loop():
    """Periodically stop transcoders that haven't been accessed recently."""
    IDLE_AFTER = 60  # seconds
    while True:
        try:
            await asyncio.sleep(15)
            now = time.time()
            stale = []
            async with _streams_lock:
                for sid, info in list(_active_streams.items()):
                    if now - info.get("last_access", now) > IDLE_AFTER:
                        stale.append(sid)
                for sid in stale:
                    await _stop_stream_locked(sid)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("streams cleanup failed")


@api_router.post("/streams", response_model=VideoOut)
async def create_stream(payload: StreamCreate, _: bool = Depends(require_auth)):
    proto = payload.stream_protocol.lower()
    if proto not in ("srt", "rtmp"):
        raise HTTPException(status_code=400, detail="Protokoll må være srt eller rtmp")
    if proto == "srt" and (payload.stream_mode or "caller").lower() not in ("caller", "listener"):
        raise HTTPException(status_code=400, detail="SRT-modus må være caller eller listener")
    media_id = str(uuid.uuid4())
    doc = {
        "id": media_id,
        "filename": payload.name or f"Strøm ({proto.upper()})",
        "storage_path": "",
        "content_type": "application/vnd.apple.mpegurl",
        "size": 0,
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "media_type": "stream",
        "duration": 0.0,
        "category": "content",
        "stream_url": payload.stream_url,
        "stream_protocol": proto,
        "stream_mode": (payload.stream_mode or "caller").lower() if proto == "srt" else None,
    }
    await db.videos.insert_one(doc.copy())
    doc["has_thumbnail"] = False
    return VideoOut(**doc)


@api_router.post("/streams/{media_id}/start")
async def start_stream(media_id: str, _: bool = Depends(require_auth)):
    record = await db.videos.find_one(
        {"id": media_id, "is_deleted": False, "media_type": "stream"}, {"_id": 0}
    )
    if not record:
        raise HTTPException(status_code=404, detail="Strøm ikke funnet")
    async with _streams_lock:
        existing = _active_streams.get(media_id)
        if existing and existing["proc"].poll() is None:
            existing["last_access"] = time.time()
            return {
                "ok": True,
                "manifest": f"/api/streams/{media_id}/hls/stream.m3u8",
                "started": False,
            }
        # Stop dead one if any
        if existing:
            await _stop_stream_locked(media_id)
        out_dir, proc = await asyncio.to_thread(_spawn_ffmpeg_for_stream, media_id, record)
        _active_streams[media_id] = {
            "proc": proc,
            "dir": out_dir,
            "last_access": time.time(),
        }
    return {
        "ok": True,
        "manifest": f"/api/streams/{media_id}/hls/stream.m3u8",
        "started": True,
    }


@api_router.post("/streams/{media_id}/stop")
async def stop_stream(media_id: str, _: bool = Depends(require_auth)):
    async with _streams_lock:
        await _stop_stream_locked(media_id)
    return {"ok": True}


@api_router.get("/streams/{media_id}/hls/{filename}")
async def serve_hls(media_id: str, filename: str):
    # Light validation to keep this endpoint scoped to its directory.
    if "/" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Ugyldig filnavn")
    info = _active_streams.get(media_id)
    if info:
        info["last_access"] = time.time()
    file_path = STREAMS_ROOT / media_id / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Segment ikke klart ennå")
    if filename.endswith(".m3u8"):
        media_type = "application/vnd.apple.mpegurl"
    elif filename.endswith(".ts"):
        media_type = "video/mp2t"
    else:
        media_type = "application/octet-stream"
    headers = {
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
    }
    return FileResponse(file_path, media_type=media_type, headers=headers)


@api_router.get("/schedule", response_model=List[ScheduleOut])
async def list_schedule(room: str = Query(DEFAULT_ROOM)):
    items = await db.schedule.find(
        {"room": _normalize_room(room)}, {"_id": 0}
    ).sort("scheduled_at", 1).to_list(500)
    return [ScheduleOut(**_serialize_schedule(i)) for i in items]


@api_router.post("/schedule", response_model=ScheduleOut)
async def create_schedule(payload: ScheduleIn, _: bool = Depends(require_auth)):
    media = await db.videos.find_one({"id": payload.media_id, "is_deleted": False}, {"_id": 0})
    if not media:
        raise HTTPException(status_code=404, detail="Media ikke funnet")
    sched_at = payload.scheduled_at
    if sched_at.tzinfo is None:
        sched_at = sched_at.replace(tzinfo=timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        "room": _normalize_room(payload.room),
        "scheduled_at": sched_at,
        "media_id": payload.media_id,
        "title": payload.title or media.get("filename", ""),
        "next_up_text": payload.next_up_text or "",
        "pre_plakat_id": payload.pre_plakat_id,
        "pre_plakat_duration": float(payload.pre_plakat_duration or 0.0),
        "duration_minutes": int(max(5, min(720, payload.duration_minutes or 15))),
        "status": "scheduled",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.schedule.insert_one(doc.copy())
    return ScheduleOut(**_serialize_schedule(doc))


@api_router.patch("/schedule/{sched_id}", response_model=ScheduleOut)
async def patch_schedule(sched_id: str, payload: SchedulePatch, _: bool = Depends(require_auth)):
    record = await db.schedule.find_one({"id": sched_id}, {"_id": 0})
    if not record:
        raise HTTPException(status_code=404, detail="Innslag ikke funnet")
    update: Dict[str, Any] = {}
    data = payload.dict(exclude_unset=True)
    for k, v in data.items():
        if k == "scheduled_at" and v is not None:
            if isinstance(v, datetime) and v.tzinfo is None:
                v = v.replace(tzinfo=timezone.utc)
            update[k] = v
        elif v is not None:
            update[k] = v
    if update:
        await db.schedule.update_one({"id": sched_id}, {"$set": update})
        record.update(update)
    return ScheduleOut(**_serialize_schedule(record))


@api_router.delete("/schedule/{sched_id}")
async def delete_schedule(sched_id: str, _: bool = Depends(require_auth)):
    res = await db.schedule.delete_one({"id": sched_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ikke funnet")
    return {"ok": True}


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


VALID_ACTIONS = {
    "play", "pause", "toggle",
    "next", "prev",
    "set_pvw", "set_pgm", "cut",
    "seek", "volume", "mute", "loop",
    "time_update", "ended",
}
# Actions that the (unauthenticated) display page is allowed to send.
PUBLIC_ACTIONS = {"ended", "time_update"}


@app.websocket("/api/ws")
async def websocket_endpoint(ws: WebSocket, room: str = Query(DEFAULT_ROOM)):
    room = _normalize_room(room)
    await manager.connect(ws, room)
    try:
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

            if action not in PUBLIC_ACTIONS:
                token = msg.get("token")
                if not token or not verify_token(token):
                    await ws.send_json({"type": "error", "error": "unauthorized"})
                    continue

            state = await get_state_doc(room)
            videos = await db.videos.find({"is_deleted": False}, {"_id": 0}).sort("created_at", 1).to_list(1000)
            ids = [v["id"] for v in videos]

            if action == "play":
                # Only meaningful if there is something in PGM
                if state.get("pgm_id"):
                    state["is_playing"] = True
            elif action == "pause":
                state["is_playing"] = False
            elif action == "toggle":
                if state.get("pgm_id"):
                    state["is_playing"] = not state.get("is_playing", False)
            elif action == "next":
                # Move PVW to the next clip in the playlist.
                cur_pvw = state.get("pvw_id")
                if cur_pvw in ids:
                    idx = ids.index(cur_pvw)
                    state["pvw_id"] = ids[(idx + 1) % len(ids)]
                elif ids:
                    state["pvw_id"] = ids[0]
            elif action == "prev":
                cur_pvw = state.get("pvw_id")
                if cur_pvw in ids:
                    idx = ids.index(cur_pvw)
                    state["pvw_id"] = ids[(idx - 1) % len(ids)]
                elif ids:
                    state["pvw_id"] = ids[0]
            elif action == "set_pvw":
                vid = msg.get("media_id") or msg.get("video_id")
                if vid is None or vid in ids:
                    state["pvw_id"] = vid if vid in ids else None
            elif action == "set_pgm":
                # Manual override: directly load PGM, frozen.
                vid = msg.get("media_id") or msg.get("video_id")
                if vid in ids:
                    state["pgm_id"] = vid
                    state["current_time"] = 0
                    state["is_playing"] = False
                elif vid is None:
                    state["pgm_id"] = None
                    state["current_time"] = 0
                    state["is_playing"] = False
            elif action == "cut":
                # Broadcast-style cut: PVW becomes new PGM, frozen on first frame.
                # The previous PGM moves into PVW (so a quick "back-cut" is possible).
                old_pgm = state.get("pgm_id")
                new_pgm = state.get("pvw_id")
                state["pgm_id"] = new_pgm
                state["pvw_id"] = old_pgm
                state["current_time"] = 0
                state["is_playing"] = False
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
                # Freeze on last frame: do NOT auto-advance, just stop playback.
                ended_id = msg.get("video_id") or msg.get("media_id")
                if ended_id == state.get("pgm_id"):
                    state["is_playing"] = False
                    # Broadcast playout: if room has a global bumper AND there's a
                    # next scheduled item, transition to bumper to fill the gap.
                    rs = await db.room_settings.find_one({"room": room}, {"_id": 0})
                    if rs and rs.get("global_bumper_id"):
                        nxt = await db.schedule.find_one(
                            {"room": room, "status": "scheduled"},
                            {"_id": 0},
                            sort=[("scheduled_at", 1)],
                        )
                        if nxt:
                            state["pgm_id"] = rs["global_bumper_id"]
                            state["pvw_id"] = nxt.get("media_id")
                            state["is_playing"] = True
                            state["current_time"] = 0
                            state["next_up_text"] = nxt.get("title") or ""
                            # Schedule a transition out of the bumper after its
                            # configured duration, so the program overview phase
                            # (or idle) can take over until the next item starts.
                            bumper_dur = float(rs.get("global_bumper_duration") or 5.0)
                            asyncio.create_task(
                                _expire_bumper(room, rs["global_bumper_id"], bumper_dur)
                            )

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
