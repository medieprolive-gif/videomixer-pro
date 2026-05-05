import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Lock, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api, setToken } from "../lib/api";

export default function Login() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const from = params.get("from") || "/control";

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const res = await api.post("/auth/login", { password });
      setToken(res.data.token);
      toast.success("Tilgang innvilget");
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err?.response?.data?.detail || "Feil passord";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-[#050505]">
      <div className="w-full max-w-sm">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-white mb-10 transition-colors"
          data-testid="login-back-link"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Tilbake
        </Link>

        <div className="mb-8">
          <div className="w-10 h-10 rounded-md bg-[#111111] border border-white/10 flex items-center justify-center mb-6">
            <Lock className="w-4 h-4 text-[#F59E0B]" strokeWidth={2} />
          </div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight text-white mb-2">
            Autentisering kreves
          </h1>
          <p className="text-sm text-zinc-500">
            Skriv inn passordet for å få tilgang til opplasting og kontrollpanelet.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4" data-testid="login-form">
          <div>
            <label
              htmlFor="password"
              className="block text-xs uppercase tracking-[0.15em] text-zinc-500 font-semibold mb-2"
            >
              Passord
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Skriv inn passord..."
              autoFocus
              data-testid="login-password-input"
              className="w-full bg-[#050505] border border-white/10 text-white rounded-md px-4 py-3 focus:outline-none focus:border-[#F59E0B] focus:ring-1 focus:ring-[#F59E0B] placeholder:text-zinc-600 font-mono"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !password}
            data-testid="login-submit-button"
            className="w-full bg-[#F59E0B] text-black hover:bg-[#FBBF24] disabled:opacity-50 disabled:cursor-not-allowed rounded-md font-medium px-6 py-3 transition-colors duration-150"
          >
            {loading ? "Verifiserer..." : "Lås opp tilgang"}
          </button>
        </form>

        <div className="mt-8 text-center text-[10px] uppercase tracking-[0.2em] text-zinc-700">
          KinoKontroll · Sikret tilgang
        </div>
      </div>
    </div>
  );
}
