// Tap-to-render latency instrumentation.
//
// Usage:
//   const perf = usePerfTracker([detailed]); // dep changes = a commit
//   <button onClick={() => { perf.mark("mark-attended"); setClassState(...); }} />
//
// Each `mark(label)` records the current timestamp; the next React commit +
// paint (measured via double rAF) completes it and records the delta in a
// ring buffer. Enable the on-screen overlay with
// `localStorage.setItem("perfDebug","1")` and reload — no cost otherwise.
//
// Also exposed on window.__perf for pulling from DevTools.

import { useEffect, useRef, useState } from "react";

type PerfSample = { label: string; ms: number; at: number };

const RING_SIZE = 40;
const ring: PerfSample[] = [];

function record(sample: PerfSample) {
  ring.push(sample);
  if (ring.length > RING_SIZE) ring.shift();
  if (typeof window !== "undefined") {
    (window as unknown as { __perf?: unknown }).__perf = {
      samples: ring.slice(),
      last: sample,
      p50: percentile(ring.map((s) => s.ms), 50),
      p95: percentile(ring.map((s) => s.ms), 95),
    };
    window.dispatchEvent(new CustomEvent("perf:sample", { detail: sample }));
  }
  // Warn in console when a tap→paint exceeds a mobile-noticeable threshold.
  if (sample.ms > 200) {
    // eslint-disable-next-line no-console
    console.warn(`[perf] slow ${sample.label}: ${sample.ms.toFixed(1)}ms`);
  }
}

function percentile(arr: number[], p: number) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[i] * 10) / 10;
}

export function usePerfTracker(deps: unknown[]) {
  const pending = useRef<{ label: string; t0: number } | null>(null);

  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    // Double rAF: first fires just before the browser's next paint, second
    // fires on the frame AFTER paint has landed → closest we can get to
    // "tap-to-pixels" without a full PerformanceObserver setup.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ms = performance.now() - p.t0;
        record({ label: p.label, ms, at: Date.now() });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    mark(label: string) {
      pending.current = { label, t0: performance.now() };
    },
  };
}

export function usePerfOverlay() {
  const [visible, setVisible] = useState(false);
  const [samples, setSamples] = useState<PerfSample[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setVisible(window.localStorage.getItem("perfDebug") === "1");
    const onSample = () => setSamples(ring.slice(-8).reverse());
    window.addEventListener("perf:sample", onSample);
    return () => window.removeEventListener("perf:sample", onSample);
  }, []);

  return { visible, samples, p50: percentile(ring.map((s) => s.ms), 50), p95: percentile(ring.map((s) => s.ms), 95) };
}
