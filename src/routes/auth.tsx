import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

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

  // Redirect if already signed in
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
          email,
          password,
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

  async function handleGoogle() {
    setErr(null);
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setErr(result.error instanceof Error ? result.error.message : String(result.error));
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden px-4 py-10">
      {/* Ambient neon */}
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

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl border border-border bg-background/60 px-4 py-3 text-sm font-semibold text-foreground transition hover:border-primary hover:shadow-[0_0_20px_-4px_var(--neon-cyan)] disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 8 3l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 8 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.5-5.2l-6.2-5.3A12 12 0 0 1 12.7 28.4l-6.5 5A20 20 0 0 0 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.5l6.2 5.3C41 34.5 44 29.7 44 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleEmail} className="space-y-4">
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
          </form>

          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            <Link to="/" className="hover:text-foreground">← Back to tracker</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
