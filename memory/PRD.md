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

## Implemented (2026-02, session 2)
- [x] Multi-room WebSocket isolation (`/control/:room`, `/display/:room`, `/playout/:room`)
- [x] PVW/PGM broadcast switcher with CUT button, mobile/PC layouts, side-by-side monitors
- [x] Image media support with configurable still duration
- [x] Video thumbnail extraction + refresh on reload
- [x] FFmpeg video trimming modal with In/Out slider + Undo history
- [x] Fullscreen Kiosk mode on `/display` with "Neste opp" overlay (last 10s)
- [x] Background playout scheduler (asyncio loop) with global bumpers + pre-plakat images
- [x] `/playout` visual timeline grid: 15-min slots 06:00–24:00, click-to-schedule, click-item-to-edit modal, day navigation, status badges, "on air" indicator (2026-02-06)
- [x] `/display` schedule ticker: subtle bottom-left strip showing next upcoming scheduled item ("Neste 20:00 · Nyhetene — om 7 min"), auto-polls every 15s, hides during "Neste opp" overlay (2026-02-06)
- [x] Automatic full-screen Programoversikt on `/display` between scheduled items and while idle: dato-toppmidt, klokke øverst til høyre, opplastet logo øverst til venstre, opplastbart bakgrunnsbilde, valgbar tekstfarge, varighet, viser de 5 neste innslagene med stor lesbar tekst. Bumper kjøres først (hvis satt) og fases automatisk ut til programoversikten via backend asyncio-task. Innstillinger på `/playout` med dedikerte upload-knapper + color picker. (2026-02-06)
- [x] `/display` locked to 16:9 broadcast aspect with letterbox/pillarbox (`min(100vw, 100vh*16/9)` stage); mobile portrait shows letterboxed 16:9, kiosk overlay hint informs user to rotate. Programoversikten bruker container query units (cqh/cqw) slik at typografien skalerer proporsjonalt med staget på alle størrelser. Endret til Helvetica font, 3 innslag i listen (i stedet for 5), og header-datoen følger nå datoen til **neste** kommende innslag — slik at kvelden før et nytt program automatisk ruller over til "Torsdag 7. mai" osv. Listen filtreres til samme dag som header-datoen for å unngå blanding av dager. (2026-02-06)
- [x] **Bugfix**: Tidssone-feil i Playout. Backend serialiserer nå `scheduled_at` med eksplisitt UTC-tz (`+00:00`) slik at JS Date-parser tolker det riktig som UTC, ikke lokal tid. Bruker som skrev 10:00 fikk tidligere innslaget plassert med UTC-offset (typisk -2h om sommeren). (2026-02-06)
- [x] **Visuell tidslinje med varighet-blokker + drag & drop**: Bygget om TimelineGrid til absolute-posisjonert grid hvor hvert innslag rendres som en blokk med høyde proporsjonal til `duration_minutes` (nytt felt på Schedule). Innslag er draggable — drop på en tom slot patcher `scheduled_at`. Modal har varighet-felt med hurtigvelger (15/30/45/60/90/120 min). Backend: `duration_minutes: int = 15` (default 15, range 5–720) i ScheduleIn/Out + create_schedule. (2026-02-06)
- [x] **Drag & drop fix**: Container-nivå drop-handler basert på Y-koordinat (i stedet for per-slot dragover). Robust mot z-index/overlapping items. Pointer-events disables på innslag mens det dras. (2026-02-06)
- [x] **Animert bumper + animert programoversikt-bakgrunn + animert logo**: Bumper, bakgrunnsplakat, og logo i programoversikt kan nå være enten bilde eller video (loop, autoplay, muted). Egen "Last opp bumper"-knapp i Playout-innstillinger som godtar både `image/*,video/*`. ProgramOverview-komponenten rendrer `<video>` automatisk når `media_type === 'video'`. (2026-02-06)
- [x] **Pre-roll bumper-fallback**: Når et schedulert innslag ikke har eksplisitt pre-plakat, faller scheduler nå tilbake på rommets globale bumper (id + duration). Bumperen spilles automatisk N sekunder før program-start, deretter overgang til hovedinnslag. (2026-02-06)
- [x] **Bugfix drag & drop** (2026-02-06): forrige containerhandler sjekket `draggingId`-state som ikke oppdateres synkront — `dragover` ble derfor aldri prevented. Endret til `useRef` (`draggingIdRef.current`) som settes synkront i `dragstart`. Ekte browser-drag fungerer nå (Playwright `mouse.down/move/up` simulerer ikke HTML5 D&D, men `DragEvent`-dispatch verifiserer fixen).
- [x] **Bugfix programoversikt mellom innslag** (2026-02-06): tidligere krevde overlay `idle = !pgm_id`. Når en bruker hadde gammel PGM hengende i room state (typisk etter manuell switch eller forrige scheduler-kjøring), forhindret PGM at programoversikten viste seg før neste innslag. Endret til `isInScheduledWindow` som beregnes fra schedule + nå-tid + pre-roll: overlay tar over når intet innslag er innenfor `[start - preRoll, start + duration]`. Pause-useEffect sørger samtidig for at video-elementet pauses når overlay kommer på, så det ikke lekker lyd.
- [x] **Glatte overganger uten svart drop** (2026-02-06): alle lag på `/display` (video, image, idle, program overview) er nå alltid mounted og crossfader via `transition-opacity duration-500`. Mellom to videoer brukes en `<canvas>` til å capture siste frame av utgående video → rendres som `<img>` overlay som fader fra opacity-1 til 0 når nytt kildemedium har `canplay`-eventet. Effekten er en broadcast-stil crossfade i stedet for svart gap mens nytt video-element laster.
- [x] **SRT/RTMP live-strøm-støtte på timeline** (2026-02-07): Nytt media_type `stream` med `stream_url`, `stream_protocol` (srt/rtmp), `stream_mode` (caller/listener for SRT). `/upload` har egen "Legg til strøm"-modal. Backend spawner ffmpeg ved `POST /api/streams/{id}/start` som henter SRT/RTMP og produserer HLS-segmenter til `/tmp/kk_streams/{id}/`. Display.jsx bruker hls.js for avspilling (eller native i Safari). Idle-cleanup-task stopper ffmpeg-prosesser etter 60s inaktivitet. Strømmer kan velges i Playout-modal som `STRØM · navn` og brukes som scheduled innslag.
- [x] **Bugfix: Video stoppet før klippet var ferdig** (2026-02-07): Apply-state-useEffect på Display seek videoen tilbake til `state.current_time` på hver state-broadcast. Backend oppdaterer ikke `state.current_time` mens video spiller (Display sender ikke timeupdate→backend), så hver scheduler-tick som re-broadcasted state forårsaket at videoen hoppet tilbake til 0. Fix: bruk `useRef` til å spore sist-applisert `state.current_time` og seek kun når den faktisk endres (operator-seek fra Control eller nytt innslag).
- [x] **Inline rename av media + mobile touch-drag** (2026-02-07): Nytt `PATCH /api/videos/{id}/filename`-endepunkt for å gi nytt navn til opplastet media. Filnavnet i `/upload`-biblioteket er nå et redigerbart `<input>` (Enter for å lagre, Escape for å avbryte) med toast-bekreftelse. På `/playout`-tidslinjen er HTML5 drag-and-drop nå komplettert med touch-event-handlere (`touchstart/move/end`) for mobil: 350ms long-press på et innslag aktiverer drag-modus (m/haptic feedback), bevegelse oppdaterer dragOverIdx, og lift-off plasserer innslaget på den slot fingeren slipper på. Vanlig tap fortsatt åpner edit-modal.
- [x] **Bugfix: Avspilling avbrutt etter ~10s av programoversikt** (2026-02-07): `isInScheduledWindow` på Display ekskluderte items med `status="played"`, men scheduler setter `played` straks innslaget STARTER (ikke når det slutter). Etter ~15s polling-intervall så Display den nye statusen → overview maskerte den pågående videoen. Fix: filteret ekskluderer nå kun `status="cancelled"`. Det aktive vinduet bestemmes utelukkende av tid vs `scheduled_at + duration_minutes`.
- [x] **Bugfix: Audio-lekkasje + synlig flash i overganger** (2026-02-07): Tre relaterte bugs i overgangene mellom programoversikt → bumper → innslag.
  1. **Audio-lekkasje**: Etter src-bytte autoplay'et `<video>` med `state.muted=false`, selv mens overview var oppe. Fix: ved hver src-load i swap-effekten, hvis `showOverviewRef.current=true`, force `v.muted=true` + `v.pause()`. Pause-useEffect mirror'er også statisk muted-state og avmuter først når overview faktisk skjules.
  2. **Visuell flash**: Overview falmet ut (500ms) selv om neste video-element fortsatt lastet → bruker så et brøkdels sekund av ny PGM gjennom semi-transparent overlay. Fix: Ny `mediaReady`-state som er `false` mens video/stream/image laster og blir `true` på `canplay`/`loadeddata`/`onLoad`. `showProgramOverview` evalueres nå som `(!isInScheduledWindow || !mediaReady)` — overview holder seg oppe til neste media kan rendre sin første ramme. Safety-timeout 3s så overview ikke blir hengende.
  3. **Sort gap mellom segmenter**: Samme `mediaReady`-fix maskerer 200–500ms loading-tiden mellom bumper og hovedinnslag. Også: `<video preload="auto">` for å forberede dekoding så snart src settes.
