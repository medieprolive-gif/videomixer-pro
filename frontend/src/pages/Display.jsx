import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { Film, Maximize2 } from "lucide-react";
import { useSync } from "../lib/useSync";
import { streamUrl } from "../lib/api";

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
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const [currentSrcId, setCurrentSrcId] = useState(null);
  const [showCursor, setShowCursor] = useState(false);
  const [fs, setFs] = useState(false);
  const [showKioskOverlay, setShowKioskOverlay] = useState(true);
  const cursorTimer = useRef(null);

  // Track fullscreen state changes (incl. user pressing ESC)
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

  // Try auto-fullscreen on mount (browsers usually require a gesture, so
  // this is best-effort; otherwise the kiosk overlay handles it on click).
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

  // F key toggles fullscreen, ESC exits (browser default already handles ESC)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (isFullscreen()) {
          exitFullscreen();
        } else if (containerRef.current) {
          enterFullscreen(containerRef.current);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Cursor hide on idle
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

  // Swap source when video changes
  useEffect(() => {
    if (!state) return;
    const v = videoRef.current;
    if (!v) return;
    if (state.current_video_id !== currentSrcId) {
      setCurrentSrcId(state.current_video_id);
      if (state.current_video_id) {
        v.src = streamUrl(state.current_video_id);
        v.load();
      } else {
        v.removeAttribute("src");
        v.load();
      }
    }
  }, [state, currentSrcId]);

  // Auto-advance: when video ends and loop is OFF, ask backend to play next.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => {
      if (state?.current_video_id) {
        sendPublic({ action: "ended", video_id: state.current_video_id });
      }
    };
    v.addEventListener("ended", onEnded);
    return () => v.removeEventListener("ended", onEnded);
  }, [state?.current_video_id, sendPublic]);

  // Apply playback state
  useEffect(() => {
    if (!state) return;
    const v = videoRef.current;
    if (!v) return;
    v.volume = state.volume ?? 1;
    v.muted = !!state.muted;
    v.loop = !!state.loop;

    if (typeof state.current_time === "number") {
      const drift = Math.abs(v.currentTime - state.current_time);
      if (drift > 1.0) {
        try {
          v.currentTime = state.current_time;
        } catch (_) {
          /* noop */
        }
      }
    }

    if (state.is_playing) {
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      v.pause();
    }
  }, [state]);

  const enterKiosk = useCallback(async () => {
    if (containerRef.current) {
      await enterFullscreen(containerRef.current);
    }
    setShowKioskOverlay(false);
  }, []);

  const idle = !state?.current_video_id;

  return (
    <div
      ref={containerRef}
      data-testid="display-page"
      className={`w-screen h-screen bg-black overflow-hidden flex items-center justify-center m-0 p-0 ${
        showCursor || showKioskOverlay ? "" : "cursor-none"
      }`}
    >
      <video
        ref={videoRef}
        data-testid="display-video"
        className={`w-full h-full object-contain bg-black ${idle ? "hidden" : ""}`}
        playsInline
        autoPlay
      />

      {idle && !showKioskOverlay && (
        <div className="text-center" data-testid="display-idle">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full border border-white/10 mb-6 animate-pulse">
            <Film className="w-8 h-8 text-[#F59E0B]" strokeWidth={1.5} />
          </div>
          <div className="font-heading text-3xl font-semibold tracking-tight text-white mb-2">
            KinoKontroll
          </div>
          <div className="text-xs uppercase tracking-[0.3em] text-zinc-600">
            Venter på avspilling
          </div>
          <div className="mt-6 text-[10px] uppercase tracking-[0.3em] text-zinc-700 font-mono">
            Sal · {roomId}
          </div>
        </div>
      )}

      {/* Kiosk start overlay — required because browsers block auto-fullscreen
          without a user gesture. Click anywhere to enter fullscreen. */}
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
          <div className="font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-3">
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
          <div className="mt-10 text-[10px] uppercase tracking-[0.3em] text-zinc-700 font-mono">
            Sal · {roomId}
          </div>
        </button>
      )}

      {/* Tiny indicator that we are in kiosk fullscreen mode (top-right, fades out with cursor) */}
      {fs && showCursor && (
        <div
          className="absolute top-4 right-4 z-40 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-mono bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/10"
          data-testid="display-fs-badge"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
          KIOSK · {roomId}
        </div>
      )}
    </div>
  );
}
