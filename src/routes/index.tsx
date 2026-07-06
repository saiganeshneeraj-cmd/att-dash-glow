import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, signOut } from "@/hooks/use-auth";
import { PRESETS, type PresetTimetable } from "@/lib/presets";
import { downloadPdfReport, downloadImageReport, computeSummary, summaryToText } from "@/lib/report";
import { loadCached, saveCached } from "@/lib/local-store";
import { BulkGrid, type BulkStatus } from "@/components/BulkGrid";
import { BulkActionBar } from "@/components/BulkActionBar";
import {
  createAttendanceRoom, createMassBunkPoll, deleteAttendanceRoom, getRoomSnapshot, joinAttendanceRoom,
  listMyRooms, sendSosBroadcast, syncRoomMemberStats, voteMassBunkPoll,
} from "@/lib/rooms.functions";
import {
  loadNotifyPrefs, saveNotifyPrefs, requestPermission, fireNotification,
  scheduleDaily, scheduleInterval, isNotificationCapable, ensureServiceWorker, type NotifyPrefs,
} from "@/lib/notifications";

export const Route = createFileRoute("/")({
  component: AttendancePage,
});


/* ============================================================
   Data model
   ============================================================ */
type Mode = "quick" | "detailed" | "history" | "rooms";
type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
const DAYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW_TO_DAY: Record<number, DayKey | undefined> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

type Timetable = Record<DayKey, string[]>;
type ClassState = Record<string, "attended" | "missed" | "cancelled">;

interface QuickData { total: number; attended: number; }
interface DetailedData {
  startDate: string;
  periods: string[];
  timetable: Timetable;
  states: ClassState;
  holidays: string[];
  presetId?: string;
}
interface SocialData { displayName: string; activeRoomId?: string; }
interface AppState { mode: Mode; quick: QuickData; detailed: DetailedData; social: SocialData; }

type SafetyBadge = "Safe" | "On the Edge" | "In Danger";
type RoomRow = { id: string; name: string; invite_code: string; owner_id: string; created_at: string };
type RoomMemberRow = {
  id: string; room_id: string; user_id: string; display_name: string;
  attendance_pct: number; status_badge: string; active_streak: number; bunk_coins: number; last_seen_at: string;
};
type PollRow = { id: string; room_id: string; creator_id: string; subject: string; class_slot: string; class_date: string; is_closed: boolean; created_at: string };
type VoteRow = { id: string; poll_id: string; user_id: string; intent: string; created_at: string };
type SosRow = { id: string; room_id: string; sender_id: string; sender_name: string; subject: string; class_slot: string; message: string; expires_at: string; created_at: string };

const LS_KEY = "attendedge_v3";
const LS_CUSTOM_PRESETS = "attendedge_custom_presets_v1";
const todayISO = () => new Date().toISOString().slice(0, 10);

const DEFAULT_PERIODS = [
  "09:00-09:45","09:45-10:30","10:30-11:15","11:15-12:00",
  "01:30-02:15","02:15-03:00","03:00-03:45","03:45-04:30",
];

const emptyTimetable = (nPeriods: number): Timetable => {
  const row = Array(nPeriods).fill("");
  return { Mon: [...row], Tue: [...row], Wed: [...row], Thu: [...row], Fri: [...row], Sat: [...row] };
};

const defaultDetailed = (): DetailedData => ({
  startDate: todayISO(),
  periods: [...DEFAULT_PERIODS],
  timetable: emptyTimetable(DEFAULT_PERIODS.length),
  states: {},
  holidays: [],
});

const defaultSocial = (): SocialData => ({ displayName: "" });

const defaultState = (): AppState => ({
  mode: "detailed",
  quick: { total: 0, attended: 0 },
  detailed: defaultDetailed(),
  social: defaultSocial(),
});

function normalizeSocial(raw: any): SocialData {
  return {
    displayName: typeof raw?.displayName === "string" ? raw.displayName : "",
    activeRoomId: typeof raw?.activeRoomId === "string" ? raw.activeRoomId : undefined,
  };
}

function normalizeDetailed(raw: any): DetailedData {
  const d = raw || {};
  const nP = d.periods?.length || DEFAULT_PERIODS.length;
  const tt = emptyTimetable(nP);
  for (const day of DAYS) {
    const row = d.timetable?.[day] || [];
    for (let i = 0; i < nP; i++) tt[day][i] = row[i] ?? "";
  }
  return {
    startDate: d.startDate || todayISO(),
    periods: d.periods?.length ? d.periods : [...DEFAULT_PERIODS],
    timetable: tt,
    states: d.states || {},
    holidays: d.holidays || [],
    presetId: d.presetId,
  };
}

function loadLocal(): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return {
      mode: s.mode ?? "detailed",
      quick: s.quick ?? { total: 0, attended: 0 },
      detailed: normalizeDetailed(s.detailed),
      social: normalizeSocial(s.social),
    };
  } catch { return null; }
}

