// Attendance report generator — produces a real PDF/JPG (not JSON)
// with headline %, per-subject stats and full history log.

type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
const DOW_TO_DAY: Record<number, DayKey | undefined> = {
  1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat",
};

export interface DetailedLike {
  startDate: string;
  periods: string[];
  timetable: Record<DayKey, string[]>;
  states: Record<string, "attended" | "missed" | "cancelled">;
  holidays: string[];
}

export interface AppStateLike {
  mode: "quick" | "detailed" | "history";
  quick: { total: number; attended: number };
  detailed: DetailedLike;
}

interface Entry {
  iso: string;
  day: DayKey;
  periodIdx: number;
  periodLabel: string;
  subject: string;
  status: "attended" | "missed" | "cancelled" | "holiday";
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function buildEntries(d: DetailedLike): Entry[] {
  const holidays = new Set(d.holidays);
  const start = new Date(d.startDate + "T00:00:00");
  const end = new Date(todayISO() + "T00:00:00");
  const out: Entry[] = [];
  if (isNaN(start.getTime()) || end < start) return out;
  const cur = new Date(start);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    const day = DOW_TO_DAY[cur.getDay()];
    if (day) {
      const row = d.timetable[day] || [];
      const isHoliday = holidays.has(iso);
      row.forEach((subj, idx) => {
        if (!subj.trim()) return;
        const st = isHoliday ? "holiday" : (d.states[`${iso}__${idx}`] ?? "attended");
        out.push({
          iso, day, periodIdx: idx,
          periodLabel: d.periods[idx] ?? `P${idx + 1}`,
          subject: subj, status: st,
        });
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export interface ReportSummary {
  total: number;
  attended: number;
  missed: number;
  cancelled: number;
  holiday: number;
  pct: number;
  target: number;
  safe: number;
  perSubject: { subject: string; attended: number; missed: number; total: number; pct: number }[];
  entries: Entry[];
  startDate: string;
  endDate: string;
}

export function computeSummary(state: AppStateLike): ReportSummary {
  if (state.mode === "quick") {
    const t = Math.max(0, Math.floor(state.quick.total || 0));
    const a = Math.min(t, Math.max(0, Math.floor(state.quick.attended || 0)));
    const pct = t > 0 ? Math.round((a / t) * 1000) / 10 : 0;
    return {
      total: t, attended: a, missed: t - a, cancelled: 0, holiday: 0, pct,
      target: t === 0 ? 0 : Math.max(0, Math.ceil(3 * t - 4 * a)),
      safe: t === 0 ? 0 : Math.max(0, Math.floor((4 * a - 3 * t) / 3)),
      perSubject: [], entries: [],
      startDate: "-", endDate: todayISO(),
    };
  }
  const entries = buildEntries(state.detailed);
  let attended = 0, missed = 0, cancelled = 0, holiday = 0;
  const map = new Map<string, { attended: number; missed: number; total: number }>();
  for (const e of entries) {
    if (e.status === "attended") attended++;
    else if (e.status === "missed") missed++;
    else if (e.status === "cancelled") cancelled++;
    else if (e.status === "holiday") holiday++;
    if (e.status === "attended" || e.status === "missed") {
      const s = map.get(e.subject) ?? { attended: 0, missed: 0, total: 0 };
      if (e.status === "attended") s.attended++;
      else s.missed++;
      s.total++;
      map.set(e.subject, s);
    }
  }
  const total = attended + missed;
  const pct = total > 0 ? Math.round((attended / total) * 1000) / 10 : 0;
  const perSubject = Array.from(map.entries())
    .map(([subject, s]) => ({ subject, ...s, pct: s.total > 0 ? Math.round((s.attended / s.total) * 1000) / 10 : 0 }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
  return {
    total, attended, missed, cancelled, holiday, pct,
    target: total === 0 ? 0 : Math.max(0, Math.ceil(3 * total - 4 * attended)),
    safe: total === 0 ? 0 : Math.max(0, Math.floor((4 * attended - 3 * total) / 3)),
    perSubject, entries,
    startDate: state.detailed.startDate,
    endDate: todayISO(),
  };
}

export function summaryToText(s: ReportSummary): string {
  const lines = [
    `AttendEdge — Attendance Summary`,
    `Period: ${s.startDate} → ${s.endDate}`,
    ``,
    `Attendance: ${s.pct}%  (${s.attended}/${s.total})`,
    s.pct < 75
      ? `Need ${s.target} consecutive classes to hit 75%.`
      : `Safe to skip up to ${s.safe} classes.`,
    ``,
  ];
  if (s.perSubject.length) {
    lines.push(`Per subject:`);
    s.perSubject.forEach((p) => lines.push(`  • ${p.subject}: ${p.pct}%  (${p.attended}/${p.total})`));
  }
  return lines.join("\n");
}

async function loadJsPDF() {
  const mod = await import("jspdf");
  return mod.default;
}

export async function downloadPdfReport(state: AppStateLike) {
  const s = computeSummary(state);
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 40;
  let y = M;

  const setColor = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    doc.setTextColor(r, g, b);
  };
  const setFill = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    doc.setFillColor(r, g, b);
  };
  const ensureRoom = (h: number) => {
    if (y + h > H - M) { doc.addPage(); y = M; }
  };

  // Header band
  setFill("#0F172A");
  doc.rect(0, 0, W, 90, "F");
  setColor("#22D3EE");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.text("AttendEdge", M, 42);
  setColor("#E2E8F0");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Attendance report — ${s.startDate} → ${s.endDate}`, M, 62);
  doc.text(`Generated ${new Date().toLocaleString()}`, M, 78);
  y = 120;

  // Headline metric
  const color = s.pct >= 80 ? "#22C55E" : s.pct >= 75 ? "#EAB308" : "#EF4444";
  setColor(color);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(52);
  doc.text(`${s.pct}%`, M, y + 20);
  setColor("#111827");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(`Attended ${s.attended} of ${s.total} classes`, M + 160, y);
  doc.text(`Missed: ${s.missed}    Cancelled: ${s.cancelled}    Holidays: ${s.holiday}`, M + 160, y + 16);
  doc.setFont("helvetica", "bold");
  doc.text(
    s.pct < 75
      ? `Attend ${s.target} more classes in a row to reach 75%.`
      : `You can safely skip up to ${s.safe} classes.`,
    M + 160, y + 34,
  );
  y += 60;

  // Per-subject table
  if (s.perSubject.length) {
    ensureRoom(40);
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    setColor("#0F172A"); doc.text("Per-subject breakdown", M, y); y += 14;
    setFill("#F1F5F9"); doc.rect(M, y, W - 2 * M, 22, "F");
    doc.setFontSize(10); setColor("#334155");
    doc.text("Subject", M + 8, y + 15);
    doc.text("Attended", M + 250, y + 15);
    doc.text("Missed", M + 320, y + 15);
    doc.text("Total", M + 380, y + 15);
    doc.text("%", W - M - 40, y + 15);
    y += 22;
    doc.setFont("helvetica", "normal"); setColor("#0F172A");
    s.perSubject.forEach((p, i) => {
      ensureRoom(20);
      if (i % 2 === 1) { setFill("#F8FAFC"); doc.rect(M, y, W - 2 * M, 18, "F"); }
      setColor("#0F172A");
      doc.text(String(p.subject).slice(0, 42), M + 8, y + 13);
      doc.text(String(p.attended), M + 250, y + 13);
      doc.text(String(p.missed), M + 320, y + 13);
      doc.text(String(p.total), M + 380, y + 13);
      const pc = p.pct >= 80 ? "#16A34A" : p.pct >= 75 ? "#CA8A04" : "#DC2626";
      setColor(pc); doc.setFont("helvetica", "bold");
      doc.text(`${p.pct}%`, W - M - 40, y + 13);
      doc.setFont("helvetica", "normal");
      y += 18;
    });
    y += 12;
  }

  // Full log
  if (s.entries.length) {
    ensureRoom(40);
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    setColor("#0F172A"); doc.text("Class log", M, y); y += 14;
    setFill("#F1F5F9"); doc.rect(M, y, W - 2 * M, 22, "F");
    doc.setFontSize(10); setColor("#334155");
    doc.text("Date", M + 8, y + 15);
    doc.text("Period", M + 110, y + 15);
    doc.text("Subject", M + 210, y + 15);
    doc.text("Status", W - M - 60, y + 15);
    y += 22;
    doc.setFont("helvetica", "normal");
    // newest first
    const rows = [...s.entries].reverse();
    rows.forEach((e, i) => {
      ensureRoom(16);
      if (i % 2 === 1) { setFill("#F8FAFC"); doc.rect(M, y, W - 2 * M, 14, "F"); }
      setColor("#0F172A");
      doc.text(e.iso, M + 8, y + 11);
      doc.text(String(e.periodLabel).slice(0, 20), M + 110, y + 11);
      doc.text(String(e.subject).slice(0, 32), M + 210, y + 11);
      const sc =
        e.status === "attended" ? "#16A34A" :
        e.status === "missed" ? "#DC2626" :
        e.status === "cancelled" ? "#64748B" : "#7C3AED";
      setColor(sc); doc.setFont("helvetica", "bold");
      doc.text(e.status.toUpperCase(), W - M - 60, y + 11);
      doc.setFont("helvetica", "normal");
      y += 14;
    });
  }

  doc.save(`attendance-report-${todayISO()}.pdf`);
}

export async function downloadImageReport(state: AppStateLike) {
  const s = computeSummary(state);
  const scale = 2;
  const W = 820, PADDING = 40;
  const rowH = 22, headerH = 260;
  const perSubH = s.perSubject.length ? 40 + s.perSubject.length * rowH + 20 : 0;
  const logH = s.entries.length ? 40 + Math.min(s.entries.length, 60) * 18 + 20 : 0;
  const H = headerH + perSubH + logH + PADDING;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0B1220");
  grad.addColorStop(1, "#1E1B4B");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = "#22D3EE";
  ctx.font = "bold 34px Inter, sans-serif";
  ctx.fillText("AttendEdge", PADDING, 60);
  ctx.fillStyle = "#94A3B8";
  ctx.font = "13px Inter, sans-serif";
  ctx.fillText(`${s.startDate} → ${s.endDate}   ·   Generated ${new Date().toLocaleString()}`, PADDING, 84);

  // Big percentage
  const color = s.pct >= 80 ? "#22C55E" : s.pct >= 75 ? "#F59E0B" : "#EF4444";
  ctx.fillStyle = color;
  ctx.font = "bold 96px Space Grotesk, Inter, sans-serif";
  ctx.fillText(`${s.pct}%`, PADDING, 200);
  ctx.fillStyle = "#E2E8F0";
  ctx.font = "16px Inter, sans-serif";
  ctx.fillText(`Attended ${s.attended} / ${s.total} classes`, PADDING + 220, 160);
  ctx.fillText(`Missed ${s.missed}  ·  Cancelled ${s.cancelled}  ·  Holidays ${s.holiday}`, PADDING + 220, 184);
  ctx.fillStyle = "#F0ABFC";
  ctx.font = "bold 15px Inter, sans-serif";
  ctx.fillText(
    s.pct < 75
      ? `Attend ${s.target} more in a row to reach 75%`
      : `You can safely skip up to ${s.safe} classes`,
    PADDING + 220, 210,
  );

  let y = headerH;

  // Per-subject
  if (s.perSubject.length) {
    ctx.fillStyle = "#E2E8F0";
    ctx.font = "bold 18px Inter, sans-serif";
    ctx.fillText("Per-subject", PADDING, y); y += 24;
    ctx.font = "12px Inter, sans-serif";
    s.perSubject.forEach((p) => {
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(PADDING, y - 14, W - PADDING * 2, rowH - 4);
      ctx.fillStyle = "#F1F5F9";
      ctx.fillText(p.subject.slice(0, 40), PADDING + 8, y);
      ctx.fillText(`${p.attended}/${p.total}`, W - PADDING - 140, y);
      ctx.fillStyle = p.pct >= 80 ? "#4ADE80" : p.pct >= 75 ? "#FBBF24" : "#F87171";
      ctx.font = "bold 13px Inter, sans-serif";
      ctx.fillText(`${p.pct}%`, W - PADDING - 60, y);
      ctx.font = "12px Inter, sans-serif";
      y += rowH;
    });
    y += 12;
  }

  // Log (last 60)
  if (s.entries.length) {
    ctx.fillStyle = "#E2E8F0";
    ctx.font = "bold 18px Inter, sans-serif";
    ctx.fillText("Recent classes", PADDING, y); y += 22;
    ctx.font = "12px Inter, sans-serif";
    const rows = [...s.entries].reverse().slice(0, 60);
    rows.forEach((e) => {
      ctx.fillStyle = "#CBD5E1";
      ctx.fillText(e.iso, PADDING + 8, y);
      ctx.fillText(e.subject.slice(0, 30), PADDING + 130, y);
      const sc =
        e.status === "attended" ? "#4ADE80" :
        e.status === "missed" ? "#F87171" :
        e.status === "cancelled" ? "#94A3B8" : "#C084FC";
      ctx.fillStyle = sc;
      ctx.font = "bold 12px Inter, sans-serif";
      ctx.fillText(e.status.toUpperCase(), W - PADDING - 90, y);
      ctx.font = "12px Inter, sans-serif";
      y += 18;
    });
  }

  await new Promise<void>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance-report-${todayISO()}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      resolve();
    }, "image/jpeg", 0.95);
  });
}
