import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  LogOut,
  Radio,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { api, clearToken, streamUrl } from "../lib/api";
import { useSync } from "../lib/useSync";

function formatTime(s) {
  if (!s || isNaN(s)) return "00:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function Control() {
  const [videos, setVideos] = useState([]);
  const [duration, setDuration] = useState(0);
  const [localTime, setLocalTime] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const probeRef = useRef(null);
  const navigate = useNavigate();
  const { state, connected, send } = useSync();

  const loadVideos = async () => {
    try {
      const res = await api.get("/videos");
      setVideos(res.data);
    } catch (_) {
      /* noop */
    }
  };

  useEffect(() => {
    loadVideos();
  }, []);

  // Reload list when state changes (e.g., a new video was added/deleted elsewhere)
  useEffect(() => {
    if (state) loadVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.current_video_id]);

  const currentVideo = useMemo(
    () => videos.find((v) => v.id === state?.current_video_id),
    [videos, state?.current_video_id]
  );

  // Use a hidden video element to read duration of currently selected video
  useEffect(() => {
    setDuration(0);
    const v = probeRef.current;
    if (!v || !state?.current_video_id) return;
    v.src = streamUrl(state.current_video_id);
    v.load();
    const onMeta = () => setDuration(v.duration || 0);
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [state?.current_video_id]);

  // Local clock to advance timeline visually while playing (server is single source of truth)
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
    if (!state?.current_video_id && videos.length === 0) {
      toast.error("Last opp en video først");
      return;
    }
    send({ action: "toggle" });
  };

  const onTimelineChange = (e) => {
    const t = parseFloat(e.target.value);
    setLocalTime(t);
  };
  const onTimelineCommit = () => {
    send({ action: "seek", time: localTime });
    setSeeking(false);
  };

  const onVolumeChange = (e) => {
    const v = parseFloat(e.target.value);
    send({ action: "volume", volume: v });
  };

  const logout = () => {
    clearToken();
    navigate("/");
  };

  return (
    <div className="h-screen w-full flex flex-col bg-[#050505] overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/5">
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
            <span className="text-[#F59E0B]">Kontrollpanel</span> · /control
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em]"
            data-testid="control-connection-status"
          >
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
            href="/display"
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
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 p-3 min-h-0">
        {/* Playlist */}
        <aside
          className="col-span-1 md:col-span-4 lg:col-span-3 flex flex-col bg-[#0A0A0A] border border-white/10 rounded-lg overflow-hidden min-h-0"
          data-testid="control-playlist"
        >
          <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold">
              Spilleliste
            </div>
            <div className="text-[11px] font-mono text-zinc-600">{videos.length}</div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {videos.length === 0 ? (
              <div className="px-4 py-8 text-sm text-zinc-600 text-center">
                Ingen videoer.
                <br />
                <Link to="/upload" className="text-[#F59E0B] hover:underline">
                  Last opp →
                </Link>
              </div>
            ) : (
              <ul>
                {videos.map((v, i) => {
                  const active = v.id === state?.current_video_id;
                  return (
                    <li key={v.id}>
                      <button
                        onClick={() => send({ action: "select", video_id: v.id })}
                        data-testid="control-playlist-item"
                        className={`w-full text-left px-4 py-3 flex items-center gap-3 border-l-2 transition-colors ${
                          active
                            ? "bg-[#111111] border-l-[#F59E0B]"
                            : "border-l-transparent hover:bg-[#0E0E0E]"
                        }`}
                      >
                        <div className="font-mono text-xs text-zinc-600 w-6">
                          {String(i + 1).padStart(2, "0")}
                        </div>
                        <Film
                          className={`w-4 h-4 shrink-0 ${active ? "text-[#F59E0B]" : "text-zinc-600"}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-sm truncate ${active ? "text-[#F59E0B]" : "text-zinc-300"}`}
                          >
                            {v.filename}
                          </div>
                        </div>
                        {active && isPlaying && (
                          <div className="flex items-end gap-0.5 h-4">
                            <span className="w-0.5 bg-[#F59E0B] animate-pulse" style={{ height: "60%" }} />
                            <span className="w-0.5 bg-[#F59E0B] animate-pulse" style={{ height: "100%", animationDelay: "120ms" }} />
                            <span className="w-0.5 bg-[#F59E0B] animate-pulse" style={{ height: "40%", animationDelay: "240ms" }} />
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Player col */}
        <section className="col-span-1 md:col-span-8 lg:col-span-9 flex flex-col gap-3 min-h-0">
          {/* Now playing */}
          <div className="bg-[#0A0A0A] border border-white/10 rounded-lg p-5 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
                Spiller nå
              </div>
              <div className="text-[11px] font-mono text-zinc-600 tracking-wider">
                {videos.length} klipp i bibliotek
              </div>
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center bg-black rounded-md border border-white/5 mb-4 overflow-hidden">
              {currentVideo ? (
                <div className="text-center">
                  <Film className="w-10 h-10 text-[#F59E0B] mx-auto mb-3" strokeWidth={1.5} />
                  <div
                    className="font-heading text-xl text-white mb-1 max-w-md truncate"
                    data-testid="control-now-playing-title"
                  >
                    {currentVideo.filename}
                  </div>
                  <div className="font-mono text-xs text-zinc-600 tracking-wider">
                    {currentVideo.content_type}
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-zinc-700 text-sm">Ingen video valgt</div>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div className="flex items-center gap-3 mb-2">
              <div
                className="text-xs font-mono text-[#F59E0B] tracking-wider w-14"
                data-testid="control-current-time"
              >
                {formatTime(localTime)}
              </div>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(localTime, duration || 0)}
                onChange={onTimelineChange}
                onMouseDown={() => setSeeking(true)}
                onTouchStart={() => setSeeking(true)}
                onMouseUp={onTimelineCommit}
                onTouchEnd={onTimelineCommit}
                disabled={!currentVideo || !duration}
                data-testid="control-timeline-slider"
                className="flex-1 accent-[#F59E0B] h-1 bg-white/10 rounded-full appearance-none disabled:opacity-50"
              />
              <div className="text-xs font-mono text-zinc-500 tracking-wider w-14 text-right">
                {formatTime(duration)}
              </div>
            </div>
          </div>

          {/* Transport */}
          <div className="bg-[#0A0A0A] border border-white/10 rounded-lg p-4 grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
            {/* Transport buttons */}
            <div className="flex items-center justify-center md:justify-start gap-2">
              <button
                onClick={() => send({ action: "prev" })}
                data-testid="control-prev-button"
                disabled={videos.length === 0}
                className="w-11 h-11 flex items-center justify-center rounded-md bg-[#111111] border border-white/10 hover:border-white/30 text-white disabled:opacity-40 transition-colors"
                aria-label="Forrige"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                onClick={togglePlay}
                data-testid="control-play-pause-button"
                className="w-14 h-11 flex items-center justify-center rounded-md bg-[#F59E0B] hover:bg-[#FBBF24] text-black transition-colors"
                aria-label={isPlaying ? "Pause" : "Spill"}
              >
                {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              </button>
              <button
                onClick={() => send({ action: "next" })}
                data-testid="control-next-button"
                disabled={videos.length === 0}
                className="w-11 h-11 flex items-center justify-center rounded-md bg-[#111111] border border-white/10 hover:border-white/30 text-white disabled:opacity-40 transition-colors"
                aria-label="Neste"
              >
                <SkipForward className="w-4 h-4" />
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
              >
                <Repeat className="w-4 h-4" />
              </button>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-3 justify-center">
              <button
                onClick={() => send({ action: "mute", muted: !muted })}
                data-testid="control-mute-button"
                className="w-9 h-9 flex items-center justify-center rounded-md bg-[#111111] border border-white/10 hover:border-white/30 text-white"
                aria-label="Demp"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={onVolumeChange}
                data-testid="control-volume-slider"
                className="flex-1 accent-[#F59E0B] h-1 bg-white/10 rounded-full appearance-none max-w-[180px]"
              />
              <div className="font-mono text-xs text-zinc-500 w-8 text-right">
                {Math.round((muted ? 0 : volume) * 100)}
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center justify-center md:justify-end gap-4 text-[11px] uppercase tracking-[0.2em] text-zinc-500">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Status</span>
                <span
                  className={`font-mono ${isPlaying ? "text-[#F59E0B]" : "text-zinc-500"}`}
                  data-testid="control-status-text"
                >
                  {isPlaying ? "AVSPILLER" : "PAUSE"}
                </span>
              </div>
              {loop && <span className="text-[#F59E0B] font-mono">LOOP</span>}
            </div>
          </div>
        </section>
      </div>

      {/* Hidden probe to read duration */}
      <video ref={probeRef} className="hidden" preload="metadata" muted />
    </div>
  );
}
