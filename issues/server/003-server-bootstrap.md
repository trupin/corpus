# [SERVER-003] Server bootstrap: Hono app, config, auth, static UI

## Domain

server

## Status

in_progress

## Priority

P0

## Model

opus — assembly of pinned pieces; no open architectural questions.

## Dependencies

- Depends on: CONTRACT-001
- Blocks: SERVER-004, SERVER-008, CLI-002, PLUGINS-001

## Spec References

- SPEC.md §2 — "Architecture overview" (server's role, the ~250 ms round-trip target)
- SPEC.md §9.2 — "HTTP API" (route surface this app will host, revised by SHARED-001)
- CLAUDE.md — Architecture Decisions 1 (tool/workspace split), 2 (server is the sole writer), 5 (localhost bind + bearer token)

## Summary

Stand up `apps/server` as a runnable, testable Hono application: an `OpenAPIHono` instance that registers handlers against `@corpus/contract`'s route definitions, workspace/config resolution (workspace root from the CLI or environment; `.corpus/config.json` supplies port and bearer token), bearer authentication on `/api/*` and `/attachments/*` with the health endpoint left open, a reusable localhost-only middleware primitive for the future job-log hook route, static serving of the pre-built UI with SPA fallback, a central error handler emitting problem JSON, and graceful shutdown. Exports `createServer(config)` for tests and ships a `tsx`-runnable entry point for development. Every subsequent server issue plugs its routes into this app; no route logic beyond `/api/health` belongs here.

## Acceptance Criteria

- [ ] `createServer(config)` returns a configured app plus a `start()` that binds and a `close()` that shuts down; it performs no `process.exit` and reads no ambient environment — everything comes from the passed config.
- [ ] Workspace resolution: explicit argument > `CORPUS_WORKSPACE` env > nearest ancestor of `cwd` containing `.corpus/config.json`; failure produces a clear "not a Corpus workspace" error.
- [ ] `.corpus/config.json` is parsed with Zod: `{ version, port (default 8765), host (default "127.0.0.1", loopback-only), token }`; a missing, unreadable, or invalid config fails fast with an actionable message naming the file and the problem.
- [ ] Bearer auth middleware guards `/api/*` and `/attachments/*`; `GET /api/health` is reachable without a token; missing/invalid tokens return `401` problem JSON; token comparison is constant-time.
- [ ] A `localhostOnly` middleware primitive is exported and unit-tested (it will guard `POST /api/jobs/:id/log`, §7) — not yet mounted on any route.
- [ ] Contract route definitions from `@corpus/contract` are registered via `app.openapi(route, handler)`; the generated OpenAPI document is served at `GET /api/openapi.json`.
- [ ] Pre-built UI is served statically with SPA fallback: any non-API `GET` that matches no file returns `index.html`; a missing UI build returns a clear `503` rather than a confusing 404.
- [ ] Central error handler returns `application/problem+json` for every failure path (validation, auth, not-found under `/api`, unexpected errors), never an HTML stack trace.
- [ ] `SIGINT`/`SIGTERM` trigger graceful shutdown: stop accepting connections, run registered disposers, exit `0`; a hard exit backstop fires after 5 s.
- [ ] `npm run dev -w apps/server` starts the server against a real workspace via `tsx` and logs the bound URL.

## Sprint-002 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-002 Open Conflicts affecting this issue — implement exactly these; full rationale in `issues/sprints/sprint-002.md` §Open Conflicts:

1. **Health payload**: the contract wins — emit `uptimeSeconds` per the shipped `HealthSchema`, not `uptimeMs`.
2. **Error bodies**: the contract wins, strictly — every error response is `application/json` carrying `ApiErrorSchema` (`{code, message, ...}`). RFC 9457 / `application/problem+json` is dropped from this issue entirely (no hybrid extra keys). Only the four CONTRACT-001 codes exist (`bad_request | unauthorized | not_found | locked`) — do not anticipate `forbidden`/`conflict` (they arrive with CONTRACT-002).
3. **`.corpus/config.json` canonical shape**: `{version: 1, port: number, host?: string (loopback-only, default "127.0.0.1"), token: string, dataDir?: string (default "data")}` — parse non-strictly (unknown keys pass, absent optionals default). No `min(32)` on the reader: token strength is `corpus init`'s generator concern (CLI-002); the server MAY warn on a short token.
4. **`GET /api/openapi.json`**: served behind the bearer guard as server-local introspection, deliberately outside the contract (no typed-client method); CONTRACT-002 documents the exemption.
5. **`?token=` reachability**: mount the bearer guard on `/events` too; that path (only) accepts header OR `?token=`. The handler is SERVER-007's — an authenticated `/events` request gets an ApiError 404 this sprint.

## Technical Design

### Files to Create/Modify

- `apps/server/src/app.ts` — `createServer(config)`: builds the `OpenAPIHono`, wires middleware, registers routes, returns `{ app, start, close, registerDisposer }`
- `apps/server/src/config.ts` — workspace resolution, `.corpus/config.json` Zod schema, `loadServerConfig()`
- `apps/server/src/middleware/auth.ts` — bearer middleware + constant-time token compare
- `apps/server/src/middleware/localhost.ts` — `localhostOnly` primitive
- `apps/server/src/middleware/logging.ts` — one structured line per request, level-gated
- `apps/server/src/errors.ts` — `CorpusError` base class, problem-JSON serializer, `app.onError` / `app.notFound` handlers
- `apps/server/src/static-ui.ts` — UI dist resolution + SPA fallback handler
- `apps/server/src/routes/health.ts` — the one route this issue owns
- `apps/server/src/main.ts` — process entry: resolve workspace, `createServer`, `start`, signal handling
- `apps/server/src/index.ts` — library surface (`createServer`, `loadServerConfig`, error types) for tests and the CLI's integration tests
- `apps/server/src/**/*.test.ts` — colocated Vitest suites
- `apps/server/package.json` — deps (`hono`, `@hono/node-server`, `@hono/zod-openapi`, `zod`, `@corpus/contract`), scripts `dev` (`tsx watch src/main.ts`) and `start`

### Key Implementation Details

**Config.** `ServerConfigSchema`:

```ts
{
  version: z.literal(1),
  port: z.number().int().min(1).max(65535).default(8765),
  host: z.string().default("127.0.0.1"),          // rejected unless loopback in v1
  token: z.string().min(32),                       // generated by `corpus init`
}
```

`loadServerConfig({ workspace?, env, cwd })` resolves the workspace root (explicit > `CORPUS_WORKSPACE` > upward search for `.corpus/config.json`, stopping at the filesystem root), reads and Zod-parses the file, and returns `{ workspaceRoot, dataDir: <ws>/data, corpusDir: <ws>/.corpus, port, host, token }`. `CORPUS_PORT` overrides the config's port (useful for tests and for running two workspaces); `CORPUS_LOG_LEVEL` (`silent|info|debug`, default `info`) controls request logging. The server never **writes** the config — `corpus init` owns creation (CLI domain).

**App assembly.** `new OpenAPIHono()` with `defaultHook` mapping zod-openapi validation failures into the same problem-JSON shape as everything else (400, `type: "about:blank#validation"`, an `errors` array of `{ path, message }`). Middleware order: request logging → auth → routes → static UI fallback. `app.doc("/api/openapi.json", { openapi: "3.1.0", info: { title: "Corpus", version } })` serves the generated document; the committed `packages/contract/openapi.json` remains the source of truth for clients (CONTRACT-001), this endpoint is for live inspection.

`createServer` returns a `registerDisposer(fn)` handle so later issues (the SQLite handle from SERVER-004, the chokidar watcher, the SSE subscriber registry) attach their cleanup without editing shutdown logic.

**Auth.** Applied with `app.use("/api/*", …)` and `app.use("/attachments/*", …)`. Extract `Authorization: Bearer <token>`; compare with `crypto.timingSafeEqual` after a length check (unequal lengths short-circuit to failure without throwing). Exempt exactly `GET /api/health`. On failure: `401` problem JSON with `WWW-Authenticate: Bearer`, and the log line records the path but never the presented token. The token also may arrive as `?token=` for the SSE `EventSource` case (browsers cannot set headers on `EventSource`) — accept it **only** for `GET /events`, and note in a code comment why the exception exists.

**localhostOnly.** Reads the peer address from the node-server request (`c.env.incoming.socket.remoteAddress`), normalizes IPv4-mapped IPv6 (`::ffff:127.0.0.1`), and allows only `127.0.0.1` / `::1`; anything else gets `403` problem JSON. It deliberately does not trust `X-Forwarded-For`.

**Static UI.** Dist resolution order: `CORPUS_UI_DIST` env > `<packageRoot>/../ui/dist` (monorepo dev) > `<packageRoot>/ui` (the packaged layout the npm tarball will use). Serve with `serveStatic` from `@hono/node-server/serve-static`, with immutable cache headers for hashed asset filenames and `no-cache` for `index.html`. SPA fallback: for `GET` requests that are not under `/api`, `/attachments`, or `/events` and match no file, return `index.html` with `200`. If no dist directory exists at boot, register a fallback returning `503` with `"UI build not found — run `npm run build -w apps/ui` (dev) or reinstall the corpus package"`; the API must remain fully functional in that state.

**Errors.** `CorpusError extends Error` with `status: number`, a stable `name`, and an optional `detail`. `app.onError` maps: `CorpusError` → its status; `ZodError` → 400; everything else → 500 with a generic detail (`"internal error"`) while the full error, including `cause`, is logged to stderr. Response body follows RFC 9457: `{ type, title, status, detail, instance }`, content-type `application/problem+json`. `app.notFound` returns problem JSON for `/api/*` and defers to the SPA fallback otherwise.

**Lifecycle.** `start()` calls `serve({ fetch: app.fetch, hostname: host, port })` and resolves with the actual bound port (pass `port: 0` in tests to get an ephemeral port — never hardcode 8765 in a test). `EADDRINUSE` is rethrown as a `CorpusError` with the message `"port <n> already in use — another corpus server may be running (corpus server status)"`. `main.ts` installs `SIGINT`/`SIGTERM` handlers that call `close()` (stop listening → run disposers in reverse registration order → resolve), then `process.exit(0)`; a `setTimeout(…, 5000).unref()` forces exit if a disposer hangs. `main.ts` stays a thin, coverage-excluded entry point — all logic lives in `app.ts`/`config.ts` where it is testable.

**Health route.** `GET /api/health` → `{ status: "ok", version, workspace: <absolute path>, uptimeMs }`. It is the readiness probe the CLI's `corpus server start|status` polls (CLI-002), so it must be cheap and must not touch the database.

### Edge Cases

- Workspace resolution walking to `/` without finding `.corpus/config.json` → `CorpusError` "not a Corpus workspace; run `corpus init`" (exit code 1 from `main.ts`).
- `.corpus/config.json` present but malformed JSON, or valid JSON failing the schema → distinct, actionable messages (parse error names the byte offset; schema error names the failing field).
- `host` configured to something non-loopback → rejected at config parse time in v1 (Decision 5 keeps remote setups a future non-breaking change, not a v1 capability).
- Two workspaces on one machine using the same port → `EADDRINUSE` message above; tests use port `0`.
- Empty or whitespace `Authorization` header, `Bearer` with no value, wrong scheme (`Basic`) → all 401, none throwing.
- A request to `/api/…` for a route no issue has registered yet → problem-JSON 404, not the SPA fallback.
- `index.html` present but assets missing (partial build) → served as-is; the 503 path only covers a missing dist directory.
- Signals arriving before `start()` resolves, or twice in a row → shutdown is idempotent.
- Unhandled promise rejection at the process level → logged and converted to a non-zero exit rather than silently ignored.

## Testing Strategy

Vitest, colocated `*.test.ts`, exercising the real app object through `app.fetch(new Request(...))` (Hono's supported in-process path — the app itself is real, only the socket is skipped) plus a small number of tests that bind a real ephemeral port.

- **Config**: fixture workspaces in a temp dir — valid, missing, malformed, non-loopback host, port override via env; assert resolved values and error messages.
- **Auth**: no header / wrong scheme / wrong token / correct token against a guarded route; health reachable unauthenticated; `?token=` accepted only on `/events`.
- **localhostOnly**: allowed and denied peer addresses, including the IPv4-mapped form.
- **Errors**: a route throwing `CorpusError`, a route throwing a plain `Error` (assert the message is not leaked), a request failing zod-openapi validation — all assert `application/problem+json` and the status.
- **Static/SPA**: dist fixture directory with an `index.html` and a hashed asset — asset served, unknown path returns `index.html`, `/api/nope` returns problem JSON; a second app instance with no dist returns 503.
- **Lifecycle**: bind on port 0, `fetch` the real URL over HTTP, call `close()`, assert the socket is refused afterwards and disposers ran in reverse order.

## E2E Verification Plan

### Reproduction Steps (bugs only)

N/A — this is a feature, not a bug.

### Verification Steps

1. Create a real workspace: `mktemp -d`, `mkdir -p .corpus data/docs data/threads`, write a real `.corpus/config.json` with a 32+ character token and `"port": 8765`.
2. Start the real server: `CORPUS_WORKSPACE=<ws> npx tsx apps/server/src/main.ts` (background). Expected: it logs `listening on http://127.0.0.1:8765`.
3. `curl -s -i http://127.0.0.1:8765/api/health` → `200`, JSON body naming the workspace path. No token supplied.
4. `curl -s -i http://127.0.0.1:8765/api/openapi.json` without a token → `401` with `content-type: application/problem+json` and `WWW-Authenticate: Bearer`; with `-H "Authorization: Bearer <token>"` → `200` and a valid OpenAPI 3.1 document (pipe to `jq .openapi`).
5. `curl -s -i -H "Authorization: Bearer wrong" …/api/openapi.json` → `401`.
6. `curl -s -i …/api/definitely-not-a-route -H "Authorization: Bearer <token>"` → `404` problem JSON (not HTML, not the SPA shell).
7. With no UI build present: `curl -s -i http://127.0.0.1:8765/` → `503` with the "UI build not found" message. Then create a fixture dist (`CORPUS_UI_DIST=<dir>` containing `index.html` + `assets/app.<hash>.js`), restart, and confirm `/` serves `index.html`, `/assets/app.<hash>.js` serves the asset, and `/some/deep/route` serves `index.html` (SPA fallback).
8. Start a **second** server against the same config → observe the `EADDRINUSE` message and a non-zero exit.
9. Send `SIGTERM` to the running server (`kill -TERM <pid>`); expected: a shutdown log line, exit status `0`, and a subsequent `curl` refused.
10. Start against a directory that is **not** a workspace (`cd /tmp && npx tsx apps/server/src/main.ts`) → expected: "not a Corpus workspace; run `corpus init`", non-zero exit.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-003]` prefix
