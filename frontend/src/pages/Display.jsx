import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Film } from "lucide-react";
import { useSync } from "../lib/useSync";
import { streamUrl } from "../lib/api";

export default function Display() {
  const { room } = useParams();
  const roomId = room || "default";
  const { state, sendPublic } = useSync(roomId);
  const videoRef = useRef(null);
  const [currentSrcId, setCurrentSrcId] = useState(null);
  const [showCursor, setShowCursor] = useState(false);
  const cursorTimer = useRef(null);

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
  // (When loop is ON, the video element loops natively and `ended` doesn't fire.)
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

    // Sync time only on big drift (avoid stutter)
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

  const idle = !state?.current_video_id;

  return (
    <div
      data-testid="display-page"
      className={`w-screen h-screen bg-black overflow-hidden flex items-center justify-center m-0 p-0 ${
        showCursor ? "" : "cursor-none"
      }`}
    >
      <video
        ref={videoRef}
        data-testid="display-video"
        className={`w-full h-full object-contain bg-black ${idle ? "hidden" : ""}`}
        playsInline
        autoPlay
      />

      {idle && (
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
    </div>
  );
}
