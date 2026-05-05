import { Link } from "react-router-dom";
import { Monitor, UploadCloud, Sliders, ArrowUpRight, Film } from "lucide-react";

const NAV = [
  {
    to: "/display",
    label: "Visningsskjerm",
    desc: "Fullskjermsvisning uten grensesnitt. Åpne på ekstern skjerm.",
    icon: Monitor,
    testid: "nav-display-link",
    path: "/display",
  },
  {
    to: "/upload",
    label: "Last opp",
    desc: "Last inn nye videoklipp til systemet.",
    icon: UploadCloud,
    testid: "nav-upload-link",
    path: "/upload",
  },
  {
    to: "/control",
    label: "Kontrollpanel",
    desc: "Styr avspilling, volum og spillelister i sanntid.",
    icon: Sliders,
    testid: "nav-control-link",
    path: "/control",
  },
];

export default function Landing() {
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
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">v1.0 · Norge</div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            System aktivt
          </div>
        </header>

        <section className="mb-16 sm:mb-20" data-testid="landing-hero">
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

        <section
          className="grid grid-cols-1 md:grid-cols-3 gap-5"
          data-testid="landing-nav-grid"
        >
          {NAV.map(({ to, label, desc, icon: Icon, testid, path }) => (
            <Link
              key={to}
              to={to}
              data-testid={testid}
              className="group relative bg-[#0A0A0A] border border-white/10 rounded-lg p-6 hover:border-[#F59E0B]/50 transition-colors duration-150"
            >
              <div className="flex items-start justify-between mb-10">
                <div className="w-10 h-10 rounded-md bg-[#111111] border border-white/10 flex items-center justify-center group-hover:border-[#F59E0B]/40 transition-colors">
                  <Icon className="w-5 h-5 text-[#F59E0B]" strokeWidth={1.8} />
                </div>
                <ArrowUpRight className="w-4 h-4 text-zinc-600 group-hover:text-[#F59E0B] transition-colors" />
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
                {path}
              </div>
              <div className="font-heading text-xl font-medium text-white mb-2">{label}</div>
              <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
            </Link>
          ))}
        </section>

        <footer className="mt-16 pt-8 border-t border-white/5 flex items-center justify-between text-xs text-zinc-600">
          <div className="font-mono tracking-wider">KK · WEBSOCKET SYNC</div>
          <div className="font-mono tracking-wider">© KINOKONTROLL</div>
        </footer>
      </div>
    </div>
  );
}
