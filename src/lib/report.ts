// Attendance report generator — PDF + JPG with clean branded layout.

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

// ------------------------------------------------------------------
// PDF — carefully aligned, branded
// ------------------------------------------------------------------
export async function downloadPdfReport(state: AppStateLike) {
  const s = computeSummary(state);
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 44;
  let y = 0;

  const rgb = (hex: string): [number, number, number] => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const setColor = (hex: string) => { const [r, g, b] = rgb(hex); doc.setTextColor(r, g, b); };
  const setFill = (hex: string) => { const [r, g, b] = rgb(hex); doc.setFillColor(r, g, b); };
  const setDraw = (hex: string) => { const [r, g, b] = rgb(hex); doc.setDrawColor(r, g, b); };
  const ensureRoom = (h: number) => { if (y + h > H - M) { doc.addPage(); drawPageHeader(); } };

  // Fonts — jsPDF built-in helvetica used to guarantee crisp text.
  // Heading uses helvetica bold (visual proxy for Google Sans Bold).
  // Body uses helvetica normal (visual proxy for Poppins).
  const HEAD = "helvetica";
  const BODY = "helvetica";

  const drawPageHeader = () => {
    // Full-bleed branded header band
    setFill("#0B1220");
    doc.rect(0, 0, W, 96, "F");
    // Accent bar
    setFill("#22D3EE");
    doc.rect(0, 96, W, 3, "F");

    // Logo mark — filled rounded square
    setFill("#8B5CF6");
    doc.roundedRect(M, 28, 40, 40, 8, 8, "F");
    doc.setFont(HEAD, "bold");
    doc.setFontSize(22);
    setColor("#FFFFFF");
    doc.text("A", M + 12, 56);

    // Wordmark
    doc.setFont(HEAD, "bold");
    doc.setFontSize(22);
    setColor("#F8FAFC");
    doc.text("AttendEdge", M + 54, 52);
    doc.setFont(BODY, "normal");
    doc.setFontSize(10);
    setColor("#94A3B8");
    doc.text("Smart Student Attendance Tracker", M + 54, 68);

    // Right-aligned meta
    doc.setFont(BODY, "normal");
    doc.setFontSize(9);
    setColor("#CBD5E1");
    const genLine = `Generated ${new Date().toLocaleString()}`;
    const periodLine = `${s.startDate}  →  ${s.endDate}`;
    doc.text(genLine, W - M, 52, { align: "right" });
    doc.text(periodLine, W - M, 68, { align: "right" });

    y = 128;
  };

  drawPageHeader();

  // ---------- Hero metric card ----------
  const cardX = M, cardW = W - 2 * M, cardH = 128;
  setFill("#F8FAFC"); doc.roundedRect(cardX, y, cardW, cardH, 12, 12, "F");
  setDraw("#E2E8F0"); doc.roundedRect(cardX, y, cardW, cardH, 12, 12, "S");

  const color = s.pct >= 80 ? "#16A34A" : s.pct >= 75 ? "#CA8A04" : "#DC2626";
  setColor(color);
  doc.setFont(HEAD, "bold");
  doc.setFontSize(64);
  doc.text(`${s.pct}%`, cardX + 24, y + 82);

  setColor("#64748B");
  doc.setFont(BODY, "normal");
  doc.setFontSize(9);
  doc.text("OVERALL ATTENDANCE", cardX + 24, y + 28);

  // Right side stats — column-aligned
  const rightX = cardX + cardW - 24;
  const statLines: [string, string, string][] = [
    ["Attended", `${s.attended}`, "#16A34A"],
    ["Missed", `${s.missed}`, "#DC2626"],
    ["Cancelled", `${s.cancelled}`, "#64748B"],
    ["Holidays", `${s.holiday}`, "#7C3AED"],
  ];
  const colW = 90;
  statLines.forEach(([label, val, c], i) => {
    const x = rightX - (statLines.length - 1 - i) * colW;
    setColor("#64748B"); doc.setFont(BODY, "normal"); doc.setFontSize(8);
    doc.text(label.toUpperCase(), x, y + 32, { align: "right" });
    setColor(c); doc.setFont(HEAD, "bold"); doc.setFontSize(20);
    doc.text(val, x, y + 58, { align: "right" });
  });

  // Insight strip inside card
  setFill(s.pct < 75 ? "#FEF2F2" : "#F0FDF4");
  doc.roundedRect(cardX + 16, y + cardH - 34, cardW - 32, 22, 6, 6, "F");
  setColor(s.pct < 75 ? "#B91C1C" : "#15803D");
  doc.setFont(HEAD, "bold"); doc.setFontSize(10);
  doc.text(
    s.pct < 75
      ? `Attend ${s.target} more classes in a row to reach 75%.`
      : `You can safely skip up to ${s.safe} classes and stay above 75%.`,
    cardX + 26, y + cardH - 19,
  );
  y += cardH + 22;

  // ---------- Per-subject table ----------
  if (s.perSubject.length) {
    ensureRoom(60);
    setColor("#0F172A"); doc.setFont(HEAD, "bold"); doc.setFontSize(14);
    doc.text("Per-subject breakdown", M, y); y += 16;

    const cols = {
      subject: M + 12,
      attended: M + cardW - 300,
      missed: M + cardW - 220,
      total: M + cardW - 140,
      pct: M + cardW - 12,
    };

    // Table header
    setFill("#0F172A"); doc.roundedRect(M, y, cardW, 26, 6, 6, "F");
    setColor("#F8FAFC"); doc.setFont(HEAD, "bold"); doc.setFontSize(9);
    doc.text("SUBJECT", cols.subject, y + 17);
    doc.text("ATTENDED", cols.attended, y + 17, { align: "right" });
    doc.text("MISSED", cols.missed, y + 17, { align: "right" });
    doc.text("TOTAL", cols.total, y + 17, { align: "right" });
    doc.text("%", cols.pct, y + 17, { align: "right" });
    y += 26;

    s.perSubject.forEach((p, i) => {
      ensureRoom(22);
      if (i % 2 === 1) { setFill("#F8FAFC"); doc.rect(M, y, cardW, 22, "F"); }
      setColor("#0F172A"); doc.setFont(BODY, "normal"); doc.setFontSize(10);
      doc.text(String(p.subject).slice(0, 46), cols.subject, y + 15);
      doc.text(String(p.attended), cols.attended, y + 15, { align: "right" });
      doc.text(String(p.missed), cols.missed, y + 15, { align: "right" });
      doc.text(String(p.total), cols.total, y + 15, { align: "right" });
      const pc = p.pct >= 80 ? "#16A34A" : p.pct >= 75 ? "#CA8A04" : "#DC2626";
      setColor(pc); doc.setFont(HEAD, "bold");
      doc.text(`${p.pct}%`, cols.pct, y + 15, { align: "right" });
      y += 22;
    });
    setDraw("#E2E8F0"); doc.line(M, y, M + cardW, y);
    y += 20;
  }

  // ---------- Alerts (subjects < 75%) ----------
  const risky = s.perSubject.filter((p) => p.pct < 75 && p.total > 0);
  if (risky.length) {
    ensureRoom(40);
    setColor("#B91C1C"); doc.setFont(HEAD, "bold"); doc.setFontSize(14);
    doc.text("⚠ Attendance alerts", M, y); y += 16;
    risky.forEach((p) => {
      ensureRoom(28);
      setFill("#FEF2F2"); doc.roundedRect(M, y, cardW, 24, 6, 6, "F");
      setColor("#7F1D1D"); doc.setFont(HEAD, "bold"); doc.setFontSize(10);
      doc.text(p.subject, M + 12, y + 16);
      const needed = Math.max(0, Math.ceil(3 * p.total - 4 * p.attended));
      setColor("#991B1B"); doc.setFont(BODY, "normal");
      doc.text(
        `${p.pct}% — attend ${needed} more in a row to reach 75%`,
        M + cardW - 12, y + 16, { align: "right" },
      );
      y += 28;
    });
    y += 12;
  }

  // ---------- Class log ----------
  if (s.entries.length) {
    ensureRoom(60);
    setColor("#0F172A"); doc.setFont(HEAD, "bold"); doc.setFontSize(14);
    doc.text("Class log", M, y); y += 16;

    const cols = {
      date: M + 12,
      period: M + 120,
      subject: M + 220,
      status: M + cardW - 12,
    };
    setFill("#0F172A"); doc.roundedRect(M, y, cardW, 24, 6, 6, "F");
    setColor("#F8FAFC"); doc.setFont(HEAD, "bold"); doc.setFontSize(9);
    doc.text("DATE", cols.date, y + 16);
    doc.text("PERIOD", cols.period, y + 16);
    doc.text("SUBJECT", cols.subject, y + 16);
    doc.text("STATUS", cols.status, y + 16, { align: "right" });
    y += 24;

    const rows = [...s.entries].reverse();
    rows.forEach((e, i) => {
      ensureRoom(18);
      if (i % 2 === 1) { setFill("#F8FAFC"); doc.rect(M, y, cardW, 16, "F"); }
      setColor("#0F172A"); doc.setFont(BODY, "normal"); doc.setFontSize(9);
      doc.text(e.iso, cols.date, y + 12);
      doc.text(String(e.periodLabel).slice(0, 18), cols.period, y + 12);
      doc.text(String(e.subject).slice(0, 34), cols.subject, y + 12);
      const sc =
        e.status === "attended" ? "#16A34A" :
        e.status === "missed" ? "#DC2626" :
        e.status === "cancelled" ? "#64748B" : "#7C3AED";
      setColor(sc); doc.setFont(HEAD, "bold");
      doc.text(e.status.toUpperCase(), cols.status, y + 12, { align: "right" });
      y += 16;
    });
  }

  // Footer on every page
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    setColor("#94A3B8"); doc.setFont(BODY, "normal"); doc.setFontSize(8);
    doc.text("AttendEdge · attendedge.app", M, H - 18);
    doc.text(`Page ${i} of ${pageCount}`, W - M, H - 18, { align: "right" });
  }

  doc.save(`attendance-report-${todayISO()}.pdf`);
}

