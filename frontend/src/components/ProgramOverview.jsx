import { useEffect, useMemo, useState } from "react";
import { thumbUrl, streamUrl } from "../lib/api";

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

/** Resolve a media URL: images use the streaming endpoint (full-res, not thumbnail). */
function mediaSrc(id) {
  return id ? streamUrl(id) : null;
}

/**
 * Full-screen program overview shown between scheduled items (and while idle)
 * when enabled in room settings.
 */
export default function ProgramOverview({ settings, schedule, media, roomId }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);

  const textColor = settings?.program_overview_text_color || "#FFFFFF";
  const logoId = settings?.program_overview_logo_id;
  const bgId = settings?.program_overview_background_id;

  const upcoming = useMemo(() => {
    const ts = now.getTime();
    return (schedule || [])
      .filter((s) => s.status === "scheduled" && new Date(s.scheduled_at).getTime() > ts)
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
      .slice(0, 5);
  }, [schedule, now]);

  return (
    <div
      data-testid="display-program-overview"
      className="absolute inset-0 z-10 overflow-hidden"
      style={{
        backgroundColor: "#000",
        backgroundImage: bgId ? `url(${mediaSrc(bgId)})` : undefined,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Subtle dark veil over background for legibility */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.65) 100%)",
        }}
      />

      <div
        className="relative h-full w-full flex flex-col"
        style={{ color: textColor }}
      >
        {/* TOP BAR: logo (left) · date (center) · clock (right) */}
        <div className="flex items-center justify-between px-12 pt-10">
          <div
            className="flex items-center min-h-[80px] min-w-[140px]"
            data-testid="program-overview-logo"
          >
            {logoId ? (
              <img
                src={thumbUrl(logoId)}
                alt="Logo"
                className="max-h-[120px] max-w-[280px] object-contain drop-shadow-2xl"
              />
            ) : null}
          </div>
          <div
            className="text-center font-heading font-semibold tracking-tight drop-shadow-2xl"
            style={{ fontSize: "clamp(2rem, 3.4vw, 3.75rem)" }}
            data-testid="program-overview-date"
          >
            {formatNorwegianDate(now)}
          </div>
          <div
            className="text-right font-mono font-bold tabular-nums tracking-wider drop-shadow-2xl"
            style={{ fontSize: "clamp(2.5rem, 4.4vw, 4.75rem)" }}
            data-testid="program-overview-clock"
          >
            {pad(now.getHours())}:{pad(now.getMinutes())}
          </div>
        </div>

        {/* Heading */}
        <div className="px-12 mt-12">
          <div
            className="font-heading font-light tracking-[0.2em] uppercase opacity-80"
            style={{ fontSize: "clamp(0.9rem, 1.1vw, 1.4rem)" }}
          >
            Programoversikt
          </div>
          <div
            className="mt-1 h-[2px] w-24"
            style={{ backgroundColor: textColor, opacity: 0.5 }}
          />
        </div>

        {/* Upcoming items list */}
        <div
          className="flex-1 px-12 pt-8 pb-12 flex items-center justify-center"
          data-testid="program-overview-list"
        >
          {upcoming.length === 0 ? (
            <div
              className="opacity-60 font-heading"
              style={{ fontSize: "clamp(1.5rem, 2.2vw, 2.5rem)" }}
            >
              Ingen flere planlagte innslag i dag
            </div>
          ) : (
            <ul className="w-full max-w-[1400px] mx-auto space-y-5">
              {upcoming.map((s) => {
                const m = (media || []).find((x) => x.id === s.media_id);
                const dt = new Date(s.scheduled_at);
                const time = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
                const title = s.title || m?.filename || "—";
                return (
                  <li
                    key={s.id}
                    data-testid="program-overview-item"
                    className="flex items-baseline gap-10 border-b py-4"
                    style={{ borderColor: `${textColor}33` }}
                  >
                    <span
                      className="font-mono font-bold tabular-nums tracking-wider shrink-0"
                      style={{ fontSize: "clamp(2rem, 3.6vw, 4rem)", minWidth: "5em" }}
                    >
                      {time}
                    </span>
                    <span
                      className="font-heading font-medium tracking-tight truncate"
                      style={{ fontSize: "clamp(1.6rem, 2.6vw, 3rem)" }}
                    >
                      {title}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Bottom-right room indicator (subtle) */}
        <div
          className="absolute bottom-6 right-8 font-mono uppercase tracking-[0.3em] opacity-50"
          style={{ fontSize: "clamp(0.7rem, 0.8vw, 1rem)" }}
        >
          Sal · {roomId}
        </div>
      </div>
    </div>
  );
}
