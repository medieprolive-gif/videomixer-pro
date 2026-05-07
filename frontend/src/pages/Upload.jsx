import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  UploadCloud,
  Trash2,
  Film,
  Image as ImageIcon,
  LogOut,
  Clock,
  Scissors,
  X,
  LogIn,
  LogOut as LogOutIcon,
  Undo2,
  Eraser,
  Radio,
  Plus,
  Music,
  ArrowRightLeft,
} from "lucide-react";
import { toast } from "sonner";
import { api, authHeaders, API, clearToken, thumbUrl, streamUrl } from "../lib/api";

function formatTimecode(s) {
  if (s == null || isNaN(s)) return "00:00.0";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tenth = Math.floor((s % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${tenth}`;
}

/**
 * Trim modal — lets user pick a [start, end] range, preview the result,
 * and POST to /api/videos/{id}/trim. The backend re-encodes via FFmpeg.
 */
function TrimModal({ video, onClose, onSaved }) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [time, setTime] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Undo stack (each entry is a {start, end} snapshot taken BEFORE the change)
  const [history, setHistory] = useState([]);

  /** Push the current state to history before mutating start/end. */
  const pushHistory = () => {
    setHistory((h) => {
      const snap = { start, end };
      // Dedupe identical consecutive entries
      if (h.length && h[h.length - 1].start === snap.start && h[h.length - 1].end === snap.end) {
        return h;
      }
      return [...h.slice(-49), snap];
    });
  };

  /** Mark current playback time as "in" (start). */
  const setInPoint = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.min(v.currentTime || 0, Math.max(0, end - 0.1));
    pushHistory();
    setStart(Math.max(0, t));
  };

  /** Mark current playback time as "out" (end). */
  const setOutPoint = () => {
    const v = videoRef.current;
    if (!v) return;
    const t = Math.max(v.currentTime || 0, start + 0.1);
    pushHistory();
    setEnd(Math.min(duration, t));
  };

  /** Reset trim points to the full clip. */
  const resetPoints = () => {
    pushHistory();
    setStart(0);
    setEnd(duration);
  };

  /** Step back one history snapshot. */
  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setStart(last.start);
      setEnd(last.end);
      return h.slice(0, -1);
    });
  };

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !video) return;
    v.src = streamUrl(video.id);
    v.load();
    const onMeta = () => {
      const d = v.duration || 0;
      setDuration(d);
      setStart(0);
      setEnd(d);
    };
    const onTime = () => setTime(v.currentTime || 0);
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [video]);

  // Preview: play from start to end, pause at end
  useEffect(() => {
    if (!previewing) return;
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (v.currentTime >= end - 0.05) {
        v.pause();
        setPreviewing(false);
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [previewing, end]);

  const startPreview = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = start;
    v.play().catch(() => {});
    setPreviewing(true);
  };

  // ESC closes; I/O set in/out; Ctrl/Cmd+Z = undo
  useEffect(() => {
    const onKey = (e) => {
      if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") {
        if (e.key !== "Escape") return;
      }
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        setInPoint();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        setOutPoint();
      } else if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, start, end, duration]);

  const trimmedLength = Math.max(0, end - start);

  const save = async () => {
    if (trimmedLength < 0.1) {
      toast.error("Området er for kort");
      return;
    }
    setSaving(true);
    const tid = toast.loading("Trimmer videoen...");
    try {
      await api.post(
        `/videos/${video.id}/trim`,
        { start, end },
        { timeout: 600000 }
      );
      toast.success("Klippet er trimmet", { id: tid });
      onSaved();
      onClose();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Trimming feilet";
      toast.error(msg, { id: tid });
    } finally {
      setSaving(false);
    }
  };

  // Visual: a single timeline strip with two draggable thumbs.
  const trimPct = duration > 0 ? ((time - 0) / duration) * 100 : 0;
  const startPct = duration > 0 ? (start / duration) * 100 : 0;
  const endPct = duration > 0 ? (end / duration) * 100 : 100;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="trim-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#0A0A0A] border border-white/10 rounded-lg w-full max-w-3xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Scissors className="w-4 h-4 text-[#F59E0B]" />
            <h3 className="font-heading text-base text-white truncate max-w-md">
              Trim · {video.filename}
            </h3>
          </div>
          <button
            onClick={onClose}
            data-testid="trim-close-button"
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/5 text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          <video
            ref={videoRef}
            controls
            className="w-full bg-black rounded border border-white/10 max-h-[55vh]"
            data-testid="trim-video"
          />

          {/* In/Out + Undo + Reset toolbar */}
          <div className="flex flex-wrap items-center gap-2" data-testid="trim-toolbar">
            <button
              onClick={setInPoint}
              data-testid="trim-set-in-button"
              title="Sett startpunkt til nåværende tid (I)"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-emerald-400 hover:text-emerald-300 px-3 py-2 border border-emerald-500/40 hover:border-emerald-500 bg-emerald-500/5 hover:bg-emerald-500/10 rounded-md transition-colors"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sett inn
              <span className="text-[9px] font-mono opacity-60">I</span>
            </button>
            <button
              onClick={setOutPoint}
              data-testid="trim-set-out-button"
              title="Sett sluttpunkt til nåværende tid (O)"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-red-400 hover:text-red-300 px-3 py-2 border border-red-500/40 hover:border-red-500 bg-red-500/5 hover:bg-red-500/10 rounded-md transition-colors"
            >
              <LogOutIcon className="w-3.5 h-3.5" />
              Sett ut
              <span className="text-[9px] font-mono opacity-60">O</span>
            </button>

            <div className="flex-1" />

            <button
              onClick={undo}
              disabled={history.length === 0}
              data-testid="trim-undo-button"
              title="Angre forrige endring (⌘Z / Ctrl-Z)"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-400 hover:text-white px-3 py-2 border border-white/10 hover:border-white/30 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Undo2 className="w-3.5 h-3.5" />
              Angre
              {history.length > 0 && (
                <span className="text-[9px] font-mono text-[#F59E0B]" data-testid="trim-undo-count">
                  {history.length}
                </span>
              )}
            </button>
            <button
              onClick={resetPoints}
              data-testid="trim-reset-button"
              title="Tilbakestill — bruk hele klippet"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-400 hover:text-red-400 px-3 py-2 border border-white/10 hover:border-red-500/50 rounded-md transition-colors"
            >
              <Eraser className="w-3.5 h-3.5" />
              Fjern
            </button>
          </div>

          {/* Timeline visualization */}
          <div className="space-y-2">
            <div className="relative h-9 rounded bg-black/60 border border-white/10 overflow-hidden">
              {/* Selected (kept) range */}
              <div
                className="absolute top-0 bottom-0 bg-[#F59E0B]/15 border-x border-[#F59E0B]/50"
                style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
              />
              {/* Removed pre-range */}
              <div
                className="absolute top-0 bottom-0 bg-red-500/15"
                style={{ left: 0, width: `${startPct}%` }}
              />
              {/* Removed post-range */}
              <div
                className="absolute top-0 bottom-0 bg-red-500/15"
                style={{ left: `${endPct}%`, right: 0 }}
              />
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none"
                style={{ left: `${trimPct}%` }}
              />
              {/* Labels */}
              <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-[0.25em] font-mono text-red-400/80">
                fjern
              </div>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-[0.25em] font-mono text-red-400/80">
                fjern
              </div>
              <div
                className="absolute top-1/2 -translate-y-1/2 text-[9px] uppercase tracking-[0.25em] font-mono text-[#F59E0B] font-semibold"
                style={{ left: `calc(${(startPct + endPct) / 2}% - 18px)` }}
              >
                behold
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-1">
                  Start
                </label>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.05}
                  value={start}
                  onMouseDown={pushHistory}
                  onTouchStart={pushHistory}
                  onChange={(e) => {
                    const s = Math.min(parseFloat(e.target.value), end - 0.1);
                    setStart(Math.max(0, s));
                    const v = videoRef.current;
                    if (v) v.currentTime = s;
                  }}
                  data-testid="trim-start-slider"
                  className="w-full accent-[#F59E0B] h-1 bg-white/10 rounded-full"
                />
                <div
                  className="font-mono text-xs text-[#F59E0B] mt-1"
                  data-testid="trim-start-value"
                >
                  {formatTimecode(start)}
                </div>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-1">
                  Slutt
                </label>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  step={0.05}
                  value={end}
                  onMouseDown={pushHistory}
                  onTouchStart={pushHistory}
                  onChange={(e) => {
                    const en = Math.max(parseFloat(e.target.value), start + 0.1);
                    setEnd(Math.min(duration || 0, en));
                    const v = videoRef.current;
                    if (v) v.currentTime = en;
                  }}
                  data-testid="trim-end-slider"
                  className="w-full accent-[#F59E0B] h-1 bg-white/10 rounded-full"
                />
                <div
                  className="font-mono text-xs text-[#F59E0B] mt-1 text-right"
                  data-testid="trim-end-value"
                >
                  {formatTimecode(end)}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-mono pt-1">
              <span>Original: {formatTimecode(duration)}</span>
              <span>
                Resultat:{" "}
                <span className="text-[#F59E0B]" data-testid="trim-result-length">
                  {formatTimecode(trimmedLength)}
                </span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 gap-2">
          <button
            onClick={startPreview}
            disabled={duration === 0 || trimmedLength < 0.1}
            data-testid="trim-preview-button"
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-300 hover:text-white px-4 py-2 border border-white/10 hover:border-white/30 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {previewing ? "Spiller av..." : "Forhåndsvis"}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              data-testid="trim-cancel-button"
              className="text-xs uppercase tracking-[0.15em] text-zinc-500 hover:text-white px-4 py-2 transition-colors"
            >
              Avbryt
            </button>
            <button
              onClick={save}
              disabled={saving || trimmedLength < 0.1}
              data-testid="trim-save-button"
              className="inline-flex items-center gap-2 bg-[#F59E0B] hover:bg-[#FBBF24] text-black font-medium text-sm px-5 py-2 rounded-md transition-colors disabled:opacity-50"
            >
              {saving ? "Trimmer..." : "Lagre trim"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let s = bytes;
  while (s >= 1024 && i < units.length - 1) {
    s /= 1024;
    i++;
  }
  return `${s.toFixed(1)} ${units[i]}`;
}

/**
 * Extract a JPEG still frame from a video File via <video> + canvas.
 * Returns a Blob, or null if extraction fails.
 */
function captureThumbnail(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.src = url;

    let settled = false;
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        /* noop */
      }
      try {
        v.src = "";
        v.load();
      } catch (_) {
        /* noop */
      }
      resolve(blob);
    };

    const grab = () => {
      try {
        const w = v.videoWidth || 0;
        const h = v.videoHeight || 0;
        if (!w || !h) {
          finish(null);
          return;
        }
        const maxW = 480;
        const ratio = Math.min(1, maxW / w);
        const cw = Math.max(1, Math.round(w * ratio));
        const ch = Math.max(1, Math.round(h * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(v, 0, 0, cw, ch);
        canvas.toBlob(
          (b) => finish(b && b.size > 100 ? b : null),
          "image/jpeg",
          0.82
        );
      } catch (_) {
        finish(null);
      }
    };

    v.addEventListener("loadeddata", () => {
      // Seek to ~10% (capped at 1s) to skip a black/lead-in first frame
      const target = Math.min(1, Math.max(0.1, (v.duration || 1) * 0.1));
      let seekFired = false;
      const onSeeked = () => {
        seekFired = true;
        v.removeEventListener("seeked", onSeeked);
        grab();
      };
      v.addEventListener("seeked", onSeeked);
      try {
        v.currentTime = target;
      } catch (_) {
        v.removeEventListener("seeked", onSeeked);
        grab();
      }
      // Some codecs don't fire seeked reliably — fall back after 1.2s
      setTimeout(() => {
        if (!seekFired && !settled) {
          v.removeEventListener("seeked", onSeeked);
          grab();
        }
      }, 1200);
    });

    v.addEventListener("error", () => finish(null));

    // Hard timeout
    setTimeout(() => finish(null), 10000);
  });
}

export default function Upload() {
  const [videos, setVideos] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentName, setCurrentName] = useState("");
  const [trimming, setTrimming] = useState(null);
  const [streamModal, setStreamModal] = useState(null);
  const [tab, setTab] = useState("content"); // "content" | "asset"
  const inputRef = useRef(null);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const res = await api.get("/videos");
      setVideos(res.data);
    } catch (e) {
      // public list, shouldn't 401
      toast.error("Klarte ikke laste videoer");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const upload = async (file, opts = {}) => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setCurrentName(file.name);
    try {
      const ftype = (file.type || "").toLowerCase();
      const isImage = ftype.startsWith("image/");
      const isAudio = ftype.startsWith("audio/");
      const fd = new FormData();
      fd.append("file", file);
      if (isImage) fd.append("duration", "5");
      if (opts.category) fd.append("category", opts.category);
      const res = await api.post("/videos/upload", fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
        onUploadProgress: (ev) => {
          if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      const mediaId = res.data?.id;

      // Best-effort video thumbnail extraction (skipped for images & audio)
      if (!isImage && !isAudio) {
        try {
          const thumb = await captureThumbnail(file);
          if (thumb && mediaId) {
            const tfd = new FormData();
            tfd.append("file", thumb, "thumb.jpg");
            await api.post(`/videos/${mediaId}/thumbnail`, tfd, {
              headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
            });
          }
        } catch (_) {
          /* thumbnail is best-effort */
        }
      }

      toast.success(`${file.name} lastet opp`);
      await load();
    } catch (err) {
      const msg = err?.response?.data?.detail || "Opplasting feilet";
      toast.error(msg);
    } finally {
      setUploading(false);
      setProgress(0);
      setCurrentName("");
    }
  };

  const onFiles = async (files) => {
    const list = Array.from(files || []);
    for (const f of list) {
      // sequential to keep order & feedback clear
      // eslint-disable-next-line no-await-in-loop
      await upload(f, { category: tab });
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  };

  const remove = async (id) => {
    try {
      await api.delete(`/videos/${id}`, { headers: authHeaders() });
      toast.success("Slettet");
      setVideos((v) => v.filter((x) => x.id !== id));
    } catch (e) {
      toast.error("Sletting feilet");
    }
  };

  const updateDuration = async (id, duration) => {
    const safe = Math.max(1, Math.min(3600, parseFloat(duration) || 5));
    try {
      await api.patch(`/videos/${id}/duration`, { duration: safe });
      setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, duration: safe } : v)));
    } catch (_) {
      toast.error("Klarte ikke oppdatere varighet");
    }
  };

  const renameMedia = async (id, name) => {
    try {
      await api.patch(`/videos/${id}/filename`, { filename: name });
      setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, filename: name } : v)));
      toast.success("Navn oppdatert");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Klarte ikke oppdatere navn");
    }
  };

  const setCategory = async (id, category) => {
    try {
      await api.patch(`/videos/${id}/category`, { category });
      setVideos((vs) => vs.map((v) => (v.id === id ? { ...v, category } : v)));
      toast.success(category === "asset" ? "Flyttet til ressurser" : "Flyttet til programinnhold");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kunne ikke endre kategori");
    }
  };

  // Items in current tab. Audio always lives under "asset". Streams under
  // "content". For everything else we honour the stored `category` (default
  // content if unset, for backwards compat with media uploaded earlier).
  const filteredVideos = useMemo(() => {
    return videos.filter((v) => {
      const cat =
        v.media_type === "audio"
          ? "asset"
          : v.media_type === "stream"
          ? "content"
          : v.category || "content";
      return cat === tab;
    });
  }, [videos, tab]);

  /**
   * Re-generate a thumbnail for an existing video by streaming it back from the server,
   * grabbing a frame and POSTing it. Useful for items uploaded before the thumbnail
   * extractor was wired up, or where extraction failed silently.
   */
  const regenerateThumb = async (item) => {
    if (item.media_type !== "video") return;
    const tid = toast.loading(`Lager forhåndsvisning for ${item.filename}...`);
    try {
      const r = await fetch(`${API}/videos/${item.id}/stream`);
      const blob = await r.blob();
      const file = new File([blob], item.filename || "video.mp4", {
        type: item.content_type || "video/mp4",
      });
      const thumb = await captureThumbnail(file);
      if (!thumb) throw new Error("Klarte ikke hente frame");
      const fd = new FormData();
      fd.append("file", thumb, "thumb.jpg");
      await api.post(`/videos/${item.id}/thumbnail`, fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
      });
      toast.success("Forhåndsvisning oppdatert", { id: tid });
      await load();
    } catch (e) {
      toast.error("Kunne ikke lage forhåndsvisning", { id: tid });
    }
  };

  const logout = () => {
    clearToken();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-[#050505]">
      {/* Header */}
      <header className="border-b border-white/5">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-white transition-colors"
            data-testid="upload-back-link"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Tilbake
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
              <span className="text-[#F59E0B]">Last opp</span> · /upload
            </div>
            <button
              onClick={logout}
              data-testid="upload-logout-button"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-500 hover:text-white transition-colors px-3 py-1.5 border border-white/10 rounded-md"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logg ut
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="font-heading text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-2">
            Last inn medieklipp
          </h1>
          <p className="text-sm text-zinc-500">
            Dra og slipp filer, eller klikk i sonen under. Støtter MP4, WEBM, MOV samt JPG, PNG, WEBP, GIF.
          </p>
        </div>

        {/* Dropzone */}
        <div
          data-testid="upload-dropzone"
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative cursor-pointer rounded-lg border border-dashed transition-all duration-150 ${
            dragOver
              ? "border-[#F59E0B] bg-[#F59E0B]/5"
              : "border-white/15 bg-[#0A0A0A] hover:border-white/30"
          } ${uploading ? "pointer-events-none" : ""}`}
        >
          <div className="px-8 py-14 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-[#111111] border border-white/10 mb-5">
              <UploadCloud className="w-5 h-5 text-[#F59E0B]" strokeWidth={1.8} />
            </div>
            <div className="font-heading text-lg text-white mb-2">
              {uploading ? "Laster opp..." : "Dra og slipp video- eller bildefiler her"}
            </div>
            <div className="text-xs text-zinc-500">
              {uploading ? currentName : "eller klikk for å velge"}
            </div>
            {uploading && (
              <div className="mt-6 max-w-md mx-auto">
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#F59E0B] transition-all duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-2 font-mono text-xs text-[#F59E0B] tracking-wider">
                  {progress}%
                </div>
              </div>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,image/*,audio/*"
            multiple
            className="hidden"
            data-testid="upload-file-input"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>

        {/* Add live stream */}
        <div className="mt-6 flex items-center justify-between gap-4 bg-[#0A0A0A] border border-white/10 rounded-lg px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-white">
              <Radio className="w-4 h-4 text-[#F59E0B]" />
              <span className="text-sm font-semibold">Direkte­strøm (SRT / RTMP)</span>
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Legg til en SRT- eller RTMP-kilde. KinoKontroll henter den med ffmpeg
              og pakker om til HLS for avspilling i nettleser.
            </div>
          </div>
          <button
            onClick={() =>
              setStreamModal({
                name: "",
                stream_url: "",
                stream_protocol: "srt",
                stream_mode: "caller",
              })
            }
            data-testid="upload-add-stream-button"
            className="inline-flex items-center gap-2 bg-[#F59E0B]/10 border border-[#F59E0B]/40 hover:bg-[#F59E0B]/20 text-[#F59E0B] px-4 py-2 rounded-md text-sm uppercase tracking-[0.15em] transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Legg til strøm
          </button>
        </div>

        {/* List */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <div className="inline-flex border border-white/10 rounded-md overflow-hidden bg-[#0A0A0A]">
              {[
                { v: "content", l: "Programinnhold" },
                { v: "asset", l: "Ressurser" },
              ].map((t) => (
                <button
                  key={t.v}
                  onClick={() => setTab(t.v)}
                  data-testid={`upload-tab-${t.v}`}
                  className={`text-[11px] uppercase tracking-[0.2em] px-4 py-2 transition-colors ${
                    tab === t.v
                      ? "bg-[#F59E0B]/15 text-[#F59E0B]"
                      : "text-zinc-500 hover:text-white"
                  }`}
                >
                  {t.l}
                </button>
              ))}
            </div>
            <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-semibold">
              {tab === "content" ? "Innhold" : "Logo / bakgrunn / bumper / musikk"} ·{" "}
              {filteredVideos.length}
            </h2>
          </div>

          {filteredVideos.length === 0 ? (
            <div
              className="text-sm text-zinc-600 bg-[#0A0A0A] border border-white/10 rounded-lg px-6 py-10 text-center"
              data-testid="upload-empty"
            >
              {tab === "content"
                ? "Ingen videoklipp eller bilder lastet opp enda."
                : "Ingen ressurser lagt til enda. Last opp logo, bakgrunn, bumper eller musikk her."}
            </div>
          ) : (
            <ul className="divide-y divide-white/5 bg-[#0A0A0A] border border-white/10 rounded-lg overflow-hidden">
              {filteredVideos.map((v) => {
                const isImg = v.media_type === "image";
                const isStream = v.media_type === "stream";
                const isAudio = v.media_type === "audio";
                return (
                  <li
                    key={v.id}
                    data-testid="upload-clip-item"
                    className="flex items-center gap-4 px-5 py-3 hover:bg-[#111111] transition-colors"
                  >
                    <div className="w-16 h-10 rounded bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                      {v.has_thumbnail ? (
                        <img
                          src={thumbUrl(v.id)}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : isImg ? (
                        <ImageIcon className="w-4 h-4 text-[#F59E0B]" />
                      ) : isStream ? (
                        <Radio className="w-4 h-4 text-rose-400" />
                      ) : isAudio ? (
                        <Music className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Film className="w-4 h-4 text-[#F59E0B]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          defaultValue={v.filename}
                          onBlur={(e) => {
                            const nv = e.target.value.trim();
                            if (nv && nv !== v.filename) renameMedia(v.id, nv);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.target.blur();
                            if (e.key === "Escape") {
                              e.target.value = v.filename;
                              e.target.blur();
                            }
                          }}
                          data-testid="upload-filename-input"
                          title="Klikk for å gi nytt navn"
                          className="text-white text-sm truncate bg-transparent border-0 border-b border-transparent hover:border-white/10 focus:border-[#F59E0B] focus:outline-none px-0 py-0.5 min-w-0 flex-1"
                        />
                        <span
                          className={`text-[9px] uppercase tracking-[0.15em] font-mono px-1.5 py-0.5 rounded border shrink-0 ${
                            isStream
                              ? "text-rose-400 border-rose-400/40 bg-rose-400/5"
                              : isAudio
                              ? "text-emerald-400 border-emerald-400/40 bg-emerald-400/5"
                              : isImg
                              ? "text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/5"
                              : "text-zinc-500 border-white/10"
                          }`}
                        >
                          {isStream
                            ? `STRØM · ${(v.stream_protocol || "").toUpperCase()}`
                            : isAudio
                            ? "MUSIKK"
                            : isImg
                            ? "BILDE"
                            : "VIDEO"}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-600 font-mono truncate">
                        {isStream
                          ? v.stream_url
                          : `${formatSize(v.size)} · ${(v.content_type || "").replace(/^(video|image|audio)\//, "")}${
                              isAudio && v.duration
                                ? ` · ${Math.floor(v.duration / 60)}:${String(Math.round(v.duration % 60)).padStart(2, "0")}`
                                : ""
                            }`}
                      </div>
                    </div>

                    {isImg && (
                      <div
                        className="flex items-center gap-2 text-xs text-zinc-500"
                        data-testid="upload-duration-controls"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <input
                          type="number"
                          min={1}
                          max={3600}
                          step={1}
                          defaultValue={v.duration || 5}
                          onBlur={(e) => updateDuration(v.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.target.blur();
                          }}
                          data-testid="upload-duration-input"
                          className="w-16 bg-[#050505] border border-white/10 rounded px-2 py-1 text-white text-xs font-mono text-right focus:outline-none focus:border-[#F59E0B]"
                        />
                        <span className="text-zinc-600 font-mono">sek</span>
                      </div>
                    )}

                    {!isImg && !isStream && !isAudio && !v.has_thumbnail && (
                      <button
                        onClick={() => regenerateThumb(v)}
                        data-testid="upload-regenerate-thumb-button"
                        className="text-[10px] uppercase tracking-[0.15em] text-zinc-500 hover:text-[#F59E0B] px-2 py-1 border border-white/10 hover:border-[#F59E0B]/40 rounded transition-colors"
                        title="Trekk ut et stillbilde fra videoen"
                      >
                        Lag preview
                      </button>
                    )}

                    {!isImg && !isStream && !isAudio && (
                      <button
                        onClick={() => setTrimming(v)}
                        data-testid="upload-trim-button"
                        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-zinc-400 hover:text-[#F59E0B] px-2 py-1 border border-white/10 hover:border-[#F59E0B]/40 rounded transition-colors"
                        title="Trim klippet"
                      >
                        <Scissors className="w-3 h-3" />
                        Trim
                      </button>
                    )}

                    {/* Move between content/asset (not for streams or audio
                        which have a fixed category). */}
                    {!isStream && !isAudio && (
                      <button
                        onClick={() =>
                          setCategory(v.id, tab === "content" ? "asset" : "content")
                        }
                        data-testid="upload-move-category-button"
                        title={
                          tab === "content"
                            ? "Flytt til ressurser (logo/bakgrunn/bumper)"
                            : "Flytt til programinnhold"
                        }
                        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] text-zinc-400 hover:text-[#F59E0B] px-2 py-1 border border-white/10 hover:border-[#F59E0B]/40 rounded transition-colors"
                      >
                        <ArrowRightLeft className="w-3 h-3" />
                        {tab === "content" ? "Til ressurser" : "Til innhold"}
                      </button>
                    )}

                    <button
                      onClick={() => remove(v.id)}
                      data-testid="upload-delete-button"
                      className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-red-400 px-3 py-1.5 border border-white/10 hover:border-red-500/40 rounded-md transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Slett
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Hidden direct stream link helper for testing */}
        {videos[0] && (
          <a
            href={`${API}/videos/${videos[0].id}/stream`}
            className="hidden"
            data-testid="upload-first-stream-url"
          >
            stream
          </a>
        )}
      </main>

      {trimming && (
        <TrimModal
          video={trimming}
          onClose={() => setTrimming(null)}
          onSaved={load}
        />
      )}

      {streamModal && (
        <StreamModal
          draft={streamModal}
          setDraft={setStreamModal}
          onClose={() => setStreamModal(null)}
          onSaved={() => {
            setStreamModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function StreamModal({ draft, setDraft, onClose, onSaved }) {
  const [saving, setSaving] = useState(false);
  const valid = draft.name.trim() && draft.stream_url.trim();

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await api.post("/streams", {
        name: draft.name.trim(),
        stream_url: draft.stream_url.trim(),
        stream_protocol: draft.stream_protocol,
        stream_mode: draft.stream_mode,
      });
      toast.success("Strøm lagret");
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kunne ikke lagre strøm");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="upload-stream-modal"
    >
      <div className="w-full max-w-lg bg-[#0A0A0A] border border-white/10 rounded-lg overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-[#F59E0B]" />
            <h3 className="text-white text-sm uppercase tracking-[0.2em] font-semibold">
              Ny direktestrøm
            </h3>
          </div>
          <button
            onClick={onClose}
            data-testid="upload-stream-close"
            className="text-zinc-500 hover:text-white p-1.5 rounded hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
              Navn
            </label>
            <input
              type="text"
              autoFocus
              placeholder="F.eks. Live fra storsalen"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              data-testid="upload-stream-name"
              className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
            />
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
              Protokoll
            </label>
            <div className="flex gap-2">
              {[
                { v: "srt", l: "SRT" },
                { v: "rtmp", l: "RTMP" },
              ].map((p) => (
                <button
                  key={p.v}
                  type="button"
                  onClick={() => setDraft({ ...draft, stream_protocol: p.v })}
                  data-testid={`upload-stream-proto-${p.v}`}
                  className={`flex-1 text-sm uppercase tracking-[0.15em] px-3 py-2 border rounded transition-colors ${
                    draft.stream_protocol === p.v
                      ? "border-[#F59E0B]/60 text-[#F59E0B] bg-[#F59E0B]/10"
                      : "border-white/10 text-zinc-400 hover:text-white hover:border-white/30"
                  }`}
                >
                  {p.l}
                </button>
              ))}
            </div>
          </div>

          {draft.stream_protocol === "srt" && (
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
                SRT-modus
              </label>
              <div className="flex gap-2">
                {[
                  { v: "caller", l: "Caller (henter)" },
                  { v: "listener", l: "Listener (mottar)" },
                ].map((m) => (
                  <button
                    key={m.v}
                    type="button"
                    onClick={() => setDraft({ ...draft, stream_mode: m.v })}
                    data-testid={`upload-stream-mode-${m.v}`}
                    className={`flex-1 text-xs uppercase tracking-[0.15em] px-3 py-2 border rounded transition-colors ${
                      draft.stream_mode === m.v
                        ? "border-[#F59E0B]/60 text-[#F59E0B] bg-[#F59E0B]/10"
                        : "border-white/10 text-zinc-400 hover:text-white hover:border-white/30"
                    }`}
                  >
                    {m.l}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
              URL
            </label>
            <input
              type="text"
              placeholder={
                draft.stream_protocol === "srt"
                  ? "srt://server.example.com:9999?streamid=live"
                  : "rtmp://server.example.com/live/streamkey"
              }
              value={draft.stream_url}
              onChange={(e) => setDraft({ ...draft, stream_url: e.target.value })}
              data-testid="upload-stream-url"
              className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
            />
            <p className="text-[10px] text-zinc-600 mt-1.5 leading-relaxed">
              Backend henter strømmen via ffmpeg ved playout-tidspunkt og
              transcoder til HLS for avspilling i visningsappen. Ekstraparametere
              (latency, passphrase, streamid) kan legges til som query-string.
            </p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-white/5 flex justify-end gap-2">
          <button
            onClick={onClose}
            data-testid="upload-stream-cancel"
            className="px-4 py-2 text-xs uppercase tracking-[0.2em] text-zinc-400 hover:text-white rounded transition-colors"
          >
            Avbryt
          </button>
          <button
            onClick={save}
            disabled={!valid || saving}
            data-testid="upload-stream-save"
            className="inline-flex items-center gap-2 bg-[#F59E0B]/10 border border-[#F59E0B]/40 hover:bg-[#F59E0B]/20 text-[#F59E0B] px-4 py-2 rounded-md text-xs uppercase tracking-[0.2em] transition-colors disabled:opacity-40"
          >
            {saving ? "Lagrer..." : "Lagre strøm"}
          </button>
        </div>
      </div>
    </div>
  );
}
