import type { IncomingMessage, ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { type Plugin, type ProxyOptions, defineConfig } from "vite";

/**
 * The three path prefixes the workspace server owns (SPEC.md §3, §6, §9.2). In
 * the installed tool the server serves the built UI itself, so everything under
 * these prefixes is same-origin; the dev server has to look like that too.
 *
 * One list, two modes: `workspaceProxy` forwards exactly these prefixes and
 * `noWorkspaceServer` refuses exactly these prefixes. A prefix added to one and
 * forgotten in the other is a type error rather than a silent hole.
 */
const SERVER_PATHS = ["/api", "/attachments", "/events"] as const;

type ServerPath = (typeof SERVER_PATHS)[number];

/**
 * **The proxy is opt-in, and only `npm run dev` opts in** (INFRA-028).
 *
 * Pointing at `127.0.0.1:8765` by default made the e2e suite test whatever
 * happened to be listening on the developer's machine: with a real workspace
 * server up, `console.spec.ts` asserts a "server unreachable" notice that a live
 * server answers away, so the run failed for a reason unrelated to the change
 * under test — and, worse, every other spec silently exercised a different
 * system. Requiring the origin to be named means no run can reach a workspace
 * server unless somebody asked it to.
 *
 * Whitespace and the empty string count as unset, so a stale
 * `CORPUS_SERVER_ORIGIN=` in a shell — or the one `playwright.config.ts` sets to
 * neutralise an exported value — reads as "no server", never as "origin `''`".
 */
const SERVER_ORIGIN = process.env.CORPUS_SERVER_ORIGIN?.trim() ?? "";

function workspaceProxy(origin: string): Record<ServerPath, ProxyOptions> {
  return {
    "/api": {
      target: origin,
      // The server binds a loopback address and issues no origin-sensitive
      // redirects, so the browser's Host header passes through untouched.
      changeOrigin: false,
    },
    // Attachment bytes (SPEC.md §6). The installed server hands them out from
    // the same origin as `/api`, so the dev server has to look like that too;
    // without this a turn's image would 404 from Vite and read exactly like a
    // missing file. The kit fetches them with the workspace bearer token, so
    // nothing about the route's auth changes here.
    "/attachments": {
      target: origin,
      changeOrigin: false,
    },
    "/events": {
      target: origin,
      changeOrigin: false,
      // `/events` is a long-lived SSE stream (SPEC.md §9.2). Two things would
      // break it under the default agent: a compressed response, which buffers
      // until the encoder flushes, and the socket timeout, which would kill a
      // stream that is idle between heartbeats. `no-transform` and
      // `X-Accel-Buffering` tell any intermediary the same thing.
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
  };
}

/**
 * Answers every workspace-server path with the same `500 text/plain` Vite's own
 * proxy returns when its target refuses the connection — the shell then reports
 * "server unreachable" (SPEC.md §11), honestly, because there is no server.
 *
 * This is what makes an isolated run isolated *by construction*: with no proxy
 * configured the dev server holds no target, so no request can leave the
 * process regardless of what is listening on any port. Without it the SPA
 * fallback would hand `/api/...` the `index.html` shell, which is a 200 and
 * would read as a server answering nonsense.
 *
 * `configureServer` runs before Vite installs its own middlewares, so this one
 * sees those paths first.
 */
function noWorkspaceServer(): Plugin {
  return {
    name: "corpus:no-workspace-server",
    configureServer(server) {
      server.middlewares.use(
        (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
          const url = req.url ?? "";
          // Prefix matching, deliberately the same rule Vite's proxy applies to
          // a `context` key, so both modes claim the same URLs.
          if (!SERVER_PATHS.some((path) => url.startsWith(path))) {
            next();
            return;
          }
          res.writeHead(500, { "Content-Type": "text/plain" }).end();
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), ...(SERVER_ORIGIN === "" ? [noWorkspaceServer()] : [])],
  server: {
    port: 5173,
    // The proxy target and the SSE contract are both port-specific; silently
    // moving to 5174 would make `/api` and `/events` appear to work while the
    // e2e suite and the docs point at the wrong place.
    strictPort: true,
    ...(SERVER_ORIGIN === "" ? {} : { proxy: workspaceProxy(SERVER_ORIGIN) }),
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
