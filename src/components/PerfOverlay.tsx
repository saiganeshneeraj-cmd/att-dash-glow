import { usePerfOverlay } from "@/lib/perf";

export function PerfOverlay() {
  const { visible, samples, p50, p95 } = usePerfOverlay();
  if (!visible) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        maxWidth: 260,
        padding: "8px 10px",
        borderRadius: 10,
        background: "rgba(10,10,26,0.9)",
        color: "#fff",
        fontFamily: "ui-monospace,monospace",
        fontSize: 11,
        lineHeight: 1.35,
        border: "1px solid rgba(255,255,255,0.15)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <strong>tap→paint</strong>
        <span style={{ opacity: 0.7 }}>p50 {p50}ms · p95 {p95}ms</span>
      </div>
      {samples.length === 0 ? (
        <div style={{ opacity: 0.6 }}>tap something…</div>
      ) : (
        samples.map((s, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{s.label}</span>
            <span style={{ color: s.ms > 200 ? "#f87171" : s.ms > 100 ? "#fbbf24" : "#4ade80" }}>
              {s.ms.toFixed(1)}ms
            </span>
          </div>
        ))
      )}
      <div style={{ marginTop: 6, opacity: 0.5, fontSize: 10 }}>
        localStorage.perfDebug=1 · reload to hide
      </div>
    </div>
  );
}
