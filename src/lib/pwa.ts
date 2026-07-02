// Guarded PWA registration. Never registers in dev, preview iframes, or Lovable hosts.
export function registerPwa() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;

  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const host = window.location.hostname;
  const forbidden =
    inIframe ||
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" ||
    host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" ||
    host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" ||
    host.endsWith(".beta.lovable.dev") ||
    new URL(window.location.href).searchParams.get("sw") === "off";

  if (forbidden) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => { if (r.active?.scriptURL.endsWith("/sw.js")) r.unregister(); });
    }).catch(() => {});
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
