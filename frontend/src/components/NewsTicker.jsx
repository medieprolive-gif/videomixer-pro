import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

/**
 * Bottom-of-screen news ticker for /display.
 * - Static "Nyheter fra NRK" pill on the LEFT, layered above the marquee so
 *   the scrolling text disappears behind it as it travels right→left.
 * - Headlines are joined into a single long string with `•` separators and
 *   rendered TWICE so the loop is seamless (CSS translates 0→-50%, the
 *   second copy fills the gap as the first scrolls off).
 * - Speed is derived from text length so longer feeds don't speed up.
 */
export default function NewsTicker({ active = true }) {
  const [items, setItems] = useState([]);
  const trackRef = useRef(null);
  const [trackWidth, setTrackWidth] = useState(0);

  // Fetch headlines (cached server-side for 5 min). Re-poll every 5 min.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.get("/news/nrk");
        if (!cancelled) setItems(r.data?.items || []);
      } catch (_) {
        /* noop — keep last items */
      }
    };
    load();
    const i = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  // Measure the rendered width of one full copy of the headline string so
  // we can size the keyframes to translate exactly that distance (in px),
  // giving a perfectly seamless loop regardless of text length.
  useEffect(() => {
    if (!trackRef.current) return;
    // Track contains TWO copies — measure half the scrollWidth.
    const w = trackRef.current.scrollWidth / 2;
    setTrackWidth(w);
  }, [items]);

  if (!items.length) return null;

  // Pixels-per-second pacing keeps a long feed feeling consistent. ~45 px/s
  // is comfortable for reading on a TV at viewing distance and works on
  // small landscape-phone screens too.
  const PX_PER_SEC = 45;
  const durationSec = trackWidth > 0 ? Math.max(20, trackWidth / PX_PER_SEC) : 60;

  const joined = items.join("   •   ");

  return (
    <div
      data-testid="display-news-ticker"
      className="absolute left-0 right-0 z-30 flex items-stretch overflow-hidden bg-black/55 backdrop-blur-md border-t border-white/10"
      style={{
        bottom: 0,
        // Height is intentionally small — just slightly taller than the
        // text. clamp() picks the larger of the cqh-based size and a
        // mobile-friendly minimum so the bar stays readable on landscape
        // phones while still scaling on big TVs.
        height: "clamp(40px, 5cqh, 70px)",
      }}
    >
      {/* Static "Nyheter fra NRK" label — solid background covers the marquee
          underneath so headlines disappear behind it. */}
      <div
        className="relative z-10 flex items-center gap-2 px-4 sm:px-5 shrink-0 bg-[#D52B1E] text-white shadow-[4px_0_12px_rgba(0,0,0,0.5)]"
        data-testid="news-ticker-label"
      >
        <span
          className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"
          aria-hidden="true"
        />
        <span
          className="font-bold uppercase whitespace-nowrap"
          style={{
            fontSize: "clamp(12px, 2.3cqh, 22px)",
            letterSpacing: "0.16em",
          }}
        >
          Nyheter fra NRK
        </span>
      </div>

      {/* Marquee track — two copies of the headline string, animated as one.
          The `kk-news-marquee` keyframes translate 0 → -trackWidth px so the
          second copy seamlessly takes over once the first scrolls offscreen. */}
      <div
        className="relative flex-1 overflow-hidden flex items-center"
        style={{
          maskImage:
            "linear-gradient(to right, black 0, black calc(100% - 60px), transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, black 0, black calc(100% - 60px), transparent)",
        }}
      >
        <div
          ref={trackRef}
          data-testid="news-ticker-track"
          className="flex whitespace-nowrap will-change-transform"
          style={{
            animation: active && trackWidth > 0
              ? `kk-news-marquee ${durationSec}s linear infinite`
              : "none",
            "--kk-news-distance": `${trackWidth}px`,
          }}
        >
          <span
            className="px-5 text-white/95"
            style={{
              fontSize: "clamp(15px, 2.8cqh, 28px)",
              letterSpacing: "0.01em",
            }}
          >
            {joined}
          </span>
          <span
            className="px-5 text-white/95"
            style={{
              fontSize: "clamp(15px, 2.8cqh, 28px)",
              letterSpacing: "0.01em",
            }}
            aria-hidden="true"
          >
            {joined}
          </span>
        </div>
      </div>
    </div>
  );
}
