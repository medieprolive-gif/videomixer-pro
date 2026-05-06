import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Repeat,
  Volume2,
  VolumeX,
  Film,
  Image as ImageIcon,
  LogOut,
  Radio,
  Wifi,
  WifiOff,
  Send,
  Eye,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { api, clearToken, streamUrl, thumbUrl } from "../lib/api";
import { useSync } from "../lib/useSync";

function formatTime(s) {
  if (s == null || isNaN(s)) return "00:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Local-only preview monitor (PVW). User can play/pause/scrub independently of /display. */
function PvwMonitor({ media }) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setTime(0);
    setPlaying(false);
    setDuration(0);
    const v = videoRef.current;
    if (!v) return;
    if (media?.media_type === "video") {
      v.src = streamUrl(media.id);
      v.load();
    } else if (v) {
      v.removeAttribute("src");
      v.load();
    }
  }, [media?.id, media?.media_type]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onMeta = () => setDuration(v.duration || 0);
    const onTime = () => setTime(v.currentTime || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [media?.id]);

  const isImage = media?.media_type === "image";
  const isVideo = media?.media_type === "video";

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  return (
    <div
      className="flex flex-col bg-[#0A0A0A] border border-white/10 rounded-lg overflow-hidden h-full"
      data-testid="pvw-monitor"
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/5 bg-[#0E0E0E]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10px] uppercase tracking-[0.25em] text-emerald-500 font-semibold">
            PVW · Preview
          </span>
        </div>
        <div
          className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-mono truncate max-w-[60%]"
          data-testid="pvw-monitor-title"
        >
          {media?.filename || "tom"}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center">
        {!media && (
          <div className="text-zinc-700 text-xs uppercase tracking-[0.25em] font-mono">
            Velg klipp →
          </div>
        )}
        <video
          ref={videoRef}
          muted
          playsInline
          preload="metadata"
          className={`w-full h-full object-contain ${isVideo ? "" : "hidden"}`}
        />
        {isImage && (
          <img
            src={thumbUrl(media.id)}
            alt={media.filename || ""}
            className="w-full h-full object-contain"
          />
        )}
      </div>

      {media && (
        <div className="px-3 py-2 flex items-center gap-2 border-t border-white/5 bg-[#0E0E0E]">
          {isVideo ? (
            <>
              <button
                onClick={togglePlay}
                data-testid="pvw-toggle-button"
                className="w-7 h-7 flex items-center justify-center rounded bg-[#111111] border border-white/10 hover:border-white/30 text-white"
              >
                {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              </button>
              <div className="text-[10px] font-mono text-zinc-500 tracking-wider w-10">
                {formatTime(time)}
              </div>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(time, duration || 0)}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (v) v.currentTime = parseFloat(e.target.value);
                }}
                className="flex-1 accent-emerald-500 h-1 bg-white/10 rounded-full appearance-none"
              />
              <div className="text-[10px] font-mono text-zinc-500 tracking-wider w-10 text-right">
                {formatTime(duration)}
              </div>
            </>
          ) : (
            <div className="text-[10px] font-mono text-zinc-500 tracking-wider w-full text-center">
              Stillbilde · {media.duration || 5}s
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Synced PGM monitor — mirrors what's on /display. Read-only preview. */
function PgmMonitor({ media, state }) {
  const videoRef = useRef(null);
  const [showFreeze, setShowFreeze] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (media?.media_type === "video") {
      v.src = streamUrl(media.id);
      v.load();
    } else if (v) {
      v.removeAttribute("src");
      v.load();
    }
  }, [media?.id, media?.media_type]);

  useEffect(() => {
    if (!state || !media) return;
    const v = videoRef.current;
    if (!v) return;
    if (media.media_type !== "video") return;

    v.muted = true; // always mute the local PGM mirror to avoid double audio
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
      setShowFreeze(false);
    } else {
      v.pause();
      setShowFreeze((state.current_time || 0) > 0.05 || media.media_type === "image");
    }
  }, [state, media]);

  // Freeze badge for images
  useEffect(() => {
    if (!media || !state) {
      setShowFreeze(false);
      return;
    }
    if (media.media_type === "image" && !state.is_playing) setShowFreeze(true);
  }, [media, state]);

  const isImage = media?.media_type === "image";
  const isVideo = media?.media_type === "video";

  return (
    <div
      className="flex flex-col bg-[#0A0A0A] border border-white/10 rounded-lg overflow-hidden h-full"
      data-testid="pgm-monitor"
    >
      <div className="px-3 py-2 flex items-center justify-between border-b border-white/5 bg-[#0E0E0E]">
        <div className="flex items-center gap-2">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              state?.is_playing ? "bg-red-500 animate-pulse" : "bg-red-500"
            }`}
          />
          <span className="text-[10px] uppercase tracking-[0.25em] text-red-500 font-semibold">
            PGM · On Air
          </span>
        </div>
        <div
          className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-mono truncate max-w-[60%]"
          data-testid="pgm-monitor-title"
        >
          {media?.filename || "tom"}
        </div>
      </div>

      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center">
        {!media && (
          <div className="text-zinc-700 text-xs uppercase tracking-[0.25em] font-mono">
            Tom — trykk CUT for å laste PVW
          </div>
        )}
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          className={`w-full h-full object-contain ${isVideo ? "" : "hidden"}`}
        />
        {isImage && (
          <img
            src={thumbUrl(media.id)}
            alt={media.filename || ""}
            className="w-full h-full object-contain"
          />
        )}
        {showFreeze && (
          <div
            className="absolute top-2 left-2 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.25em] text-white font-mono bg-black/70 backdrop-blur-sm px-2 py-1 rounded border border-white/10"
            data-testid="pgm-freeze-badge"
          >
            <span className="w-1 h-1 rounded-full bg-white" />
            Frozen
          </div>
        )}
      </div>
    </div>
  );
}

export default function Control() {
  const { room } = useParams();
  const roomId = room || "default";
  const [media, setMedia] = useState([]);
  const [duration, setDuration] = useState(0);
  const [localTime, setLocalTime] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const probeRef = useRef(null);
  const navigate = useNavigate();
  const { state, connected, send } = useSync(roomId);

  const loadMedia = async () => {
    try {
      const res = await api.get("/videos");
      setMedia(res.data);
    } catch (_) {
      /* noop */
    }
  };

  useEffect(() => {
    loadMedia();
  }, []);

  useEffect(() => {
    loadMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.pgm_id, state?.pvw_id]);

  const pgmMedia = useMemo(
    () => media.find((m) => m.id === state?.pgm_id) || null,
    [media, state?.pgm_id]
  );
  const pvwMedia = useMemo(
    () => media.find((m) => m.id === state?.pvw_id) || null,
    [media, state?.pvw_id]
  );

  // Probe duration of PGM video for the timeline
  useEffect(() => {
    setDuration(0);
    const v = probeRef.current;
    if (!v) return;
    if (pgmMedia?.media_type === "video") {
      v.src = streamUrl(pgmMedia.id);
      v.load();
      const onMeta = () => setDuration(v.duration || 0);
      v.addEventListener("loadedmetadata", onMeta);
      return () => v.removeEventListener("loadedmetadata", onMeta);
    } else if (pgmMedia?.media_type === "image") {
      setDuration(pgmMedia.duration || 5);
    }
  }, [pgmMedia?.id, pgmMedia?.media_type, pgmMedia?.duration]);

  // Local timeline tick
  useEffect(() => {
    if (!state) return;
    if (!seeking) setLocalTime(state.current_time || 0);
  }, [state, seeking]);
  useEffect(() => {
    if (!state?.is_playing || seeking) return;
    const i = setInterval(() => setLocalTime((t) => t + 0.25), 250);
    return () => clearInterval(i);
  }, [state?.is_playing, seeking]);

  const isPlaying = !!state?.is_playing;
  const volume = state?.volume ?? 1;
  const muted = !!state?.muted;
  const loop = !!state?.loop;

  const togglePlay = () => {
    if (!state?.pgm_id) {
      toast.error("Last noe i PGM først (trykk CUT)");
      return;
    }
    send({ action: "toggle" });
  };

  const cut = useCallback(() => {
    if (!state?.pvw_id) {
      toast.error("Velg et klipp i PVW først");
      return;
    }
    send({ action: "cut" });
    toast.success("CUT — PVW → PGM");
  }, [send, state?.pvw_id]);

  const onTimelineCommit = () => {
    send({ action: "seek", time: localTime });
    setSeeking(false);
  };
  const onVolumeChange = (e) => send({ action: "volume", volume: parseFloat(e.target.value) });

  const logout = () => {
    clearToken();
    navigate("/");
  };

  // Keyboard shortcuts: SPACE = toggle play, ENTER = cut
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "Enter") {
        e.preventDefault();
        cut();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.pvw_id, state?.pgm_id]);

  return (
    <div className="h-screen w-full flex flex-col bg-[#050505] overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/5 shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-white transition-colors"
            data-testid="control-back-link"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Tilbake
          </Link>
          <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
            <Radio className="w-3 h-3" />
            <span className="text-[#F59E0B]">Switcher</span> · /control
            <span className="text-zinc-700">·</span>
            <span className="font-mono text-zinc-500" data-testid="control-room-label">
              sal: {roomId}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em]" data-testid="control-connection-status">
            {connected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-emerald-500">Tilkoblet</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-red-500" />
                <span className="text-red-500">Frakoblet</span>
              </>
            )}
          </div>
          <a
            href={roomId === "default" ? "/display" : `/display/${roomId}`}
            target="_blank"
            rel="noreferrer"
            data-testid="control-open-display-link"
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-300 hover:text-white px-3 py-1.5 border border-white/10 rounded-md hover:border-white/30 transition-colors"
          >
            Åpne visning
          </a>
          <button
            onClick={logout}
            data-testid="control-logout-button"
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-500 hover:text-white px-3 py-1.5 border border-white/10 rounded-md transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Logg ut
          </button>
        </div>
      </header>

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 p-3 min-h-0">
        {/* Playlist */}
        <aside
          className="lg:col-span-3 flex flex-col bg-[#0A0A0A] border border-white/10 rounded-lg overflow-hidden min-h-0"
          data-testid="control-playlist"
        >
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-[#0E0E0E]">
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold flex items-center gap-2">
              <Layers className="w-3 h-3" />
              Bibliotek
            </div>
            <div className="text-[11px] font-mono text-zinc-600">{media.length}</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {media.length === 0 ? (
              <div className="px-4 py-8 text-sm text-zinc-600 text-center">
                Tomt.
                <br />
                <Link to="/upload" className="text-[#F59E0B] hover:underline">
                  Last opp →
                </Link>
              </div>
            ) : (
              <ul>
                {media.map((m, i) => {
                  const isPgm = m.id === state?.pgm_id;
                  const isPvw = m.id === state?.pvw_id;
                  const isImg = m.media_type === "image";
                  return (
                    <li key={m.id}>
                      <button
                        onClick={() => send({ action: "set_pvw", media_id: m.id })}
                        data-testid="control-playlist-item"
                        title="Klikk for å laste i PVW"
                        className={`w-full text-left px-3 py-2.5 flex items-center gap-3 border-l-2 transition-colors ${
                          isPgm
                            ? "border-l-red-500 bg-red-500/5"
                            : isPvw
                            ? "border-l-emerald-500 bg-emerald-500/5"
                            : "border-l-transparent hover:bg-[#0E0E0E]"
                        }`}
                      >
                        <div className="font-mono text-xs text-zinc-600 w-5 shrink-0">
                          {String(i + 1).padStart(2, "0")}
                        </div>
                        <div className="w-12 h-8 rounded bg-black/60 border border-white/10 overflow-hidden shrink-0 flex items-center justify-center">
                          {m.has_thumbnail ? (
                            <img src={thumbUrl(m.id)} alt="" className="w-full h-full object-cover" loading="lazy" />
                          ) : isImg ? (
                            <ImageIcon className="w-3.5 h-3.5 text-[#F59E0B]" />
                          ) : (
                            <Film className="w-3.5 h-3.5 text-zinc-600" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-zinc-300 truncate">{m.filename}</div>
                          <div className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider">
                            {isImg ? `bilde · ${m.duration || 5}s` : "video"}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                          {isPgm && (
                            <span className="text-[8px] uppercase tracking-[0.2em] text-red-500 font-mono font-semibold">
                              PGM
                            </span>
                          )}
                          {isPvw && (
                            <span className="text-[8px] uppercase tracking-[0.2em] text-emerald-500 font-mono font-semibold">
                              PVW
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Center: PVW + PGM monitors + transport */}
        <section className="lg:col-span-9 flex flex-col gap-3 min-h-0">
          {/* Monitors */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1 min-h-0">
            <PvwMonitor media={pvwMedia} />
            <PgmMonitor media={pgmMedia} state={state} />
          </div>

          {/* CUT / TAKE big button */}
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => send({ action: "prev" })}
              data-testid="control-prev-button"
              disabled={media.length === 0}
              className="w-11 h-11 flex items-center justify-center rounded-md bg-[#111111] border border-white/10 hover:border-emerald-500/50 hover:text-emerald-400 text-zinc-400 disabled:opacity-40 transition-colors"
              title="Forrige i bibliotek (PVW)"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              onClick={cut}
              disabled={!state?.pvw_id}
              data-testid="control-cut-button"
              className="group relative px-10 h-14 rounded-md bg-[#F59E0B] hover:bg-[#FBBF24] text-black font-heading text-lg font-semibold tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-3"
            >
              <Send className="w-5 h-5" />
              CUT
              <span className="text-[10px] uppercase tracking-[0.2em] font-mono opacity-70 ml-1">
                Enter
              </span>
            </button>

            <button
              onClick={() => send({ action: "next" })}
              data-testid="control-next-button"
              disabled={media.length === 0}
              className="w-11 h-11 flex items-center justify-center rounded-md bg-[#111111] border border-white/10 hover:border-emerald-500/50 hover:text-emerald-400 text-zinc-400 disabled:opacity-40 transition-colors"
              title="Neste i bibliotek (PVW)"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          {/* PGM transport bar */}
          <div className="bg-[#0A0A0A] border border-white/10 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            {/* PGM transport */}
            <div className="flex items-center justify-center md:justify-start gap-2">
              <div className="text-[10px] uppercase tracking-[0.2em] text-red-500 font-mono mr-2 hidden md:block">
                PGM
              </div>
              <button
                onClick={togglePlay}
                data-testid="control-play-pause-button"
                className="w-14 h-11 flex items-center justify-center rounded-md bg-red-500 hover:bg-red-400 text-white transition-colors disabled:opacity-50"
                disabled={!state?.pgm_id}
                aria-label={isPlaying ? "Pause" : "Spill"}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button
                onClick={() => send({ action: "loop", loop: !loop })}
                data-testid="control-loop-toggle"
                className={`w-11 h-11 flex items-center justify-center rounded-md border transition-colors ${
                  loop
                    ? "bg-[#F59E0B]/10 border-[#F59E0B]/50 text-[#F59E0B]"
                    : "bg-[#111111] border-white/10 hover:border-white/30 text-white"
                }`}
                aria-label="Gjenta"
                title="Loop (kun video)"
              >
                <Repeat className="w-4 h-4" />
              </button>
            </div>

            {/* Timeline */}
            <div className="flex items-center gap-3">
              <div className="text-xs font-mono text-[#F59E0B] tracking-wider w-12" data-testid="control-current-time">
                {formatTime(localTime)}
              </div>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(localTime, duration || 0)}
                onChange={(e) => setLocalTime(parseFloat(e.target.value))}
                onMouseDown={() => setSeeking(true)}
                onTouchStart={() => setSeeking(true)}
                onMouseUp={onTimelineCommit}
                onTouchEnd={onTimelineCommit}
                disabled={!pgmMedia || !duration}
                data-testid="control-timeline-slider"
                className="flex-1 accent-[#F59E0B] h-1 bg-white/10 rounded-full appearance-none disabled:opacity-50"
              />
              <div className="text-xs font-mono text-zinc-500 tracking-wider w-12 text-right">
                {formatTime(duration)}
              </div>
            </div>

            {/* Volume + status */}
            <div className="flex items-center gap-3 justify-center md:justify-end">
              <button
                onClick={() => send({ action: "mute", muted: !muted })}
                data-testid="control-mute-button"
                className="w-9 h-9 flex items-center justify-center rounded-md bg-[#111111] border border-white/10 hover:border-white/30 text-white"
                aria-label="Demp"
              >
                {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={onVolumeChange}
                data-testid="control-volume-slider"
                className="accent-[#F59E0B] h-1 bg-white/10 rounded-full appearance-none w-24"
              />
              <div className="font-mono text-xs text-zinc-500 w-8 text-right">
                {Math.round((muted ? 0 : volume) * 100)}
              </div>
              <div className="hidden lg:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-500 ml-2">
                <Eye className="w-3 h-3" />
                <span
                  className={`font-mono ${isPlaying ? "text-red-500" : "text-zinc-500"}`}
                  data-testid="control-status-text"
                >
                  {isPlaying ? "ON AIR" : "PAUSE"}
                </span>
              </div>
            </div>
          </div>

          {/* Hint bar */}
          <div className="hidden md:flex items-center justify-center gap-4 text-[10px] uppercase tracking-[0.25em] text-zinc-700 font-mono">
            <span>klikk klipp → PVW</span>
            <span className="text-zinc-800">·</span>
            <span>
              <span className="text-zinc-500">Enter</span> = CUT
            </span>
            <span className="text-zinc-800">·</span>
            <span>
              <span className="text-zinc-500">Space</span> = play / pause
            </span>
          </div>
        </section>
      </div>

      {/* Hidden probe to read duration */}
      <video ref={probeRef} className="hidden" preload="metadata" muted />
    </div>
  );
}
