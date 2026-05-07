import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  Upload as UploadIcon,
  LayoutGrid,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { api, clearToken, streamUrl, thumbUrl } from "../lib/api";
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
  duration_minutes: 60,
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
        duration_minutes: item.duration_minutes || 60,
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
  const streams = useMemo(() => media.filter((m) => m.media_type === "stream"), [media]);

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
        duration_minutes: Math.max(5, parseInt(draft.duration_minutes, 10) || 60),
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
                  // When picking a video with a known duration, default the
                  // timeline-block length to the actual clip length (rounded
                  // up to nearest minute, with a 5-min minimum so very short
                  // clips still produce a clickable block).
                  let nextDuration = draft.duration_minutes;
                  if (m && m.media_type === "video" && m.duration > 0) {
                    nextDuration = Math.max(5, Math.ceil(m.duration / 60));
                  }
                  setDraft({
                    ...draft,
                    media_id: e.target.value,
                    title: draft.title || m?.filename || "",
                    duration_minutes: nextDuration,
                  });
                }}
                data-testid="playout-modal-media"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
              >
                <option value="">— Velg —</option>
                {videos.length > 0 && <optgroup label="Video">{videos.map((m) => <option key={m.id} value={m.id}>{m.filename}</option>)}</optgroup>}
                {images.length > 0 && <optgroup label="Bilde">{images.map((m) => <option key={m.id} value={m.id}>{m.filename}</option>)}</optgroup>}
                {streams.length > 0 && <optgroup label="Direktestrøm">{streams.map((m) => <option key={m.id} value={m.id}>{`${m.stream_protocol?.toUpperCase() || "STRØM"} · ${m.filename}`}</option>)}</optgroup>}
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
            <div className="md:col-span-2">
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Lengde i tidslinje (minutter)
                {(() => {
                  const m = media.find((x) => x.id === draft.media_id);
                  if (!m || !m.duration) return null;
                  const mins = Math.floor(m.duration / 60);
                  const secs = Math.round(m.duration % 60);
                  return (
                    <span className="ml-2 text-zinc-400 normal-case tracking-normal">
                      · faktisk klipp-lengde {mins}m {secs}s
                    </span>
                  );
                })()}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  step={5}
                  max={720}
                  value={draft.duration_minutes}
                  onChange={(e) => setDraft({ ...draft, duration_minutes: e.target.value })}
                  data-testid="playout-modal-duration"
                  className="flex-1 bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
                />
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setDraft({ ...draft, duration_minutes: m })}
                    className={`text-[10px] uppercase tracking-[0.15em] px-2.5 py-2 border rounded transition-colors ${
                      Number(draft.duration_minutes) === m
                        ? "border-[#F59E0B]/60 text-[#F59E0B] bg-[#F59E0B]/10"
                        : "border-white/10 text-zinc-500 hover:text-white hover:border-white/30"
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </div>
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

/**
 * Vertical timeline with absolute-positioned item blocks.
 * - Each scheduled item is rendered as a single block whose height equals its
 *   `duration_minutes` (rounded to 15-min slots).
 * - Items are draggable: dropping on an empty slot patches `scheduled_at` to
 *   that slot's time on the same day.
 */
const SLOT_PX = 44;
const HOURS_START = 6;
const HOURS_END = 24;
const TOTAL_SLOTS = (HOURS_END - HOURS_START) * 4; // 72
const TIMELINE_HEIGHT = TOTAL_SLOTS * SLOT_PX;
const TIME_COL_WIDTH = 80;

function slotIndexFromTime(hours, minutes) {
  return ((hours - HOURS_START) * 60 + minutes) / 15;
}

function TimelineGrid({
  items,
  media,
  date,
  onSlotClick,
  onItemClick,
  onItemMove,
  currentMediaId,
}) {
  const containerRef = useRef(null);
  const draggingIdRef = useRef(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const [draggingId, setDraggingId] = useState(null);

  const dayItems = useMemo(
    () => items.filter((it) => ymd(new Date(it.scheduled_at)) === date),
    [items, date]
  );

  const slotKeys = useMemo(() => {
    const out = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const total = HOURS_START * 60 + i * 15;
      const h = Math.floor(total / 60);
      const m = total % 60;
      out.push({ idx: i, h, m, key: `${pad(h)}:${pad(m)}`, isHour: m === 0 });
    }
    return out;
  }, []);

  const slotIndexFromY = (clientY) => {
    if (!containerRef.current) return -1;
    const rect = containerRef.current.getBoundingClientRect();
    const y = clientY - rect.top;
    return Math.floor(y / SLOT_PX);
  };

  const handleDragStart = (e, item) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
    // Use a ref so onDragOver can read the current dragging id synchronously
    // (state updates are async and would race with the dragover that follows
    // immediately after dragstart, causing preventDefault to be skipped).
    draggingIdRef.current = item.id;
    setDraggingId(item.id);
  };
  const handleDragEnd = () => {
    draggingIdRef.current = null;
    setDraggingId(null);
    setDragOverIdx(null);
  };

  // Container-level drag handlers — robust against z-index / overlapping items
  const handleContainerDragOver = (e) => {
    if (!draggingIdRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const idx = slotIndexFromY(e.clientY);
    if (idx >= 0 && idx < TOTAL_SLOTS && dragOverIdx !== idx) {
      setDragOverIdx(idx);
    }
  };
  const handleContainerDrop = (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || draggingIdRef.current;
    draggingIdRef.current = null;
    setDragOverIdx(null);
    setDraggingId(null);
    if (!id) return;
    const idx = slotIndexFromY(e.clientY);
    if (idx < 0 || idx >= TOTAL_SLOTS) return;
    const slot = slotKeys[idx];
    onItemMove?.(id, `${date}T${slot.key}`);
  };

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
          06:00 – 24:00 · klikk eller dra for å plassere
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative"
        style={{ height: TIMELINE_HEIGHT }}
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
        onDragLeave={(e) => {
          // Only clear when leaving the container itself, not children
          if (e.currentTarget === e.target) setDragOverIdx(null);
        }}
      >
        {/* Background slot rows (lines + click-to-add) */}
        {slotKeys.map((slot) => {
          const top = slot.idx * SLOT_PX;
          const isDragOver = dragOverIdx === slot.idx;
          return (
            <div
              key={slot.key}
              className={`absolute left-0 right-0 ${
                slot.isHour ? "border-t-2 border-white/10" : "border-t border-white/5"
              }`}
              style={{ top, height: SLOT_PX }}
            >
              <div
                className={`absolute left-0 top-0 h-full px-3 py-2.5 font-mono text-xs select-none pointer-events-none ${
                  slot.isHour ? "text-[#F59E0B]" : "text-zinc-600"
                }`}
                style={{ width: TIME_COL_WIDTH }}
              >
                {slot.key}
              </div>
              {/* Click target (drag is handled at container level) */}
              <div
                role="button"
                tabIndex={-1}
                data-testid="playout-empty-slot"
                data-time={slot.key}
                onClick={() => onSlotClick(`${date}T${slot.key}`)}
                className={`absolute top-0 bottom-0 cursor-pointer transition-colors ${
                  isDragOver
                    ? "bg-[#F59E0B]/20 outline outline-2 outline-[#F59E0B]/70"
                    : "hover:bg-[#F59E0B]/5"
                }`}
                style={{ left: TIME_COL_WIDTH, right: 0 }}
              />
            </div>
          );
        })}

        {/* Items (absolute, on top, span across slots based on duration) */}
        {dayItems.map((it) => {
          const dt = new Date(it.scheduled_at);
          const startIdx = slotIndexFromTime(dt.getHours(), dt.getMinutes());
          if (startIdx < 0 || startIdx >= TOTAL_SLOTS) return null;
          const dur = Math.max(15, Number(it.duration_minutes) || 15);
          const endMinutes = dt.getHours() * 60 + dt.getMinutes() + dur;
          const endHours = Math.floor(endMinutes / 60);
          const endMins = endMinutes % 60;
          const endLabel = `${pad(endHours)}:${pad(endMins)}`;
          const heightPx = (dur / 15) * SLOT_PX - 4;
          const top = startIdx * SLOT_PX + 2;
          const mediaItem = media.find((x) => x.id === it.media_id);
          const pre = it.pre_plakat_id ? media.find((x) => x.id === it.pre_plakat_id) : null;
          const isOnAir =
            currentMediaId === it.media_id || currentMediaId === it.pre_plakat_id;
          const isDragging = draggingId === it.id;
          const isCompact = heightPx < 56;
          return (
            <div
              key={it.id}
              draggable
              onDragStart={(e) => handleDragStart(e, it)}
              onDragEnd={handleDragEnd}
              onClick={() => onItemClick(it)}
              data-testid="playout-timeline-item"
              data-time={`${pad(dt.getHours())}:${pad(dt.getMinutes())}`}
              style={{
                top,
                height: Math.max(SLOT_PX - 4, heightPx),
                left: TIME_COL_WIDTH + 6,
                right: 8,
                opacity: isDragging ? 0.35 : 1,
                pointerEvents: isDragging ? "none" : "auto",
              }}
              className={`absolute z-10 cursor-move rounded border px-3 py-2 flex flex-col gap-1 transition-colors overflow-hidden shadow-lg ${
                isOnAir
                  ? "border-red-500/60 bg-red-500/15 hover:bg-red-500/20"
                  : it.status === "played"
                  ? "border-white/10 bg-black/40 hover:bg-black/50"
                  : it.status === "pre_playing"
                  ? "border-emerald-500/50 bg-emerald-500/10 hover:bg-emerald-500/15"
                  : "border-[#F59E0B]/40 bg-[#F59E0B]/10 hover:bg-[#F59E0B]/15 hover:border-[#F59E0B]/70"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isOnAir && (
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0"
                    title="On air"
                  />
                )}
                <div className="w-8 h-6 rounded bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                  {mediaItem?.has_thumbnail ? (
                    <img
                      src={thumbUrl(mediaItem.id)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : mediaItem?.media_type === "image" ? (
                    <ImageIcon className="w-3 h-3 text-[#F59E0B]" />
                  ) : mediaItem?.media_type === "stream" ? (
                    <Radio className="w-3 h-3 text-rose-400" />
                  ) : (
                    <Film className="w-3 h-3 text-zinc-500" />
                  )}
                </div>
                <span className="text-sm text-white truncate flex-1 min-w-0">
                  {it.title || mediaItem?.filename || "?"}
                </span>
                <StatusBadge status={it.status} />
              </div>

              {!isCompact && (
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 mt-auto">
                  <span className="text-[#F59E0B] font-semibold">
                    {pad(dt.getHours())}:{pad(dt.getMinutes())} – {endLabel}
                  </span>
                  <span className="text-zinc-500 uppercase tracking-[0.15em]">
                    {dur} min
                  </span>
                </div>
              )}

              {!isCompact && pre && (
                <div className="text-[10px] font-mono text-emerald-400/70 truncate">
                  Plakat: {pre.filename} · {it.pre_plakat_duration}s
                </div>
              )}
              {!isCompact && it.next_up_text && (
                <div className="text-[10px] font-mono text-[#F59E0B]/70 truncate">
                  → {it.next_up_text}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Playout() {
  const { room } = useParams();
  const roomId = room || "default";
  const navigate = useNavigate();
  const [media, setMedia] = useState([]);
  const [items, setItems] = useState([]);
  const [settings, setSettings] = useState({
    global_bumper_id: null,
    global_bumper_duration: 5,
    program_overview_enabled: false,
    program_overview_logo_id: null,
    program_overview_background_id: null,
    program_overview_text_color: "#FFFFFF",
    program_overview_duration: 8,
  });
  const [now, setNow] = useState(new Date());
  const { state } = useSync(roomId);

  // Selected day and modal state
  const [date, setDate] = useState(ymd(new Date()));
  const [editing, setEditing] = useState(null); // null | { mode: "create"|"edit", item?, initialTime? }
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);
  const [uploadingBumper, setUploadingBumper] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [m, sched, st] = await Promise.all([
        api.get("/videos"),
        api.get("/schedule", { params: { room: roomId } }),
        api.get(`/rooms/${roomId}/settings`),
      ]);
      setMedia(m.data || []);
      setItems(sched.data || []);
      setSettings((prev) => ({ ...prev, ...(st.data || {}) }));
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
        program_overview_enabled: !!settings.program_overview_enabled,
        program_overview_logo_id: settings.program_overview_logo_id || null,
        program_overview_background_id: settings.program_overview_background_id || null,
        program_overview_text_color: settings.program_overview_text_color || "#FFFFFF",
        program_overview_duration: parseFloat(settings.program_overview_duration) || 8,
      });
      toast.success("Innstillinger lagret");
    } catch (_) {
      toast.error("Kunne ikke lagre innstillinger");
    }
  };

  /** Upload an image OR video and persist its id under the given settings field. */
  const uploadImageToSetting = async (file, settingKey, busySetter) => {
    if (!file) return;
    const isMedia = file.type.startsWith("image/") || file.type.startsWith("video/");
    if (!isMedia) {
      toast.error("Bare bilde- eller videofiler kan brukes her");
      return;
    }
    busySetter(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.post("/videos/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const newId = r.data?.id;
      if (!newId) throw new Error("Manglet id i svar");
      // Save the new setting immediately so it sticks even before user clicks "Lagre".
      const next = { ...settings, [settingKey]: newId };
      setSettings(next);
      await api.put(`/rooms/${roomId}/settings`, {
        room: roomId,
        global_bumper_id: next.global_bumper_id || null,
        global_bumper_duration: parseFloat(next.global_bumper_duration) || 5,
        program_overview_enabled: !!next.program_overview_enabled,
        program_overview_logo_id: next.program_overview_logo_id || null,
        program_overview_background_id: next.program_overview_background_id || null,
        program_overview_text_color: next.program_overview_text_color || "#FFFFFF",
        program_overview_duration: parseFloat(next.program_overview_duration) || 8,
      });
      toast.success("Bilde lastet opp");
      loadAll();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Opplasting feilet");
    } finally {
      busySetter(false);
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

  // Move an item to a new time slot via drag & drop. The new time uses the
  // same calendar date as the slot the user dropped on; we keep the original
  // duration/media/etc untouched.
  const moveItem = useCallback(
    async (id, localDateTime) => {
      const iso = localInputToIso(localDateTime);
      if (!iso) return;
      // Optimistic update
      setItems((cur) =>
        cur.map((it) => (it.id === id ? { ...it, scheduled_at: iso } : it))
      );
      try {
        await api.patch(`/schedule/${id}`, { scheduled_at: iso });
        toast.success("Innslag flyttet");
        loadAll();
      } catch (e) {
        toast.error("Flytting feilet");
        loadAll();
      }
    },
    [loadAll]
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
            <Settings className="w-3 h-3" /> Pre-roll bumper (spilles 5s før hvert program)
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Bumper (animasjon eller stillbilde)
              </label>
              <div className="flex items-center gap-3">
                <div className="w-20 h-12 rounded bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                  {settings.global_bumper_id ? (
                    media.find((m) => m.id === settings.global_bumper_id)?.media_type === "video" ? (
                      <video
                        src={streamUrl(settings.global_bumper_id)}
                        muted
                        loop
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img
                        src={thumbUrl(settings.global_bumper_id)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    )
                  ) : (
                    <ImageIcon className="w-4 h-4 text-zinc-600" />
                  )}
                </div>
                <label
                  className={`inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] px-3 py-2 border border-white/10 rounded-md cursor-pointer transition-colors ${
                    uploadingBumper
                      ? "text-zinc-600 border-white/5 cursor-wait"
                      : "text-zinc-300 hover:text-[#F59E0B] hover:border-[#F59E0B]/40"
                  }`}
                  data-testid="playout-bumper-upload"
                >
                  {uploadingBumper ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UploadIcon className="w-3.5 h-3.5" />
                  )}
                  Last opp bumper
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    disabled={uploadingBumper}
                    onChange={(e) =>
                      uploadImageToSetting(
                        e.target.files?.[0],
                        "global_bumper_id",
                        setUploadingBumper
                      )
                    }
                  />
                </label>
                {settings.global_bumper_id && (
                  <button
                    onClick={() =>
                      setSettings({ ...settings, global_bumper_id: null })
                    }
                    title="Fjern bumper"
                    data-testid="playout-bumper-clear"
                    className="text-zinc-500 hover:text-red-400 p-1.5 rounded hover:bg-red-500/10"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
                <select
                  value={settings.global_bumper_id || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, global_bumper_id: e.target.value || null })
                  }
                  data-testid="playout-bumper-select"
                  className="flex-1 bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-[#F59E0B]"
                  title="Eller velg fra eksisterende mediabibliotek"
                >
                  <option value="">— Velg fra bibliotek —</option>
                  {media.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.media_type === "video" ? "🎬 " : "🖼 "}
                      {m.filename}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                Pre-roll varighet (sek før program)
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  max={3600}
                  value={settings.global_bumper_duration || 5}
                  onChange={(e) =>
                    setSettings({ ...settings, global_bumper_duration: e.target.value })
                  }
                  data-testid="playout-bumper-duration"
                  className="flex-1 bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
                />
                <button
                  onClick={saveSettings}
                  data-testid="playout-bumper-save"
                  className="inline-flex items-center justify-center gap-2 bg-[#111111] border border-white/10 hover:border-[#F59E0B]/40 hover:bg-[#F59E0B]/5 text-zinc-300 hover:text-[#F59E0B] px-4 py-2 rounded-md text-sm transition-colors"
                >
                  <Save className="w-3.5 h-3.5" /> Lagre
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Programoversikt */}
        <section
          className="mb-6 bg-[#0A0A0A] border border-white/10 rounded-lg p-4"
          data-testid="playout-program-overview-section"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold flex items-center gap-2">
              <LayoutGrid className="w-3 h-3" /> Programoversikt
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!settings.program_overview_enabled}
                onChange={(e) =>
                  setSettings({ ...settings, program_overview_enabled: e.target.checked })
                }
                data-testid="playout-overview-enabled"
                className="accent-[#F59E0B]"
              />
              <span className="text-[10px] uppercase tracking-[0.2em] text-zinc-400">
                {settings.program_overview_enabled ? "Aktivert" : "Deaktivert"}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Logo upload */}
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
                Logo (øverst venstre)
              </label>
              <div className="flex items-center gap-3">
                <div className="w-20 h-12 rounded bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                  {settings.program_overview_logo_id ? (
                    <img
                      src={thumbUrl(settings.program_overview_logo_id)}
                      alt=""
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="w-4 h-4 text-zinc-600" />
                  )}
                </div>
                <label
                  className={`inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] px-3 py-2 border border-white/10 rounded-md cursor-pointer transition-colors ${
                    uploadingLogo
                      ? "text-zinc-600 border-white/5 cursor-wait"
                      : "text-zinc-300 hover:text-[#F59E0B] hover:border-[#F59E0B]/40"
                  }`}
                  data-testid="playout-overview-logo-upload"
                >
                  {uploadingLogo ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UploadIcon className="w-3.5 h-3.5" />
                  )}
                  Last opp logo
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    disabled={uploadingLogo}
                    onChange={(e) =>
                      uploadImageToSetting(
                        e.target.files?.[0],
                        "program_overview_logo_id",
                        setUploadingLogo
                      )
                    }
                  />
                </label>
                {settings.program_overview_logo_id && (
                  <button
                    onClick={() =>
                      setSettings({ ...settings, program_overview_logo_id: null })
                    }
                    title="Fjern logo"
                    data-testid="playout-overview-logo-clear"
                    className="text-zinc-500 hover:text-red-400 p-1.5 rounded hover:bg-red-500/10"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Background upload */}
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
                Bakgrunnsplakat
              </label>
              <div className="flex items-center gap-3">
                <div className="w-20 h-12 rounded bg-black/60 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                  {settings.program_overview_background_id ? (
                    <img
                      src={thumbUrl(settings.program_overview_background_id)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-4 h-4 text-zinc-600" />
                  )}
                </div>
                <label
                  className={`inline-flex items-center gap-2 text-xs uppercase tracking-[0.15em] px-3 py-2 border border-white/10 rounded-md cursor-pointer transition-colors ${
                    uploadingBg
                      ? "text-zinc-600 border-white/5 cursor-wait"
                      : "text-zinc-300 hover:text-[#F59E0B] hover:border-[#F59E0B]/40"
                  }`}
                  data-testid="playout-overview-bg-upload"
                >
                  {uploadingBg ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UploadIcon className="w-3.5 h-3.5" />
                  )}
                  Last opp bakgrunn
                  <input
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    disabled={uploadingBg}
                    onChange={(e) =>
                      uploadImageToSetting(
                        e.target.files?.[0],
                        "program_overview_background_id",
                        setUploadingBg
                      )
                    }
                  />
                </label>
                {settings.program_overview_background_id && (
                  <button
                    onClick={() =>
                      setSettings({ ...settings, program_overview_background_id: null })
                    }
                    title="Fjern bakgrunn"
                    data-testid="playout-overview-bg-clear"
                    className="text-zinc-500 hover:text-red-400 p-1.5 rounded hover:bg-red-500/10"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Text color */}
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
                Tekstfarge
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={settings.program_overview_text_color || "#FFFFFF"}
                  onChange={(e) =>
                    setSettings({ ...settings, program_overview_text_color: e.target.value })
                  }
                  data-testid="playout-overview-color"
                  className="w-12 h-10 rounded border border-white/10 bg-[#050505] cursor-pointer"
                />
                <input
                  type="text"
                  value={settings.program_overview_text_color || "#FFFFFF"}
                  onChange={(e) =>
                    setSettings({ ...settings, program_overview_text_color: e.target.value })
                  }
                  placeholder="#FFFFFF"
                  data-testid="playout-overview-color-text"
                  className="flex-1 bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono uppercase focus:outline-none focus:border-[#F59E0B]"
                />
              </div>
            </div>

            {/* Duration */}
            <div>
              <label className="block text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1.5">
                Varighet mellom innslag (sek)
              </label>
              <input
                type="number"
                min={1}
                max={3600}
                value={settings.program_overview_duration || 8}
                onChange={(e) =>
                  setSettings({ ...settings, program_overview_duration: e.target.value })
                }
                data-testid="playout-overview-duration"
                className="w-full bg-[#050505] border border-white/10 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-[#F59E0B]"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-zinc-600 flex-1 min-w-[260px]">
              Vises automatisk på <code className="text-zinc-400">/display</code> mellom innslag og når det ikke er noe avspilling.
              Bumper (over) vises først hvis satt, deretter programoversikten.
            </p>
            <button
              onClick={saveSettings}
              data-testid="playout-overview-save"
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
            onItemMove={moveItem}
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
