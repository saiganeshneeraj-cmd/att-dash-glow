import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

function clearStoredAuthSession() {
  if (typeof window === "undefined") return;
  const clearMatchingAuthKeys = (storage: Storage) => {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (!key) continue;
      if ((key.startsWith("sb-") && key.endsWith("-auth-token")) || key === "supabase.auth.token") {
        storage.removeItem(key);
      }
    }
  };
  try { clearMatchingAuthKeys(window.localStorage); } catch {}
  try { clearMatchingAuthKeys(window.sessionStorage); } catch {}
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up listener FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
    });
    // Then check existing session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user, loading };
}

let signingOut = false;

export async function signOut() {
  if (signingOut) return;
  signingOut = true;
  const t = toast.loading("Signing out…");
  try {
    const signOutTimeout = new Promise<{ error: Error }>((resolve) => {
      window.setTimeout(() => resolve({ error: new Error("Sign-out timed out") }), 2500);
    });
    await Promise.race([supabase.auth.signOut({ scope: "local" }), signOutTimeout]);
    clearStoredAuthSession();
    toast.success("Signed out", { id: t });
  } catch (err) {
    clearStoredAuthSession();
    toast.success("Signed out", { id: t });
    console.error("[auth] signOut error", err);
  }
  // Give the toast a beat to render before the hard nav tears the DOM down.
  setTimeout(() => {
    if (typeof window !== "undefined") window.location.replace("/auth");
  }, 250);
}
