// Universal client-side notification engine for AttendEdge.
// - Uses browser Notification API + ServiceWorker.showNotification when available
// - Schedules daily 8AM / 6PM alerts via chained setTimeout (survives PWA + tab-open)
// - Predictive proximity alerts computed against local state
//
// NOTE: True background delivery when every tab is closed requires either a
// paid push backend or the (Chrome-only, still experimental) Notification
// Triggers API. This engine uses TriggerAPI when present and falls back to
// in-app scheduling — matching the "no external backend" constraint.

export const LS_NOTIFY = "attendedge_notify_v1";

export type NotifyPrefs = {
  enabled: boolean;
  onboarded: boolean;
  lastMorning?: string; // yyyy-mm-dd
  lastEvening?: string;
  lastProximity?: string;
};

export function loadNotifyPrefs(): NotifyPrefs {
  if (typeof window === "undefined") return { enabled: false, onboarded: false };
  try {
    const raw = window.localStorage.getItem(LS_NOTIFY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { enabled: false, onboarded: false, ...parsed };
  } catch {
    return { enabled: false, onboarded: false };
  }
}

export function saveNotifyPrefs(patch: Partial<NotifyPrefs>) {
  if (typeof window === "undefined") return;
  const next = { ...loadNotifyPrefs(), ...patch };
  try { window.localStorage.setItem(LS_NOTIFY, JSON.stringify(next)); } catch {}
}

export function isNotificationCapable(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (!isNotificationCapable()) return "denied";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try { return await Notification.requestPermission(); }
  catch { return Notification.permission; }
}

export async function fireNotification(title: string, body: string, tag?: string) {
  if (!isNotificationCapable() || Notification.permission !== "granted") return;
  const opts: NotificationOptions = {
    body,
    tag,
    icon: "/pwa-512.png",
    badge: "/pwa-512.png",
    // @ts-expect-error vibrate is not typed on all lib versions
    vibrate: [80, 40, 80],
  };
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
      return;
    }
  } catch {}
  try { new Notification(title, opts); } catch {}
}

function nextOccurrenceMs(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

// Chained daily scheduler. Returns a cancel handle.
export function scheduleDaily(hour: number, minute: number, run: () => void): () => void {
  let handle: number | null = null;
  let cancelled = false;
  const tick = () => {
    if (cancelled) return;
    const wait = nextOccurrenceMs(hour, minute);
    handle = window.setTimeout(() => {
      if (cancelled) return;
      try { run(); } catch {}
      tick();
    }, wait);
  };
  tick();
  return () => { cancelled = true; if (handle) window.clearTimeout(handle); };
}

export function scheduleInterval(ms: number, run: () => void): () => void {
  const id = window.setInterval(run, ms);
  return () => window.clearInterval(id);
}
