import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, UploadCloud, Trash2, Film, Image as ImageIcon, LogOut, Clock } from "lucide-react";
import { toast } from "sonner";
import { api, authHeaders, API, clearToken, thumbUrl } from "../lib/api";

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

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setCurrentName(file.name);
    try {
      const isImage = (file.type || "").startsWith("image/");
      const fd = new FormData();
      fd.append("file", file);
      if (isImage) fd.append("duration", "5");
      const res = await api.post("/videos/upload", fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
        onUploadProgress: (ev) => {
          if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      const mediaId = res.data?.id;

      // Best-effort video thumbnail extraction (skipped for images — backend already uses image as its own thumb)
      if (!isImage) {
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
      await upload(f);
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
            accept="video/*,image/*"
            multiple
            className="hidden"
            data-testid="upload-file-input"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>

        {/* List */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-semibold">
              Bibliotek · {videos.length}
            </h2>
          </div>

          {videos.length === 0 ? (
            <div
              className="text-sm text-zinc-600 bg-[#0A0A0A] border border-white/10 rounded-lg px-6 py-10 text-center"
              data-testid="upload-empty"
            >
              Ingen klipp lastet opp enda.
            </div>
          ) : (
            <ul className="divide-y divide-white/5 bg-[#0A0A0A] border border-white/10 rounded-lg overflow-hidden">
              {videos.map((v) => {
                const isImg = v.media_type === "image";
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
                      ) : (
                        <Film className="w-4 h-4 text-[#F59E0B]" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm truncate">{v.filename}</span>
                        <span
                          className={`text-[9px] uppercase tracking-[0.15em] font-mono px-1.5 py-0.5 rounded border ${
                            isImg
                              ? "text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/5"
                              : "text-zinc-500 border-white/10"
                          }`}
                        >
                          {isImg ? "BILDE" : "VIDEO"}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-600 font-mono">
                        {formatSize(v.size)} · {(v.content_type || "").replace(/^(video|image)\//, "")}
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

                    {!isImg && !v.has_thumbnail && (
                      <button
                        onClick={() => regenerateThumb(v)}
                        data-testid="upload-regenerate-thumb-button"
                        className="text-[10px] uppercase tracking-[0.15em] text-zinc-500 hover:text-[#F59E0B] px-2 py-1 border border-white/10 hover:border-[#F59E0B]/40 rounded transition-colors"
                        title="Trekk ut et stillbilde fra videoen"
                      >
                        Lag preview
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
    </div>
  );
}
