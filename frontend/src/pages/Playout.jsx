import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarClock,
  Plus,
  Trash2,
  Image as ImageIcon,
  Film,
  LogOut,
  RefreshCw,
  Settings,
  Save,
  Radio,
  X,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { api, clearToken, thumbUrl } from "../lib/api";
import { useSync } from "../lib/useSync";

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Build a Date for a given local Y-M-D + HH:MM. */
function makeLocalDate(yyyymmdd, hh, mm) {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatClock(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function StatusBadge({ status }) {
  const map = {
    scheduled: { label: "Planlagt", color: "text-zinc-400 border-white/15 bg-white/5" },
    pre_playing: { label: "Forhåndsplakat", color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
    played: { label: "Spilt", color: "text-zinc-600 border-white/10 bg-transparent" },
  };
  const s = map[status] || map.scheduled;
  return (
    <span
      className={`text-[9px] uppercase tracking-[0.2em] font-mono px-2 py-0.5 rounded border ${s.color}`}
      data-testid="schedule-status"
    >
      {s.label}
    </span>
  );
}

const EMPTY_DRAFT = {
  scheduled_at: "",
  media_id: "",
  title: "",
  next_up_text: "",
  pre_plakat_id: "",
  pre_plakat_duration: 5,
};

/** Modal for creating or editing a schedule entry. */
function ItemModal({ mode, item, initialTime, media, roomId, onClose, onSaved }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mode === "edit" && item) {
      setDraft({
        scheduled_at: isoToLocalInput(item.scheduled_at),
        media_id: item.media_id || "",
        title: item.title || "",
        next_up_text: item.next_up_text || "",
        pre_plakat_id: item.pre_plakat_id || "",
        pre_plakat_duration: item.pre_plakat_duration || 5,
      });
    } else {
      setDraft({ ...EMPTY_DRAFT, scheduled_at: initialTime || "" });
    }
  }, [mode, item, initialTime]);

  // ESC to close
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const videos = useMemo(() => media.filter((m) => m.media_type === "video"), [media]);
  const images = useMemo(() => media.filter((m) => m.media_type === "image"), [media]);

  const save = async () => {
    if (!draft.scheduled_at || !draft.media_id) {
      toast.error("Velg klokkeslett og innslag");
      return;
    }
    const iso = localInputToIso(draft.scheduled_at);
    if (!iso) {
      toast.error("Ugyldig klokkeslett");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        scheduled_at: iso,
        media_id: draft.media_id,
        title: draft.title,
        next_up_text: draft.next_up_text,
        pre_plakat_id: draft.pre_plakat_id || null,
        pre_plakat_duration: draft.pre_plakat_id ? parseFloat(draft.pre_plakat_duration) || 0 : 0,
      };
      if (mode === "edit" && item) {
        await api.patch(`/schedule/${item.id}`, payload);
        toast.success("Innslag oppdatert");
      } else {
        await api.post("/schedule", { ...payload, room: roomId });
        toast.success("Innslag lagt til");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kunne ikke lagre");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!item) return;
    if (!window.confirm(`Slette "${item.title || "innslag"}"?`)) return;
    try {
      await api.delete(`/schedule/${item.id}`);
      toast.success("Slettet");
      onSaved();
      onClose();
    } catch (_) {
      toast.error("Sletting feilet");
    }
  };

  const reset = async () => {
    if (!item) return;
    try {
      await api.patch(`/schedule/${item.id}`, { status: "scheduled" });
      toast.success("Tilbakestilt");
      onSaved();
      onClose();
    } catch (_) {
      toast.error("Kunne ikke tilbakestille");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      data-testid="playout-item-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#0A0A0A] border border-white/10 rounded-lg w-full max-w-2xl flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-[#F59E0B]" />
            <h3 className="font-heading text-base text-white">
              {mode === "edit" ? "Rediger innslag" : "Nytt innslag"}
            </h3>
            {item && <StatusBadge status={item.status} />}
          </div>
          <button
            onClick={onClose}
            data-testid="playout-modal-close"
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-white/5 text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Tidspunkt
              </label>
              <input
                type="datetime-local"
                value={draft.scheduled_at}
                onChange={(e) => setDraft({ ...draft, scheduled_at: e.target.value })}
                data-testid="playout-modal-time"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Hovedinnslag
              </label>
              <select
                value={draft.media_id}
                onChange={(e) => {
                  const m = media.find((x) => x.id === e.target.value);
                  setDraft({
                    ...draft,
                    media_id: e.target.value,
                    title: draft.title || m?.filename || "",
                  });
                }}
                data-testid="playout-modal-media"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              >
                <option value="">— Velg —</option>
                {videos.length > 0 && <optgroup label="Video">{videos.map((m) => <option key={m.id} value={m.id}>{m.filename}</option>)}</optgroup>}
                {images.length > 0 && <optgroup label="Bilde">{images.map((m) => <option key={m.id} value={m.id}>{m.filename}</option>)}</optgroup>}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Tittel
              </label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="F.eks. Nyhetene 19:00"
                data-testid="playout-modal-title"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                "Neste opp"-tekst
              </label>
              <input
                type="text"
                value={draft.next_up_text}
                onChange={(e) => setDraft({ ...draft, next_up_text: e.target.value })}
                placeholder="Vises på /display siste 10 sek"
                data-testid="playout-modal-next-text"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Forhåndsplakat (valgfritt)
              </label>
              <select
                value={draft.pre_plakat_id}
                onChange={(e) => setDraft({ ...draft, pre_plakat_id: e.target.value })}
                data-testid="playout-modal-preplakat"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              >
                <option value="">— Ingen —</option>
                {images.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.filename}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Plakat varighet (sek)
              </label>
              <input
                type="number"
                min={1}
                max={3600}
                value={draft.pre_plakat_duration}
                onChange={(e) => setDraft({ ...draft, pre_plakat_duration: e.target.value })}
                disabled={!draft.pre_plakat_id}
                data-testid="playout-modal-preplakat-duration"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B] disabled:opacity-40"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {mode === "edit" && item && (
              <>
                <button
                  onClick={remove}
                  data-testid="playout-modal-delete"
                  className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-zinc-500 hover:text-red-400 px-3 py-2 border border-white/10 hover:border-red-500/40 rounded-md transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Slett
                </button>
                {item.status === "played" && (
                  <button
                    onClick={reset}
                    data-testid="playout-modal-reset"
                    className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-zinc-500 hover:text-[#F59E0B] px-3 py-2 border border-white/10 hover:border-[#F59E0B]/40 rounded-md transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Tilbakestill
                  </button>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-xs uppercase tracking-[0.15em] text-zinc-500 hover:text-white px-4 py-2 transition-colors"
            >
              Avbryt
            </button>
            <button
              onClick={save}
              disabled={saving}
              data-testid="playout-modal-save"
              className="inline-flex items-center gap-2 bg-[#F59E0B] hover:bg-[#FBBF24] text-black font-medium text-sm px-5 py-2 rounded-md transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? "Lagrer..." : mode === "edit" ? "Lagre endringer" : "Legg til"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Vertical timeline grid with quarter-hour clickable slots. */
function TimelineGrid({ items, media, date, onSlotClick, onItemClick, currentMediaId }) {
  // Generate slots from 06:00 to 24:00 in 15-min increments
  const slots = useMemo(() => {
    const out = [];
    for (let h = 6; h < 24; h++) {
      for (let q = 0; q < 4; q++) {
        out.push({ h, m: q * 15 });
      }
    }
    return out;
  }, []);

  // Build a map from "HH:MM" key (rounded down to nearest quarter) → list of items
  const itemsBySlot = useMemo(() => {
    const map = new Map();
    items.forEach((it) => {
      const dt = new Date(it.scheduled_at);
      if (ymd(dt) !== date) return;
      const h = dt.getHours();
      const m = Math.floor(dt.getMinutes() / 15) * 15;
      const key = `${pad(h)}:${pad(m)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    });
    return map;
  }, [items, date]);

  return (
    <div
      className="bg-[#0A0A0A] border border-white/10 rounded-lg overflow-hidden"
      data-testid="playout-timeline-grid"
    >
      <div className="px-4 py-3 border-b border-white/5 bg-[#0E0E0E] flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold">
          Tidslinje · {date}
        </div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-mono">
          06:00 – 24:00 · klikk for å legge til
        </div>
      </div>
      <ul className="divide-y divide-white/5">
        {slots.map(({ h, m }) => {
          const key = `${pad(h)}:${pad(m)}`;
          const slotItems = itemsBySlot.get(key) || [];
          const isHourBoundary = m === 0;
          return (
            <li
              key={key}
              className={`relative ${isHourBoundary ? "border-t-2 border-white/10" : ""}`}
            >
              <div className="flex items-stretch">
                <div
                  className={`w-20 shrink-0 border-r border-white/5 px-3 py-2.5 font-mono text-xs ${
                    isHourBoundary ? "text-[#F59E0B]" : "text-zinc-600"
                  }`}
                >
                  {key}
                </div>
                <div className="flex-1 min-w-0 p-1.5">
                  {slotItems.length === 0 ? (
                    <button
                      onClick={() => onSlotClick(`${date}T${key}`)}
                      data-testid="playout-empty-slot"
                      data-time={key}
                      className="w-full h-9 rounded border border-dashed border-white/5 hover:border-[#F59E0B]/40 hover:bg-[#F59E0B]/5 text-zinc-700 hover:text-[#F59E0B] transition-colors flex items-center justify-center group"
                    >
                      <Plus className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ) : (
                    <div className="space-y-1.5">
                      {slotItems.map((it) => {
                        const m = media.find((x) => x.id === it.media_id);
                        const pre = it.pre_plakat_id ? media.find((x) => x.id === it.pre_plakat_id) : null;
                        const isOnAir = currentMediaId === it.media_id || currentMediaId === it.pre_plakat_id;
                        return (
                          <button
                            key={it.id}
                            onClick={() => onItemClick(it)}
                            data-testid="playout-timeline-item"
                            className={`w-full text-left rounded border px-3 py-2 flex items-center gap-3 transition-colors ${
                              isOnAir
                                ? "border-red-500/50 bg-red-500/10 hover:bg-red-500/15"
                                : it.status === "played"
                                ? "border-white/5 bg-black/30 opacity-60 hover:opacity-100"
                                : it.status === "pre_playing"
                                ? "border-emerald-500/40 bg-emerald-500/5"
                                : "border-[#F59E0B]/30 bg-[#F59E0B]/5 hover:bg-[#F59E0B]/10"
                            }`}
                          >
                            {isOnAir && (
                              <span
                                className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0"
                                title="On air"
                              />
                            )}
                            <div className="w-10 h-7 rounded bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                              {m?.has_thumbnail ? (
                                <img src={thumbUrl(m.id)} alt="" className="w-full h-full object-cover" />
                              ) : m?.media_type === "image" ? (
                                <ImageIcon className="w-3.5 h-3.5 text-[#F59E0B]" />
                              ) : (
                                <Film className="w-3.5 h-3.5 text-zinc-500" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-white truncate">
                                  {it.title || m?.filename || "?"}
                                </span>
                                <StatusBadge status={it.status} />
                              </div>
                              <div className="text-[10px] font-mono text-zinc-600 truncate">
                                {pre && (
                                  <span className="text-emerald-400/70 mr-3">
                                    Plakat: {pre.filename} · {it.pre_plakat_duration}s
                                  </span>
                                )}
                                {it.next_up_text && (
                                  <span className="text-[#F59E0B]/70">→ {it.next_up_text}</span>
                                )}
                              </div>
                            </div>
                            <span className="text-[10px] uppercase tracking-[0.2em] font-mono text-zinc-600 shrink-0">
                              {pad(new Date(it.scheduled_at).getHours())}:
                              {pad(new Date(it.scheduled_at).getMinutes())}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function Playout() {
  const { room } = useParams();
  const roomId = room || "default";
  const navigate = useNavigate();
  const [media, setMedia] = useState([]);
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState({ global_bumper_id: null, global_bumper_duration: 5 });
  const [now, setNow] = useState(new Date());
  const { state } = useSync(roomId);

  // Selected day and modal state
  const [date, setDate] = useState(ymd(new Date()));
  const [editing, setEditing] = useState(null); // null | { mode: "create"|"edit", item?, initialTime? }

  const loadAll = useCallback(async () => {
    try {
      const [m, sched, st] = await Promise.all([
        api.get("/videos"),
        api.get("/schedule", { params: { room: roomId } }),
        api.get(`/rooms/${roomId}/settings`),
      ]);
      setMedia(m.data || []);
      setItems(sched.data || []);
      setSettings(st.data || { global_bumper_id: null, global_bumper_duration: 5 });
    } catch (_) {
      /* noop */
    }
  }, [roomId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 500);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const i = setInterval(loadAll, 5000);
    return () => clearInterval(i);
  }, [loadAll]);

  const images = useMemo(() => media.filter((m) => m.media_type === "image"), [media]);

  const saveSettings = async () => {
    try {
      await api.put(`/rooms/${roomId}/settings`, {
        room: roomId,
        global_bumper_id: settings.global_bumper_id || null,
        global_bumper_duration: parseFloat(settings.global_bumper_duration) || 5,
      });
      toast.success("Innstillinger lagret");
    } catch (_) {
      toast.error("Kunne ikke lagre innstillinger");
    }
  };

  const logout = () => {
    clearToken();
    navigate("/");
  };

  const currentlyPlaying = useMemo(
    () => media.find((m) => m.id === state?.pgm_id),
    [media, state?.pgm_id]
  );

  const shiftDate = (days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    setDate(ymd(d));
  };

  return (
    <div className="min-h-screen bg-[#050505]">
      <header className="border-b border-white/5 bg-[#0A0A0A]/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              data-testid="playout-back-link"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Tilbake
            </Link>
            <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
              <CalendarClock className="w-3 h-3" />
              <span className="text-[#F59E0B]">Playout</span> · /playout
              <span className="text-zinc-700">·</span>
              <span className="font-mono text-zinc-500">sal: {roomId}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 text-sm font-mono text-[#F59E0B] tracking-wider"
              data-testid="playout-clock"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
              {formatClock(now)}
            </div>
            <a
              href={roomId === "default" ? "/control" : `/control/${roomId}`}
              className="hidden sm:inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-300 hover:text-white px-3 py-1.5 border border-white/10 rounded-md"
            >
              <Radio className="w-3.5 h-3.5" /> Switcher
            </a>
            <button
              onClick={loadAll}
              data-testid="playout-refresh-button"
              className="w-9 h-9 flex items-center justify-center rounded-md border border-white/10 hover:border-white/30 text-zinc-400 hover:text-white"
              title="Oppdater"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={logout}
              data-testid="playout-logout-button"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-500 hover:text-white px-3 py-1.5 border border-white/10 rounded-md"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logg ut</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-8">
        {/* Now playing strip */}
        <section
          className="mb-6 bg-[#0A0A0A] border border-white/10 rounded-lg p-4 flex items-center gap-4"
          data-testid="playout-now-strip"
        >
          <div className="text-[10px] uppercase tracking-[0.25em] text-red-500 font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> ON AIR
          </div>
          <div className="w-16 h-10 rounded bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
            {currentlyPlaying?.has_thumbnail ? (
              <img src={thumbUrl(currentlyPlaying.id)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Film className="w-4 h-4 text-zinc-600" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm truncate" data-testid="playout-now-title">
              {currentlyPlaying?.filename || "Ingenting spilles av"}
            </div>
            {state?.next_up_text && (
              <div className="text-xs text-[#F59E0B] truncate font-mono mt-0.5">
                Neste opp: {state.next_up_text}
              </div>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-zinc-600">
            {state?.is_playing ? "PLAYING" : "PAUSED"}
          </div>
        </section>

        {/* Settings */}
        <section className="mb-6 bg-[#0A0A0A] border border-white/10 rounded-lg p-4">
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-3 flex items-center gap-2">
            <Settings className="w-3 h-3" /> Innstillinger
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Global bumper
              </label>
              <select
                value={settings.global_bumper_id || ""}
                onChange={(e) => setSettings({ ...settings, global_bumper_id: e.target.value || null })}
                data-testid="playout-bumper-select"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              >
                <option value="">— Ingen —</option>
                {images.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.filename}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Bumper varighet (sek)
              </label>
              <input
                type="number"
                min={1}
                max={3600}
                value={settings.global_bumper_duration || 5}
                onChange={(e) => setSettings({ ...settings, global_bumper_duration: e.target.value })}
                data-testid="playout-bumper-duration"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
              />
            </div>
            <button
              onClick={saveSettings}
              data-testid="playout-bumper-save"
              className="inline-flex items-center justify-center gap-2 bg-[#111111] border border-white/10 hover:border-[#F59E0B]/40 hover:bg-[#F59E0B]/5 text-zinc-300 hover:text-[#F59E0B] px-4 py-2 rounded-md text-sm transition-colors"
            >
              <Save className="w-3.5 h-3.5" /> Lagre
            </button>
          </div>
        </section>

        {/* Day selector + timeline */}
        <section data-testid="playout-day-section">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => shiftDate(-1)}
                data-testid="playout-day-prev"
                className="w-8 h-8 flex items-center justify-center rounded border border-white/10 hover:border-white/30 text-zinc-400 hover:text-white"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="playout-day-input"
                className="bg-[#050505] border border-white/10 rounded px-3 py-1.5 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
              />
              <button
                onClick={() => shiftDate(1)}
                data-testid="playout-day-next"
                className="w-8 h-8 flex items-center justify-center rounded border border-white/10 hover:border-white/30 text-zinc-400 hover:text-white"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <button
                onClick={() => setDate(ymd(new Date()))}
                className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 hover:text-[#F59E0B] px-3 py-1.5 border border-white/10 hover:border-[#F59E0B]/40 rounded transition-colors"
              >
                I dag
              </button>
            </div>
            <button
              onClick={() => setEditing({ mode: "create", initialTime: `${date}T20:00` })}
              data-testid="playout-add-button"
              className="inline-flex items-center gap-2 bg-[#F59E0B] hover:bg-[#FBBF24] text-black font-medium text-sm px-4 py-2 rounded-md transition-colors"
            >
              <Plus className="w-4 h-4" /> Nytt innslag
            </button>
          </div>

          <TimelineGrid
            items={items}
            media={media}
            date={date}
            currentMediaId={state?.pgm_id}
            onSlotClick={(time) => setEditing({ mode: "create", initialTime: time })}
            onItemClick={(it) => setEditing({ mode: "edit", item: it })}
          />
        </section>
      </main>

      {editing && (
        <ItemModal
          mode={editing.mode}
          item={editing.item}
          initialTime={editing.initialTime}
          media={media}
          roomId={roomId}
          onClose={() => setEditing(null)}
          onSaved={loadAll}
        />
      )}
    </div>
  );
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Convert ISO datetime → value for <input type="datetime-local"> in local TZ. */
function isoToLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert <input type="datetime-local"> value → ISO string in UTC. */
function localInputToIso(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatClock(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function StatusBadge({ status }) {
  const map = {
    scheduled: { label: "Planlagt", color: "text-zinc-400 border-white/15 bg-white/5" },
    pre_playing: { label: "Forhåndsplakat", color: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10" },
    played: { label: "Spilt", color: "text-zinc-600 border-white/10 bg-transparent" },
  };
  const s = map[status] || map.scheduled;
  return (
    <span
      className={`text-[9px] uppercase tracking-[0.2em] font-mono px-2 py-0.5 rounded border ${s.color}`}
      data-testid="schedule-status"
    >
      {s.label}
    </span>
  );
}

export default function Playout() {
  const { room } = useParams();
  const roomId = room || "default";
  const navigate = useNavigate();
  const [media, setMedia] = useState([]);
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState({ global_bumper_id: null, global_bumper_duration: 5 });
  const [now, setNow] = useState(new Date());
  const { state } = useSync(roomId);

  // Inline editor state for new schedule item
  const [draft, setDraft] = useState({
    scheduled_at: "",
    media_id: "",
    title: "",
    next_up_text: "",
    pre_plakat_id: "",
    pre_plakat_duration: 5,
  });

  const loadAll = useCallback(async () => {
    try {
      const [m, sched, st] = await Promise.all([
        api.get("/videos"),
        api.get("/schedule", { params: { room: roomId } }),
        api.get(`/rooms/${roomId}/settings`),
      ]);
      setMedia(m.data || []);
      setItems(sched.data || []);
      setSettings(st.data || { global_bumper_id: null, global_bumper_duration: 5 });
    } catch (_) {
      /* noop */
    }
  }, [roomId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Live clock
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 500);
    return () => clearInterval(i);
  }, []);

  // Auto-refresh schedule (so status updates from backend scheduler are visible)
  useEffect(() => {
    const i = setInterval(loadAll, 5000);
    return () => clearInterval(i);
  }, [loadAll]);

  const videos = useMemo(() => media.filter((m) => m.media_type === "video"), [media]);
  const images = useMemo(() => media.filter((m) => m.media_type === "image"), [media]);

  const addItem = async () => {
    if (!draft.scheduled_at || !draft.media_id) {
      toast.error("Velg klokkeslett og innslag");
      return;
    }
    const iso = localInputToIso(draft.scheduled_at);
    if (!iso) {
      toast.error("Ugyldig klokkeslett");
      return;
    }
    try {
      await api.post("/schedule", {
        room: roomId,
        scheduled_at: iso,
        media_id: draft.media_id,
        title: draft.title,
        next_up_text: draft.next_up_text,
        pre_plakat_id: draft.pre_plakat_id || null,
        pre_plakat_duration: draft.pre_plakat_id ? parseFloat(draft.pre_plakat_duration) || 0 : 0,
      });
      toast.success("Innslag lagt til");
      setDraft({ ...draft, media_id: "", title: "", next_up_text: "", pre_plakat_id: "" });
      loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kunne ikke lagre");
    }
  };

  const updateItem = async (id, patch) => {
    try {
      await api.patch(`/schedule/${id}`, patch);
      loadAll();
    } catch (_) {
      toast.error("Oppdatering feilet");
    }
  };

  const deleteItem = async (id) => {
    try {
      await api.delete(`/schedule/${id}`);
      setItems((x) => x.filter((i) => i.id !== id));
      toast.success("Slettet");
    } catch (_) {
      toast.error("Sletting feilet");
    }
  };

  const resetItem = async (id) => {
    await updateItem(id, { status: "scheduled" });
    toast.success("Tilbakestilt til planlagt");
  };

  const saveSettings = async () => {
    try {
      await api.put(`/rooms/${roomId}/settings`, {
        room: roomId,
        global_bumper_id: settings.global_bumper_id || null,
        global_bumper_duration: parseFloat(settings.global_bumper_duration) || 5,
      });
      toast.success("Innstillinger lagret");
    } catch (_) {
      toast.error("Kunne ikke lagre innstillinger");
    }
  };

  const logout = () => {
    clearToken();
    navigate("/");
  };

  const currentlyPlaying = useMemo(
    () => media.find((m) => m.id === state?.pgm_id),
    [media, state?.pgm_id]
  );

  return (
    <div className="min-h-screen bg-[#050505]">
      <header className="border-b border-white/5 bg-[#0A0A0A]/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/"
              data-testid="playout-back-link"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-white"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Tilbake
            </Link>
            <div className="hidden sm:flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-zinc-600">
              <CalendarClock className="w-3 h-3" />
              <span className="text-[#F59E0B]">Playout</span> · /playout
              <span className="text-zinc-700">·</span>
              <span className="font-mono text-zinc-500">sal: {roomId}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 text-sm font-mono text-[#F59E0B] tracking-wider"
              data-testid="playout-clock"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
              {formatClock(now)}
            </div>
            <a
              href={roomId === "default" ? "/control" : `/control/${roomId}`}
              className="hidden sm:inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-300 hover:text-white px-3 py-1.5 border border-white/10 rounded-md"
            >
              <Radio className="w-3.5 h-3.5" /> Switcher
            </a>
            <button
              onClick={loadAll}
              data-testid="playout-refresh-button"
              className="w-9 h-9 flex items-center justify-center rounded-md border border-white/10 hover:border-white/30 text-zinc-400 hover:text-white"
              title="Oppdater"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={logout}
              data-testid="playout-logout-button"
              className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] text-zinc-500 hover:text-white px-3 py-1.5 border border-white/10 rounded-md"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Logg ut</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-8">
        {/* Now playing strip */}
        <section
          className="mb-8 bg-[#0A0A0A] border border-white/10 rounded-lg p-4 flex items-center gap-4"
          data-testid="playout-now-strip"
        >
          <div className="text-[10px] uppercase tracking-[0.25em] text-red-500 font-semibold flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" /> ON AIR
          </div>
          <div className="w-16 h-10 rounded bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
            {currentlyPlaying?.has_thumbnail ? (
              <img src={thumbUrl(currentlyPlaying.id)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Film className="w-4 h-4 text-zinc-600" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm truncate" data-testid="playout-now-title">
              {currentlyPlaying?.filename || "Ingenting spilles av"}
            </div>
            {state?.next_up_text && (
              <div className="text-xs text-[#F59E0B] truncate font-mono mt-0.5">
                Neste opp: {state.next_up_text}
              </div>
            )}
          </div>
          <div className="text-[10px] uppercase tracking-[0.2em] font-mono text-zinc-600">
            {state?.is_playing ? "PLAYING" : "PAUSED"}
          </div>
        </section>

        {/* Settings */}
        <section className="mb-8 bg-[#0A0A0A] border border-white/10 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold flex items-center gap-2">
              <Settings className="w-3 h-3" /> Innstillinger
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Global bumper (mellom innslag)
              </label>
              <select
                value={settings.global_bumper_id || ""}
                onChange={(e) => setSettings({ ...settings, global_bumper_id: e.target.value || null })}
                data-testid="playout-bumper-select"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              >
                <option value="">— Ingen —</option>
                {images.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.filename}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Bumper varighet (sek)
              </label>
              <input
                type="number"
                min={1}
                max={3600}
                value={settings.global_bumper_duration || 5}
                onChange={(e) => setSettings({ ...settings, global_bumper_duration: e.target.value })}
                data-testid="playout-bumper-duration"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
              />
            </div>
            <button
              onClick={saveSettings}
              data-testid="playout-bumper-save"
              className="inline-flex items-center justify-center gap-2 bg-[#111111] border border-white/10 hover:border-[#F59E0B]/40 hover:bg-[#F59E0B]/5 text-zinc-300 hover:text-[#F59E0B] px-4 py-2 rounded-md text-sm transition-colors"
            >
              <Save className="w-3.5 h-3.5" /> Lagre
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            Bumperen vises automatisk på <code className="text-zinc-400">/display</code> mellom innslag (når et innslag slutter og det finnes et neste planlagt klokkeslett).
          </p>
        </section>

        {/* New item editor */}
        <section className="mb-8 bg-[#0A0A0A] border border-white/10 rounded-lg p-4" data-testid="playout-new-item">
          <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-3 flex items-center gap-2">
            <Plus className="w-3 h-3" /> Nytt innslag
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Tidspunkt
              </label>
              <input
                type="datetime-local"
                value={draft.scheduled_at}
                onChange={(e) => setDraft({ ...draft, scheduled_at: e.target.value })}
                data-testid="playout-new-time"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Hovedinnslag (video eller bilde)
              </label>
              <select
                value={draft.media_id}
                onChange={(e) => {
                  const m = media.find((x) => x.id === e.target.value);
                  setDraft({ ...draft, media_id: e.target.value, title: draft.title || m?.filename || "" });
                }}
                data-testid="playout-new-media"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              >
                <option value="">— Velg —</option>
                {videos.map((m) => (
                  <option key={m.id} value={m.id}>
                    🎞 {m.filename}
                  </option>
                ))}
                {images.map((m) => (
                  <option key={m.id} value={m.id}>
                    🖼 {m.filename}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Tittel (valgfri)
              </label>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="F.eks. Nyhetene 19:00"
                data-testid="playout-new-title"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                "Neste opp"-tekst (vises siste 10 sek)
              </label>
              <input
                type="text"
                value={draft.next_up_text}
                onChange={(e) => setDraft({ ...draft, next_up_text: e.target.value })}
                placeholder="F.eks. Sport kl 19:30"
                data-testid="playout-new-next-text"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Forhåndsplakat (valgfritt)
              </label>
              <select
                value={draft.pre_plakat_id}
                onChange={(e) => setDraft({ ...draft, pre_plakat_id: e.target.value })}
                data-testid="playout-new-preplakat"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              >
                <option value="">— Ingen —</option>
                {images.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.filename}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Forhåndsplakat varighet (sek)
              </label>
              <input
                type="number"
                min={1}
                max={3600}
                value={draft.pre_plakat_duration}
                onChange={(e) => setDraft({ ...draft, pre_plakat_duration: e.target.value })}
                disabled={!draft.pre_plakat_id}
                data-testid="playout-new-preplakat-duration"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B] disabled:opacity-40"
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              onClick={addItem}
              data-testid="playout-add-button"
              className="inline-flex items-center gap-2 bg-[#F59E0B] hover:bg-[#FBBF24] text-black font-medium text-sm px-5 py-2 rounded-md transition-colors"
            >
              <Plus className="w-4 h-4" /> Legg til innslag
            </button>
          </div>
        </section>

        {/* Schedule list */}
        <section data-testid="playout-schedule-list">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-semibold">
              Spilleliste · {items.length}
            </h2>
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-mono">
              Auto-spiller ved klokkeslett
            </div>
          </div>
          {items.length === 0 ? (
            <div className="text-sm text-zinc-600 bg-[#0A0A0A] border border-white/10 rounded-lg px-6 py-12 text-center">
              Ingen planlagte innslag. Legg til ditt første over.
            </div>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => {
                const m = media.find((x) => x.id === item.media_id);
                const pre = item.pre_plakat_id ? media.find((x) => x.id === item.pre_plakat_id) : null;
                const sched = new Date(item.scheduled_at);
                const due = sched.getTime() <= now.getTime();
                return (
                  <li
                    key={item.id}
                    data-testid="playout-schedule-item"
                    className={`bg-[#0A0A0A] border rounded-lg p-3 flex items-center gap-3 transition-colors ${
                      item.status === "played"
                        ? "border-white/5 opacity-60"
                        : item.status === "pre_playing"
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : due
                        ? "border-red-500/30"
                        : "border-white/10"
                    }`}
                  >
                    <div className="font-mono text-sm text-[#F59E0B] tracking-wider w-20 shrink-0">
                      {pad(sched.getHours())}:{pad(sched.getMinutes())}
                    </div>
                    <div className="w-14 h-9 rounded bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                      {m?.has_thumbnail ? (
                        <img src={thumbUrl(m.id)} alt="" className="w-full h-full object-cover" />
                      ) : m?.media_type === "image" ? (
                        <ImageIcon className="w-4 h-4 text-[#F59E0B]" />
                      ) : (
                        <Film className="w-4 h-4 text-zinc-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm truncate">
                          {item.title || m?.filename || "Ukjent"}
                        </span>
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="text-[11px] text-zinc-600 font-mono truncate">
                        {pre && (
                          <span className="text-emerald-400/70 mr-3">
                            ⏵ Plakat: {pre.filename} · {item.pre_plakat_duration}s
                          </span>
                        )}
                        {item.next_up_text && (
                          <span className="text-[#F59E0B]/70">Neste: {item.next_up_text}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {item.status === "played" && (
                        <button
                          onClick={() => resetItem(item.id)}
                          data-testid="playout-reset-button"
                          className="text-[10px] uppercase tracking-[0.15em] text-zinc-500 hover:text-[#F59E0B] px-2 py-1 border border-white/10 hover:border-[#F59E0B]/40 rounded"
                        >
                          Tilbakestill
                        </button>
                      )}
                      <button
                        onClick={() => deleteItem(item.id)}
                        data-testid="playout-delete-button"
                        className="w-8 h-8 flex items-center justify-center rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10"
                        title="Slett"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
