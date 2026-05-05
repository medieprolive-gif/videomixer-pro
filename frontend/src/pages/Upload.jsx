import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, UploadCloud, Trash2, Film, LogOut } from "lucide-react";
import { toast } from "sonner";
import { api, authHeaders, API, clearToken } from "../lib/api";

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
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post("/videos/upload", fd, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
        onUploadProgress: (ev) => {
          if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100));
        },
      });
      const videoId = res.data?.id;

      // Best-effort thumbnail extraction in the browser
      try {
        const thumb = await captureThumbnail(file);
        if (thumb && videoId) {
          const tfd = new FormData();
          tfd.append("file", thumb, "thumb.jpg");
          await api.post(`/videos/${videoId}/thumbnail`, tfd, {
            headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
          });
        }
      } catch (_) {
        /* thumbnail is best-effort; ignore failures */
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
      toast.success("Video slettet");
      setVideos((v) => v.filter((x) => x.id !== id));
    } catch (e) {
      toast.error("Sletting feilet");
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
            Last inn videoklipp
          </h1>
          <p className="text-sm text-zinc-500">
            Dra og slipp filer, eller klikk i sonen under. Støtter MP4, WEBM, MOV.
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
              {uploading ? "Laster opp..." : "Dra og slipp videofiler her"}
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
            accept="video/*"
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
              Ingen videoer lastet opp enda.
            </div>
          ) : (
            <ul className="divide-y divide-white/5 bg-[#0A0A0A] border border-white/10 rounded-lg overflow-hidden">
              {videos.map((v) => (
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
                    ) : (
                      <Film className="w-4 h-4 text-[#F59E0B]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm truncate">{v.filename}</div>
                    <div className="text-xs text-zinc-600 font-mono">
                      {formatSize(v.size)} · {(v.content_type || "").replace("video/", "")}
                    </div>
                  </div>
                  <button
                    onClick={() => remove(v.id)}
                    data-testid="upload-delete-button"
                    className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-red-400 px-3 py-1.5 border border-white/10 hover:border-red-500/40 rounded-md transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Slett
                  </button>
                </li>
              ))}
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
