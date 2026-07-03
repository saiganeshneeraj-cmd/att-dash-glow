import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setMsg(null); setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setMsg("If an account exists for that email, a reset link is on the way.");
    } catch (e: any) {
      setErr(e?.message || "Could not send reset email");
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
          <p className="mt-1 text-sm text-muted-foreground">Recover access to your account.</p>
        </div>
        <div className="glass-neon p-6 sm:p-8">
          <h1 className="text-lg font-semibold text-foreground">Reset your password</h1>
          <p className="mt-1 text-xs text-muted-foreground">Enter your email and we'll send you a secure reset link.</p>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <label className="block">
              <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40" />
            </label>
            {err && <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</div>}
            {msg && <div className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">{msg}</div>}
            <button type="submit" disabled={loading}
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition hover:brightness-110 disabled:opacity-60"
              style={{ background: "var(--gradient-primary)" }}>
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </form>
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            <Link to="/auth" className="hover:text-foreground">← Back to sign in</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