// ------------------------------------------------------------------
// Image (JPG) — branded summary card
// ------------------------------------------------------------------
async function ensureFontsReady() {
  try {
    const anyDoc: any = document;
    if (anyDoc?.fonts?.load) {
      await Promise.all([
        anyDoc.fonts.load('700 48px "Google Sans"'),
        anyDoc.fonts.load('700 16px "Poppins"'),
        anyDoc.fonts.load('400 14px "Poppins"'),
      ]);
      await anyDoc.fonts.ready;
    }
  } catch { /* ignore */ }
}

export async function downloadImageReport(state: AppStateLike) {
  const s = computeSummary(state);
  await ensureFontsReady();

  const scale = 2;
  const W = 900;
  const PAD = 48;
  const HEAD_H = 260;
  const ROW = 26;
  const perSubH = s.perSubject.length ? 60 + s.perSubject.length * ROW + 20 : 0;
  const risky = s.perSubject.filter((p) => p.pct < 75 && p.total > 0);
  const alertsH = risky.length ? 60 + risky.length * 40 + 20 : 0;
  const logRows = Math.min(s.entries.length, 60);
  const logH = logRows ? 60 + logRows * 22 + 20 : 0;
  const H = HEAD_H + perSubH + alertsH + logH + PAD + 60;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale; canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  const HEAD_FONT = '"Google Sans", "Poppins", system-ui, sans-serif';
  const BODY_FONT = '"Poppins", "Inter", system-ui, sans-serif';

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#0B1220");
  grad.addColorStop(0.5, "#1E1B4B");
  grad.addColorStop(1, "#0B1220");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = "rgba(148,163,184,0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }

  // Header band
  const headGrad = ctx.createLinearGradient(0, 0, W, 0);
  headGrad.addColorStop(0, "rgba(139,92,246,0.25)");
  headGrad.addColorStop(1, "rgba(34,211,238,0.25)");
  ctx.fillStyle = headGrad; ctx.fillRect(0, 0, W, 110);
  ctx.fillStyle = "#22D3EE"; ctx.fillRect(0, 110, W, 2);

  // Logo mark
  ctx.fillStyle = "#8B5CF6";
  roundRect(ctx, PAD, 30, 48, 48, 10); ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.font = `700 26px ${HEAD_FONT}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("A", PAD + 24, 55);
  ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";

  // Wordmark
  ctx.fillStyle = "#F8FAFC";
  ctx.font = `700 28px ${HEAD_FONT}`;
  ctx.fillText("AttendEdge", PAD + 64, 58);
  ctx.fillStyle = "#94A3B8";
  ctx.font = `400 12px ${BODY_FONT}`;
  ctx.fillText("Smart Student Attendance Tracker", PAD + 64, 78);

  // Right meta
  ctx.fillStyle = "#CBD5E1";
  ctx.font = `400 11px ${BODY_FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${s.startDate}  →  ${s.endDate}`, W - PAD, 58);
  ctx.fillText(`Generated ${new Date().toLocaleString()}`, W - PAD, 76);
  ctx.textAlign = "start";

  // Hero card
  const cardY = 138, cardH = 100;
  ctx.fillStyle = "rgba(15,23,42,0.55)";
  roundRect(ctx, PAD, cardY, W - PAD * 2, cardH, 14); ctx.fill();
  ctx.strokeStyle = "rgba(148,163,184,0.2)"; ctx.stroke();

  ctx.fillStyle = "#94A3B8";
  ctx.font = `500 10px ${BODY_FONT}`;
  ctx.fillText("OVERALL ATTENDANCE", PAD + 24, cardY + 26);

  const color = s.pct >= 80 ? "#4ADE80" : s.pct >= 75 ? "#FBBF24" : "#F87171";
  ctx.fillStyle = color;
  ctx.font = `700 64px ${HEAD_FONT}`;
  ctx.fillText(`${s.pct}%`, PAD + 22, cardY + 82);

  // Right stats — grid aligned
  const stats: [string, string, string][] = [
    ["Attended", `${s.attended}`, "#4ADE80"],
    ["Missed", `${s.missed}`, "#F87171"],
    ["Cancelled", `${s.cancelled}`, "#94A3B8"],
    ["Holidays", `${s.holiday}`, "#C084FC"],
  ];
  const rightEdge = W - PAD - 24;
  const colGap = 110;
  ctx.textAlign = "right";
  stats.forEach(([lab, val, c], i) => {
    const x = rightEdge - (stats.length - 1 - i) * colGap;
    ctx.fillStyle = "#94A3B8";
    ctx.font = `500 10px ${BODY_FONT}`;
    ctx.fillText(lab.toUpperCase(), x, cardY + 34);
    ctx.fillStyle = c;
    ctx.font = `700 22px ${HEAD_FONT}`;
    ctx.fillText(val, x, cardY + 66);
  });
  ctx.textAlign = "start";

  // Insight pill
  ctx.fillStyle = s.pct < 75 ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)";
  roundRect(ctx, PAD, cardY + cardH + 12, W - PAD * 2, 32, 10); ctx.fill();
  ctx.fillStyle = s.pct < 75 ? "#FCA5A5" : "#86EFAC";
  ctx.font = `600 13px ${HEAD_FONT}`;
  ctx.fillText(
    s.pct < 75
      ? `⚠ Attend ${s.target} more classes in a row to reach 75%`
      : `✓ You can safely skip up to ${s.safe} classes`,
    PAD + 16, cardY + cardH + 33,
  );

  let y = HEAD_H + 20;

  // Per-subject block
  if (s.perSubject.length) {
    ctx.fillStyle = "#F8FAFC";
    ctx.font = `700 18px ${HEAD_FONT}`;
    ctx.fillText("Per-subject", PAD, y); y += 24;

    // Column headers
    ctx.fillStyle = "#64748B";
    ctx.font = `500 10px ${BODY_FONT}`;
    ctx.fillText("SUBJECT", PAD + 12, y);
    ctx.textAlign = "right";
    ctx.fillText("ATTENDED", W - PAD - 220, y);
    ctx.fillText("TOTAL", W - PAD - 120, y);
    ctx.fillText("%", W - PAD - 20, y);
    ctx.textAlign = "start";
    y += 8;
    ctx.strokeStyle = "rgba(148,163,184,0.2)";
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(W - PAD, y); ctx.stroke();
    y += 10;

    s.perSubject.forEach((p, i) => {
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        ctx.fillRect(PAD, y - 14, W - PAD * 2, ROW - 4);
      }
      ctx.fillStyle = "#F1F5F9";
      ctx.font = `500 13px ${BODY_FONT}`;
      ctx.fillText(p.subject.slice(0, 44), PAD + 12, y);
      ctx.fillStyle = "#CBD5E1";
      ctx.font = `400 13px ${BODY_FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(`${p.attended}`, W - PAD - 220, y);
      ctx.fillText(`${p.total}`, W - PAD - 120, y);
      ctx.fillStyle = p.pct >= 80 ? "#4ADE80" : p.pct >= 75 ? "#FBBF24" : "#F87171";
      ctx.font = `700 14px ${HEAD_FONT}`;
      ctx.fillText(`${p.pct}%`, W - PAD - 20, y);
      ctx.textAlign = "start";
      y += ROW;
    });
    y += 18;
  }

  // Alerts
  if (risky.length) {
    ctx.fillStyle = "#FCA5A5";
    ctx.font = `700 18px ${HEAD_FONT}`;
    ctx.fillText("⚠ Attendance alerts", PAD, y); y += 20;
    risky.forEach((p) => {
      ctx.fillStyle = "rgba(239,68,68,0.12)";
      roundRect(ctx, PAD, y, W - PAD * 2, 32, 8); ctx.fill();
      ctx.fillStyle = "#FECACA";
      ctx.font = `600 13px ${HEAD_FONT}`;
      ctx.fillText(p.subject, PAD + 14, y + 20);
      const needed = Math.max(0, Math.ceil(3 * p.total - 4 * p.attended));
      ctx.fillStyle = "#FEE2E2";
      ctx.font = `400 12px ${BODY_FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(`${p.pct}% · attend ${needed} more in a row`, W - PAD - 14, y + 20);
      ctx.textAlign = "start";
      y += 40;
    });
    y += 12;
  }

  // Recent log
  if (logRows) {
    ctx.fillStyle = "#F8FAFC";
    ctx.font = `700 18px ${HEAD_FONT}`;
    ctx.fillText("Recent classes", PAD, y); y += 22;
    ctx.strokeStyle = "rgba(148,163,184,0.2)";
    ctx.beginPath(); ctx.moveTo(PAD, y - 8); ctx.lineTo(W - PAD, y - 8); ctx.stroke();
    const rows = [...s.entries].reverse().slice(0, logRows);
    rows.forEach((e, i) => {
      if (i % 2 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.03)";
        ctx.fillRect(PAD, y - 12, W - PAD * 2, 20);
      }
      ctx.fillStyle = "#CBD5E1"; ctx.font = `400 12px ${BODY_FONT}`;
      ctx.fillText(e.iso, PAD + 12, y);
      ctx.fillStyle = "#94A3B8";
      ctx.fillText(String(e.periodLabel).slice(0, 14), PAD + 130, y);
      ctx.fillStyle = "#E2E8F0";
      ctx.fillText(e.subject.slice(0, 34), PAD + 240, y);
      const sc =
        e.status === "attended" ? "#4ADE80" :
        e.status === "missed" ? "#F87171" :
        e.status === "cancelled" ? "#94A3B8" : "#C084FC";
      ctx.fillStyle = sc; ctx.font = `700 11px ${HEAD_FONT}`;
      ctx.textAlign = "right";
      ctx.fillText(e.status.toUpperCase(), W - PAD - 12, y);
      ctx.textAlign = "start";
      y += 22;
    });
  }

  // Footer
  ctx.fillStyle = "#64748B";
  ctx.font = `400 11px ${BODY_FONT}`;
  ctx.fillText("AttendEdge · attendedge.app", PAD, H - 20);
  ctx.textAlign = "right";
  ctx.fillText("Threshold 75%", W - PAD, H - 20);
  ctx.textAlign = "start";

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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
