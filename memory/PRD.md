# KinoKontroll – PRD

## Original Problem Statement
"Lag en app hvor man har tre url'er en er for fullskjerm video visning, en for å laste inn videoklipp og en for å kontrollere avspillingen av videoklippene."

(Build an app with three URLs: one for fullscreen video display, one for uploading video clips, and one for controlling playback of the video clips.)

## User Choices (2026-02)
- Real-time WebSocket synchronization between control and display
- Emergent object storage for video files
- Extended controls: play/pause, next/prev, volume, timeline seek, loop, playlist
- Simple shared-password protection for /upload and /control
- Dark, cinematic theme (Norwegian language)

## Architecture
- **Backend**: FastAPI + MongoDB + Emergent object storage; WebSocket at `/api/ws`; JWT (HS256) auth.
- **Frontend**: React Router v7 + Tailwind + shadcn/ui + sonner toasts + lucide-react.
- **State**: Single shared "global" playback state document in MongoDB; WS broadcasts to all clients.

## Routes
- `/` – Landing (public)
- `/login` – Password gate
- `/display` – Public fullscreen passive viewer (cinema/projector screen)
- `/upload` – Protected: drag/drop upload, list, soft-delete
- `/control` – Protected: playlist, transport, timeline, volume, loop, mute, connection status

## Implemented (2026-02-XX)
- [x] Auth: POST /api/auth/login, GET /api/auth/verify (JWT 7-day)
- [x] Videos: upload (multipart) → object storage; list; soft-delete; stream with HTTP Range support (206)
- [x] Playback state: persisted in MongoDB, served via GET /api/state and broadcast via WS
- [x] WebSocket sync: play/pause/toggle/next/prev/select/seek/volume/mute/loop/time_update
- [x] Display page: WS subscriber, video element, idle placeholder, cursor auto-hide
- [x] Control page: full transport deck, real-time playlist with active highlight, animated equalizer for now-playing, connection indicator, "open display" link
- [x] Upload page: drag/drop dropzone, progress bar, library list, delete
- [x] Cinematic dark theme with cinema-marquee gold (#F59E0B), grain texture, Outfit/Manrope/JetBrains Mono fonts
- [x] All interactive elements have data-testid

## Test Results (Iteration 1)
- Backend: 17/17 pytest tests passed (auth, CRUD, range streaming, WS auth/broadcast)
- Frontend: All flows verified (login, upload, control, display, WS sync)

## Backlog
### P1
- Stream video with chunked passthrough (currently loads full bytes — fine for small clips, OOM risk for large)
- Wrap synchronous storage calls in `asyncio.to_thread`
- Add max upload size guard
### P2
- Migrate `@app.on_event` to FastAPI lifespan
- Toast on WS unauthorized error
- Multi-room support (currently single global state)
- Video thumbnails on upload
- Crossfade transitions between clips on display
- Schedule / playlist auto-advance modes (random, sequential)
