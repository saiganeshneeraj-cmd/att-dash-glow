import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

export const Route = createFileRoute("/")({
  component: AttendancePage,
});

type Mode = "quick" | "detailed";
type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";
const DAYS: DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const DAY_INDEX: Record<DayKey, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };

type Timetable = Record<DayKey, string[]>;
// classState key: `${YYYY-MM-DD}__${slotIndex}` -> "attended" | "missed" | "removed"
type ClassState = Record<string, "attended" | "missed" | "removed">;

interface QuickData { total: number; attended: number; }
interface DetailedData { startDate: string; timetable: Timetable; states: ClassState; }

const LS_KEY = "attendedge_v1";

const emptyTimetable = (): Timetable => ({ Mon: [], Tue: [], Wed: [], Thu: [], Fri: [] });

const todayISO = () => new Date().toISOString().slice(0, 10);

function loadState() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function AttendancePage() {
  const [mode, setMode] = useState<Mode>("quick");
  const [quick, setQuick] = useState<QuickData>({ total: 0, attended: 0 });
  const [detailed, setDetailed] = useState<DetailedData>({
    startDate: todayISO(),
    timetable: emptyTimetable(),
    states: {},
  });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const s = loadState();
    if (s) {
      if (s.mode) setMode(s.mode);
      if (s.quick) setQuick(s.quick);
      if (s.detailed) setDetailed({ ...s.detailed, timetable: { ...emptyTimetable(), ...s.detailed.timetable } });
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(LS_KEY, JSON.stringify({ mode, quick, detailed }));
  }, [mode, quick, detailed, hydrated]);

  // ---- Derived: totals ----
  const { total, attended } = useMemo(() => {
    if (mode === "quick") {
      const t = Math.max(0, Math.floor(quick.total || 0));
      const a = Math.min(t, Math.max(0, Math.floor(quick.attended || 0)));
      return { total: t, attended: a };
    }
    // detailed: iterate each date from startDate up to today, for each weekday's slots
    const start = new Date(detailed.startDate + "T00:00:00");
    const end = new Date(todayISO() + "T00:00:00");
    if (isNaN(start.getTime()) || end < start) return { total: 0, attended: 0 };
    let t = 0, a = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay(); // 0 Sun ... 6 Sat
      const dayKey = (Object.entries(DAY_INDEX).find(([, v]) => v === dow)?.[0]) as DayKey | undefined;
      if (dayKey) {
        const slots = detailed.timetable[dayKey] || [];
        const iso = cur.toISOString().slice(0, 10);
        slots.forEach((_, idx) => {
          const st = detailed.states[`${iso}__${idx}`] ?? "attended";
          if (st === "removed") return;
          t += 1;
          if (st === "attended") a += 1;
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return { total: t, attended: a };
  }, [mode, quick, detailed]);

  const pct = total > 0 ? Math.round(((attended / total) * 100) * 10) / 10 : 0;
  const status = pct < 75 ? "danger" : pct < 80 ? "warn" : "good";
  const statusText = status === "danger" ? "In Danger" : status === "warn" ? "On the Edge" : "Good Position";
  const statusColor = status === "danger" ? "var(--color-danger)" : status === "warn" ? "var(--color-warning)" : "var(--color-success)";

  // target: consecutive classes to attend to reach 75%
  const target = total === 0 ? 0 : Math.max(0, Math.ceil(3 * total - 4 * attended));
  // safe skip
  const safe = total === 0 ? 0 : Math.max(0, Math.floor((4 * attended - 3 * total) / 3));

  return (
    <main className="min-h-screen w-full px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-6xl">
        <Header mode={mode} setMode={setMode} />

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
          Data saved locally in your browser. Threshold: 75%.
        </footer>
      </div>
    </main>
  );
}

/* ---------------- Header ---------------- */
function Header({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-3xl font-bold sm:text-4xl">
          <span className="text-gradient">AttendEdge</span>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{today}</p>
      </div>
      <div className="inline-flex rounded-full border border-border bg-card p-1 backdrop-blur-md">
        {(["quick", "detailed"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
              mode === m
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {m === "quick" ? "Quick Entry" : "Calendar Tracker"}
          </button>
        ))}
      </div>
    </header>
  );
}

/* ---------------- Hero Ring ---------------- */
function HeroRing({ pct, statusText, statusColor, total, attended }: { pct: number; statusText: string; statusColor: string; total: number; attended: number }) {
  const size = 240;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const dash = (clamped / 100) * c;

  return (
    <div className="glass animate-pop-in flex flex-col items-center justify-center p-6 sm:p-8">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke="var(--color-muted)" fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            stroke={statusColor}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${dash} ${c - dash}`}
            style={{ transition: "stroke-dasharray 700ms cubic-bezier(0.2,0.9,0.3,1.1), stroke 300ms" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-5xl font-bold tracking-tight" style={{ color: statusColor }}>
            {pct.toFixed(1)}<span className="text-2xl">%</span>
          </div>
          <div className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">Attendance</div>
        </div>
      </div>
      <div
        className="mt-6 rounded-full px-4 py-1.5 text-sm font-semibold"
        style={{ backgroundColor: `color-mix(in oklab, ${statusColor} 18%, transparent)`, color: statusColor, border: `1px solid color-mix(in oklab, ${statusColor} 40%, transparent)` }}
      >
        {statusText}
      </div>
      <div className="mt-4 flex gap-6 text-center">
        <div>
          <div className="text-2xl font-bold text-foreground">{attended}</div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Attended</div>
        </div>
        <div className="h-10 w-px bg-border" />
        <div>
          <div className="text-2xl font-bold text-foreground">{total}</div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Total</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Insights ---------------- */
function InsightsPanel({ status, target, safe, total }: { status: string; target: number; safe: number; total: number }) {
  const targetActive = status === "danger";
  const safeActive = status !== "danger";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <InsightCard
        active={targetActive}
        color="var(--color-danger)"
        eyebrow="Target to Safety"
        big={target}
        unit={target === 1 ? "class" : "classes"}
        detail={total === 0 ? "Enter data to see your target." : `Attend the next ${target} classes consecutively to reach 75%.`}
      />
      <InsightCard
        active={safeActive}
        color="var(--color-success)"
        eyebrow="Safe Skip Margin"
        big={safe}
        unit={safe === 1 ? "class" : "classes"}
        detail={total === 0 ? "Enter data to see how many you can skip." : `You can afford to skip ${safe} upcoming classes.`}
      />
    </div>
  );
}

function InsightCard({ active, color, eyebrow, big, unit, detail }: { active: boolean; color: string; eyebrow: string; big: number; unit: string; detail: string }) {
  return (
    <div
      className="glass relative overflow-hidden p-6 transition-all"
      style={{
        opacity: active ? 1 : 0.55,
        transform: active ? "translateY(0)" : "translateY(2px)",
        borderColor: active ? `color-mix(in oklab, ${color} 55%, transparent)` : undefined,
        boxShadow: active ? `0 0 60px -20px ${color}` : undefined,
      }}
    >
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{eyebrow}</div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="text-5xl font-bold" style={{ color }}>{big}</div>
        <div className="text-sm text-muted-foreground">{unit}</div>
      </div>
      <p className="mt-3 text-sm text-foreground/80">{detail}</p>
    </div>
  );
}

/* ---------------- Quick Form ---------------- */
function QuickForm({ quick, setQuick }: { quick: QuickData; setQuick: (q: QuickData) => void }) {
  return (
    <div className="glass p-6 sm:p-8">
      <h2 className="text-xl font-semibold">Quick Entry</h2>
      <p className="mt-1 text-sm text-muted-foreground">Enter your current totals. The dashboard updates instantly.</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Total Classes Held"
          value={quick.total}
          onChange={(v) => setQuick({ total: v, attended: Math.min(v, quick.attended) })}
        />
        <NumberField
          label="Classes Attended"
          value={quick.attended}
          max={quick.total}
          onChange={(v) => setQuick({ ...quick, attended: Math.min(quick.total, Math.max(0, v)) })}
        />
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, max }: { label: string; value: number; onChange: (v: number) => void; max?: number }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-2xl font-semibold text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/40"
      />
    </label>
  );
}

/* ---------------- Detailed Tracker ---------------- */
function DetailedTracker({ detailed, setDetailed }: { detailed: DetailedData; setDetailed: (d: DetailedData) => void }) {
  const addSlot = (day: DayKey) => {
    const next = { ...detailed.timetable, [day]: [...detailed.timetable[day], `Class ${detailed.timetable[day].length + 1}`] };
    setDetailed({ ...detailed, timetable: next });
  };
  const removeSlot = (day: DayKey, idx: number) => {
    const next = { ...detailed.timetable, [day]: detailed.timetable[day].filter((_, i) => i !== idx) };
    setDetailed({ ...detailed, timetable: next });
  };
  const renameSlot = (day: DayKey, idx: number, name: string) => {
    const arr = [...detailed.timetable[day]];
    arr[idx] = name;
    setDetailed({ ...detailed, timetable: { ...detailed.timetable, [day]: arr } });
  };

  const dates = useMemo(() => {
    const arr: { iso: string; day: DayKey; label: string }[] = [];
    const start = new Date(detailed.startDate + "T00:00:00");
    const end = new Date(todayISO() + "T00:00:00");
    if (isNaN(start.getTime()) || end < start) return arr;
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay();
      const dayKey = (Object.entries(DAY_INDEX).find(([, v]) => v === dow)?.[0]) as DayKey | undefined;
      if (dayKey && detailed.timetable[dayKey].length > 0) {
        arr.push({
          iso: cur.toISOString().slice(0, 10),
          day: dayKey,
          label: cur.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return arr.reverse();
  }, [detailed.startDate, detailed.timetable]);

  const setClassState = (iso: string, idx: number, st: "attended" | "missed" | "removed") => {
    setDetailed({ ...detailed, states: { ...detailed.states, [`${iso}__${idx}`]: st } });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      {/* Timetable setup */}
      <div className="glass p-6">
        <h2 className="text-xl font-semibold">Setup</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose your start date and build your weekly timetable.</p>

        <label className="mt-5 block">
          <span className="text-xs uppercase tracking-widest text-muted-foreground">Class Start Date</span>
          <input
            type="date"
            value={detailed.startDate}
            max={todayISO()}
            onChange={(e) => setDetailed({ ...detailed, startDate: e.target.value })}
            className="mt-2 w-full rounded-xl border border-border bg-input px-4 py-3 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/40"
          />
        </label>

        <div className="mt-5 space-y-4">
          {DAYS.map((day) => (
            <div key={day} className="rounded-xl border border-border/60 bg-background/30 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-foreground">{day}</div>
                <button
                  onClick={() => addSlot(day)}
                  className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/25"
                >
                  + Add class
                </button>
              </div>
              {detailed.timetable[day].length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">No classes.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {detailed.timetable[day].map((name, idx) => (
                    <li key={idx} className="flex gap-2">
                      <input
                        value={name}
                        onChange={(e) => renameSlot(day, idx, e.target.value)}
                        className="flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                      <button
                        onClick={() => removeSlot(day, idx)}
                        aria-label="Remove slot"
                        className="rounded-lg border border-border bg-background/40 px-3 text-sm text-muted-foreground hover:border-danger hover:text-danger"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Daily grid */}
      <div className="glass p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Daily Log</h2>
            <p className="mt-1 text-sm text-muted-foreground">Tap a class to toggle attended / missed. Use ✕ to mark a holiday or cancellation.</p>
          </div>
        </div>

        {dates.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Add classes to your weekly timetable to generate a daily checklist.
          </div>
        ) : (
          <div className="mt-5 max-h-[600px] space-y-4 overflow-y-auto pr-1">
            {dates.map(({ iso, day, label }) => (
              <div key={iso}>
                <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">{day}</span>
                  {label}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {detailed.timetable[day].map((name, idx) => {
                    const key = `${iso}__${idx}`;
                    const st = detailed.states[key] ?? "attended";
                    if (st === "removed") {
                      return (
                        <div key={idx} className="flex items-center justify-between rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                          <span className="line-through">{name}</span>
                          <button
                            onClick={() => setClassState(iso, idx, "attended")}
                            className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground hover:bg-accent"
                          >
                            Restore
                          </button>
                        </div>
                      );
                    }
                    const attended = st === "attended";
                    const color = attended ? "var(--color-success)" : "var(--color-danger)";
                    return (
                      <div
                        key={idx}
                        className="group relative flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-medium transition-all"
                        style={{
                          borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
                          backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)`,
                          color,
                        }}
                      >
                        <button
                          onClick={() => setClassState(iso, idx, attended ? "missed" : "attended")}
                          className="flex-1 text-left"
                        >
                          <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                          {name}
                          <span className="ml-2 text-xs opacity-80">{attended ? "Attended" : "Missed"}</span>
                        </button>
                        <button
                          onClick={() => setClassState(iso, idx, "removed")}
                          aria-label="Mark as holiday / removed"
                          title="Remove (holiday / cancelled)"
                          className="ml-3 rounded-md border border-current/30 px-2 py-1 text-xs opacity-70 hover:opacity-100"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
