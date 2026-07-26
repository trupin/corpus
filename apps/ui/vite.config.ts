import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The workspace server (SPEC.md §3): binds `127.0.0.1`, default port 8765. In
 * the installed tool the server serves the built UI itself, so this proxy only
 * exists to make the dev server look like that same origin.
 */
const SERVER_ORIGIN = "http://127.0.0.1:8765";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The proxy target and the SSE contract are both port-specific; silently
    // moving to 5174 would make `/api` and `/events` appear to work while the
    // e2e suite and the docs point at the wrong place.
    strictPort: true,
    proxy: {
      "/api": {
        target: SERVER_ORIGIN,
        // The server binds a loopback address and issues no origin-sensitive
        // redirects, so the browser's Host header passes through untouched.
        changeOrigin: false,
      },
      "/events": {
        target: SERVER_ORIGIN,
        changeOrigin: false,
        // `/events` is a long-lived SSE stream (SPEC.md §9.2). Two things
        // would break it under the default agent: a compressed response, which
        // buffers until the encoder flushes, and the socket timeout, which
        // would kill a stream that is idle between heartbeats. `no-transform`
        // and `X-Accel-Buffering` tell any intermediary the same thing.
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept-Encoding", "identity");
            proxyReq.setHeader("Connection", "keep-alive");
          });
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["cache-control"] = "no-cache, no-transform";
            proxyRes.headers["x-accel-buffering"] = "no";
          });
        },
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
