import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
    await supabase.auth.signOut();
    toast.success("Signed out", { id: t });
  } catch (err) {
    toast.error("Sign out failed — clearing session anyway", { id: t });
    console.error("[auth] signOut error", err);
  }
  // Give the toast a beat to render before the hard nav tears the DOM down.
  setTimeout(() => {
    if (typeof window !== "undefined") window.location.replace("/auth");
  }, 250);
}
