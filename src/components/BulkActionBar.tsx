import type { BulkStatus } from "./BulkGrid";

interface Props {
  count: number;
  onApply: (status: BulkStatus | "holiday") => void;
  onClear: () => void;
}

export function BulkActionBar({ count, onApply, onClear }: Props) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3">
      <div
        className="animate-toast-in pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-2 rounded-2xl border p-3 shadow-2xl backdrop-blur-xl"
        style={{
          background: "color-mix(in oklab, var(--popover) 90%, transparent)",
          borderColor: "color-mix(in oklab, var(--neon-cyan) 45%, transparent)",
          boxShadow: "0 0 60px -18px var(--neon-magenta), 0 20px 60px -20px rgba(0,0,0,0.75)",
        }}
      >
        <div className="flex-1 text-xs font-semibold text-foreground">
          <span className="text-gradient text-sm">{count}</span>{" "}
          <span className="text-muted-foreground">cell{count === 1 ? "" : "s"} selected</span>
        </div>
        <button
          onClick={() => onApply("attended")}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:brightness-110"
          style={{
            background: "color-mix(in oklab, var(--color-success) 18%, transparent)",
            color: "var(--color-success)",
            border: "1px solid color-mix(in oklab, var(--color-success) 55%, transparent)",
          }}
        >
          ✓ Present
        </button>
        <button
          onClick={() => onApply("missed")}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:brightness-110"
          style={{
            background: "color-mix(in oklab, var(--color-danger) 18%, transparent)",
            color: "var(--color-danger)",
            border: "1px solid color-mix(in oklab, var(--color-danger) 55%, transparent)",
          }}
        >
          ✕ Absent
        </button>
        <button
          onClick={() => onApply("cancelled")}
          className="rounded-full border border-border bg-background/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-all duration-200 hover:text-foreground hover:border-primary/60"
        >
          Cancelled
        </button>
        <button
          onClick={() => onApply("holiday")}
          className="rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200 hover:brightness-110"
          style={{
            background: "color-mix(in oklab, var(--neon-magenta) 15%, transparent)",
            color: "var(--neon-magenta)",
            border: "1px solid color-mix(in oklab, var(--neon-magenta) 45%, transparent)",
          }}
        >
          Holiday
        </button>
        <button
          onClick={onClear}
          className="rounded-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Clear selection"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
