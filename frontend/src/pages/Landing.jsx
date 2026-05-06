import { useState } from "react";
import { Link } from "react-router-dom";
import { Monitor, UploadCloud, Sliders, ArrowUpRight, Film, CalendarClock } from "lucide-react";

const NAV = [
  {
    to: (room) => (room ? `/display/${room}` : "/display"),
    label: "Visningsskjerm",
    desc: "Fullskjermsvisning uten grensesnitt. Åpne på ekstern skjerm.",
    icon: Monitor,
    testid: "nav-display-link",
    path: (room) => (room ? `/display/${room}` : "/display"),
  },
  {
    to: () => "/upload",
    label: "Last opp",
    desc: "Last inn nye videoklipp og bilder. Trim og rediger.",
    icon: UploadCloud,
    testid: "nav-upload-link",
    path: () => "/upload",
  },
  {
    to: (room) => (room ? `/control/${room}` : "/control"),
    label: "Switcher",
    desc: "PVW/PGM live switcher. CUT mellom klipp i sanntid.",
    icon: Sliders,
    testid: "nav-control-link",
    path: (room) => (room ? `/control/${room}` : "/control"),
  },
  {
    to: (room) => (room ? `/playout/${room}` : "/playout"),
    label: "Playout",
    desc: "Planlagt avspilling på klokkeslett. Plakat, neste-opp-tekst, automatikk.",
    icon: CalendarClock,
    testid: "nav-playout-link",
    path: (room) => (room ? `/playout/${room}` : "/playout"),
  },
];

export default function Landing() {
  const [room, setRoom] = useState("");
  const cleanRoom = room
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-30"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1760170437237-a3654545ab4c?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODl8MHwxfHNlYXJjaHwxfHxjaW5lbWElMjB0aGVhdGVyJTIwZGFyayUyMGVtcHR5JTIwc2NyZWVufGVufDB8fHx8MTc3Nzk5NTkxOXww&ixlib=rb-4.1.0&q=85')",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/80 to-black" />
      <div className="kino-grain absolute inset-0" />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-16 sm:py-20">
        <header className="flex items-center justify-between mb-16 sm:mb-24">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-[#F59E0B] flex items-center justify-center">
              <Film className="w-5 h-5 text-black" strokeWidth={2.4} />
            </div>
            <div className="leading-tight">
              <div className="font-heading text-lg font-semibold tracking-tight text-white">KinoKontroll</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">v1.1 · Norge</div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            System aktivt
          </div>
        </header>

        <section className="mb-12 sm:mb-16" data-testid="landing-hero">
          <div className="text-xs uppercase tracking-[0.3em] text-[#F59E0B] mb-4">
            Profesjonelt avspillingssystem
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tighter text-white leading-[1.05] max-w-3xl">
            Tre skjermer.
            <br />
            <span className="text-zinc-500">Én sømløs</span> kontroll.
          </h1>
          <p className="mt-6 max-w-xl text-base text-zinc-400">
            KinoKontroll lar deg vise videoklipp på en fullskjerm, mens du laster opp og styrer
            avspilling fra et eget panel — alt synkronisert i sanntid.
          </p>
        </section>

        {/* Room selector */}
        <section className="mb-10 max-w-md" data-testid="landing-room-selector">
          <label className="block text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-2">
            Sal / Skjerm
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="default"
              data-testid="landing-room-input"
              className="flex-1 bg-[#050505] border border-white/10 text-white rounded-md px-3 py-2 focus:outline-none focus:border-[#F59E0B] focus:ring-1 focus:ring-[#F59E0B] placeholder:text-zinc-700 font-mono text-sm"
            />
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-600 font-mono">
              {cleanRoom || "default"}
            </div>
          </div>
          <p className="mt-2 text-xs text-zinc-600">
            La være tom for hovedsal. Bruk f.eks. <span className="font-mono text-zinc-500">sal-1</span> for å styre flere lokasjoner uavhengig.
          </p>
        </section>

        <section
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5"
          data-testid="landing-nav-grid"
        >
          {NAV.map(({ to, label, desc, icon: Icon, testid, path }) => {
            const target = to(cleanRoom);
            const display = path(cleanRoom);
            return (
              <Link
                key={display}
                to={target}
                data-testid={testid}
                className="group relative bg-[#0A0A0A] border border-white/10 rounded-lg p-6 hover:border-[#F59E0B]/50 transition-colors duration-150"
              >
                <div className="flex items-start justify-between mb-10">
                  <div className="w-10 h-10 rounded-md bg-[#111111] border border-white/10 flex items-center justify-center group-hover:border-[#F59E0B]/40 transition-colors">
                    <Icon className="w-5 h-5 text-[#F59E0B]" strokeWidth={1.8} />
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-zinc-600 group-hover:text-[#F59E0B] transition-colors" />
                </div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2 font-mono">
                  {display}
                </div>
                <div className="font-heading text-xl font-medium text-white mb-2">{label}</div>
                <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
              </Link>
            );
          })}
        </section>

        <footer className="mt-16 pt-8 border-t border-white/5 flex items-center justify-between text-xs text-zinc-600">
          <div className="font-mono tracking-wider">KK · WEBSOCKET SYNC</div>
          <div className="font-mono tracking-wider">© KINOKONTROLL</div>
        </footer>
      </div>
    </div>
  );
}