- [x] **Faktisk klipp-lengde via ffprobe** (2026-02-06): Backend ekstraherer `duration` fra opplastede videoer ved hjelp av `ffprobe`. Default `duration_minutes` i ItemModal beregnes fra `Math.ceil(media.duration / 60)` med 5-min minimum, og modalen viser "faktisk klipp-lengde Xm Ys"-hint. ffmpeg/ffprobe re-installert via apt-get.

## Test Results (Iteration 4, 2026-02-06)
- Backend: iteration_1 (17/17) + iteration_2 + iteration_3 all green; iteration_4 added `/app/backend/tests/test_playout.py` covering schedule CRUD/auth/404 + room settings (8 pass, 5 fixture-only errors unrelated to product)
- Frontend E2E (Playwright smoke): click empty slot → modal with pre-filled time ✓, create/edit/delete item ✓, ESC close ✓, day nav ✓, "Nytt innslag" default 20:00 ✓

## Backlog
### P1
- Drag & drop items between timeline slots
- Visual duration block spanning multiple slots (proportional to media duration)
- "N items outside visible 06:00–24:00 range" hint on timeline
### P2
- Weekly view (7 days side by side) for playout
- Duplicate/copy schedule item to another time
- Split `server.py` into routes/, models/, services/ modules (file is growing large)
- Stream video with chunked passthrough (currently loads full bytes — fine for small clips, OOM risk for large)
- Wrap synchronous storage calls in `asyncio.to_thread`
- Migrate `@app.on_event` to FastAPI lifespan
- Crossfade transitions between clips on display
