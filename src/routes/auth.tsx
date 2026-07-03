import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      if (s) navigate({ to: "/" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e: any) {
      setErr(e?.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-float absolute -left-32 top-10 h-96 w-96 rounded-full opacity-40 blur-3xl" style={{ background: "var(--neon-cyan)" }} />
        <div className="animate-float absolute -right-40 top-1/3 h-[28rem] w-[28rem] rounded-full opacity-30 blur-3xl" style={{ background: "var(--neon-magenta)", animationDelay: "-4s" }} />
        <div className="animate-float absolute bottom-0 left-1/3 h-96 w-96 rounded-full opacity-25 blur-3xl" style={{ background: "var(--neon-lime)", animationDelay: "-8s" }} />
      </div>

      <div className="mx-auto w-full max-w-md animate-pop-in">
        <div className="mb-6 text-center">
          <Link to="/" className="text-2xl font-bold">
            <span className="text-gradient">AttendEdge</span>
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">Save your timetable across every device.</p>
        </div>

        <div className="glass-neon p-6 sm:p-8">
          <div className="inline-flex w-full rounded-full border border-border bg-background/40 p-1">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold transition-all sm:text-sm ${
                  mode === m ? "text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"
                }`}
                style={mode === m ? { background: "var(--gradient-primary)" } : undefined}
              >
                {m === "signin" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>

          <form onSubmit={handleEmail} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Email</span>
              <input
                type="email" required autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40"
              />
            </label>
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Password</span>
              <input
                type="password" required minLength={6}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40"
              />
            </label>

            {err && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {err}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition hover:brightness-110 disabled:opacity-60"
              style={{ background: "var(--gradient-primary)" }}
            >
              {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
            </button>

            {mode === "signin" && (
              <div className="text-center">
                <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-primary">
                  Forgot your password?
                </Link>
              </div>
            )}
          </form>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            <Link to="/" className="hover:text-foreground">← Back to tracker</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
