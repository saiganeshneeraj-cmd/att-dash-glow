import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Supabase auto-processes the recovery token in the URL hash and fires a
  // PASSWORD_RECOVERY event. We only enable the form once we have a session.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => { if (data.session) setReady(true); });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) { setErr("Password must be at least 6 characters"); return; }
    if (password !== confirm) { setErr("Passwords do not match"); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setOk(true);
      setTimeout(() => navigate({ to: "/" }), 1500);
    } catch (e: any) {
      setErr(e?.message || "Could not update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-float absolute -left-32 top-10 h-96 w-96 rounded-full opacity-40 blur-3xl" style={{ background: "var(--neon-cyan)" }} />
        <div className="animate-float absolute -right-40 top-1/3 h-[28rem] w-[28rem] rounded-full opacity-30 blur-3xl" style={{ background: "var(--neon-magenta)", animationDelay: "-4s" }} />
      </div>
      <div className="mx-auto w-full max-w-md animate-pop-in">
        <div className="mb-6 text-center">
          <Link to="/" className="text-2xl font-bold"><span className="text-gradient">AttendEdge</span></Link>
        </div>
        <div className="glass-neon p-6 sm:p-8">
          <h1 className="text-lg font-semibold text-foreground">Set a new password</h1>
          {!ready ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Waiting for a valid recovery link. Open the reset email on this device.
            </p>
          ) : ok ? (
            <p className="mt-3 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
              Password updated. Redirecting to your tracker…
            </p>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">New password</span>
                <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Confirm password</span>
                <input type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40" />
              </label>
              {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
              <button type="submit" disabled={loading}
                className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition hover:brightness-110 disabled:opacity-60"
                style={{ background: "var(--gradient-primary)" }}>
                {loading ? "Updating…" : "Update password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
