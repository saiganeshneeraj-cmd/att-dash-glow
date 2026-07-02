// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        devOptions: { enabled: false },
        includeAssets: ["favicon.ico", "pwa-512.png"],
        manifest: {
          name: "AttendEdge — Smart Attendance Tracker",
          short_name: "AttendEdge",
          description: "Track class attendance with premium neon dashboard.",
          theme_color: "#0a0a1a",
          background_color: "#0a0a1a",
          display: "standalone",
          start_url: "/",
          scope: "/",
          icons: [
            { src: "/pwa-512.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
        workbox: {
          navigateFallback: "/",
          navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: { cacheName: "html-nav", networkTimeoutSeconds: 4 },
            },
            {
              urlPattern: ({ url }) => url.origin === self.location.origin && /\.(?:js|css|woff2?|png|svg|jpg|jpeg)$/.test(url.pathname),
              handler: "CacheFirst",
              options: { cacheName: "assets", expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 } },
            },
            {
              urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
              handler: "CacheFirst",
              options: { cacheName: "fonts", expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
            },
          ],
        },
      }),
    ],
  },
});
