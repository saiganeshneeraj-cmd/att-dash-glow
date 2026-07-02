import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/")({
  component: AttendancePage,
});

/* ============================================================
   Data model
   ------------------------------------------------------------
   The timetable is a grid: DAYS x PERIODS.
   Each cell stores a subject name (empty string = no class).
   Each period counts as ONE class (a subject spanning 2 periods = 2 classes).
   ============================================================ */

type Mode = "quick" | "detailed";
type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
const DAYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// JS getDay(): Sun=0, Mon=1, ... Sat=6
const DAY_TO_DOW: Record<DayKey, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const DOW_TO_DAY: Record<number, DayKey | undefined> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };

type Timetable = Record<DayKey, string[]>; // length = periods.length
type ClassState = Record<string, "attended" | "missed" | "cancelled">; // key: `${iso}__${periodIdx}`

interface QuickData { total: number; attended: number; }
interface DetailedData {
  startDate: string;
  periods: string[];       // labels e.g. "09:00-09:45"
  timetable: Timetable;    // subject per day/period
  states: ClassState;
  holidays: string[];      // ISO dates that count as full holidays
}

const LS_KEY = "attendedge_v2";
const todayISO = () => new Date().toISOString().slice(0, 10);

const DEFAULT_PERIODS = [
  "09:00-09:45",
  "09:45-10:30",
  "10:30-11:15",
  "11:15-12:00",
  "01:30-02:15",
  "02:15-03:00",
  "03:00-03:45",
  "03:45-04:30",
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

function loadState() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* ---------- Date formatting (SSR-safe, locale-independent) ---------- */
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
function formatLongDate(d: Date) {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function formatShortDate(d: Date) {
  return `${WEEKDAYS[d.getDay()].slice(0,3)}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/* ============================================================
   Page
   ============================================================ */
function AttendancePage() {
  const [mode, setMode] = useState<Mode>("quick");
  const [quick, setQuick] = useState<QuickData>({ total: 0, attended: 0 });
  const [detailed, setDetailed] = useState<DetailedData>(defaultDetailed());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const s = loadState();
    if (s) {
      if (s.mode) setMode(s.mode);
      if (s.quick) setQuick(s.quick);
      if (s.detailed) {
        const d = s.detailed as DetailedData;
        // Migration: ensure timetable rows match period count
        const nP = d.periods?.length || DEFAULT_PERIODS.length;
        const tt = emptyTimetable(nP);
        for (const day of DAYS) {
          const row = d.timetable?.[day] || [];
          for (let i = 0; i < nP; i++) tt[day][i] = row[i] ?? "";
        }
        setDetailed({
          startDate: d.startDate || todayISO(),
          periods: d.periods?.length ? d.periods : [...DEFAULT_PERIODS],
          timetable: tt,
          states: d.states || {},
          holidays: d.holidays || [],
        });
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(LS_KEY, JSON.stringify({ mode, quick, detailed }));
  }, [mode, quick, detailed, hydrated]);

  /* ---- Totals ---- */
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

  const pct = total > 0 ? Math.round((attended / total) * 1000) / 10 : 0;
  const status = pct < 75 ? "danger" : pct < 80 ? "warn" : "good";
  const statusText = status === "danger" ? "In Danger" : status === "warn" ? "On the Edge" : "Good Position";
  const statusColor = status === "danger" ? "var(--color-danger)" : status === "warn" ? "var(--color-warning)" : "var(--color-success)";
  const target = total === 0 ? 0 : Math.max(0, Math.ceil(3 * total - 4 * attended));
  const safe = total === 0 ? 0 : Math.max(0, Math.floor((4 * attended - 3 * total) / 3));

  return (
    <main className="relative min-h-screen w-full overflow-hidden px-4 py-6 sm:px-6 sm:py-10">
      {/* Ambient neon blobs */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-float absolute -left-32 top-10 h-96 w-96 rounded-full opacity-40 blur-3xl" style={{ background: "var(--neon-cyan)" }} />
        <div className="animate-float absolute -right-40 top-1/3 h-[28rem] w-[28rem] rounded-full opacity-30 blur-3xl" style={{ background: "var(--neon-magenta)", animationDelay: "-4s" }} />
        <div className="animate-float absolute bottom-0 left-1/3 h-96 w-96 rounded-full opacity-25 blur-3xl" style={{ background: "var(--neon-lime)", animationDelay: "-8s" }} />
      </div>

      <div className="mx-auto w-full max-w-6xl">
        <Header mode={mode} setMode={setMode} hydrated={hydrated} />

        <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <HeroRing pct={pct} statusText={statusText} statusColor={statusColor} total={total} attended={attended} />
          <InsightsPanel status={status} target={target} safe={safe} total={total} />
        </section>

        <section className="mt-6 animate-fade-in">
          {mode === "quick" ? (
            <QuickForm quick={quick} setQuick={setQuick} />
          ) : (
            <DetailedTracker detailed={detailed} setDetailed={setDetailed} />
          )}
        </section>

        <footer className="mt-10 pb-4 text-center text-xs text-muted-foreground">
          Saved locally in your browser · Threshold: 75%
        </footer>
      </div>
    </main>
  );
}

/* ============================================================
   Header
   ============================================================ */
function Header({ mode, setMode, hydrated }: { mode: Mode; setMode: (m: Mode) => void; hydrated: boolean }) {
  const [today, setToday] = useState<string>("");
  useEffect(() => { setToday(formatLongDate(new Date())); }, []);
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:flex sm:flex-wrap sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-3xl font-bold sm:text-4xl">
          <span className="text-gradient">AttendEdge</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{hydrated ? today : "\u00A0"}</p>
      </div>
      <div className="shrink-0 inline-flex rounded-full border border-border bg-card p-1 backdrop-blur-md">
        {(["quick", "detailed"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full px-3 py-2 text-xs font-medium transition-all sm:px-4 sm:text-sm ${
              mode === m
                ? "text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
            style={mode === m ? { background: "var(--gradient-primary)" } : undefined}
          >
            {m === "quick" ? "Quick" : "Timetable"}
          </button>
        ))}
      </div>
    </header>
  );
}

/* ============================================================
   Hero Ring
   ============================================================ */
function HeroRing({ pct, statusText, statusColor, total, attended }: { pct: number; statusText: string; statusColor: string; total: number; attended: number }) {
  const size = 240;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const dash = (clamped / 100) * c;

  return (
    <div className="glass-neon animate-pop-in flex flex-col items-center justify-center overflow-hidden p-6 sm:p-8">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" style={{ filter: `drop-shadow(0 0 14px ${statusColor})` }}>
          <defs>
            <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--neon-cyan)" />
              <stop offset="50%" stopColor="var(--neon-magenta)" />
              <stop offset="100%" stopColor="var(--neon-lime)" />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke="color-mix(in oklab, white 8%, transparent)" fill="none" />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            strokeWidth={stroke} stroke={statusColor} strokeLinecap="round" fill="none"
            strokeDasharray={`${dash} ${c - dash}`}
            style={{ transition: "stroke-dasharray 800ms cubic-bezier(0.2,0.9,0.3,1.1), stroke 300ms" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-5xl font-bold tracking-tight" style={{ color: statusColor, textShadow: `0 0 24px ${statusColor}` }}>
            {pct.toFixed(1)}<span className="text-2xl">%</span>
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Attendance</div>
        </div>
      </div>
      <div
        className="animate-neon-pulse mt-6 rounded-full px-4 py-1.5 text-sm font-semibold"
        style={{
          backgroundColor: `color-mix(in oklab, ${statusColor} 15%, transparent)`,
          color: statusColor,
          border: `1px solid color-mix(in oklab, ${statusColor} 45%, transparent)`,
        }}
      >
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
}

/* ============================================================
   Insights
   ============================================================ */
function InsightsPanel({ status, target, safe, total }: { status: string; target: number; safe: number; total: number }) {
  const targetActive = status === "danger";
  const safeActive = status !== "danger";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <InsightCard active={targetActive} color="var(--color-danger)" eyebrow="Target to Safety" big={target} unit={target === 1 ? "class" : "classes"}
        detail={total === 0 ? "Enter data to see your target." : `Attend the next ${target} classes consecutively to reach 75%.`} />
      <InsightCard active={safeActive} color="var(--color-success)" eyebrow="Safe Skip Margin" big={safe} unit={safe === 1 ? "class" : "classes"}
        detail={total === 0 ? "Enter data to see how many you can skip." : `You can afford to skip ${safe} upcoming classes.`} />
    </div>
  );
}

function InsightCard({ active, color, eyebrow, big, unit, detail }: { active: boolean; color: string; eyebrow: string; big: number; unit: string; detail: string }) {
  return (
    <div
      className="glass relative overflow-hidden p-6 transition-all"
      style={{
        opacity: active ? 1 : 0.55,
        borderColor: active ? `color-mix(in oklab, ${color} 55%, transparent)` : undefined,
        boxShadow: active ? `0 0 50px -12px ${color}, inset 0 0 0 1px color-mix(in oklab, ${color} 30%, transparent)` : undefined,
      }}
    >
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
   Quick Form
   ============================================================ */
function QuickForm({ quick, setQuick }: { quick: QuickData; setQuick: (q: QuickData) => void }) {
  return (
    <div className="glass p-6 sm:p-8">
      <h2 className="text-xl font-semibold">Quick Entry</h2>
      <p className="mt-1 text-sm text-muted-foreground">Enter your current totals. The dashboard updates instantly.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <NumberField label="Total Classes Held" value={quick.total}
          onChange={(v) => setQuick({ total: v, attended: Math.min(v, quick.attended) })} />
        <NumberField label="Classes Attended" value={quick.attended} max={quick.total}
          onChange={(v) => setQuick({ ...quick, attended: Math.min(quick.total, Math.max(0, v)) })} />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">{label}</span>
      <input
        type="number" min={0} max={max}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-2xl font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40"
      />
    </label>
  );
}

/* ============================================================
   Detailed Tracker — Period grid + Holidays + Daily log
   ============================================================ */
function DetailedTracker({ detailed, setDetailed }: { detailed: DetailedData; setDetailed: (d: DetailedData) => void }) {
  const [tab, setTab] = useState<"setup" | "log">("setup");

  return (
    <div className="glass-neon overflow-hidden p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold">Weekly Timetable</h2>
          <p className="text-xs text-muted-foreground sm:text-sm">Fill periods like your college schedule. Each period = 1 class.</p>
        </div>
        <div className="inline-flex shrink-0 rounded-full border border-border bg-background/40 p-1">
          {(["setup", "log"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium transition ${tab === t ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              style={tab === t ? { background: "var(--gradient-primary)" } : undefined}>
              {t === "setup" ? "Setup" : "Daily Log"}
            </button>
          ))}
        </div>
      </div>

      {tab === "setup" ? (
        <SetupPanel detailed={detailed} setDetailed={setDetailed} />
      ) : (
        <LogPanel detailed={detailed} setDetailed={setDetailed} />
      )}
    </div>
  );
}

/* ---------- Setup: period grid ---------- */
function SetupPanel({ detailed, setDetailed }: { detailed: DetailedData; setDetailed: (d: DetailedData) => void }) {
  const setCell = (day: DayKey, idx: number, val: string) => {
    const row = [...detailed.timetable[day]];
    row[idx] = val;
    setDetailed({ ...detailed, timetable: { ...detailed.timetable, [day]: row } });
  };
  const setPeriodLabel = (idx: number, val: string) => {
    const p = [...detailed.periods]; p[idx] = val;
    setDetailed({ ...detailed, periods: p });
  };
  const addPeriod = () => {
    const p = [...detailed.periods, `P${detailed.periods.length + 1}`];
    const tt = { ...detailed.timetable };
    for (const d of DAYS) tt[d] = [...tt[d], ""];
    setDetailed({ ...detailed, periods: p, timetable: tt });
  };
  const removePeriod = (idx: number) => {
    if (detailed.periods.length <= 1) return;
    const p = detailed.periods.filter((_, i) => i !== idx);
    const tt = { ...detailed.timetable };
    for (const d of DAYS) tt[d] = tt[d].filter((_, i) => i !== idx);
    setDetailed({ ...detailed, periods: p, timetable: tt });
  };
  const resetToDefault = () => setDetailed({
    ...detailed,
    periods: [...DEFAULT_PERIODS],
    timetable: emptyTimetable(DEFAULT_PERIODS.length),
  });

  return (
    <div className="mt-5 animate-fade-in">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Class Start Date</span>
          <input type="date" value={detailed.startDate} max={todayISO()}
            onChange={(e) => setDetailed({ ...detailed, startDate: e.target.value })}
            className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/40" />
        </label>
        <div className="flex items-end justify-end gap-2">
          <button onClick={addPeriod} className="rounded-xl border border-border bg-background/40 px-3 py-2 text-xs font-medium text-foreground transition hover:border-primary">
            + Add Period
          </button>
          <button onClick={resetToDefault} className="rounded-xl border border-border bg-background/40 px-3 py-2 text-xs font-medium text-muted-foreground transition hover:text-danger hover:border-danger">
            Reset
          </button>
        </div>
      </div>

      {/* Timetable grid */}
      <div className="mt-5 -mx-2 overflow-x-auto pb-3 sm:mx-0">
        <div className="min-w-[720px] px-2 sm:px-0">
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `72px repeat(${detailed.periods.length}, minmax(120px, 1fr))` }}
          >
            {/* header row */}
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
            {/* day rows */}
            {DAYS.map((day) => (
              <RowFragment key={day} day={day} row={detailed.timetable[day]} onChange={(idx, v) => setCell(day, idx, v)} />
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Tip: For a subject that spans multiple periods (e.g. a lab), just repeat its name across those cells — each period counts as one class.
      </p>
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
          <input
            key={idx}
            value={cell}
            onChange={(e) => onChange(idx, e.target.value)}
            placeholder="—"
            className="rounded-lg border bg-input px-2 py-2.5 text-center text-xs font-medium outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40"
            style={{
              borderColor: filled ? "color-mix(in oklab, var(--neon-cyan) 40%, transparent)" : undefined,
              backgroundColor: filled ? "color-mix(in oklab, var(--neon-cyan) 8%, transparent)" : undefined,
              color: filled ? "oklch(0.98 0.02 200)" : undefined,
              boxShadow: filled ? "0 0 12px -6px var(--neon-cyan)" : undefined,
            }}
          />
        );
      })}
    </>
  );
}

/* ---------- Daily log ---------- */
function LogPanel({ detailed, setDetailed }: { detailed: DetailedData; setDetailed: (d: DetailedData) => void }) {
  const holidaySet = useMemo(() => new Set(detailed.holidays), [detailed.holidays]);

  const dates = useMemo(() => {
    const arr: { iso: string; day: DayKey; label: string }[] = [];
    const start = new Date(detailed.startDate + "T00:00:00");
    const end = new Date(todayISO() + "T00:00:00");
    if (isNaN(start.getTime()) || end < start) return arr;
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay();
      const dayKey = DOW_TO_DAY[dow];
      if (dayKey) {
        const row = detailed.timetable[dayKey] || [];
        if (row.some((s) => s.trim())) {
          arr.push({ iso: cur.toISOString().slice(0, 10), day: dayKey, label: formatShortDate(cur) });
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return arr.reverse();
  }, [detailed.startDate, detailed.timetable]);

  const setClassState = (iso: string, idx: number, st: "attended" | "missed" | "cancelled") => {
    setDetailed({ ...detailed, states: { ...detailed.states, [`${iso}__${idx}`]: st } });
  };

  const toggleHoliday = (iso: string) => {
    const has = holidaySet.has(iso);
    const next = has ? detailed.holidays.filter((d) => d !== iso) : [...detailed.holidays, iso];
    setDetailed({ ...detailed, holidays: next });
  };

  if (dates.length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Fill in subjects in the Setup tab to generate your daily log.
      </div>
    );
  }

  return (
    <div className="mt-5 max-h-[640px] space-y-5 overflow-y-auto pr-1 animate-fade-in">
      {dates.map(({ iso, day, label }) => {
        const isHoliday = holidaySet.has(iso);
        const row = detailed.timetable[day];
        return (
          <div key={iso}>
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
              <button onClick={() => toggleHoliday(iso)}
                className="rounded-full border border-border bg-background/40 px-3 py-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground hover:border-primary">
                {isHoliday ? "Unmark Holiday" : "Mark as Holiday"}
              </button>
            </div>

            <div
              className="grid gap-2"
              style={{
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                opacity: isHoliday ? 0.45 : 1,
                pointerEvents: isHoliday ? "none" : "auto",
              }}
            >
              {row.map((subj, idx) => {
                if (!subj.trim()) {
                  return (
                    <div key={idx} className="rounded-xl border border-dashed border-border/60 bg-background/20 p-3 text-center text-[11px] text-muted-foreground">
                      <div className="opacity-70">{detailed.periods[idx]}</div>
                      <div className="mt-1 opacity-40">Free</div>
                    </div>
                  );
                }
                const key = `${iso}__${idx}`;
                const st = detailed.states[key] ?? "attended";
                if (st === "cancelled") {
                  return (
                    <div key={idx} className="flex flex-col rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                      <div className="text-[10px] uppercase tracking-widest opacity-70">{detailed.periods[idx]}</div>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="truncate line-through">{subj}</span>
                        <button onClick={() => setClassState(iso, idx, "attended")}
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
                  <div
                    key={idx}
                    className="group relative overflow-hidden rounded-xl border p-3 text-sm font-medium transition-all"
                    style={{
                      borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
                      backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`,
                      color,
                      boxShadow: `0 0 20px -10px ${color}`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] uppercase tracking-widest opacity-80">{detailed.periods[idx]}</span>
                      <button onClick={() => setClassState(iso, idx, "cancelled")}
                        aria-label="Cancel this class"
                        title="Cancelled / removed"
                        className="rounded-md border border-current/30 px-1.5 text-[10px] opacity-70 transition hover:opacity-100">
                        ✕
                      </button>
                    </div>
                    <button onClick={() => setClassState(iso, idx, attended ? "missed" : "attended")}
                      className="mt-1 flex w-full items-center gap-2 text-left">
                      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />
                      <span className="truncate">{subj}</span>
                    </button>
                    <div className="mt-1 text-[10px] opacity-80">{attended ? "Attended · tap to toggle" : "Missed · tap to toggle"}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
