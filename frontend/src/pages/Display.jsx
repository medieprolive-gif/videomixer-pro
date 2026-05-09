import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Film, Maximize2 } from "lucide-react";
import Hls from "hls.js";
import { useSync } from "../lib/useSync";
import { api, streamUrl, thumbUrl, API } from "../lib/api";
import ProgramOverview from "../components/ProgramOverview";

function isFullscreen() {
  return Boolean(
    document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
  );
}

async function enterFullscreen(el) {
  const fn =
    el.requestFullscreen ||
    el.webkitRequestFullscreen ||
    el.msRequestFullscreen;
  if (!fn) return false;
  try {
    await fn.call(el, { navigationUI: "hide" });
    return true;
  } catch (_) {
    try {
      await fn.call(el);
      return true;
    } catch (_e) {
      return false;
    }
  }
}

async function exitFullscreen() {
  const fn =
    document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.msExitFullscreen;
  if (fn) {
    try {
      await fn.call(document);
    } catch (_) {
      /* noop */
    }
  }
}

export default function Display() {
  const { room } = useParams();
  const roomId = room || "default";
  const { state, sendPublic } = useSync(roomId);

  const [media, setMedia] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [settings, setSettings] = useState(null);
  const [now, setNow] = useState(Date.now());
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const hlsRef = useRef(null);
  // Mirror of showProgramOverview that swap-effect can read without creating
  // a temporal-dead-zone in the dependency array (showProgramOverview is
  // declared further down in the component body).
  const showOverviewRef = useRef(false);
  const [showCursor, setShowCursor] = useState(false);
  // Becomes true when an upstream live stream is selected as PGM but the
  // HLS manifest has been unavailable for an extended period (typically
  // because the encoder is offline). Surfaces a "Venter på strøm"-overlay
  // instead of the browser's blank/play-button fallback.
  const [streamWaiting, setStreamWaiting] = useState(false);
  const [fs, setFs] = useState(false);
  const [showKioskOverlay, setShowKioskOverlay] = useState(true);
  const [frozenFrame, setFrozenFrame] = useState(null);
  const [frozenOpacity, setFrozenOpacity] = useState(0);
  const cursorTimer = useRef(null);
  const imageTimer = useRef(null);
  const frozenTimer = useRef(null);
  // Tracks the currently-loaded source id WITHOUT triggering re-renders.
  // Using state for this caused the swap-effect to re-run mid-flight (after
  // setCurrentSrcId), which would cancel the in-progress HLS attach IIFE
  // before `hls.attachMedia` was ever called.
  const currentSrcIdRef = useRef(null);

  // Load media library (so we know media_type / duration of pgm_id)
  const loadMedia = useCallback(async () => {
    try {
      const r = await api.get("/videos");
      setMedia(r.data || []);
    } catch (_) {
      /* noop */
    }
  }, []);
  useEffect(() => {
    loadMedia();
  }, [loadMedia]);
  useEffect(() => {
    // Refetch when pgm changes (e.g., new uploads while open)
    loadMedia();
  }, [state?.pgm_id, loadMedia]);

  // Load + poll schedule for "next scheduled" ticker
  const loadSchedule = useCallback(async () => {
    try {
      const r = await api.get("/schedule", { params: { room: roomId } });
      setSchedule(r.data || []);
    } catch (_) {
      /* noop */
    }
  }, [roomId]);
  useEffect(() => {
    loadSchedule();
    const i = setInterval(loadSchedule, 15000);
    return () => clearInterval(i);
  }, [loadSchedule]);

  // Load room settings (program overview config) – poll periodically so changes
  // made in /playout reach the projector without a reload.
  const loadSettings = useCallback(async () => {
    try {
      const r = await api.get(`/rooms/${roomId}/settings`);
      setSettings(r.data || null);
    } catch (_) {
      /* noop */
    }
  }, [roomId]);
  useEffect(() => {
    loadSettings();
    const i = setInterval(loadSettings, 20000);
    return () => clearInterval(i);
  }, [loadSettings]);
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  const pgm = useMemo(
    () => media.find((m) => m.id === state?.pgm_id) || null,
    [media, state?.pgm_id]
  );
  const isVideo = pgm?.media_type === "video";
  const isImage = pgm?.media_type === "image";
  const isStream = pgm?.media_type === "stream";

  // Track fullscreen changes
  useEffect(() => {
    const onChange = () => {
      const inFs = isFullscreen();
      setFs(inFs);
      if (inFs) setShowKioskOverlay(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Try auto-fullscreen
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const el = containerRef.current;
      if (!el) return;
      const ok = await enterFullscreen(el);
      if (!cancelled && ok) setShowKioskOverlay(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // F key toggles fullscreen
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (isFullscreen()) exitFullscreen();
        else if (containerRef.current) enterFullscreen(containerRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Cursor hide
  useEffect(() => {
    const onMove = () => {
      setShowCursor(true);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
      cursorTimer.current = setTimeout(() => setShowCursor(false), 2000);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (cursorTimer.current) clearTimeout(cursorTimer.current);
    };
  }, []);

  // Swap video src when PGM video changes. Before the swap we capture the
  // outgoing video's current frame onto a canvas and render it as a fade-out
  // overlay, giving a broadcast-style crossfade instead of a black drop while
  // the new source loads.
  useEffect(() => {
    if (!isVideo && !isStream) return;
    const v = videoRef.current;
    if (!v) return;
    if (state?.pgm_id === currentSrcIdRef.current) return;

    // Capture last frame of the OUTGOING video so we can crossfade over the
    // black gap while the new source is buffering.
    if (currentSrcIdRef.current && v.videoWidth > 0 && v.readyState >= 2) {
      try {
        const c = canvasRef.current || document.createElement("canvas");
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext("2d").drawImage(v, 0, 0);
        const dataUrl = c.toDataURL("image/jpeg", 0.6);
        setFrozenFrame(dataUrl);
        setFrozenOpacity(1);
      } catch (_) {
        /* CORS / taint — skip crossfade */
      }
    }

    currentSrcIdRef.current = state?.pgm_id;

    // Tear down previous hls.js instance if any
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch (_) {
        /* noop */
      }
      hlsRef.current = null;
    }

    if (!state?.pgm_id) {
      v.removeAttribute("src");
      v.load();
      return;
    }

    if (isStream) {
      // Live stream: ask backend to start the ffmpeg→HLS pipeline, then play
      // the manifest via hls.js (or natively in Safari). We MUST start muted
      // — browsers block autoplay-with-sound without user gesture, and the
      // result is the native play-button overlay instead of a live picture.
      // Once the first frame is rendered, the apply-state effect re-syncs
      // mute from the global state.
      v.muted = true;
      setStreamWaiting(false);
      let cancelled = false;
      (async () => {
        try {
          await api.post(`/streams/${state.pgm_id}/start`);
        } catch (e) {
          // Endpoint is public, so failure here means a network or backend
          // issue — log so we can debug. The manifest fetch below will also
          // fail and hls.js will retry.
          // eslint-disable-next-line no-console
          console.warn("stream start failed", e?.message || e);
        }
        if (cancelled) return;
        const manifest = `${API}/streams/${state.pgm_id}/hls/stream.m3u8`;
        if (Hls.isSupported()) {
          const hls = new Hls({ liveDurationInfinity: true, lowLatencyMode: true });
          hlsRef.current = hls;
          hls.attachMedia(v);
          hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            // Retry loadSource a few times until ffmpeg has emitted the first
            // segments; the manifest 404s briefly during startup, and
            // longer if the upstream encoder is offline.
            let attempts = 0;
            const tryLoad = () => {
              attempts += 1;
              hls.loadSource(manifest);
            };
            tryLoad();
            hls.on(Hls.Events.ERROR, (_evt, data) => {
              if (
                data.fatal &&
                data.type === Hls.ErrorTypes.NETWORK_ERROR
              ) {
                if (attempts < 60) {
                  // Keep retrying for ~90s — handles the case where the
                  // upstream encoder reconnects after a brief drop.
                  setTimeout(tryLoad, 1500);
                } else {
                  setStreamWaiting(true);
                }
              }
            });
            hls.on(Hls.Events.FRAG_LOADED, () => {
              setStreamWaiting(false);
            });
          });
          // Once we have a manifest parsed, force a play() — autoplay
          // attribute may have been suppressed by earlier muted-pause
          // logic, and hls.js doesn't auto-start playback.
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            setStreamWaiting(false);
            const p = v.play();
            if (p && p.catch) p.catch(() => {});
          });
        } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
          v.src = manifest;
          v.load();
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    // Static video file
    v.src = streamUrl(state.pgm_id);
    v.load();
    if (showOverviewRef.current) {
      // Don't let autoplay leak audio while overview is up.
      v.muted = true;
      try {
        v.pause();
      } catch (_) {
        /* noop */
      }
    }
  }, [state?.pgm_id, isVideo, isStream]);

  // Fade out the frozen frame once the new video is ready to render pixels.
  useEffect(() => {
    if (!frozenFrame) return;
    const v = videoRef.current;
    if (!v) return;
    const onReady = () => {
      setFrozenOpacity(0);
      if (frozenTimer.current) clearTimeout(frozenTimer.current);
      frozenTimer.current = setTimeout(() => setFrozenFrame(null), 700);
    };
    v.addEventListener("canplay", onReady);
    // Safety net: always clear after 1.5s even if canplay never fires
    const safety = setTimeout(onReady, 1500);
    return () => {
      v.removeEventListener("canplay", onReady);
      clearTimeout(safety);
    };
  }, [frozenFrame]);

  // Apply playback state to <video>
  // The backend's `state.current_time` only changes on explicit seeks (or
  // when a new item starts). The Display does NOT push timeupdate → backend.
  // We must therefore track the LAST APPLIED time so that recurring state
  // broadcasts (e.g. scheduler ticks every 2s) don't keep snapping the video
  // back to a stale cached time and cause apparent freezes / restarts.
  const lastAppliedTimeRef = useRef(null);
  const lastAppliedSrcIdRef = useRef(null);
  useEffect(() => {
    if (!state || (!isVideo && !isStream)) return;
    const v = videoRef.current;
    if (!v) return;
    // While the program overview is up, do NOT touch volume/mute/play —
    // otherwise the freshly-loaded next video would briefly emit audio
    // through the overlay before the dedicated overview-pause effect
    // re-mutes/pauses it. The overview-pause effect (further down) is the
    // single source of truth for play state in that case.
    if (showOverviewRef.current) return;
    v.volume = state.volume ?? 1;
    // Live streams stay MUTED on the display. Browser autoplay-with-sound
    // policy blocks programmatic unmute on most TV/kiosk browsers (even
    // after a click on the kiosk-start button), and the side effect of a
    // failed unmute is the browser pausing the element — which surfaces the
    // native play-button overlay. Audio for live programs is expected to
    // flow through the broadcast path (HDMI/SDI/etc.), not through the
    // browser. Pre-recorded videos still respect `state.muted` as before.
    if (isStream) {
      v.muted = true;
    } else {
      v.muted = !!state.muted;
    }
    v.loop = !!state.loop && !isStream; // looping makes no sense for live streams

    // Reset the cached "last applied time" when the underlying source changes
    // so that the new item's initial seek (typically to 0) is honoured.
    if (lastAppliedSrcIdRef.current !== state.pgm_id) {
      lastAppliedSrcIdRef.current = state.pgm_id;
      lastAppliedTimeRef.current = null;
    }

    if (typeof state.current_time === "number" && !isStream) {
      // Only seek when the backend-driven time has actually changed (i.e.
      // an operator seeked from /control or a new item started).
      if (lastAppliedTimeRef.current !== state.current_time) {
        lastAppliedTimeRef.current = state.current_time;
        const drift = Math.abs(v.currentTime - state.current_time);
        if (drift > 1.0) {
          try {
            v.currentTime = state.current_time;
          } catch (_) {
            /* noop */
          }
        }
      }
    }

    if (state.is_playing) {
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      v.pause();
    }
  }, [state, isVideo, isStream]);

  // Video ended -> notify backend (freezes on last frame, no auto-advance)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => {
      if (state?.pgm_id) sendPublic({ action: "ended", media_id: state.pgm_id });
    };
    v.addEventListener("ended", onEnded);
    return () => {
      v.removeEventListener("ended", onEnded);
    };
  }, [state?.pgm_id, sendPublic]);

  // Image duration timer
  useEffect(() => {
    if (imageTimer.current) {
      clearTimeout(imageTimer.current);
      imageTimer.current = null;
    }
    if (!isImage || !pgm || !state?.is_playing) return;
    const dur = pgm.duration || 5;
    const remaining = Math.max(0.2, dur - (state.current_time || 0));
    imageTimer.current = setTimeout(() => {
      if (state?.pgm_id) sendPublic({ action: "ended", media_id: state.pgm_id });
    }, remaining * 1000);
    return () => {
      if (imageTimer.current) clearTimeout(imageTimer.current);
    };
  }, [isImage, pgm, state?.is_playing, state?.current_time, state?.pgm_id, sendPublic]);

  const enterKiosk = useCallback(async () => {
    if (containerRef.current) await enterFullscreen(containerRef.current);
    setShowKioskOverlay(false);
  }, []);

  // Track current playback time + duration for "next up" overlay timing
  const [pgmTime, setPgmTime] = useState(0);
  const [pgmDuration, setPgmDuration] = useState(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !isVideo) {
      setPgmTime(0);
      setPgmDuration(pgm?.duration || 0);
      return;
    }
    const onTime = () => setPgmTime(v.currentTime || 0);
    const onMeta = () => setPgmDuration(v.duration || 0);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
    };
  }, [isVideo, pgm?.id, pgm?.duration]);

  // For images, use synced state.current_time as the "elapsed" indicator
  useEffect(() => {
    if (isImage && state) {
      setPgmTime(state.current_time || 0);
      setPgmDuration(pgm?.duration || 5);
    }
  }, [isImage, state?.current_time, pgm?.duration, state]);

  const remaining = Math.max(0, (pgmDuration || 0) - (pgmTime || 0));
  const showNextUp =
    !!state?.next_up_text &&
    !!pgm &&
    state?.is_playing &&
    pgmDuration > 0 &&
    remaining <= 10 &&
    remaining > 0;

  const idle = !state?.pgm_id;

  // Is any scheduled item currently within its play window?
  // Used by the program-overview overlay so it takes precedence between
  // programs even if the room state still holds a stale pgm_id from earlier
  // playback. When the scheduler is actively running an item we let the video
  // play normally.
  //
  // NOTE: We intentionally do NOT include the global pre-roll bumper in the
  // window — automatic bumpers are disabled to avoid rough transitions.
  // Only an item's own `pre_plakat_duration` (manual per-item plakat) extends
  // the window backward.
  //
  // NOTE: Backend marks status="played" the moment it STARTS playing, not when
  // the clip finishes. So we must NOT exclude "played" here — only "cancelled".
  // The active window is determined purely by time vs scheduled_at + duration.
  const isInScheduledWindow = useMemo(() => {
    const ts = now;
    return (schedule || []).some((s) => {
      if (s.status === "cancelled") return false;
      const start = new Date(s.scheduled_at).getTime();
      const dur = (s.duration_minutes || 15) * 60 * 1000;
      const itemPre = (s.pre_plakat_duration || 0) * 1000;
      return ts >= start - itemPre && ts < start + dur;
    });
  }, [schedule, now]);

  // Next scheduled item (upcoming, status=scheduled)
  const nextScheduled = useMemo(() => {
    const upcoming = schedule
      .filter((s) => s.status === "scheduled" && new Date(s.scheduled_at).getTime() > now)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    return upcoming[0] || null;
  }, [schedule, now]);

  const nextScheduledLabel = useMemo(() => {
    if (!nextScheduled) return null;
    const dt = new Date(nextScheduled.scheduled_at);
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    const m = media.find((x) => x.id === nextScheduled.media_id);
    const title = nextScheduled.title || m?.filename || "—";
    const diffMs = dt.getTime() - now;
    const diffMin = Math.round(diffMs / 60000);
    let rel = "";
    if (diffMin < 1) rel = "straks";
    else if (diffMin < 60) rel = `om ${diffMin} min`;
    else {
      const h = Math.floor(diffMin / 60);
      const mRest = diffMin % 60;
      rel = mRest ? `om ${h}t ${mRest}m` : `om ${h}t`;
    }
    return { time: `${hh}:${mm}`, title, rel };
  }, [nextScheduled, media, now]);

  // Show schedule ticker when idle OR not overlapping with "next up"-overlay
  // Hidden when full program overview is up (it already shows next items).
  const showScheduleTicker =
    !!nextScheduledLabel && !showNextUp && !showKioskOverlay;

  // Track whether the currently-pointed-to media element is ready to render
  // its first frame. We use this to hold the program-overview overlay up
  // until the next clip (video/stream/image) is decoded — that masks the
  // black "loading" gap between segments and gives broadcast-style cuts.
  const [mediaReady, setMediaReady] = useState(true);

  // Program overview: shown full-screen between scheduled items and while idle.
  // Driven by user setting on /playout. Hides when:
  //  - kiosk start overlay is up (initial fullscreen prompt)
  //  - a scheduled item is currently within its play window AND the new
  //    media has reported it can render its first frame (no black flash)
  //  - the "Next up" overlay is up (so we don't double up text on screen)
  const showProgramOverview =
    !!settings?.program_overview_enabled &&
    !showKioskOverlay &&
    !showNextUp &&
    // Hold the overview up until we ACTUALLY have playable media on screen.
    // Three guards: (1) no scheduled item is in its window yet, (2) the
    // backend hasn't pushed the new pgm_id (state.pgm_id null), or (3) the
    // media element has not signalled it can render its first frame. This
    // eliminates the black gap between overview-hides and video-shows.
    (!isInScheduledWindow || !state?.pgm_id || !mediaReady);
  showOverviewRef.current = showProgramOverview;

  // Reset mediaReady whenever PGM source changes; flip back to true when the
  // new source signals it can render pixels (canplay for video, image onload).
  useEffect(() => {
    if (!state?.pgm_id) {
      setMediaReady(true);
      return;
    }
    if (!isVideo && !isStream && !isImage) {
      setMediaReady(true);
      return;
    }
    setMediaReady(false);
    const safety = setTimeout(() => setMediaReady(true), 3000);
    if (isVideo || isStream) {
      const v = videoRef.current;
      if (!v) {
        setMediaReady(true);
        return;
      }
      const onReady = () => setMediaReady(true);
      v.addEventListener("canplay", onReady, { once: true });
      v.addEventListener("loadeddata", onReady, { once: true });
      return () => {
        clearTimeout(safety);
        v.removeEventListener("canplay", onReady);
        v.removeEventListener("loadeddata", onReady);
      };
    }
    // Images: rely on <img onLoad> via state setter below
    return () => clearTimeout(safety);
  }, [state?.pgm_id, isVideo, isStream, isImage]);

  // Pause video element while program overview takes over so we don't get
  // background audio leaking through the overlay.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (showProgramOverview) {
      try {
        v.pause();
      } catch (_) {
        /* noop */
      }
      v.muted = true;
    } else if ((isVideo || isStream) && state?.is_playing) {
      v.muted = !!state?.muted;
      v.play().catch(() => {});
    }
  }, [showProgramOverview, isVideo, isStream, state?.is_playing, state?.muted, state?.pgm_id, mediaReady]);

  return (
    <div
      ref={containerRef}
      data-testid="display-page"
      className={`w-screen h-screen bg-black overflow-hidden flex items-center justify-center m-0 p-0 ${
        showCursor || showKioskOverlay ? "" : "cursor-none"
      }`}
      style={{ fontFamily: "Helvetica, Arial, sans-serif" }}
    >
      {/* 16:9 stage — letterboxes/pillarboxes on non-16:9 viewports so the
          program output is always rendered at the broadcast aspect ratio. */}
      <div
        data-testid="display-stage"
        className="relative bg-black overflow-hidden"
        style={{
          width: "min(100vw, calc(100vh * 16 / 9))",
          height: "min(100vh, calc(100vw * 9 / 16))",
        }}
      >
        <video
          ref={(el) => {
            videoRef.current = el;
            if (el) {
              // Critical: React's `muted` JSX prop doesn't reliably set the
              // DOM `muted` property. Without an actually-muted element,
              // browsers attempt autoplay-with-sound, get rejected, and
              // surface their native play-button overlay instead of the
              // stream. Setting `muted` imperatively here guarantees the
              // element is muted from its very first frame, which lets
              // autoplay succeed on TVs and mobile.
              el.muted = true;
              el.defaultMuted = true;
            }
          }}
          data-testid="display-video"
          className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-500 ${
            (isVideo || isStream) && !showProgramOverview
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
          playsInline
          autoPlay
          preload="auto"
        />

        {/* Crossfade snapshot — shows last frame of outgoing video until the
            new source is ready to paint pixels, then fades to 0 over 500ms. */}
        {frozenFrame && (
          <img
            src={frozenFrame}
            alt=""
            data-testid="display-crossfade"
            aria-hidden="true"
            style={{
              opacity: frozenOpacity,
              transition: "opacity 500ms ease-out",
            }}
            className="absolute inset-0 w-full h-full object-contain bg-black z-[5] pointer-events-none"
          />
        )}
        <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

        <img
          data-testid="display-image"
          src={isImage && pgm ? thumbUrl(pgm.id) : ""}
          alt={pgm?.filename || ""}
          onLoad={() => isImage && setMediaReady(true)}
          className={`absolute inset-0 w-full h-full object-contain bg-black transition-opacity duration-500 ${
            isImage && pgm && !showProgramOverview ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        />

        <div
          className={`absolute inset-0 flex flex-col items-center justify-center text-center transition-opacity duration-500 ${
            idle && !showKioskOverlay && !showProgramOverview
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
          data-testid="display-idle"
        >
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border border-white/10 mb-6 animate-pulse">
            <Film className="w-8 h-8 text-[#F59E0B]" strokeWidth={1.5} />
          </div>
          <div className="text-3xl font-semibold tracking-tight text-white mb-2">
            KinoKontroll
          </div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-600">
            Venter på avspilling
          </div>
          <div className="mt-6 text-[10px] uppercase tracking-[0.3em] text-zinc-700 font-mono">
            Sal · {roomId}
          </div>
        </div>

        {/* "Venter på strøm" — appears when an upstream live stream is the
            PGM but its HLS manifest stays unavailable (encoder offline). */}
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center text-center transition-opacity duration-500 z-20 ${
            isStream && streamWaiting && !showProgramOverview && !showKioskOverlay
              ? "opacity-100"
              : "opacity-0 pointer-events-none"
          }`}
          data-testid="display-stream-waiting"
        >
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border border-rose-500/30 bg-rose-500/5 mb-6">
            <Film className="w-8 h-8 text-rose-400 animate-pulse" strokeWidth={1.5} />
          </div>
          <div className="text-3xl font-semibold tracking-tight text-white mb-2">
            Venter på strøm
          </div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-500">
            Live-kilden er ikke tilgjengelig
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-[0.2em] text-zinc-700 font-mono">
            {pgm?.stream_protocol?.toUpperCase() || ""} · {pgm?.filename}
          </div>
        </div>

        {/* "Neste opp"-overlay (siste 10 sek av PGM) */}
        {showNextUp && (
          <div
            data-testid="display-next-up-overlay"
            className="absolute bottom-[6%] left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-black/75 backdrop-blur-sm border border-[#F59E0B]/40 px-6 py-3 rounded-md shadow-2xl animate-pulse"
            style={{ animation: "kk-fade-in 0.4s ease-out" }}
          >
            <div className="text-[10px] uppercase tracking-[0.3em] text-[#F59E0B] font-mono font-semibold">
              Neste opp
            </div>
            <div className="text-white text-lg max-w-2xl truncate">
              {state.next_up_text}
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-zinc-500 ml-2">
              {Math.ceil(remaining)}s
            </div>
          </div>
        )}

        {/* Program overview — always mounted, crossfades via opacity so the
            transition between PGM video and overview is smooth (no black drop). */}
        <div
          className={`absolute inset-0 z-10 transition-opacity duration-500 ${
            showProgramOverview ? "opacity-100" : "opacity-0 pointer-events-none"
          }`}
        >
          {settings?.program_overview_enabled && (
            <ProgramOverview
              active={showProgramOverview}
              settings={settings}
              schedule={schedule}
              media={media}
              roomId={roomId}
            />
          )}
        </div>

        {/* Neste innslag (fra spillelisten) – vises kontinuerlig nederst */}
        {showScheduleTicker && !showProgramOverview && (
          <div
            data-testid="display-schedule-ticker"
            className="absolute bottom-[3%] left-[2%] z-20 flex items-center gap-3 bg-black/55 backdrop-blur-md border border-white/10 px-4 py-2 rounded-md shadow-xl"
            style={{ animation: "kk-fade-in 0.5s ease-out" }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
            <span className="text-[10px] uppercase tracking-[0.3em] text-[#F59E0B] font-mono font-semibold">
              Neste
            </span>
            <span className="font-mono text-sm text-white tracking-wider">
              {nextScheduledLabel.time}
            </span>
            <span className="text-zinc-600">·</span>
            <span className="text-white text-sm max-w-[40ch] truncate">
              {nextScheduledLabel.title}
            </span>
            <span className="text-[10px] uppercase tracking-[0.2em] font-mono text-zinc-500">
              {nextScheduledLabel.rel}
            </span>
          </div>
        )}

        {/* KIOSK indicator (top-right, fades with cursor) */}
        {fs && showCursor && (
          <div
            className="absolute top-[2%] right-[2%] z-40 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-mono bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/10"
            data-testid="display-fs-badge"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
            KIOSK · {roomId}
          </div>
        )}
      </div>

      {/* Kiosk start overlay (covers entire viewport including letterbox bars) */}
      {showKioskOverlay && (
        <button
          type="button"
          onClick={enterKiosk}
          data-testid="display-kiosk-start"
          className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black text-center group"
        >
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full border border-[#F59E0B]/40 bg-[#F59E0B]/5 mb-8 group-hover:bg-[#F59E0B]/10 transition-colors">
            <Maximize2 className="w-9 h-9 text-[#F59E0B]" strokeWidth={1.5} />
          </div>
          <div className="text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-3">
            Trykk for å starte kiosk
          </div>
          <div className="text-sm text-zinc-400 max-w-md px-6">
            KinoKontroll åpnes i fullskjerm. Trykk{" "}
            <span className="font-mono text-[#F59E0B] px-1.5 py-0.5 rounded bg-[#F59E0B]/10 border border-[#F59E0B]/30">
              F
            </span>{" "}
            for å veksle, eller{" "}
            <span className="font-mono text-[#F59E0B] px-1.5 py-0.5 rounded bg-[#F59E0B]/10 border border-[#F59E0B]/30">
              ESC
            </span>{" "}
            for å avslutte.
          </div>
          <div className="mt-6 text-xs text-zinc-500 max-w-md px-6">
            Tips: Skjermen vises i 16:9. Roter mobilen horisontalt for full visning.
          </div>
          <div className="mt-10 text-[10px] uppercase tracking-[0.3em] text-zinc-700 font-mono">
            Sal · {roomId}
          </div>
        </button>
      )}
    </div>
  );
}
