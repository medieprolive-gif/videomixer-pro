import { useEffect, useMemo, useRef, useState } from "react";
import { thumbUrl, streamUrl } from "../lib/api";
import NewsTicker from "./NewsTicker";

const WEEKDAYS_NB = [
  "søndag",
  "mandag",
  "tirsdag",
  "onsdag",
  "torsdag",
  "fredag",
  "lørdag",
];
const MONTHS_NB = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
];

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatNorwegianDate(d) {
  const wd = WEEKDAYS_NB[d.getDay()];
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${d.getDate()}. ${MONTHS_NB[d.getMonth()]}`;
}

/**
 * Full-screen program overview shown between scheduled items (and while idle)
 * when enabled in room settings. Content is sized in cqh/cqw (container query
 * units) so the same layout works at any viewport/screen size.
 */
export default function ProgramOverview({ active = true, settings, schedule, media, roomId }) {
  const [now, setNow] = useState(new Date());
  const audioRef = useRef(null);

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  // Pause/resume the looped background music when overlay activity changes
  // (opacity:0 alone does NOT stop <audio> playback, which would leak music
  // into the actual program). We don't reset currentTime so the music feels
  // continuous across multiple appearances of the overview.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (active) {
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      try {
        a.pause();
      } catch (_) {
        /* noop */
      }
    }
  }, [active]);

  const textColor = settings?.program_overview_text_color || "#FFFFFF";
  const logoId = settings?.program_overview_logo_id;
  const bgId = settings?.program_overview_background_id;
  const musicId = settings?.program_overview_music_id;
  const musicVolume = settings?.program_overview_music_volume ?? 0.6;
  const logoMedia = (media || []).find((m) => m.id === logoId);
  const bgMedia = (media || []).find((m) => m.id === bgId);
  const bgIsVideo = bgMedia?.media_type === "video";

  const upcoming = useMemo(() => {
    const ts = now.getTime();
    return (schedule || [])
      .filter((s) => {
        if (s.status === "cancelled") return false;
        const start = new Date(s.scheduled_at).getTime();
        const dur = (s.duration_minutes || 15) * 60 * 1000;
        // Keep an item visible until its END time, not its start time.
        // Otherwise the item that just started disappears from the list a
        // few seconds before the actual program takes over the screen.
        return start + dur > ts;
      })
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  }, [schedule, now]);

  // Date shown in the header follows the NEXT upcoming item's date, so that a
  // late-evening display automatically rolls over to tomorrow once today's
  // program is done. Falls back to current date when the schedule is empty.
  const headerDate = useMemo(() => {
    if (upcoming.length > 0) return new Date(upcoming[0].scheduled_at);
    return now;
  }, [upcoming, now]);

  // Only show items that fall on the same calendar day as the header date —
  // mixing today + tomorrow in one list reads as out-of-order to viewers.
  const visibleItems = useMemo(() => {
    const y = headerDate.getFullYear();
    const m = headerDate.getMonth();
    const d = headerDate.getDate();
    return upcoming
      .filter((s) => {
        const dt = new Date(s.scheduled_at);
        return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
      })
      .slice(0, 3);
  }, [upcoming, headerDate]);

  return (
    <div
      data-testid="display-program-overview"
      className="relative w-full h-full overflow-hidden"
      style={{
        fontFamily: "Helvetica, Arial, sans-serif",
        color: textColor,
        backgroundColor: "#000",
        backgroundImage: bgId && !bgIsVideo ? `url(${streamUrl(bgId)})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
        containerType: "size",
      }}
    >
      {/* Looping background music — only present when overview is rendered.
          Volume controlled via room settings, looped indefinitely. The
          parent `active` prop drives play/pause via useEffect above so the
          music doesn't leak into the actual program once the overlay fades. */}
      {musicId && (
        <audio
          key={musicId}
          ref={(el) => {
            audioRef.current = el;
            if (el) el.volume = Math.max(0, Math.min(1, musicVolume));
          }}
          src={streamUrl(musicId)}
          loop
          data-testid="program-overview-music"
        />
      )}

      {/* Looping video background (animated) */}
      {bgIsVideo && bgId && (
        <video
          key={bgId}
          src={streamUrl(bgId)}
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />
      )}
      {/* Dark veil for legibility over arbitrary background images */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.7) 100%)",
        }}
      />

      <div className="relative h-full w-full flex flex-col">
        {/* TOP BAR: logo (left) · date (center) · clock (right) */}
        <div
          className="flex items-center justify-between"
          style={{ padding: "4cqh 4cqw 0 4cqw" }}
        >
          <div
            className="flex items-center"
            style={{ width: "26cqw", minHeight: "10cqh" }}
            data-testid="program-overview-logo"
          >
            {logoId && logoMedia?.media_type === "video" ? (
              <video
                key={logoId}
                src={streamUrl(logoId)}
                autoPlay
                loop
                muted
                playsInline
                className="object-contain drop-shadow-2xl"
                style={{ maxHeight: "14cqh", maxWidth: "100%" }}
              />
            ) : logoId ? (
              <img
                src={thumbUrl(logoId)}
                alt="Logo"
                className="object-contain drop-shadow-2xl"
                style={{ maxHeight: "14cqh", maxWidth: "100%" }}
              />
            ) : null}
          </div>
          <div
            className="text-center font-bold tracking-tight drop-shadow-2xl"
            style={{ fontSize: "5.2cqh", letterSpacing: "-0.02em" }}
            data-testid="program-overview-date"
          >
            {formatNorwegianDate(headerDate)}
          </div>
          <div
            className="text-right font-bold tabular-nums tracking-wider drop-shadow-2xl"
            style={{
              width: "26cqw",
              fontSize: "7cqh",
              letterSpacing: "0.02em",
            }}
            data-testid="program-overview-clock"
          >
            {pad(now.getHours())}:{pad(now.getMinutes())}
          </div>
        </div>

        {/* Section label */}
        <div style={{ padding: "4cqh 5cqw 0 5cqw" }}>
          <div
            className="font-light uppercase opacity-75"
            style={{ fontSize: "1.8cqh", letterSpacing: "0.35em" }}
          >
            Programoversikt
          </div>
          <div
            style={{
              marginTop: "0.8cqh",
              height: "2px",
              width: "8cqw",
              backgroundColor: textColor,
              opacity: 0.5,
            }}
          />
        </div>

        {/* Upcoming items list (3 items) */}
        <div
          className="flex-1 flex items-center justify-center"
          style={{ padding: "2cqh 5cqw 4cqh 5cqw" }}
          data-testid="program-overview-list"
        >
          {visibleItems.length === 0 ? (
            <div
              className="opacity-60 font-light"
              style={{ fontSize: "4cqh" }}
            >
              Ingen flere planlagte innslag
            </div>
          ) : (
            <ul
              className="w-full"
              style={{ maxWidth: "90cqw", display: "flex", flexDirection: "column", gap: "2cqh" }}
            >
              {visibleItems.map((s) => {
                const m = (media || []).find((x) => x.id === s.media_id);
                const dt = new Date(s.scheduled_at);
                const time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
                const title = s.title || m?.filename || "—";
                return (
                  <li
                    key={s.id}
                    data-testid="program-overview-item"
                    className="flex items-baseline"
                    style={{
                      gap: "6cqw",
                      paddingBottom: "2cqh",
                      borderBottom: `1px solid ${textColor}33`,
                    }}
                  >
                    <span
                      className="font-bold tabular-nums"
                      style={{
                        fontSize: "10cqh",
                        letterSpacing: "0.02em",
                        minWidth: "20cqw",
                        flexShrink: 0,
                      }}
                    >
                      {time}
                    </span>
                    <span
                      className="font-medium tracking-tight truncate"
                      style={{ fontSize: "7cqh", letterSpacing: "-0.015em", minWidth: 0, flex: 1 }}
                    >
                      {title}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Bottom-right room indicator */}
        <div
          className="absolute uppercase opacity-50"
          style={{
            bottom: "6cqh",
            right: "3cqw",
            fontSize: "1.4cqh",
            letterSpacing: "0.3em",
          }}
        >
          Sal · {roomId}
        </div>
      </div>

      {/* NRK news ticker — pinned to the very bottom of the overview only */}
      <NewsTicker active={active} />
    </div>
  );
}