function loadCustomPresets(): PresetTimetable[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LS_CUSTOM_PRESETS);
    return raw ? (JSON.parse(raw) as PresetTimetable[]) : [];
  } catch { return []; }
}
function saveCustomPresets(list: PresetTimetable[]) {
  try { window.localStorage.setItem(LS_CUSTOM_PRESETS, JSON.stringify(list)); } catch {}
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const formatLongDate = (d: Date) => `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
const formatShortDate = (d: Date) => `${WEEKDAYS[d.getDay()].slice(0,3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;

export function applyPreset(state: AppState, preset: PresetTimetable): AppState {
  const tt: Timetable = { Mon: [...preset.rows.Mon], Tue: [...preset.rows.Tue], Wed: [...preset.rows.Wed],
    Thu: [...preset.rows.Thu], Fri: [...preset.rows.Fri], Sat: [...preset.rows.Sat] };
  return {
    ...state,
    mode: "detailed",
    detailed: { ...state.detailed, periods: [...preset.periods], timetable: tt, presetId: preset.id },
  };
}

function computeDetailedTotals(detailed: DetailedData, untilISO = todayISO()) {
  const holidays = new Set(detailed.holidays);
  const start = new Date(detailed.startDate + "T00:00:00");
  const end = new Date(untilISO + "T00:00:00");
  if (isNaN(start.getTime()) || end < start) return { total: 0, attended: 0, missed: 0, cancelled: 0 };
  let total = 0, attended = 0, missed = 0, cancelled = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    const dayKey = DOW_TO_DAY[cur.getDay()];
    if (dayKey && !holidays.has(iso)) {
      detailed.timetable[dayKey].forEach((subj, idx) => {
        if (!subj.trim()) return;
        const st = detailed.states[`${iso}__${idx}`] ?? "attended";
        if (st === "cancelled") { cancelled += 1; return; }
        total += 1;
        if (st === "attended") attended += 1;
        else missed += 1;
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return { total, attended, missed, cancelled };
}

function pctFor(attended: number, total: number) {
  return total > 0 ? Math.round((attended / total) * 1000) / 10 : 0;
}

function statusBadgeFor(pct: number): SafetyBadge {
  return pct >= 80 ? "Safe" : pct >= 75 ? "On the Edge" : "In Danger";
}

function bunkCoinsFor(attended: number, total: number) {
  return total === 0 ? 0 : Math.max(0, Math.floor((4 * attended - 3 * total) / 3));
}

function computeStreak(detailed: DetailedData) {
  const start = new Date(detailed.startDate + "T00:00:00");
  const cur = new Date(todayISO() + "T00:00:00");
  if (isNaN(start.getTime()) || cur < start) return 0;
  const holidays = new Set(detailed.holidays);
  let streak = 0;
  while (cur >= start) {
    const iso = cur.toISOString().slice(0, 10);
    const dayKey = DOW_TO_DAY[cur.getDay()];
    if (dayKey && !holidays.has(iso)) {
      const classes = detailed.timetable[dayKey]
        .map((subj, idx) => ({ subj: subj.trim(), idx }))
        .filter((c) => c.subj);
      if (classes.length > 0) {
        const hasMiss = classes.some((c) => detailed.states[`${iso}__${c.idx}`] === "missed");
        const activeCount = classes.filter((c) => detailed.states[`${iso}__${c.idx}`] !== "cancelled").length;
        if (hasMiss) break;
        if (activeCount > 0) streak += 1;
      }
    }
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

function streakBadge(streak: number) {
  if (streak >= 30) return { label: "Legendary Regular", icon: "🏆", next: 60 };
  if (streak >= 14) return { label: "Roll Call Warrior", icon: "🛡️", next: 30 };
  if (streak >= 7) return { label: "Week Saver", icon: "🔥", next: 14 };
  if (streak >= 3) return { label: "Momentum Rookie", icon: "⚡", next: 7 };
  return { label: "Starter", icon: "🌱", next: 3 };
}

function buildRoadmap(detailed: DetailedData, attended: number, total: number) {
  if (total === 0 || pctFor(attended, total) >= 75) return [] as { iso: string; label: string; pct: number }[];
  const milestones = [70, 72, 75];
  const hit = new Set<number>();
  const out: { iso: string; label: string; pct: number }[] = [];
  let a = attended, t = total;
  const cur = new Date(todayISO() + "T00:00:00");
  cur.setDate(cur.getDate() + 1);
  for (let guard = 0; guard < 90 && out.length < 5; guard++) {
    const iso = cur.toISOString().slice(0, 10);
    const dayKey = DOW_TO_DAY[cur.getDay()];
    const classes = dayKey && !detailed.holidays.includes(iso)
      ? detailed.timetable[dayKey].filter((s) => s.trim()).length
      : 0;
    if (classes > 0) {
      a += classes; t += classes;
      const p = pctFor(a, t);
      const crossed = milestones.find((m) => p >= m && !hit.has(m));
      if (crossed) {
        hit.add(crossed);
        out.push({ iso, label: `Attend through ${formatShortDate(cur)} to reach ${p}%`, pct: p });
      } else if (out.length < 2) {
        out.push({ iso, label: `Keep attending through ${formatShortDate(cur)} · projected ${p}%`, pct: p });
      }
      if (p >= 75 && hit.has(75)) break;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function computeWrapped(detailed: DetailedData) {
  const start = new Date(detailed.startDate + "T00:00:00");
  const end = new Date(todayISO() + "T00:00:00");
  const skippedByDay: Record<string, number> = {};
  let total = 0, attended = 0, closest = 100, closestLabel = "No close calls yet";
  if (isNaN(start.getTime()) || end < start) return { mostSkipped: "—", closestCall: closestLabel, hours: 0 };
  const cur = new Date(start);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    const dayKey = DOW_TO_DAY[cur.getDay()];
    if (dayKey && !detailed.holidays.includes(iso)) {
      detailed.timetable[dayKey].forEach((subj, idx) => {
        if (!subj.trim()) return;
        const st = detailed.states[`${iso}__${idx}`] ?? "attended";
        if (st === "cancelled") return;
        total += 1;
        if (st === "attended") attended += 1;
        if (st === "missed") skippedByDay[WEEKDAYS[cur.getDay()]] = (skippedByDay[WEEKDAYS[cur.getDay()]] ?? 0) + 1;
        const p = pctFor(attended, total);
        const diff = Math.abs(p - 75);
        if (total >= 4 && diff < closest) { closest = diff; closestLabel = `${p}% on ${formatShortDate(cur)}`; }
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  const mostSkipped = Object.entries(skippedByDay).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "No skip pattern";
  return { mostSkipped, closestCall: closestLabel, hours: Math.round(attended * 0.75 * 10) / 10 };
}

/* ============================================================
   Page
   ============================================================ */
function AttendancePage() {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<AppState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [customPresets, setCustomPresets] = useState<PresetTimetable[]>([]);
  const skipNextSaveRef = useRef(true);

  // ---- Undo stack (last 25 snapshots) ----
  const undoStackRef = useRef<{ state: AppState; label: string }[]>([]);
  const [toast, setToast] = useState<{ label: string; id: number } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const captureUndo = useCallback((label: string) => {
    setState((prev) => {
      undoStackRef.current.push({ state: prev, label });
      if (undoStackRef.current.length > 25) undoStackRef.current.shift();
      return prev;
    });
    const id = Date.now();
    setToast({ label, id });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 5000);
  }, []);

  const performUndo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    setState(entry.state);
    setToast(null);
  }, []);

  // Local-first hydration: IndexedDB → paint → localStorage → remote reconcile.
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    (async () => {
      // 1. Paint from IndexedDB immediately (fastest cache).
      const cached = await loadCached<AppState>(user?.id);
      if (!cancelled && cached) {
        setState({
          mode: cached.mode ?? "detailed",
          quick: cached.quick ?? { total: 0, attended: 0 },
          detailed: normalizeDetailed(cached.detailed),
          social: normalizeSocial(cached.social),
        });
        setCustomPresets(loadCustomPresets());
        skipNextSaveRef.current = true;
        setHydrated(true);
      }
      // 2. Fall back to localStorage on a totally cold start.
      if (!cached) {
        const local = loadLocal();
        if (!cancelled && local) setState(local);
      }
      // 3. If signed in, reconcile against Supabase in the background.
      if (user) {
        const { data, error } = await supabase
          .from("user_data" as any)
          .select("data")
          .eq("user_id", user.id)
          .maybeSingle();
        if (cancelled) return;
        if (!error && data && (data as any).data && Object.keys((data as any).data).length) {
          const s = (data as any).data as AppState;
          const remote: AppState = {
            mode: s.mode ?? "detailed",
            quick: s.quick ?? { total: 0, attended: 0 },
            detailed: normalizeDetailed(s.detailed),
            social: normalizeSocial(s.social),
          };
          if (JSON.stringify(remote) !== JSON.stringify(cached)) {
            setState(remote);
            saveCached(user.id, remote);
          }
        }
      }
      if (!cancelled && !cached) {
        setCustomPresets(loadCustomPresets());
        skipNextSaveRef.current = true;
        setHydrated(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  // Mirror every state change into localStorage + IndexedDB (fire-and-forget).
  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {}
    saveCached(user?.id, state);
  }, [state, hydrated, user?.id]);

  // Debounced background sync to Supabase — never blocks the UI.
  useEffect(() => {
    if (!hydrated || !user) return;
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    setSyncStatus("saving");
    const t = setTimeout(async () => {
      const { error } = await supabase
        .from("user_data" as any)
        .upsert({ user_id: user.id, data: state as any }, { onConflict: "user_id" });
      setSyncStatus(error ? "error" : "saved");
      if (!error) setTimeout(() => setSyncStatus("idle"), 1200);
    }, 700);
    return () => clearTimeout(t);
  }, [state, hydrated, user]);


  const setMode = useCallback((m: Mode) => setState((s) => ({ ...s, mode: m })), []);
  const setQuick = useCallback(
    (updater: QuickData | ((q: QuickData) => QuickData)) =>
      setState((s) => ({ ...s, quick: typeof updater === "function" ? (updater as any)(s.quick) : updater })), []);
  const setDetailed = useCallback(
    (updater: DetailedData | ((d: DetailedData) => DetailedData)) =>
      setState((s) => ({ ...s, detailed: typeof updater === "function" ? (updater as any)(s.detailed) : updater })), []);
  const setSocial = useCallback(
    (updater: SocialData | ((d: SocialData) => SocialData)) =>
      setState((s) => ({ ...s, social: typeof updater === "function" ? (updater as any)(s.social) : updater })), []);

  const allPresets = useMemo(() => [...PRESETS, ...customPresets], [customPresets]);
  const applyPresetById = useCallback((id: string) => {
    const p = allPresets.find((x) => x.id === id);
    if (!p) return;
    captureUndo(`Loaded preset: ${p.label}`);
    setState((s) => applyPreset(s, p));
  }, [allPresets, captureUndo]);

  const saveCurrentAsPreset = useCallback((label: string) => {
    const d = state.detailed;
    const newPreset: PresetTimetable = {
      id: `custom-${Date.now()}`,
      label: label.trim() || "My Section",
      meta: "Custom preset",
      periods: [...d.periods],
      rows: {
        Mon: [...d.timetable.Mon], Tue: [...d.timetable.Tue], Wed: [...d.timetable.Wed],
        Thu: [...d.timetable.Thu], Fri: [...d.timetable.Fri], Sat: [...d.timetable.Sat],
      },
    };
    const next = [...customPresets, newPreset];
    setCustomPresets(next);
    saveCustomPresets(next);
    setState((s) => ({ ...s, detailed: { ...s.detailed, presetId: newPreset.id } }));
  }, [state.detailed, customPresets]);

  const deleteCustomPreset = useCallback((id: string) => {
    const next = customPresets.filter((p) => p.id !== id);
    setCustomPresets(next);
    saveCustomPresets(next);
  }, [customPresets]);

  const exportData = useCallback(() => {
    const blob = new Blob(
      [JSON.stringify({ version: 3, exportedAt: new Date().toISOString(), state, customPresets }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendedge-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, [state, customPresets]);

  const importData = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed.state) {
          const s = parsed.state as AppState;
          setState({
            mode: s.mode ?? "detailed",
            quick: s.quick ?? { total: 0, attended: 0 },
            detailed: normalizeDetailed(s.detailed),
            social: normalizeSocial(s.social),
          });
        }
        if (Array.isArray(parsed.customPresets)) {
          setCustomPresets(parsed.customPresets);
          saveCustomPresets(parsed.customPresets);
        }
      } catch { alert("Invalid backup file."); }
    };
    reader.readAsText(file);
  }, []);

  const { mode, quick, detailed } = state;

  const { total, attended } = useMemo(() => {
    if (mode === "quick") {
      const t = Math.max(0, Math.floor(quick.total || 0));
      const a = Math.min(t, Math.max(0, Math.floor(quick.attended || 0)));
      return { total: t, attended: a };
    }
    const holidays = new Set(detailed.holidays);
    const start = new Date(detailed.startDate + "T00:00:00");
    const end = new Date(todayISO() + "T00:00:00");
    if (isNaN(start.getTime()) || end < start) return { total: 0, attended: 0 };
    let t = 0, a = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const iso = cur.toISOString().slice(0, 10);
      const dayKey = DOW_TO_DAY[cur.getDay()];
      if (dayKey && !holidays.has(iso)) {
        const row = detailed.timetable[dayKey];
        row.forEach((subj, idx) => {
          if (!subj.trim()) return;
          const st = detailed.states[`${iso}__${idx}`] ?? "attended";
          if (st === "cancelled") return;
          t += 1;
          if (st === "attended") a += 1;
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return { total: t, attended: a };
  }, [mode, quick, detailed]);

  const pct = pctFor(attended, total);
  const status = pct < 75 ? "danger" : pct < 80 ? "warn" : "good";
  const statusText = status === "danger" ? "In Danger" : status === "warn" ? "On the Edge" : "Good Position";
  const statusColor = status === "danger" ? "var(--color-danger)" : status === "warn" ? "var(--color-warning)" : "var(--color-success)";
  const target = total === 0 ? 0 : Math.max(0, Math.ceil(3 * total - 4 * attended));
  const safe = bunkCoinsFor(attended, total);
  const activeStreak = useMemo(() => mode === "quick" ? 0 : computeStreak(detailed), [mode, detailed]);
  const badge = streakBadge(activeStreak);
  const socialStats = useMemo(() => ({
    attendancePct: pct,
    statusBadge: statusBadgeFor(pct),
    activeStreak,
    bunkCoins: safe,
  }), [pct, activeStreak, safe]);
  const roadmap = useMemo(() => buildRoadmap(detailed, attended, total), [detailed, attended, total]);
  const wrapped = useMemo(() => computeWrapped(detailed), [detailed]);

  const [badgePopup, setBadgePopup] = useState<{ icon: string; label: string; streak: number } | null>(null);
  useEffect(() => {
    if (!hydrated || activeStreak <= 0) return;
    const milestones = [3, 7, 14, 30, 60, 100];
    if (!milestones.includes(activeStreak)) return;
    const key = `attendedge_streak_badge_${activeStreak}`;
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, "1");
    const b = streakBadge(activeStreak);
    setBadgePopup({ icon: b.icon, label: b.label, streak: activeStreak });
    const t = window.setTimeout(() => setBadgePopup(null), 5200);
    return () => window.clearTimeout(t);
  }, [hydrated, activeStreak]);

  // ---- Notifications engine ----
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs>({ enabled: false, onboarded: false });
  const [showOnboard, setShowOnboard] = useState(false);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    if (!hydrated) return;
    const p = loadNotifyPrefs();
    setNotifyPrefs(p);
    if (!p.onboarded && isNotificationCapable()) {
      const t = setTimeout(() => setShowOnboard(true), 900);
      return () => clearTimeout(t);
    }
  }, [hydrated]);

  const computeTodayInfo = useCallback(() => {
    const s = stateRef.current;
    const d = s.detailed;
    const now = new Date();
    const dk = DOW_TO_DAY[now.getDay()];
    const iso = todayISO();
    let classesToday = 0;
    let loggedToday = false;
    if (dk && !d.holidays.includes(iso)) {
      d.timetable[dk].forEach((subj, idx) => {
        if (!subj.trim()) return;
        classesToday += 1;
        if (d.states[`${iso}__${idx}`]) loggedToday = true;
      });
    }
    // If user skips ALL of today's remaining classes: attended stays, total grows by classesToday
    const projMissAll = classesToday > 0 && total >= 0
      ? pctFor(attended, total + classesToday)
      : pct;
    const drop = Math.max(0, Math.round((pct - projMissAll) * 10) / 10);
    return { classesToday, loggedToday, pct, projMissAll, drop };
  }, [pct, attended, total]);


  const projectProximity = useCallback(() => {
    const s = stateRef.current;
    if (s.mode !== "detailed") return false;
    if (total <= 0) return false;
    // Count non-logged classes in next 48h that would move the needle
    const now = new Date();
    let future = 0;
    for (let i = 0; i < 3; i++) {
      const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0);
      const dk = DOW_TO_DAY[d.getDay()];
      if (!dk) continue;
      const iso = d.toISOString().slice(0, 10);
      if (s.detailed.holidays.includes(iso)) continue;
      s.detailed.timetable[dk].forEach((subj, idx) => {
        if (!subj.trim()) return;
        if (s.detailed.states[`${iso}__${idx}`]) return;
        future += 1;
      });
    }
    if (future === 0) return false;
    // Worst case: miss one upcoming class → attended stays, total+1
    const projPct = (attended / (total + 1)) * 100;
    return projPct < 75;
  }, [attended, total]);

  // Compute yesterday-based scenario (excludes today's states)
  const computeScenario = useCallback(() => {
    const s = stateRef.current;
    const d = s.detailed;
    const now = new Date();
    const yest = new Date(now); yest.setDate(now.getDate() - 1);
    const yISO = yest.toISOString().slice(0, 10);
    const yTotals = computeDetailedTotals(d, yISO);
    const dk = DOW_TO_DAY[now.getDay()];
    const iso = todayISO();
    let classesToday = 0;
    let loggedToday = false;
    if (dk && !d.holidays.includes(iso)) {
      d.timetable[dk].forEach((subj, idx) => {
        if (!subj.trim()) return;
        classesToday += 1;
        if (d.states[`${iso}__${idx}`]) loggedToday = true;
      });
    }
    const yPct = pctFor(yTotals.attended, yTotals.total);
    const ifPresent = pctFor(yTotals.attended + classesToday, yTotals.total + classesToday);
    const ifAbsent  = pctFor(yTotals.attended, yTotals.total + classesToday);
    return { yPct, ifPresent, ifAbsent, classesToday, loggedToday };
  }, []);

  // Schedule alerts when enabled
  useEffect(() => {
    if (!hydrated || !notifyPrefs.enabled) return;
    if (!isNotificationCapable() || Notification.permission !== "granted") return;

    const cancels: Array<() => void> = [];
    const fireImpact = (tag: string, prefix: string) => {
      const sc = computeScenario();
      const body = sc.classesToday > 0
        ? `Attendance: ${sc.yPct}%. Today: ${sc.ifPresent}% if you attend, or ${sc.ifAbsent}% if you skip.`
        : `Attendance: ${sc.yPct}%. No classes scheduled today.`;
      fireNotification(prefix, body, tag);
    };
    cancels.push(scheduleDaily(8, 0, () => fireImpact("attendedge-morning", "Good morning ☀️")));
    // Also fire once ~5s after enabling so the user sees the format immediately
    const initial = window.setTimeout(() => fireImpact("attendedge-impact-now", "Today's attendance impact 📊"), 4000);
    cancels.push(() => window.clearTimeout(initial));

    cancels.push(scheduleDaily(18, 0, () => {
      const sc = computeScenario();
      if (sc.classesToday > 0 && !sc.loggedToday) {
        fireNotification("Time to log today's attendance 📝",
          `Attendance: ${sc.yPct}%. Today: ${sc.ifPresent}% if you attend, or ${sc.ifAbsent}% if you skip.`,
          "attendedge-evening");
      }
    }));
    // Proximity: check hourly + once on start
    const checkProx = () => {
      if (projectProximity()) {
        const today = todayISO();
        const p = loadNotifyPrefs();
        if (p.lastProximity === today) return;
        saveNotifyPrefs({ lastProximity: today });
        fireNotification("⚠️ Proximity Alert",
          "Missing an upcoming class in the next 48 hours may drop you below 75%. Plan your leaves carefully!",
          "attendedge-proximity");
      }
    };
    const t = window.setTimeout(checkProx, 5000);
    cancels.push(() => window.clearTimeout(t));
    cancels.push(scheduleInterval(60 * 60 * 1000, checkProx));

    return () => { cancels.forEach((c) => c()); };
  }, [hydrated, notifyPrefs.enabled, computeScenario, projectProximity]);

  const enableNotifications = useCallback(async () => {
    await ensureServiceWorker();
    const perm = await requestPermission();
    const enabled = perm === "granted";
    const next = { enabled, onboarded: true };
    saveNotifyPrefs(next);
    setNotifyPrefs((p) => ({ ...p, ...next }));
    setShowOnboard(false);
    if (enabled) {
      fireNotification("Notifications enabled 🔔",
        "You'll get morning previews at 8AM and logging reminders at 6PM.", "attendedge-welcome");
    }
  }, []);

  const sendTestNotification = useCallback(async () => {
    await ensureServiceWorker();
    const perm = await requestPermission();
    if (perm !== "granted") return false;
    const sc = computeScenario();
    const body = sc.classesToday > 0
      ? `Attendance: ${sc.yPct}%. Today: ${sc.ifPresent}% if you attend, or ${sc.ifAbsent}% if you skip.`
      : `Attendance: ${sc.yPct}%. No classes scheduled today.`;
    return fireNotification("📊 Today's attendance impact", body, "attendedge-test");
  }, [computeScenario]);

  const skipOnboard = useCallback(() => {
    saveNotifyPrefs({ onboarded: true, enabled: false });
    setNotifyPrefs((p) => ({ ...p, onboarded: true, enabled: false }));
    setShowOnboard(false);
  }, []);

  const toggleNotifications = useCallback(async (want: boolean) => {
    if (want) {
      // Always show the live preview before asking permission so users see
      // exactly what an alert looks like with their current numbers.
      setShowOnboard(true);
    } else {
      saveNotifyPrefs({ enabled: false });
      setNotifyPrefs((p) => ({ ...p, enabled: false }));
    }
  }, []);

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden px-3 py-5 sm:px-6 sm:py-10">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-float absolute -left-32 top-10 h-96 w-96 rounded-full opacity-40 blur-3xl" style={{ background: "var(--neon-cyan)" }} />
        <div className="animate-float absolute -right-40 top-1/3 h-[28rem] w-[28rem] rounded-full opacity-30 blur-3xl" style={{ background: "var(--neon-magenta)", animationDelay: "-4s" }} />
        <div className="animate-float absolute bottom-0 left-1/3 h-96 w-96 rounded-full opacity-25 blur-3xl" style={{ background: "var(--neon-lime)", animationDelay: "-8s" }} />
        <div className="scanline pointer-events-none absolute inset-0" />
      </div>

      <div className="route-enter mx-auto w-full max-w-6xl">
        <Header
          mode={mode} setMode={setMode} hydrated={hydrated}
          user={user} syncStatus={syncStatus}
          onExport={exportData} onImport={importData}
          state={state}
          notifyEnabled={notifyPrefs.enabled}
          onToggleNotify={toggleNotifications}
          notifyCapable={isNotificationCapable()}
        />


        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <HeroRing pct={pct} statusText={statusText} statusColor={statusColor} total={total} attended={attended} />
          <InsightsPanel status={status} target={target} safe={safe} total={total} streak={activeStreak} badge={badge} />
        </section>

        {hydrated && total > 0 && (
          <section className="mt-6 animate-fade-in">
            <WhatIfPlanner attended={attended} total={total} />
          </section>
        )}

        <section className="mt-6 animate-fade-in">
          {!hydrated ? (
            <ContentSkeleton />
          ) : mode === "quick" ? (
            <QuickForm quick={quick} setQuick={setQuick} />
          ) : mode === "history" ? (
            <HistoryView detailed={detailed} />
          ) : mode === "rooms" ? (
            <RoomsHub
              user={user}
              social={state.social}
              setSocial={setSocial}
              stats={socialStats}
              detailed={detailed}
              roadmap={roadmap}
              wrapped={wrapped}
              onToggleNotify={toggleNotifications}
            />
          ) : (
            <DetailedTracker
              detailed={detailed} setDetailed={setDetailed}
              applyPresetById={applyPresetById}
              allPresets={allPresets}
              customPresets={customPresets}
              onSaveCustomPreset={saveCurrentAsPreset}
              onDeleteCustomPreset={deleteCustomPreset}
              captureUndo={captureUndo}
            />
          )}
        </section>


        <footer className="mt-10 pb-4 text-center text-xs text-muted-foreground">
          {user ? "Synced to your account" : "Saved locally"} · Threshold: 75%
        </footer>
      </div>

      <UndoToast toast={toast} onUndo={performUndo} onDismiss={() => setToast(null)} />
      <BadgePopup badge={badgePopup} onDismiss={() => setBadgePopup(null)} />
      {showOnboard && (
        <NotifyOnboardModal onEnable={enableNotifications} onSkip={skipOnboard} onTest={sendTestNotification} info={computeTodayInfo()} />
      )}
    </main>
  );
}

/* ============================================================
   Notification onboarding modal
   ============================================================ */
function NotifyOnboardModal({ onEnable, onSkip, onTest, info }: {
  onEnable: () => void;
  onSkip: () => void;
  onTest: () => Promise<boolean>;
  info: { classesToday: number; loggedToday: boolean; pct: number; projMissAll: number; drop: number };
}) {
  const [testStatus, setTestStatus] = useState<"idle" | "sent" | "blocked">("idle");
  const hasClasses = info.classesToday > 0;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] flex items-start justify-center bg-black/55 px-3 pb-10 pt-3 backdrop-blur-sm animate-fade-in sm:pt-5">
      <div className="glass-neon relative w-full max-w-lg overflow-hidden rounded-3xl p-4 sm:p-5 animate-toast-in max-h-[80vh] overflow-y-auto"
        style={{ boxShadow: "0 0 60px -8px var(--neon-magenta), 0 0 120px -20px var(--neon-cyan)" }}>
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl opacity-60"
          style={{ background: "var(--neon-magenta)" }} />
        <div className="pointer-events-none absolute -left-10 -bottom-10 h-40 w-40 rounded-full blur-3xl opacity-50"
          style={{ background: "var(--neon-cyan)" }} />
        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl shadow-xl"
              style={{ background: "var(--gradient-primary)" }}>🔔</div>
            <h2 className="min-w-0 text-lg font-bold text-foreground sm:text-xl" style={{ fontFamily: "var(--font-display)" }}>
              Stay above 75% — automatically
            </h2>
          </div>

          {/* Live preview of the exact alert */}
          <div className="mt-4 rounded-2xl border border-primary/40 bg-background/60 p-3 shadow-inner">
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              <span>🔔</span><span>Live preview · updates with your attendance</span>
            </div>
            {hasClasses ? (
              <div className="space-y-1">
                <div className="text-sm font-bold text-foreground">📊 Today's Attendance Impact</div>
                <div className="text-xs text-muted-foreground">
                  You have <b className="text-foreground">{info.classesToday}</b> class{info.classesToday === 1 ? "" : "es"} today. Current attendance: <b className="text-foreground">{info.pct}%</b>.
                </div>
                <div className={`text-xs font-semibold ${info.projMissAll < 75 ? "text-destructive" : "text-warning"}`}>
                  If you skip all today → <b>{info.projMissAll}%</b>
                  {info.drop > 0 && <span className="opacity-80"> (−{info.drop}%)</span>}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No scheduled classes today. Current attendance: <b className="text-foreground">{info.pct}%</b>.
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <button onClick={onEnable}
              className="w-full rounded-xl px-4 py-3 text-sm font-bold text-primary-foreground shadow-lg transition hover:brightness-110"
              style={{ background: "var(--gradient-primary)", boxShadow: "0 0 24px -4px var(--neon-magenta)" }}>
              Allow notifications
            </button>
            <button
              onClick={async () => { const ok = await onTest(); setTestStatus(ok ? "sent" : "blocked"); }}
              className="w-full rounded-xl border border-primary/40 bg-background/40 px-4 py-2 text-xs font-semibold text-foreground hover:bg-background/70">
              {testStatus === "sent" ? "✓ Test sent — if you don't see it, check OS notification settings"
                : testStatus === "blocked" ? "Permission blocked — enable it in browser (iOS: install to Home Screen first)"
                : "Send me a test alert now"}
            </button>
            <button onClick={onSkip}
              className="w-full rounded-xl border border-border bg-card/40 px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
              Not now
            </button>
          </div>

          <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-start gap-2"><span>☀️</span><span><b className="text-foreground">8:00 AM</b> — today's classes + impact preview above</span></li>
            <li className="flex items-start gap-2"><span>📝</span><span><b className="text-foreground">6:00 PM</b> — reminder to log attended / missed</span></li>
            <li className="flex items-start gap-2"><span>⚠️</span><span><b className="text-foreground">Proximity alerts</b> when you're about to drop below 75%</span></li>
          </ul>
          <p className="mt-3 text-center text-[10px] text-muted-foreground">
            You can toggle alerts anytime from the header.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Header
   ============================================================ */
function Header({
  mode, setMode, hydrated, user, syncStatus, onExport, onImport, state,
  notifyEnabled, onToggleNotify, notifyCapable,
}: {
  mode: Mode; setMode: (m: Mode) => void; hydrated: boolean;
  user: ReturnType<typeof useAuth>["user"]; syncStatus: string;
  onExport: () => void; onImport: (f: File) => void; state: AppState;
  notifyEnabled: boolean; onToggleNotify: (v: boolean) => void; notifyCapable: boolean;
}) {
  const [today, setToday] = useState<string>("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState<null | "pdf" | "img" | "share">(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setToday(formatLongDate(new Date())); }, []);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);
  const initial = user?.email?.[0]?.toUpperCase() ?? "?";
  const reportMode: "quick" | "detailed" | "history" = state.mode === "rooms" ? "detailed" : state.mode;
  const reportState = { mode: reportMode, quick: state.quick, detailed: state.detailed };

  const doPdf = async () => {
    setBusy("pdf"); setMenuOpen(false);
    try { await downloadPdfReport(reportState); } finally { setBusy(null); }
  };
  const doImg = async () => {
    setBusy("img"); setMenuOpen(false);
    try { await downloadImageReport(reportState); } finally { setBusy(null); }
  };
  const doShare = async () => {
    setBusy("share"); setMenuOpen(false);
    const text = summaryToText(computeSummary(reportState));
    try {
      if (navigator.share) {
        try { await navigator.share({ title: "My attendance", text }); }
        catch { await navigator.clipboard.writeText(text); setShareMsg("Copied to clipboard"); }
      } else {
        await navigator.clipboard.writeText(text);
        setShareMsg("Copied to clipboard");
      }
    } catch { setShareMsg("Could not copy"); }
    finally {
      setBusy(null);
      setTimeout(() => setShareMsg(null), 2200);
    }
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-3xl font-bold sm:text-4xl">
          <span className="text-gradient">AttendEdge</span>
        </h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{hydrated ? today : "\u00A0"}</span>
          {user && syncStatus !== "idle" && (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${
              syncStatus === "saving" ? "border-primary/40 text-primary" :
              syncStatus === "saved" ? "border-success/40 text-success" :
              "border-destructive/40 text-destructive"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${syncStatus === "saving" ? "animate-pulse bg-primary" : syncStatus === "saved" ? "bg-success" : "bg-destructive"}`} />
              {syncStatus === "saving" ? "Syncing" : syncStatus === "saved" ? "Saved" : "Error"}
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="inline-flex rounded-full border border-border bg-card p-1 backdrop-blur-md">
          {(["detailed", "quick", "history", "rooms"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={`rounded-full px-3 py-2 text-xs font-medium transition-all sm:px-4 sm:text-sm ${
                mode === m ? "text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground"
              }`}
              style={mode === m ? { background: "var(--gradient-primary)" } : undefined}>
              {m === "quick" ? "Quick" : m === "history" ? "History" : m === "rooms" ? "Rooms" : "Timetable"}
            </button>
          ))}
        </div>

        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            disabled={!!busy}
            className="press-card rounded-full px-4 py-2 text-xs font-bold text-primary-foreground transition disabled:opacity-60"
            style={{ background: "var(--gradient-primary)", boxShadow: "0 0 18px -6px var(--neon-magenta)" }}
            title="Download attendance report"
          >
            {busy === "pdf" ? "Building PDF…" : busy === "img" ? "Building image…" : busy === "share" ? "Preparing…" : "↓ Download"}
          </button>
          {menuOpen && (
            <div className="animate-toast-in absolute right-0 top-full z-30 mt-2 w-56 rounded-2xl border border-primary/30 bg-popover p-1.5 shadow-2xl backdrop-blur-xl">
              <button onClick={doPdf} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-accent">
                <span>📄</span><div><div className="font-semibold">PDF report</div><div className="text-[10px] text-muted-foreground">Full summary + class log</div></div>
              </button>
              <button onClick={doImg} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-accent">
                <span>🖼️</span><div><div className="font-semibold">Image (JPG)</div><div className="text-[10px] text-muted-foreground">Shareable card</div></div>
              </button>
              <button onClick={doShare} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-accent">
                <span>🔗</span><div><div className="font-semibold">Share / copy</div><div className="text-[10px] text-muted-foreground">WhatsApp-ready text</div></div>
              </button>
              <div className="my-1 h-px bg-border" />
              <button onClick={() => { setMenuOpen(false); onExport(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-accent">
                <span>💾</span><div><div className="font-semibold">JSON backup</div><div className="text-[10px] text-muted-foreground">Move data between devices</div></div>
              </button>
              <button onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-foreground hover:bg-accent">
                <span>📥</span><div><div className="font-semibold">Import backup</div><div className="text-[10px] text-muted-foreground">Restore from JSON</div></div>
              </button>
            </div>
          )}
          {shareMsg && (
            <div className="animate-toast-in absolute right-0 top-full mt-2 rounded-full border border-success/40 bg-card px-3 py-1.5 text-xs text-success shadow-lg">
              {shareMsg}
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="application/json" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.currentTarget.value = ""; }} />

        {hydrated && notifyCapable && (
          <button
            onClick={() => onToggleNotify(!notifyEnabled)}
            title={notifyEnabled ? "Notifications ON — click to turn off" : "Turn on daily notifications"}
            className={`press-card inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
              notifyEnabled
                ? "border-primary/60 bg-primary/10 text-primary shadow-[0_0_18px_-6px_var(--neon-cyan)]"
                : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
            }`}
          >
            <span>{notifyEnabled ? "🔔" : "🔕"}</span>
            <span className="hidden sm:inline">Alerts {notifyEnabled ? "On" : "Off"}</span>
            <span
              aria-hidden
              className={`relative inline-block h-4 w-7 rounded-full transition-colors ${notifyEnabled ? "bg-primary" : "bg-muted"}`}
            >
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all ${notifyEnabled ? "left-3.5" : "left-0.5"}`} />
            </span>
          </button>
        )}

        {user ? (
          <UserMenu user={user} initial={initial} />
        ) : (
          <Link to="/auth"
            className="rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground transition hover:border-primary hover:shadow-[0_0_18px_-6px_var(--neon-cyan)]">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

function UserMenu({ user, initial }: { user: { email?: string | null } | null; initial: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    if (open) document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 rounded-full border border-border bg-card px-2 pr-3 transition hover:border-primary"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-primary-foreground"
          style={{ background: "var(--gradient-primary)" }}>{initial}</span>
        <span className="hidden max-w-[140px] truncate text-xs text-foreground sm:inline">{user?.email}</span>
        <span className="text-[10px] text-muted-foreground">▾</span>
      </button>
      {open && (
        <div className="animate-toast-in absolute right-0 top-full z-30 mt-2 w-52 rounded-xl border border-border bg-popover p-1.5 shadow-xl backdrop-blur-xl">
          <div className="truncate px-3 py-2 text-[11px] text-muted-foreground">{user?.email}</div>
          <button
            onClick={() => { setOpen(false); signOut(); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-destructive hover:bg-destructive/10"
          >
            <span>⎋</span> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Hero Ring
   ============================================================ */
const HeroRing = memo(function HeroRing({ pct, statusText, statusColor, total, attended }:
  { pct: number; statusText: string; statusColor: string; total: number; attended: number }) {
  const size = 240;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const dash = (clamped / 100) * c;

  return (
    <div className="glass-neon tilt-3d sheen animate-pop-in flex flex-col items-center justify-center overflow-hidden p-6 sm:p-8">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90 animate-spin-slow" style={{ filter: `drop-shadow(0 0 14px ${statusColor})` }}>
          <defs>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--neon-cyan)" />
              <stop offset="50%" stopColor="var(--neon-magenta)" />
              <stop offset="100%" stopColor="var(--neon-lime)" />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke="color-mix(in oklab, white 8%, transparent)" fill="none" />
          <circle cx={size / 2} cy={size / 2} r={r}
            strokeWidth={stroke} stroke={statusColor} strokeLinecap="round" fill="none"
            strokeDasharray={`${dash} ${c - dash}`}
            style={{ transition: "stroke-dasharray 800ms cubic-bezier(0.2,0.9,0.3,1.1), stroke 300ms" }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-5xl font-bold tracking-tight" style={{ color: statusColor, textShadow: `0 0 24px ${statusColor}` }}>
            {pct.toFixed(1)}<span className="text-2xl">%</span>
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Attendance</div>
        </div>
      </div>
      <div className="animate-neon-pulse mt-6 rounded-full px-4 py-1.5 text-sm font-semibold"
        style={{
          backgroundColor: `color-mix(in oklab, ${statusColor} 15%, transparent)`,
          color: statusColor,
          border: `1px solid color-mix(in oklab, ${statusColor} 45%, transparent)`,
        }}>
        {statusText}
      </div>
      <div className="mt-5 flex gap-6 text-center">
        <div>
          <div className="text-2xl font-bold text-foreground">{attended}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Attended</div>
        </div>
        <div className="h-10 w-px bg-border" />
        <div>
          <div className="text-2xl font-bold text-foreground">{total}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Total</div>
        </div>
      </div>
    </div>
  );
});

/* ============================================================
   Insights
   ============================================================ */
function InsightsPanel({ status, target, safe, total, streak, badge }: {
  status: string; target: number; safe: number; total: number; streak: number; badge: { label: string; icon: string; next: number };
}) {
  const targetActive = status === "danger";
  const safeActive = status !== "danger";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <InsightCard active={targetActive} color="var(--color-danger)" eyebrow="Target to Safety" big={target} unit={target === 1 ? "class" : "classes"}
        detail={total === 0 ? "Enter data to see your target." : `Attend the next ${target} classes consecutively to reach 75%.`} />
      <InsightCard active={safeActive} color="var(--color-warning)" eyebrow="Available Bunk Coins" big={safe} unit={safe === 1 ? "coin" : "coins"}
        detail={total === 0 ? "Enter data to mint your budget." : `Each marked absence spends 1 coin. Keep coins above zero.`} />
    </div>
  );
}

function InsightCard({ active, color, eyebrow, big, unit, detail }: { active: boolean; color: string; eyebrow: string; big: number; unit: string; detail: string }) {
  return (
    <div className="glass tilt-3d sheen relative overflow-hidden p-6"
      style={{
        opacity: active ? 1 : 0.55,
        borderColor: active ? `color-mix(in oklab, ${color} 55%, transparent)` : undefined,
        boxShadow: active ? `0 0 50px -12px ${color}, inset 0 0 0 1px color-mix(in oklab, ${color} 30%, transparent)` : undefined,
      }}>
      <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{eyebrow}</div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="text-5xl font-bold" style={{ color, textShadow: active ? `0 0 22px ${color}` : "none" }}>{big}</div>
        <div className="text-sm text-muted-foreground">{unit}</div>
      </div>
      <p className="mt-3 text-sm text-foreground/80">{detail}</p>
    </div>
  );
}

/* ============================================================
   What-If Planner — interactive skip/attend simulator
   ============================================================ */
function WhatIfPlanner({ attended, total }: { attended: number; total: number }) {
  const [skip, setSkip] = useState(0);
  const [attend, setAttend] = useState(0);
  const projTotal = total + skip + attend;
  const projAttended = attended + attend;
  const projPct = projTotal > 0 ? Math.round((projAttended / projTotal) * 1000) / 10 : 0;
  const currentPct = total > 0 ? Math.round((attended / total) * 1000) / 10 : 0;
  const delta = Math.round((projPct - currentPct) * 10) / 10;
  const safe = projPct >= 75;
  const maxSkip = Math.min(40, Math.max(5, Math.round(total * 0.4)));
  const maxAttend = Math.min(40, Math.max(5, Math.round(total * 0.4)));
  // How many consecutive attends needed to reach 75% from current
  const toRecover = attended >= total * 0.75
    ? 0
    : Math.max(0, Math.ceil((0.75 * total - attended) / 0.25));

  return (
    <div className="glass relative overflow-hidden p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">What-If Planner</div>
          <h3 className="text-lg font-bold text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            Simulate future classes
          </h3>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black" style={{ color: safe ? "var(--color-warning)" : "var(--color-danger)", textShadow: `0 0 18px ${safe ? "var(--color-warning)" : "var(--color-danger)"}` }}>
            {projPct}%
          </span>
          <span className={`text-xs font-semibold ${delta >= 0 ? "text-warning" : "text-destructive"}`}>
            {delta >= 0 ? `+${delta}` : delta}%
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>🚫 Skip next</span>
            <span className="font-bold text-destructive">{skip} class{skip === 1 ? "" : "es"}</span>
          </div>
          <input type="range" min={0} max={maxSkip} value={skip} onChange={(e) => setSkip(Number(e.target.value))}
            className="w-full accent-[var(--color-danger)]" aria-label="Classes to skip" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>✅ Attend next</span>
            <span className="font-bold text-warning">{attend} class{attend === 1 ? "" : "es"}</span>
          </div>
          <input type="range" min={0} max={maxAttend} value={attend} onChange={(e) => setAttend(Number(e.target.value))}
            className="w-full accent-[var(--color-warning)]" aria-label="Classes to attend" />
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-background/40 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Now</div>
          <div className="text-lg font-bold text-foreground">{currentPct}%</div>
          <div className="text-[11px] text-muted-foreground">{attended}/{total}</div>
        </div>
        <div className="rounded-xl border p-3" style={{ borderColor: safe ? "color-mix(in oklab, var(--color-warning) 55%, transparent)" : "color-mix(in oklab, var(--color-danger) 55%, transparent)", background: "color-mix(in oklab, var(--card) 60%, transparent)" }}>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Projected</div>
          <div className="text-lg font-bold" style={{ color: safe ? "var(--color-warning)" : "var(--color-danger)" }}>{projPct}%</div>
          <div className="text-[11px] text-muted-foreground">{projAttended}/{projTotal}</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/40 p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Recovery</div>
          <div className="text-lg font-bold text-foreground">{toRecover === 0 ? "0" : toRecover}</div>
          <div className="text-[11px] text-muted-foreground">{toRecover === 0 ? "Already safe" : `attend to hit 75%`}</div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Move the sliders to test scenarios — the projection updates live using your current numbers.
      </p>
    </div>
  );
}

function BadgePopup({ badge, onDismiss }: {
  badge: { icon: string; label: string; streak: number } | null;
  onDismiss: () => void;
}) {
  if (!badge) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div className="animate-pop-in pointer-events-auto flex max-w-sm items-center gap-3 rounded-3xl border border-warning/50 bg-popover/90 p-4 shadow-2xl backdrop-blur-xl"
        style={{ boxShadow: "0 0 48px -12px var(--color-warning)" }}>
        <div className="text-4xl">{badge.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-foreground">Badge unlocked</div>
          <div className="text-xs text-muted-foreground">{badge.label} · {badge.streak} attended days in a row</div>
        </div>
        <button onClick={onDismiss} className="rounded-full px-2 text-muted-foreground hover:text-foreground" aria-label="Dismiss badge">✕</button>
      </div>
    </div>
  );
}

function nextClassSlot(detailed: DetailedData) {
  const cur = new Date(todayISO() + "T00:00:00");
  for (let guard = 0; guard < 21; guard++) {
    const iso = cur.toISOString().slice(0, 10);
    const dayKey = DOW_TO_DAY[cur.getDay()];
    if (dayKey && !detailed.holidays.includes(iso)) {
      const idx = detailed.timetable[dayKey].findIndex((s) => s.trim());
      if (idx >= 0) {
        return { iso, subject: detailed.timetable[dayKey][idx].trim(), slot: detailed.periods[idx] ?? `P${idx + 1}` };
      }
    }
    cur.setDate(cur.getDate() + 1);
  }
  return { iso: todayISO(), subject: "Next lecture", slot: "Upcoming slot" };
}

function RoomsHub({ user, social, setSocial, stats, detailed, roadmap, wrapped, onToggleNotify }: {
  user: ReturnType<typeof useAuth>["user"];
  social: SocialData;
  setSocial: (u: SocialData | ((d: SocialData) => SocialData)) => void;
  stats: { attendancePct: number; statusBadge: SafetyBadge; activeStreak: number; bunkCoins: number };
  detailed: DetailedData;
  roadmap: { iso: string; label: string; pct: number }[];
  wrapped: { mostSkipped: string; closestCall: string; hours: number };
  onToggleNotify: (v: boolean) => void;
}) {
  const fetchRooms = useServerFn(listMyRooms);
  const createRoom = useServerFn(createAttendanceRoom);
  const joinRoom = useServerFn(joinAttendanceRoom);
  const fetchSnapshot = useServerFn(getRoomSnapshot);
  const syncStats = useServerFn(syncRoomMemberStats);
  const createPoll = useServerFn(createMassBunkPoll);
  const votePoll = useServerFn(voteMassBunkPoll);
  const sendSos = useServerFn(sendSosBroadcast);
  const deleteRoom = useServerFn(deleteAttendanceRoom);

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [snapshot, setSnapshot] = useState<{ room: RoomRow; members: RoomMemberRow[]; polls: PollRow[]; votes: VoteRow[]; sos: SosRow[] } | null>(null);
  const [roomName, setRoomName] = useState("My Attendance Room");
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState(social.displayName || user?.email?.split("@")[0] || "Student");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRoomId = social.activeRoomId || rooms[0]?.id;
  const nextClass = useMemo(() => nextClassSlot(detailed), [detailed]);

  const refreshRooms = useCallback(async () => {
    if (!user) return;
    try {
      const rows = await fetchRooms();
      setRooms(rows as RoomRow[]);
      if (!social.activeRoomId && rows?.[0]?.id) setSocial((s) => ({ ...s, activeRoomId: rows[0].id }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load rooms"); }
  }, [user, fetchRooms, social.activeRoomId, setSocial]);

  const refreshSnapshot = useCallback(async () => {
    if (!activeRoomId) { setSnapshot(null); return; }
    try {
      const snap = await fetchSnapshot({ data: { roomId: activeRoomId } });
      setSnapshot(snap as typeof snapshot);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load room"); }
  }, [activeRoomId, fetchSnapshot]);

  useEffect(() => { refreshRooms(); }, [refreshRooms]);
  useEffect(() => { refreshSnapshot(); }, [refreshSnapshot]);

  useEffect(() => {
    if (!activeRoomId || !user) return;
    const t = window.setTimeout(() => {
      syncStats({ data: { roomId: activeRoomId, displayName: displayName.trim() || "Student", stats } }).catch(() => {});
      setSocial((s) => ({ ...s, displayName: displayName.trim() || "Student" }));
    }, 900);
    return () => window.clearTimeout(t);
  }, [activeRoomId, user, displayName, stats, syncStats, setSocial]);

  useEffect(() => {
    if (!activeRoomId) return;
    const channel = supabase
      .channel(`attendance-room-${activeRoomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${activeRoomId}` }, () => refreshSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "mass_bunk_polls", filter: `room_id=eq.${activeRoomId}` }, () => refreshSnapshot())
      .on("postgres_changes", { event: "*", schema: "public", table: "mass_bunk_votes" }, () => refreshSnapshot())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sos_broadcasts", filter: `room_id=eq.${activeRoomId}` }, (payload) => {
        const row = payload.new as SosRow;
        refreshSnapshot();
        if (row.sender_id !== user?.id) fireNotification("🚨 SOS Proxy", row.message, `sos-${row.id}`);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeRoomId, refreshSnapshot, user?.id]);

  const handleCreate = async () => {
    setBusy("create"); setError(null);
    try {
      const room = await createRoom({ data: { name: roomName, displayName: displayName.trim() || "Student", stats } }) as RoomRow;
      setRooms((r) => [room, ...r.filter((x) => x.id !== room.id)]);
      setSocial((s) => ({ ...s, displayName: displayName.trim() || "Student", activeRoomId: room.id }));
    } catch (e) { setError(e instanceof Error ? e.message : "Room creation failed"); }
    finally { setBusy(null); }
  };

  const handleJoin = async () => {
    setBusy("join"); setError(null);
    try {
      const room = await joinRoom({ data: { inviteCode, displayName: displayName.trim() || "Student", stats } }) as RoomRow;
      setRooms((r) => [room, ...r.filter((x) => x.id !== room.id)]);
      setSocial((s) => ({ ...s, displayName: displayName.trim() || "Student", activeRoomId: room.id }));
      setInviteCode("");
    } catch (e) { setError(e instanceof Error ? e.message : "Join failed"); }
    finally { setBusy(null); }
  };

  const handlePoll = async () => {
    if (!activeRoomId) return;
    setBusy("poll"); setError(null);
    try {
      await createPoll({ data: { roomId: activeRoomId, subject: nextClass.subject, classSlot: nextClass.slot, classDate: nextClass.iso } });
      await refreshSnapshot();
    } catch (e) { setError(e instanceof Error ? e.message : "Poll failed"); }
    finally { setBusy(null); }
  };

  const handleSos = async () => {
    if (!activeRoomId) return;
    setBusy("sos"); setError(null);
    try {
      await onToggleNotify(true);
      const sos = await sendSos({ data: { roomId: activeRoomId, senderName: displayName.trim() || "A friend", subject: nextClass.subject, classSlot: nextClass.slot } }) as SosRow;
      fireNotification("🚨 SOS Proxy", sos.message, `sos-${sos.id}`);
      await refreshSnapshot();
    } catch (e) { setError(e instanceof Error ? e.message : "SOS failed"); }
    finally { setBusy(null); }
  };

  const handleDeleteRoom = async (roomId: string, roomName: string) => {
    if (!window.confirm(`Delete room "${roomName}"? This removes all members, polls, and SOS history. This cannot be undone.`)) return;
    setBusy("delete"); setError(null);
    try {
      await deleteRoom({ data: { roomId } });
      setRooms((r) => r.filter((x) => x.id !== roomId));
      setSocial((s) => (s.activeRoomId === roomId ? { ...s, activeRoomId: undefined } : s));
      setSnapshot(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
    finally { setBusy(null); }
  };

  if (!user) {
    return (
      <div className="glass-neon p-6 text-center">
        <h2 className="text-xl font-bold">Attendance Rooms</h2>
        <p className="mt-2 text-sm text-muted-foreground">Sign in to create private rooms, live leaderboards, polls, SOS alerts, and shareable Wrapped cards.</p>
        <Link to="/auth" className="mt-5 inline-flex rounded-full px-5 py-3 text-sm font-bold text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>Sign in to collaborate</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="glass-neon p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Attendance Rooms</h2>
            <p className="text-xs text-muted-foreground sm:text-sm">Live friend tracking, anonymous bunk planning, emergency roll-call proxy, recovery roadmap, and semester wrapped.</p>
          </div>
          <div className="rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-right">
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Bunk Coins</div>
            <div className="text-3xl font-black" style={{ color: "var(--color-warning)" }}>{stats.bunkCoins}</div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Your room name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">New room title</span>
            <input value={roomName} onChange={(e) => setRoomName(e.target.value)} className="mt-1 w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
          </label>
          <button onClick={handleCreate} disabled={busy === "create"} className="self-end rounded-xl px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50" style={{ background: "var(--gradient-primary)" }}>{busy === "create" ? "Creating…" : "Create room"}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="Invite code" className="min-w-[150px] flex-1 rounded-xl border border-border bg-input px-3 py-2 text-sm uppercase tracking-[0.25em] text-foreground outline-none focus:border-primary" />
          <button onClick={handleJoin} disabled={busy === "join" || inviteCode.length !== 6} className="rounded-xl border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-bold text-primary disabled:opacity-40">Join room</button>
        </div>
        {error && <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}

        {rooms.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {rooms.map((room) => {
              const owned = room.owner_id === user.id;
              return (
                <div key={room.id}
                  className={`relative shrink-0 rounded-2xl border transition ${activeRoomId === room.id ? "border-primary bg-primary/10" : "border-border bg-background/40 hover:border-primary/50"}`}>
                  <button onClick={() => setSocial((s) => ({ ...s, activeRoomId: room.id }))}
                    className={`block px-4 py-2 pr-8 text-left text-xs ${activeRoomId === room.id ? "text-primary" : "text-foreground"}`}>
                    <div className="font-bold">{room.name}{owned ? " · Owner" : ""}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{room.invite_code}</div>
                  </button>
                  {owned && (
                    <button
                      onClick={() => handleDeleteRoom(room.id, room.name)}
                      disabled={busy === "delete"}
                      title="Delete room"
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40">
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {snapshot ? (
        <>
          <RoomLeaderboard room={snapshot.room} members={snapshot.members} currentUserId={user.id} />
          <div className="grid gap-5 lg:grid-cols-2">
            <MassBunkPlanner
              members={snapshot.members}
              polls={snapshot.polls}
              votes={snapshot.votes}
              userId={user.id}
              busy={busy}
              onCreate={handlePoll}
              onVote={async (pollId, intent) => { await votePoll({ data: { pollId, intent } }); await refreshSnapshot(); }}
              nextClass={nextClass}
            />
            <SosPanel sos={snapshot.sos} nextClass={nextClass} busy={busy} onSend={handleSos} />
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Create or join a room to unlock the live dashboard.</div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <RecoveryRoadmap roadmap={roadmap} pct={stats.attendancePct} />
        <WrappedCard wrapped={wrapped} stats={stats} />
      </div>
    </div>
  );
}

function RoomLeaderboard({ room, members, currentUserId }: { room: RoomRow; members: RoomMemberRow[]; currentUserId: string }) {
  return (
    <div className="glass p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">{room.name} Leaderboard</h3>
          <div className="text-xs text-muted-foreground">Invite code <span className="font-mono text-primary">{room.invite_code}</span></div>
        </div>
        <button onClick={() => navigator.clipboard?.writeText(room.invite_code)} className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary">Copy code</button>
      </div>
      <div className="mt-4 grid gap-2">
        {members.map((m, idx) => {
          const color = m.status_badge === "Safe" ? "var(--color-success)" : m.status_badge === "On the Edge" ? "var(--color-warning)" : "var(--color-danger)";
          return (
            <div key={m.id} className="flex items-center gap-3 rounded-2xl border border-border bg-background/30 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-black text-primary">#{idx + 1}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-foreground">{m.display_name}{m.user_id === currentUserId ? " · You" : ""}</div>
                <div className="text-[10px] text-muted-foreground">🔥 {m.active_streak} day streak · 🪙 {m.bunk_coins} coins</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-black" style={{ color }}>{Number(m.attendance_pct).toFixed(1)}%</div>
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>{m.status_badge}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MassBunkPlanner({ members, polls, votes, userId, busy, onCreate, onVote, nextClass }: {
  members: RoomMemberRow[]; polls: PollRow[]; votes: VoteRow[]; userId: string; busy: string | null;
  onCreate: () => void; onVote: (pollId: string, intent: "attending" | "bunking") => Promise<void>; nextClass: { iso: string; subject: string; slot: string };
}) {
  return (
    <div className="glass p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Anonymous Mass Bunk Planner</h3>
          <p className="text-xs text-muted-foreground">Next slot: {nextClass.subject} · {nextClass.slot}</p>
        </div>
        <button onClick={onCreate} disabled={busy === "poll"} className="rounded-full px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50" style={{ background: "var(--gradient-primary)" }}>{busy === "poll" ? "Launching…" : "Launch poll"}</button>
      </div>
      <div className="mt-4 space-y-3">
        {polls.length === 0 ? <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No active intent polls.</div> : polls.map((poll) => {
          const pv = votes.filter((v) => v.poll_id === poll.id);
          const bunking = pv.filter((v) => v.intent === "bunking").length;
          const confidence = members.length ? Math.round((bunking / members.length) * 100) : 0;
          const mine = pv.find((v) => v.user_id === userId)?.intent;
          const safe = confidence >= 85;
          return (
            <div key={poll.id} className="rounded-2xl border border-border bg-background/30 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-foreground">{poll.subject}</div>
                  <div className="text-[10px] text-muted-foreground">{poll.class_date} · {poll.class_slot}</div>
                </div>
                <span className="rounded-full px-2 py-1 text-[10px] font-black" style={{ color: safe ? "var(--color-success)" : "var(--color-danger)", background: safe ? "color-mix(in oklab, var(--color-success) 12%, transparent)" : "color-mix(in oklab, var(--color-danger) 12%, transparent)" }}>{safe ? "SAFE TO BUNK" : "UNSAFE TO BUNK"}</span>
              </div>
              <div className="mt-3 h-3 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-all" style={{ width: `${confidence}%`, background: safe ? "var(--color-success)" : "var(--color-danger)" }} />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{confidence}% bunk confidence · needs 85%</div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => onVote(poll.id, "attending")} className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold ${mine === "attending" ? "border-success bg-success/10 text-success" : "border-border text-foreground"}`}>Attending</button>
                <button onClick={() => onVote(poll.id, "bunking")} className={`flex-1 rounded-xl border px-3 py-2 text-xs font-bold ${mine === "bunking" ? "border-warning bg-warning/10 text-warning" : "border-border text-foreground"}`}>Bunking</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SosPanel({ sos, nextClass, busy, onSend }: { sos: SosRow[]; nextClass: { subject: string; slot: string }; busy: string | null; onSend: () => void }) {
  return (
    <div className="glass p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">SOS Proxy Broadcast</h3>
          <p className="text-xs text-muted-foreground">{nextClass.subject} · {nextClass.slot}</p>
        </div>
        <button onClick={onSend} disabled={busy === "sos"} className="rounded-full border border-destructive/50 bg-destructive/15 px-4 py-2 text-xs font-black text-destructive disabled:opacity-50">🚨 SOS</button>
      </div>
      <div className="mt-4 space-y-2">
        {sos.length === 0 ? <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">No active emergency broadcasts.</div> : sos.map((row) => (
          <div key={row.id} className="rounded-2xl border border-destructive/35 bg-destructive/10 p-3">
            <div className="text-sm font-bold text-foreground">{row.sender_name}</div>
            <div className="text-xs text-muted-foreground">{row.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecoveryRoadmap({ roadmap, pct }: { roadmap: { iso: string; label: string; pct: number }[]; pct: number }) {
  return (
    <div className="glass p-4 sm:p-6">
      <h3 className="text-lg font-bold">Roadmap to Safety</h3>
      {pct >= 75 ? <p className="mt-2 text-sm text-success">You are above 75%. Protect the safe zone by spending bunk coins carefully.</p> : (
        <div className="mt-4 space-y-3">
          {roadmap.length === 0 ? <div className="text-sm text-muted-foreground">Fill your timetable to generate recovery milestones.</div> : roadmap.map((m, i) => (
            <div key={`${m.iso}-${i}`} className="flex gap-3 rounded-2xl border border-border bg-background/30 p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-black text-primary">{i + 1}</div>
              <div><div className="text-sm font-semibold text-foreground">{m.label}</div><div className="text-[10px] text-muted-foreground">Calendar milestone · {m.iso}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WrappedCard({ wrapped, stats }: { wrapped: { mostSkipped: string; closestCall: string; hours: number }; stats: { attendancePct: number; activeStreak: number; bunkCoins: number } }) {
  const share = async () => {
    const text = `My AttendEdge Wrapped: ${stats.attendancePct}% attendance, ${stats.activeStreak}-day streak, ${stats.bunkCoins} bunk coins, ${wrapped.hours} academic hours logged.`;
    if (navigator.share) await navigator.share({ title: "Semester Wrapped", text });
    else await navigator.clipboard?.writeText(text);
  };
  return (
    <div className="relative overflow-hidden rounded-3xl border border-primary/35 p-5 shadow-2xl" style={{ background: "linear-gradient(135deg, color-mix(in oklab, var(--neon-cyan) 28%, var(--background)), color-mix(in oklab, var(--neon-magenta) 30%, var(--background)))" }}>
      <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary-foreground/70">Semester Wrapped</div>
      <div className="mt-3 text-5xl font-black text-primary-foreground">{stats.attendancePct}%</div>
      <div className="text-sm font-semibold text-primary-foreground/80">Final attendance vibe</div>
      <div className="mt-5 grid gap-3 text-primary-foreground">
        <div className="rounded-2xl bg-background/20 p-3"><div className="text-[10px] uppercase opacity-70">Most skipped day</div><div className="font-bold">{wrapped.mostSkipped}</div></div>
        <div className="rounded-2xl bg-background/20 p-3"><div className="text-[10px] uppercase opacity-70">Closest call with 75%</div><div className="font-bold">{wrapped.closestCall}</div></div>
        <div className="rounded-2xl bg-background/20 p-3"><div className="text-[10px] uppercase opacity-70">Academic hours logged</div><div className="font-bold">{wrapped.hours} hrs</div></div>
      </div>
      <button onClick={share} className="mt-5 rounded-full bg-background/80 px-4 py-2 text-xs font-black text-foreground">Share Wrapped</button>
    </div>
  );
}

/* ============================================================
   Quick Form
   ============================================================ */
function QuickForm({ quick, setQuick }: { quick: QuickData; setQuick: (u: QuickData | ((q: QuickData) => QuickData)) => void }) {
  return (
    <div className="glass p-6 sm:p-8">
      <h2 className="text-xl font-semibold">Quick Entry</h2>
      <p className="mt-1 text-sm text-muted-foreground">Enter your current totals. The dashboard updates instantly.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <NumberField label="Total Classes Held" value={quick.total}
          onChange={(v) => setQuick((q) => ({ total: v, attended: Math.min(v, q.attended) }))} />
        <NumberField label="Classes Attended" value={quick.attended} max={quick.total}
          onChange={(v) => setQuick((q) => ({ ...q, attended: Math.min(q.total, Math.max(0, v)) }))} />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</span>
      <input type="number" min={0} max={max}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-2xl font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40" />
    </label>
  );
}

/* ============================================================
   Detailed Tracker
   ============================================================ */
function DetailedTracker({
  detailed, setDetailed, applyPresetById, allPresets, customPresets,
  onSaveCustomPreset, onDeleteCustomPreset, captureUndo,
}: {
  detailed: DetailedData;
  setDetailed: (u: DetailedData | ((d: DetailedData) => DetailedData)) => void;
  applyPresetById: (id: string) => void;
  allPresets: PresetTimetable[];
  customPresets: PresetTimetable[];
  onSaveCustomPreset: (label: string) => void;
  onDeleteCustomPreset: (id: string) => void;
  captureUndo: (label: string) => void;
}) {
  const [tab, setTab] = useState<"setup" | "log" | "bulk">("setup");

  return (
    <div className="glass-neon overflow-hidden p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Weekly Timetable</h2>
          <p className="text-xs text-muted-foreground sm:text-sm">
            {tab === "setup"
              ? "Step 1: load a preset or fill your grid, then head to Daily Log."
              : tab === "log"
              ? "Step 2: tap any class to mark Attended / Missed."
              : "Bulk Edit: drag across cells or click row/column headers, then apply."}
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-full border border-border bg-background/40 p-1">
          {(["setup", "log", "bulk"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200 sm:px-4 ${tab === t ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              style={tab === t ? { background: "var(--gradient-primary)" } : undefined}>
              {t === "setup" ? "1 · Setup" : t === "log" ? "2 · Daily Log" : "⚡ Bulk Edit"}
            </button>
          ))}
        </div>
      </div>

      {tab === "setup" ? (
        <SetupPanel
          detailed={detailed} setDetailed={setDetailed}
          applyPresetById={applyPresetById}
          allPresets={allPresets}
          customPresets={customPresets}
          onSaveCustomPreset={onSaveCustomPreset}
          onDeleteCustomPreset={onDeleteCustomPreset}
          onGoToLog={() => setTab("log")}
        />
      ) : tab === "log" ? (
        <LogPanel detailed={detailed} setDetailed={setDetailed} captureUndo={captureUndo} />
      ) : (
        <BulkEditPanel detailed={detailed} setDetailed={setDetailed} captureUndo={captureUndo} />
      )}
    </div>
  );
}


/* ---------- Preset picker ---------- */
function PresetPicker({
  activeId, onPick, allPresets, customPresets, onSaveCurrent, onDelete,
}: {
  activeId?: string;
  onPick: (id: string) => void;
  allPresets: PresetTimetable[];
  customPresets: PresetTimetable[];
  onSaveCurrent: (label: string) => void;
  onDelete: (id: string) => void;
}) {
  const customIds = new Set(customPresets.map((p) => p.id));
  return (
    <div className="mt-4 rounded-2xl border border-border/70 bg-background/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Section presets</div>
        <button
          onClick={() => {
            const name = window.prompt("Name this section (e.g. '3/4 CSE Sec B'):");
            if (name && name.trim()) onSaveCurrent(name);
          }}
          className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary transition hover:bg-primary/20">
          + Save current
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {allPresets.map((p) => {
          const active = activeId === p.id;
          const isCustom = customIds.has(p.id);
          return (
            <div key={p.id} className="relative">
              <button onClick={() => onPick(p.id)}
                className={`press-card group relative rounded-xl border px-3 py-2 pr-7 text-left text-xs font-semibold transition-all ${
                  active ? "border-transparent text-primary-foreground" : "border-border bg-background/50 text-foreground hover:border-primary"
                }`}
                style={active ? { background: "var(--gradient-primary)", boxShadow: "0 0 24px -8px var(--neon-cyan)" } : undefined}>
                <div>{p.label}</div>
                {p.meta && <div className={`text-[10px] font-normal ${active ? "opacity-80" : "text-muted-foreground"}`}>{p.meta}</div>}
              </button>
              {isCustom && (
                <button
                  onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete preset "${p.label}"?`)) onDelete(p.id); }}
                  title="Delete custom preset"
                  className="absolute -right-1.5 -top-1.5 h-5 w-5 rounded-full border border-border bg-background text-[10px] text-muted-foreground hover:border-destructive hover:text-destructive">
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Setup ---------- */
function SetupPanel({
  detailed, setDetailed, applyPresetById, allPresets, customPresets,
  onSaveCustomPreset, onDeleteCustomPreset, onGoToLog,
}: {
  detailed: DetailedData;
  setDetailed: (u: DetailedData | ((d: DetailedData) => DetailedData)) => void;
  applyPresetById: (id: string) => void;
  allPresets: PresetTimetable[];
  customPresets: PresetTimetable[];
  onSaveCustomPreset: (label: string) => void;
  onDeleteCustomPreset: (id: string) => void;
  onGoToLog: () => void;
}) {
  const setCell = useCallback((day: DayKey, idx: number, val: string) => {
    setDetailed((d) => {
      const row = [...d.timetable[day]]; row[idx] = val;
      return { ...d, timetable: { ...d.timetable, [day]: row }, presetId: undefined };
    });
  }, [setDetailed]);
  const setPeriodLabel = (idx: number, val: string) =>
    setDetailed((d) => { const p = [...d.periods]; p[idx] = val; return { ...d, periods: p }; });
  const addPeriod = () =>
    setDetailed((d) => {
      const p = [...d.periods, `P${d.periods.length + 1}`];
      const tt = { ...d.timetable }; for (const day of DAYS) tt[day] = [...tt[day], ""];
      return { ...d, periods: p, timetable: tt };
    });
  const removePeriod = (idx: number) =>
    setDetailed((d) => {
      if (d.periods.length <= 1) return d;
      const p = d.periods.filter((_, i) => i !== idx);
      const tt = { ...d.timetable }; for (const day of DAYS) tt[day] = tt[day].filter((_, i) => i !== idx);
      return { ...d, periods: p, timetable: tt };
    });
  const resetToDefault = () =>
    setDetailed((d) => ({ ...d, periods: [...DEFAULT_PERIODS], timetable: emptyTimetable(DEFAULT_PERIODS.length), presetId: undefined }));

  const hasContent = useMemo(
    () => DAYS.some((day) => detailed.timetable[day].some((s) => s.trim())),
    [detailed.timetable],
  );

  return (
    <div className="mt-5 animate-fade-in">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Class Start Date</span>
          <input type="date" value={detailed.startDate} max={todayISO()}
            onChange={(e) => setDetailed((d) => ({ ...d, startDate: e.target.value }))}
            className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/40" />
        </label>
        <div className="flex items-end justify-end gap-2">
          <button onClick={addPeriod} className="rounded-xl border border-border bg-background/40 px-3 py-2 text-xs font-medium text-foreground transition hover:border-primary">
            + Period
          </button>
          <button onClick={resetToDefault} className="rounded-xl border border-border bg-background/40 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-danger hover:border-danger">
            Reset
          </button>
        </div>
      </div>

      <PresetPicker
        activeId={detailed.presetId}
        onPick={applyPresetById}
        allPresets={allPresets}
        customPresets={customPresets}
        onSaveCurrent={onSaveCustomPreset}
        onDelete={onDeleteCustomPreset}
      />

      <div className="mt-5 -mx-2 overflow-x-auto pb-3 sm:mx-0">
        <div className="min-w-[720px] px-2 sm:px-0">
          <div className="grid gap-1.5"
            style={{ gridTemplateColumns: `72px repeat(${detailed.periods.length}, minmax(120px, 1fr))` }}>
            <div />
            {detailed.periods.map((p, i) => (
              <div key={i} className="group relative rounded-lg border border-border bg-background/40 p-1.5 text-center">
                <input value={p} onChange={(e) => setPeriodLabel(i, e.target.value)}
                  className="w-full bg-transparent text-center text-[11px] font-medium text-foreground/90 outline-none" />
                <button onClick={() => removePeriod(i)} title="Remove period"
                  className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[10px] text-muted-foreground hover:border-danger hover:text-danger group-hover:flex">
                  ✕
                </button>
              </div>
            ))}
            {DAYS.map((day) => (
              <RowFragment key={day} day={day} row={detailed.timetable[day]} onChange={(idx, v) => setCell(day, idx, v)} />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Tip: For a subject that spans multiple periods (lab), just repeat its name across those cells — each period counts as one class.
      </p>

      {/* Big "Next step" CTA — removes the confusion after setup */}
      <div className="mt-6 flex flex-col items-center gap-2 rounded-2xl border border-primary/30 bg-background/40 p-5 text-center sm:flex-row sm:justify-between sm:text-left">
        <div>
          <div className="text-sm font-semibold text-foreground">
            {hasContent ? "Your timetable is ready." : "Load a preset or fill your grid above."}
          </div>
          <div className="text-xs text-muted-foreground">
            {hasContent
              ? "Now open Daily Log to mark each class as Attended or Missed."
              : "As soon as it has subjects, this button lights up."}
          </div>
        </div>
        <button
          onClick={onGoToLog}
          disabled={!hasContent}
          className={`press-card rounded-full px-5 py-3 text-sm font-bold text-primary-foreground transition ${hasContent ? "animate-nudge" : "opacity-40"}`}
          style={{ background: "var(--gradient-primary)", boxShadow: "0 0 24px -6px var(--neon-magenta)" }}>
          Go to Daily Log →
        </button>
      </div>
    </div>
  );
}

function RowFragment({ day, row, onChange }: { day: DayKey; row: string[]; onChange: (idx: number, v: string) => void }) {
  return (
    <>
      <div className="flex items-center justify-center rounded-lg border border-border bg-background/30 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {day}
      </div>
      {row.map((cell, idx) => {
        const filled = cell.trim().length > 0;
        return (
          <input key={idx} value={cell} onChange={(e) => onChange(idx, e.target.value)} placeholder="—"
            className="rounded-lg border bg-input px-2 py-2.5 text-center text-xs font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40"
            style={{
              borderColor: filled ? "color-mix(in oklab, var(--neon-cyan) 40%, transparent)" : undefined,
              backgroundColor: filled ? "color-mix(in oklab, var(--neon-cyan) 8%, transparent)" : undefined,
              color: filled ? "oklch(0.98 0.02 200)" : undefined,
              boxShadow: filled ? "0 0 12px -6px var(--neon-cyan)" : undefined,
            }} />
        );
      })}
    </>
  );
}

/* ============================================================
   Daily Log
   ============================================================ */
function LogPanel({
  detailed, setDetailed, captureUndo,
}: {
  detailed: DetailedData;
  setDetailed: (u: DetailedData | ((d: DetailedData) => DetailedData)) => void;
  captureUndo: (label: string) => void;
}) {
  const holidaySet = useMemo(() => new Set(detailed.holidays), [detailed.holidays]);

  const dates = useMemo(() => {
    const arr: { iso: string; day: DayKey; label: string }[] = [];
    const start = new Date(detailed.startDate + "T00:00:00");
    const end = new Date(todayISO() + "T00:00:00");
    if (isNaN(start.getTime()) || end < start) return arr;
    const cur = new Date(start);
    while (cur <= end) {
      const dayKey = DOW_TO_DAY[cur.getDay()];
      if (dayKey) {
        const row = detailed.timetable[dayKey] || [];
        if (row.some((s) => s.trim()))
          arr.push({ iso: cur.toISOString().slice(0, 10), day: dayKey, label: formatShortDate(cur) });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return arr.reverse();
  }, [detailed.startDate, detailed.timetable]);

  const setClassState = useCallback((iso: string, idx: number, st: "attended" | "missed" | "cancelled") => {
    captureUndo(st === "cancelled" ? "Class cancelled" : st === "attended" ? "Marked attended" : "Marked absent");
    setDetailed((d) => ({ ...d, states: { ...d.states, [`${iso}__${idx}`]: st } }));
  }, [setDetailed, captureUndo]);

  const toggleHoliday = useCallback((iso: string) => {
    captureUndo("Holiday toggled");
    setDetailed((d) => {
      const has = d.holidays.includes(iso);
      return { ...d, holidays: has ? d.holidays.filter((x) => x !== iso) : [...d.holidays, iso] };
    });
  }, [setDetailed, captureUndo]);

  const markDay = useCallback((iso: string, day: DayKey, st: "attended" | "missed") => {
    captureUndo(st === "attended" ? "Whole day marked present" : "Whole day marked absent");
    setDetailed((d) => {
      const row = d.timetable[day];
      const next = { ...d.states };
      row.forEach((subj, idx) => {
        if (!subj.trim()) return;
        next[`${iso}__${idx}`] = st;
      });
      return { ...d, states: next };
    });
  }, [setDetailed]);

  // Refs to each day card for the carousel jump-to
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollerRef = useRef<HTMLDivElement>(null);
  const jumpToDay = useCallback((iso: string) => {
    const el = cardRefs.current[iso];
    const container = scrollerRef.current;
    if (!el || !container) return;
    container.scrollTo({ top: el.offsetTop - container.offsetTop - 8, behavior: "smooth" });
  }, []);

  const todayIsoStr = todayISO();

  // Start Date fallback toolbar — always visible inside Daily Log
  const StartDateToolbar = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/30 p-3">
      <label className="flex min-w-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        <span>📅 Class Start Date</span>
        <input
          type="date"
          value={detailed.startDate}
          max={todayIsoStr}
          onChange={(e) => setDetailed((d) => ({ ...d, startDate: e.target.value }))}
          className="rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs font-medium normal-case tracking-normal text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
        />
      </label>
      <span className="text-[10px] text-muted-foreground">
        Forgot to set it earlier? Update anytime — the log rebuilds instantly.
      </span>
    </div>
  );

  if (dates.length === 0) {
    return (
      <div className="mt-5 animate-fade-in">
        {StartDateToolbar}
        <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Fill in subjects in the Setup tab (or load a section preset) to generate your daily log.
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 animate-fade-in">
      {StartDateToolbar}

      {/* Day carousel — sticky so it stays visible while scrolling long logs */}
      <div className="sticky top-0 z-20 -mx-1 mb-3 flex gap-2 overflow-x-auto rounded-2xl border border-border/40 bg-background/70 px-2 py-2 backdrop-blur-md transition-colors duration-200"
        style={{ scrollSnapType: "x mandatory" }}>

        {dates.map(({ iso, day, label }) => {
          const isToday = iso === todayIsoStr;
          const isHoliday = holidaySet.has(iso);
          const dateNum = label.split(", ")[1]?.split(" ").slice(-1)[0] ?? "";
          return (
            <button
              key={iso}
              onClick={() => jumpToDay(iso)}
              className={`press-card group flex shrink-0 flex-col items-center rounded-2xl border px-3 py-2 text-center transition ${
                isToday
                  ? "border-transparent text-primary-foreground"
                  : "border-border bg-background/40 text-foreground hover:border-primary"
              }`}
              style={{
                scrollSnapAlign: "start",
                minWidth: 62,
                background: isToday ? "var(--gradient-primary)" : undefined,
                boxShadow: isToday ? "0 0 20px -6px var(--neon-cyan)" : undefined,
              }}
              title={label}
            >
              <span className={`text-[9px] font-bold uppercase tracking-widest ${isToday ? "opacity-90" : "text-muted-foreground"}`}>{day}</span>
              <span className="text-lg font-black leading-none" style={{ fontFamily: "var(--font-display)" }}>{dateNum}</span>
              {isHoliday && <span className="mt-0.5 text-[8px] opacity-80">Holiday</span>}
            </button>
          );
        })}
      </div>

      <div ref={scrollerRef} className="max-h-[640px] space-y-5 overflow-y-auto pr-1">
        {dates.map(({ iso, day, label }) => (
          <div
            key={iso}
            ref={(el) => { cardRefs.current[iso] = el; }}
            style={{ contentVisibility: "auto", containIntrinsicSize: "320px" } as React.CSSProperties}
          >
            <DayCard iso={iso} day={day} label={label}
              isHoliday={holidaySet.has(iso)}
              row={detailed.timetable[day]}
              periods={detailed.periods}
              states={detailed.states}
              onSetState={setClassState}
              onToggleHoliday={toggleHoliday}
              onMarkDay={markDay} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* --- Memoized DayCard --- */
type DayCardProps = {
  iso: string; day: DayKey; label: string;
  isHoliday: boolean;
  row: string[]; periods: string[];
  states: ClassState;
  onSetState: (iso: string, idx: number, st: "attended" | "missed" | "cancelled") => void;
  onToggleHoliday: (iso: string) => void;
  onMarkDay: (iso: string, day: DayKey, st: "attended" | "missed") => void;
};

const DayCard = memo(function DayCard({
  iso, day, label, isHoliday, row, periods, states, onSetState, onToggleHoliday, onMarkDay,
}: DayCardProps) {
  return (
    <div className="animate-fade-in">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          <span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">{day}</span>
          <span>{label}</span>
          {isHoliday && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
              style={{ background: "color-mix(in oklab, var(--neon-magenta) 20%, transparent)", color: "var(--neon-magenta)", border: "1px solid color-mix(in oklab, var(--neon-magenta) 45%, transparent)" }}>
              Holiday
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => onMarkDay(iso, day, "attended")} disabled={isHoliday}
            className="rounded-full border border-success/40 bg-success/10 px-2.5 py-1 text-[11px] font-semibold text-success transition hover:bg-success/20 disabled:opacity-40">
            ✓ All present
          </button>
          <button onClick={() => onMarkDay(iso, day, "missed")} disabled={isHoliday}
            className="rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-[11px] font-semibold text-destructive transition hover:bg-destructive/20 disabled:opacity-40">
            ✕ All absent
          </button>
          <button onClick={() => onToggleHoliday(iso)}
            className="rounded-full border border-border bg-background/40 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground hover:border-primary">
            {isHoliday ? "Unmark Holiday" : "Holiday"}
          </button>
        </div>
      </div>

      <div className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          opacity: isHoliday ? 0.45 : 1, pointerEvents: isHoliday ? "none" : "auto" }}>
        {row.map((subj, idx) => {
          if (!subj.trim()) {
            return (
              <div key={idx} className="rounded-xl border border-dashed border-border/60 bg-background/20 p-3 text-center text-[11px] text-muted-foreground">
                <div className="opacity-70">{periods[idx]}</div>
                <div className="mt-1 opacity-40">Free</div>
              </div>
            );
          }
          const key = `${iso}__${idx}`;
          const st = states[key] ?? "attended";
          if (st === "cancelled") {
            return (
              <div key={idx} className="flex flex-col rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                <div className="text-[10px] uppercase tracking-widest opacity-70">{periods[idx]}</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="truncate line-through">{subj}</span>
                  <button onClick={() => onSetState(iso, idx, "attended")}
                    className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground hover:bg-accent">
                    Undo
                  </button>
                </div>
                <div className="mt-1 text-[10px] opacity-70">Cancelled</div>
              </div>
            );
          }
          const attended = st === "attended";
          const color = attended ? "var(--color-success)" : "var(--color-danger)";
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSetState(iso, idx, attended ? "missed" : "attended")}
              className="press-card tilt-3d group relative overflow-hidden rounded-xl border p-3 text-left text-sm font-medium"
              style={{
                borderColor: `color-mix(in oklab, ${color} 55%, transparent)`,
                backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)`,
                color,
                boxShadow: `0 0 24px -10px ${color}, inset 0 0 0 1px color-mix(in oklab, ${color} 25%, transparent)`,
              }}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-widest opacity-80">{periods[idx]}</span>
                <span
                  role="button"
                  aria-label="Cancel this class"
                  title="Cancel this class"
                  onClick={(e) => { e.stopPropagation(); onSetState(iso, idx, "cancelled"); }}
                  className="cursor-pointer rounded-md border border-current/30 px-1.5 text-[10px] opacity-70 transition hover:opacity-100">
                  ✕
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
                  style={{ backgroundColor: color, color: "oklch(0.14 0.03 275)", boxShadow: `0 0 10px ${color}` }}>
                  {attended ? "✓" : "✕"}
                </span>
                <span className="truncate text-base">{subj}</span>
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-widest opacity-80">
                {attended ? "Attended · tap to mark absent" : "Absent · tap to mark present"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
});

/* ============================================================
   Undo Toast
   ============================================================ */
function UndoToast({ toast, onUndo, onDismiss }: {
  toast: { label: string; id: number } | null;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div key={toast.id} className="animate-toast-in pointer-events-auto flex items-center gap-3 rounded-full border px-4 py-2.5 text-sm text-foreground shadow-2xl backdrop-blur-md"
        style={{
          background: "color-mix(in oklab, var(--popover) 85%, transparent)",
          borderColor: "color-mix(in oklab, var(--neon-cyan) 50%, transparent)",
          boxShadow: "0 0 40px -8px var(--neon-magenta), 0 0 24px -6px var(--neon-cyan)",
        }}>
        <span className="text-muted-foreground">{toast.label}</span>
        <button onClick={onUndo}
          className="rounded-full px-3 py-1 text-xs font-bold text-primary-foreground transition hover:brightness-110"
          style={{ background: "var(--gradient-primary)" }}>
          Undo
        </button>
        <button onClick={onDismiss} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">✕</button>
      </div>
    </div>
  );
}

/* ============================================================
   History View — per-subject logs, filters, PDF/JPG export
   ============================================================ */
type HistoryEntry = {
  iso: string;
  dateLabel: string;
  day: DayKey;
  periodIdx: number;
  periodLabel: string;
  subject: string;
  status: "attended" | "missed" | "cancelled" | "holiday";
};

function HistoryView({ detailed }: { detailed: DetailedData }) {
  const [from, setFrom] = useState<string>(detailed.startDate);
  const [to, setTo] = useState<string>(todayISO());
  const [statusFilter, setStatusFilter] = useState<"all" | "attended" | "missed" | "cancelled" | "holiday">("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [exporting, setExporting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const holidaySet = useMemo(() => new Set(detailed.holidays), [detailed.holidays]);

  const allEntries = useMemo<HistoryEntry[]>(() => {
    const arr: HistoryEntry[] = [];
    const startISO = detailed.startDate;
    const endISO = todayISO();
    const s = new Date(startISO + "T00:00:00");
    const e = new Date(endISO + "T00:00:00");
    if (isNaN(s.getTime()) || e < s) return arr;
    const cur = new Date(s);
    while (cur <= e) {
      const iso = cur.toISOString().slice(0, 10);
      const day = DOW_TO_DAY[cur.getDay()];
      if (day) {
        const row = detailed.timetable[day] || [];
        const isHoliday = holidaySet.has(iso);
        row.forEach((subj, idx) => {
          if (!subj.trim()) return;
          const key = `${iso}__${idx}`;
          const st = isHoliday ? "holiday" : (detailed.states[key] ?? "attended");
          arr.push({
            iso, dateLabel: formatShortDate(cur), day,
            periodIdx: idx, periodLabel: detailed.periods[idx] ?? `P${idx + 1}`,
            subject: subj, status: st as HistoryEntry["status"],
          });
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return arr;
  }, [detailed, holidaySet]);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    allEntries.forEach((e) => set.add(e.subject));
    return Array.from(set).sort();
  }, [allEntries]);

  const filtered = useMemo(() => {
    return allEntries.filter((e) => {
      if (from && e.iso < from) return false;
      if (to && e.iso > to) return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (subjectFilter !== "all" && e.subject !== subjectFilter) return false;
      return true;
    });
  }, [allEntries, from, to, statusFilter, subjectFilter]);

  const perSubject = useMemo(() => {
    const map = new Map<string, { attended: number; missed: number; cancelled: number; total: number; trend: number[] }>();
    filtered.forEach((e) => {
      const s = map.get(e.subject) ?? { attended: 0, missed: 0, cancelled: 0, total: 0, trend: [] };
      if (e.status === "attended") { s.attended++; s.total++; }
      else if (e.status === "missed") { s.missed++; s.total++; }
      else if (e.status === "cancelled") s.cancelled++;
      if (e.status === "attended" || e.status === "missed") {
        s.trend.push(s.total > 0 ? Math.round((s.attended / s.total) * 1000) / 10 : 0);
      }
      map.set(e.subject, s);
    });
    return Array.from(map.entries())
      .map(([subject, s]) => ({ subject, ...s, pct: s.total > 0 ? Math.round((s.attended / s.total) * 1000) / 10 : 0 }))
      .sort((a, b) => a.subject.localeCompare(b.subject));
  }, [filtered]);


  const totals = useMemo(() => {
    let attended = 0, missed = 0, cancelled = 0, holiday = 0;
    filtered.forEach((e) => {
      if (e.status === "attended") attended++;
      else if (e.status === "missed") missed++;
      else if (e.status === "cancelled") cancelled++;
      else if (e.status === "holiday") holiday++;
    });
    const total = attended + missed;
    const pct = total > 0 ? Math.round((attended / total) * 1000) / 10 : 0;
    return { attended, missed, cancelled, holiday, total, pct };
  }, [filtered]);

  const exportPdf = useCallback(async () => {
    if (!printRef.current) return;
    setExporting(true);
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import("html2canvas"), import("jspdf"),
      ]);
      const node = printRef.current;
      const canvas = await html2canvas(node, {
        backgroundColor: "#0a0a1a", scale: 2, useCORS: true, logging: false,
      });
      const img = canvas.toDataURL("image/jpeg", 0.92);
      const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const ratio = canvas.width / canvas.height;
      const imgW = pw - 24, imgH = imgW / ratio;
      let y = 12, remaining = imgH;
      if (imgH <= ph - 24) {
        pdf.addImage(img, "JPEG", 12, y, imgW, imgH);
      } else {
        // Slice tall canvas across pages
        const pxPerPt = canvas.width / imgW;
        const pageContentH = ph - 24;
        const sliceCanvasH = Math.floor(pageContentH * pxPerPt);
        let sy = 0;
        while (sy < canvas.height) {
          const sh = Math.min(sliceCanvasH, canvas.height - sy);
          const slice = document.createElement("canvas");
          slice.width = canvas.width; slice.height = sh;
          slice.getContext("2d")!.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
          const sliceImg = slice.toDataURL("image/jpeg", 0.92);
          const sHpt = sh / pxPerPt;
          if (sy > 0) pdf.addPage();
          pdf.addImage(sliceImg, "JPEG", 12, 12, imgW, sHpt);
          sy += sh;
          remaining -= sHpt;
        }
      }
      pdf.save(`attendance-history-${todayISO()}.pdf`);
    } finally { setExporting(false); }
  }, []);

  const exportJpg = useCallback(async () => {
    if (!printRef.current) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(printRef.current, {
        backgroundColor: "#0a0a1a", scale: 2, useCORS: true, logging: false,
      });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `attendance-history-${todayISO()}.jpg`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }, "image/jpeg", 0.95);
    } finally { setExporting(false); }
  }, []);

  const statusColors: Record<HistoryEntry["status"], string> = {
    attended: "var(--color-success)",
    missed: "var(--color-danger)",
    cancelled: "var(--muted-foreground)",
    holiday: "var(--neon-magenta)",
  };

  return (
    <div className="glass-neon p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Attendance History</h2>
          <p className="text-xs text-muted-foreground sm:text-sm">Per-subject logs, filters, and downloadable report.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportJpg} disabled={exporting}
            className="press-card rounded-full border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50">
            {exporting ? "…" : "↓ JPG"}
          </button>
          <button onClick={exportPdf} disabled={exporting}
            className="press-card rounded-full px-4 py-2 text-xs font-bold text-primary-foreground transition disabled:opacity-50"
            style={{ background: "var(--gradient-primary)", boxShadow: "0 0 22px -6px var(--neon-magenta)" }}>
            {exporting ? "Exporting…" : "↓ PDF"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}
            className="mt-1 w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary">
            <option value="all">All</option>
            <option value="attended">Attended</option>
            <option value="missed">Missed</option>
            <option value="cancelled">Cancelled</option>
            <option value="holiday">Holiday</option>
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Subject</span>
          <select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary">
            <option value="all">All subjects</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      </div>

      {/* Printable region */}
      <div ref={printRef} className="mt-6 rounded-2xl p-4 sm:p-6" style={{ background: "oklch(0.14 0.03 275)" }}>
        <div className="mb-4 border-b border-border pb-3">
          <div className="text-lg font-bold text-foreground">AttendEdge · Attendance Report</div>
          <div className="text-xs text-muted-foreground">
            {from || detailed.startDate} → {to || todayISO()}
            {subjectFilter !== "all" && ` · ${subjectFilter}`}
            {statusFilter !== "all" && ` · ${statusFilter}`}
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SummaryTile label="Attendance" value={`${totals.pct}%`} color="var(--neon-cyan)" />
          <SummaryTile label="Attended" value={totals.attended} color="var(--color-success)" />
          <SummaryTile label="Missed" value={totals.missed} color="var(--color-danger)" />
          <SummaryTile label="Cancelled" value={totals.cancelled} color="var(--muted-foreground)" />
          <SummaryTile label="Holidays" value={totals.holiday} color="var(--neon-magenta)" />
        </div>

        {/* Attendance Alerts */}
        {(() => {
          const risky = perSubject.filter((p) => p.total > 0 && p.pct < 75);
          const warn = perSubject.filter((p) => p.total > 0 && p.pct >= 75 && p.pct < 80);
          if (risky.length === 0 && warn.length === 0) return null;
          return (
            <div className="mt-6">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--color-danger)" }}>
                ⚠ Attendance alerts
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {risky.map((p) => {
                  const needed = Math.max(0, Math.ceil(3 * p.total - 4 * p.attended));
                  return (
                    <div key={p.subject} className="flex items-center justify-between rounded-xl border p-3"
                      style={{
                        borderColor: "color-mix(in oklab, var(--color-danger) 45%, transparent)",
                        background: "color-mix(in oklab, var(--color-danger) 10%, transparent)",
                        boxShadow: "0 0 24px -14px var(--color-danger)",
                      }}>
                      <div>
                        <div className="text-sm font-semibold text-foreground">{p.subject}</div>
                        <div className="text-xs text-muted-foreground">Attend {needed} more in a row to reach 75%</div>
                      </div>
                      <div className="text-xl font-bold" style={{ color: "var(--color-danger)", textShadow: "0 0 12px var(--color-danger)" }}>{p.pct}%</div>
                    </div>
                  );
                })}
                {warn.map((p) => (
                  <div key={p.subject} className="flex items-center justify-between rounded-xl border p-3"
                    style={{
                      borderColor: "color-mix(in oklab, var(--color-warning) 45%, transparent)",
                      background: "color-mix(in oklab, var(--color-warning) 8%, transparent)",
                    }}>
                    <div>
                      <div className="text-sm font-semibold text-foreground">{p.subject}</div>
                      <div className="text-xs text-muted-foreground">Cutting it close — stay above 75%</div>
                    </div>
                    <div className="text-xl font-bold" style={{ color: "var(--color-warning)" }}>{p.pct}%</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Per subject */}
        <h3 className="mt-6 mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Per subject</h3>
        {perSubject.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No data for these filters.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-background/85 backdrop-blur text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Trend</th>
                  <th className="px-3 py-2 text-right">Attended</th>
                  <th className="px-3 py-2 text-right">Missed</th>
                  <th className="px-3 py-2 text-right">Cancelled</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {perSubject.map((r) => {
                  const c = r.pct >= 75 ? "var(--color-success)" : r.pct >= 65 ? "var(--color-warning)" : "var(--color-danger)";
                  return (
                    <tr key={r.subject} className="border-t border-border">
                      <td className="px-3 py-2 font-medium text-foreground">{r.subject}</td>
                      <td className="px-3 py-2"><TrendSparkline data={r.trend} color={c} /></td>
                      <td className="px-3 py-2 text-right text-foreground">{r.attended}</td>
                      <td className="px-3 py-2 text-right text-foreground">{r.missed}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{r.cancelled}</td>
                      <td className="px-3 py-2 text-right text-foreground">{r.total}</td>
                      <td className="px-3 py-2 text-right font-bold" style={{ color: c }}>{r.pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}


        {/* Detailed log */}
        <h3 className="mt-6 mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">Full log</h3>
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No entries.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-background/85 backdrop-blur text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Day</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2">Subject</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr key={`${e.iso}-${e.periodIdx}-${i}`} className="border-t border-border">
                    <td className="px-3 py-1.5 text-foreground">{e.dateLabel}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{e.day}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{e.periodLabel}</td>
                    <td className="px-3 py-1.5 text-foreground">{e.subject}</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest"
                        style={{
                          color: statusColors[e.status],
                          background: `color-mix(in oklab, ${statusColors[e.status]} 15%, transparent)`,
                          border: `1px solid color-mix(in oklab, ${statusColors[e.status]} 40%, transparent)`,
                        }}>
                        {e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-[10px] text-muted-foreground">
          Generated {new Date().toLocaleString()} · Threshold 75%
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-xl border p-3 tilt-3d"
      style={{
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${color} 8%, transparent)`,
        boxShadow: `0 0 24px -14px ${color}`,
      }}>
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold" style={{ color, textShadow: `0 0 16px ${color}` }}>{value}</div>
    </div>
  );
}

function TrendSparkline({ data, color, width = 120, height = 32 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (!data || data.length === 0) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const w = width, h = height, pad = 2;
  const n = data.length;
  const xs = (i: number) => (n === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const ys = (v: number) => h - pad - (Math.max(0, Math.min(100, v)) / 100) * (h - 2 * pad);
  const path = data.map((v, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(" ");
  const area = `${path} L${xs(n - 1).toFixed(1)},${h - pad} L${xs(0).toFixed(1)},${h - pad} Z`;
  const last = data[n - 1];
  const threshY = ys(75);
  const uid = `spk-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        <defs>
          <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={threshY} x2={w} y2={threshY} stroke="currentColor" strokeOpacity="0.3" strokeDasharray="2 3" className="text-muted-foreground" />
        <path d={area} fill={`url(#${uid})`} />
        <path d={path} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx={xs(n - 1)} cy={ys(last)} r="2.5" fill={color} />
      </svg>
      <span className="text-[10px] font-medium tabular-nums text-muted-foreground">n={n}</span>
    </div>
  );
}

/* ============================================================
   Skeleton shown before IndexedDB hydration completes
   ============================================================ */
function ContentSkeleton() {
  return (
    <div className="glass p-4 sm:p-6">
      <div className="mb-4 flex gap-3">
        <div className="h-6 w-32 animate-pulse rounded-full bg-primary/10" />
        <div className="ml-auto h-6 w-24 animate-pulse rounded-full bg-primary/10" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-primary/5" style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Bulk Edit Panel — grid select + floating action bar + undo
   ============================================================ */
function BulkEditPanel({
  detailed, setDetailed, captureUndo,
}: {
  detailed: DetailedData;
  setDetailed: (u: DetailedData | ((d: DetailedData) => DetailedData)) => void;
  captureUndo: (label: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const applyBulk = useCallback((status: BulkStatus | "holiday") => {
    if (selected.size === 0) return;
    captureUndo(`Bulk: ${status} · ${selected.size} cell${selected.size === 1 ? "" : "s"}`);
    setDetailed((d) => {
      if (status === "holiday") {
        // Add every unique date in selection to holidays
        const days = new Set<string>();
        selected.forEach((k) => days.add(k.split("__")[0]));
        const nextHolidays = Array.from(new Set([...d.holidays, ...days]));
        return { ...d, holidays: nextHolidays };
      }
      const nextStates: ClassState = { ...d.states };
      selected.forEach((k) => { nextStates[k] = status; });
      return { ...d, states: nextStates };
    });
    setSelected(new Set());
  }, [selected, setDetailed, captureUndo]);

  return (
    <div className="mt-5 animate-fade-in">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Drag across cells, or click a row/column header to select. Hold <kbd className="rounded border border-border bg-background/60 px-1">Shift</kbd> while dragging to add to your current selection.
        </span>
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="rounded-full border border-border bg-background/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground transition-colors duration-200 hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      <BulkGrid
        startDate={detailed.startDate}
        timetable={detailed.timetable}
        periods={detailed.periods}
        states={detailed.states}
        holidays={detailed.holidays}
        selected={selected}
        onSelectedChange={setSelected}
      />
      <BulkActionBar
        count={selected.size}
        onApply={applyBulk}
        onClear={() => setSelected(new Set())}
      />
    </div>
  );
}

