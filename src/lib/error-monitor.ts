// Global runtime-error monitor. Captures window errors and unhandled promise
// rejections, forwards to Lovable's error reporter, keeps a ring buffer for
// in-app diagnostics, and de-dupes noisy repeats.

import { reportLovableError } from "./lovable-error-reporting";

type ErrorRecord = {
  message: string;
  stack?: string;
  source?: string;
  at: number;
  count: number;
};

const RING_SIZE = 25;
const ring: ErrorRecord[] = [];
let installed = false;

function push(rec: Omit<ErrorRecord, "count">) {
  const existing = ring.find((r) => r.message === rec.message && r.stack === rec.stack);
  if (existing) {
    existing.count += 1;
    existing.at = rec.at;
  } else {
    ring.push({ ...rec, count: 1 });
    if (ring.length > RING_SIZE) ring.shift();
  }
  if (typeof window !== "undefined") {
    (window as unknown as { __errors?: unknown }).__errors = ring.slice();
  }
}

function normalize(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  if (typeof err === "string") return { message: err };
  try { return { message: JSON.stringify(err) }; } catch { return { message: String(err) }; }
}

export function installErrorMonitor() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const { message, stack } = normalize(event.error ?? event.message);
    push({ message, stack, source: `${event.filename}:${event.lineno}:${event.colno}`, at: Date.now() });
    try { reportLovableError(event.error ?? new Error(message), { boundary: "window_error" }); } catch {}
  });

  window.addEventListener("unhandledrejection", (event) => {
    const { message, stack } = normalize(event.reason);
    push({ message, stack, source: "unhandledrejection", at: Date.now() });
    try {
      const err = event.reason instanceof Error ? event.reason : new Error(message);
      reportLovableError(err, { boundary: "unhandled_rejection" });
    } catch {}
  });

  (window as unknown as { __getErrors?: () => ErrorRecord[] }).__getErrors = () => ring.slice();
}
