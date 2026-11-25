import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-32.png", "icon-16.png"],
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Without this, the browser may serve a cached index.html and never
        // discover that a new build exists - the app looks permanently stale
        // until it's deleted and re-added.
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          { urlPattern: ({ url }) => url.hostname.endsWith("supabase.co"), handler: "NetworkOnly" },
        ],
      },
      manifest: {
        name: "Ledger Sawa",
        short_name: "Ledger Sawa",
        description: "Household bookkeeping, balanced.",
        theme_color: "#0B1A2D",
        background_color: "#0B1A2D",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
