import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";
const DOW_TO_DAY: Record<number, DayKey | undefined> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat" };
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

type Timetable = Record<DayKey, string[]>;
type ClassState = Record<string, "attended" | "missed" | "cancelled">;
export type BulkStatus = "attended" | "missed" | "cancelled";

export type BulkCell = { iso: string; periodIdx: number };
const cellKey = (c: BulkCell) => `${c.iso}__${c.periodIdx}`;

interface Props {
  startDate: string;
  timetable: Timetable;
  periods: string[];
  states: ClassState;
  holidays: string[];
  selected: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
}

function statusColor(st: BulkStatus | "empty" | "holiday") {
  switch (st) {
    case "attended":  return "var(--color-success)";
    case "missed":    return "var(--color-danger)";
    case "cancelled": return "var(--muted-foreground)";
    case "holiday":   return "var(--neon-magenta)";
    default:          return "var(--border)";
  }
}

/** Grid: rows = dates (newest first), cols = periods. Drag / shift-click to select. */
export const BulkGrid = memo(function BulkGrid({
  startDate, timetable, periods, states, holidays, selected, onSelectedChange,
}: Props) {
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);

  const rows = useMemo(() => {
    const out: { iso: string; day: DayKey; label: string; cells: (string | null)[] }[] = [];
    const start = new Date(startDate + "T00:00:00");
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00");
    if (isNaN(start.getTime()) || today < start) return out;
    const cur = new Date(start);
    while (cur <= today) {
      const dk = DOW_TO_DAY[cur.getDay()];
      if (dk) {
        const row = timetable[dk] || [];
        if (row.some((s) => s.trim())) {
          const iso = cur.toISOString().slice(0, 10);
          out.push({
            iso, day: dk,
            label: `${MONTHS[cur.getMonth()]} ${cur.getDate()}`,
            cells: row.map((s) => (s.trim() ? s : null)),
          });
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
    return out.reverse();
  }, [startDate, timetable]);

  // Drag selection state
  const dragRef = useRef<null | {
    startRow: number; startCol: number;
    additive: boolean;
    base: Set<string>;
  }>(null);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);

  const applyDrag = useCallback((r: number, c: number) => {
    const d = dragRef.current;
    if (!d) return;
    const rMin = Math.min(d.startRow, r), rMax = Math.max(d.startRow, r);
    const cMin = Math.min(d.startCol, c), cMax = Math.max(d.startCol, c);
    const next = new Set(d.base);
    for (let i = rMin; i <= rMax; i++) {
      const row = rows[i]; if (!row) continue;
      if (holidaySet.has(row.iso)) continue;
      for (let j = cMin; j <= cMax; j++) {
        if (!row.cells[j]) continue; // skip free periods
        next.add(cellKey({ iso: row.iso, periodIdx: j }));
      }
    }
    onSelectedChange(next);
  }, [rows, holidaySet, onSelectedChange]);

  const onDown = (r: number, c: number, e: React.PointerEvent, additive: boolean) => {
    const row = rows[r]; if (!row || !row.cells[c]) return;
    if (holidaySet.has(row.iso)) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startRow: r, startCol: c, additive, base: additive ? new Set(selected) : new Set() };
    applyDrag(r, c);
  };
  const onEnter = (r: number, c: number) => {
    setHover({ row: r, col: c });
    if (dragRef.current) applyDrag(r, c);
  };
  const onUp = () => { dragRef.current = null; };

  useEffect(() => {
    const up = () => onUp();
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const toggleRow = (r: number) => {
    const row = rows[r]; if (!row) return;
    const next = new Set(selected);
    const inRow = row.cells.map((c, i) => (c ? cellKey({ iso: row.iso, periodIdx: i }) : null)).filter(Boolean) as string[];
    const allIn = inRow.every((k) => next.has(k));
    inRow.forEach((k) => (allIn ? next.delete(k) : next.add(k)));
    if (!holidaySet.has(row.iso) || allIn) onSelectedChange(next);
  };
  const toggleCol = (c: number) => {
    const next = new Set(selected);
    const inCol: string[] = [];
    rows.forEach((row) => {
      if (row.cells[c] && !holidaySet.has(row.iso)) inCol.push(cellKey({ iso: row.iso, periodIdx: c }));
    });
    const allIn = inCol.every((k) => next.has(k));
    inCol.forEach((k) => (allIn ? next.delete(k) : next.add(k)));
    onSelectedChange(next);
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Set a start date and fill the timetable — the grid appears here.
      </div>
    );
  }

  return (
    <div className="relative overflow-auto rounded-2xl border border-border" style={{ maxHeight: 640 }}>
      <table className="w-full border-collapse text-xs select-none" style={{ minWidth: 120 + periods.length * 108 }}>
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 bg-background/95 backdrop-blur px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground border-b border-border">
              Date
            </th>
            {periods.map((p, ci) => (
              <th key={ci}
                onClick={() => toggleCol(ci)}
                className="cursor-pointer bg-background/95 backdrop-blur px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground hover:text-primary border-b border-border transition-colors"
                title={`Select column ${p}`}
              >
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => {
            const isHol = holidaySet.has(row.iso);
            return (
              <tr key={row.iso}>
                <th
                  onClick={() => toggleRow(ri)}
                  className="sticky left-0 z-10 bg-card/85 backdrop-blur px-2 py-1.5 text-left align-middle border-b border-border/60 cursor-pointer hover:text-primary transition-colors"
                  title="Select this row"
                >
                  <div className="text-[11px] font-semibold text-foreground">{row.label}</div>
                  <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{row.day}{isHol ? " · Hol" : ""}</div>
                </th>
                {row.cells.map((subj, ci) => {
                  const key = cellKey({ iso: row.iso, periodIdx: ci });
                  const isSel = selected.has(key);
                  if (!subj) {
                    return <td key={ci} className="border-b border-border/40 bg-background/20" />;
                  }
                  const st: BulkStatus | "holiday" = isHol ? "holiday" : (states[key] ?? "attended");
                  const c = statusColor(st);
                  return (
                    <td
                      key={ci}
                      onPointerDown={(e) => onDown(ri, ci, e, e.shiftKey || e.ctrlKey || e.metaKey)}
                      onPointerEnter={() => onEnter(ri, ci)}
                      className="border-b border-border/40 p-1 transition-colors duration-200"
                      style={{
                        cursor: isHol ? "not-allowed" : "pointer",
                        background: isSel
                          ? "color-mix(in oklab, var(--neon-cyan) 22%, transparent)"
                          : hover?.row === ri && hover?.col === ci
                            ? "color-mix(in oklab, var(--neon-cyan) 8%, transparent)"
                            : undefined,
                        outline: isSel ? "1.5px solid var(--neon-cyan)" : undefined,
                        outlineOffset: isSel ? "-2px" : undefined,
                      }}
                    >
                      <div
                        className="flex flex-col rounded-md px-1.5 py-1 transition-all duration-200"
                        style={{
                          background: `color-mix(in oklab, ${c} 14%, transparent)`,
                          border: `1px solid color-mix(in oklab, ${c} 40%, transparent)`,
                          color: c,
                        }}
                      >
                        <span className="truncate text-[10px] font-semibold">{subj}</span>
                        <span className="text-[9px] uppercase tracking-widest opacity-70">
                          {st === "holiday" ? "hol" : st.slice(0, 4)}
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
