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

- [x] `createServer(config)` returns a configured app plus a `start()` that binds and a `close()` that shuts down; it performs no `process.exit` and reads no ambient environment — everything comes from the passed config.
- [x] Workspace resolution: explicit argument > `CORPUS_WORKSPACE` env > nearest ancestor of `cwd` containing `.corpus/config.json`; failure produces a clear "not a Corpus workspace" error.
- [x] `.corpus/config.json` is parsed with Zod: `{ version, port (default 8765), host (default "127.0.0.1", loopback-only), token }` — plus `dataDir` and no reader-side token-length rule, per Adjudication 3; a missing, unreadable, or invalid config fails fast with an actionable message naming the file and the problem.
- [x] Bearer auth middleware guards `/api/*` and `/attachments/*` (and `/events`, per Adjudication 5); `GET /api/health` is reachable without a token; missing/invalid tokens return `401` with a contract `ApiError` body; token comparison is constant-time.
- [x] A `localhostOnly` middleware primitive is exported and unit-tested (it will guard `POST /api/jobs/:id/log`, §7) — not yet mounted on any route.
- [x] Contract route definitions from `@corpus/contract` are registered via `app.openapi(route, handler)`; the generated OpenAPI document is served at `GET /api/openapi.json`, behind the guard (Adjudication 4).
- [x] Pre-built UI is served statically with SPA fallback: any non-API `GET` that matches no file returns `index.html`; a missing UI build returns a clear `503` rather than a confusing 404.
- [x] Central error handler returns a contract `ApiError` as `application/json` for every failure path (validation, auth, not-found under `/api`, unexpected errors), never an HTML stack trace. **RFC 9457 / `application/problem+json` was dropped by Adjudication 2** — this criterion's original wording is superseded.
- [x] `SIGINT`/`SIGTERM` trigger graceful shutdown: stop accepting connections, run registered disposers, exit `0`; a hard exit backstop fires after 5 s.
- [x] `npm run dev -w apps/server` starts the server against a real workspace via `tsx` and logs the bound URL.

## Sprint-002 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-002 Open Conflicts affecting this issue — implement exactly these; full rationale in `issues/sprints/sprint-002.md` §Open Conflicts:

1. **Health payload**: the contract wins — emit `uptimeSeconds` per the shipped `HealthSchema`, not `uptimeMs`.
2. **Error bodies**: the contract wins, strictly — every error response is `application/json` carrying `ApiErrorSchema` (`{code, message, ...}`). RFC 9457 / `application/problem+json` is dropped from this issue entirely (no hybrid extra keys). Only the four CONTRACT-001 codes exist (`bad_request | unauthorized | not_found | locked`) — do not anticipate `forbidden`/`conflict` (they arrive with CONTRACT-002).
3. **`.corpus/config.json` canonical shape**: `{version: 1, port: number, host?: string (loopback-only, default "127.0.0.1"), token: string, dataDir?: string (default "data")}` — parse non-strictly (unknown keys pass, absent optionals default). No `min(32)` on the reader: token strength is `corpus init`'s generator concern (CLI-002); the server MAY warn on a short token.
4. **`GET /api/openapi.json`**: served behind the bearer guard as server-local introspection, deliberately outside the contract (no typed-client method); CONTRACT-002 documents the exemption.
5. **`?token=` reachability**: mount the bearer guard on `/events` too; that path (only) accepts header OR `?token=`. The handler is SERVER-007's — an authenticated `/events` request gets an ApiError 404 this sprint.

## Sprint-002 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-002 Open Conflicts affecting this issue — implement exactly these; full rationale in `issues/sprints/sprint-002.md` §Open Conflicts:

1. **Health payload**: the contract wins — emit `uptimeSeconds` per the shipped `HealthSchema`, not `uptimeMs`.
2. **Error bodies**: the contract wins, strictly — every error response is `application/json` carrying `ApiErrorSchema` (`{code, message, ...}`). RFC 9457 / `application/problem+json` is dropped from this issue entirely (no hybrid extra keys). Only the four CONTRACT-001 codes exist (`bad_request | unauthorized | not_found | locked`) — do not anticipate `forbidden`/`conflict` (they arrive with CONTRACT-002).
3. **`.corpus/config.json` canonical shape**: `{version: 1, port: number, host?: string (loopback-only, default "127.0.0.1"), token: string, dataDir?: string (default "data")}` — parse non-strictly (unknown keys pass, absent optionals default). No `min(32)` on the reader: token strength is `corpus init`'s generator concern (CLI-002); the server MAY warn on a short token.
4. **`GET /api/openapi.json`**: served behind the bearer guard as server-local introspection, deliberately outside the contract (no typed-client method); CONTRACT-002 documents the exemption.
5. **`?token=` reachability**: mount the bearer guard on `/events` too; that path (only) accepts header OR `?token=`. The handler is SERVER-007's — an authenticated `/events` request gets an ApiError 404 this sprint.

6. **Post-eval edge pin (2026-07-26)**: `port` is optional in the schema with default `8765` (matching this issue's own AC) — BOTH readers must accept a portless config. `host` non-loopback values are not a schema failure: the schema accepts any string; the SERVER enforces loopback-only at boot as a semantic error (it is the component that binds). The CLI treats `host` as an opaque dial target.

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
- `host` configured to something non-loopback → ~~rejected at config parse time in v1~~ **superseded by Adjudication 6**: the config parses (the CLI shares the file and only dials `host`); the server refuses to *bind* it at boot with an actionable message and exits 1 (Decision 5 keeps remote setups a future non-breaking change, not a v1 capability).
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

**implemented on: opus**

### Reproduction (bugs only)

N/A — feature, not a bug.

### Environment

Real `corpus` server process (`tsx apps/server/src/main.ts`), real workspace on real disk
(`/tmp/server003/ws` with a real `.corpus/config.json`, 48-character token, `"port": 8765`),
real `curl`, real POSIX signals. Port 8765 as assigned by sprint-002; automated tests use
`CORPUS_PORT=0`. `npm run build` from a clean tree before every step. Node v25.2.1.

Two shell notes recorded so a re-runner is not misled:

- `npx tsx` is rewritten to `npm tsx` by a local shell hook on this machine; every command
  below invokes `./node_modules/.bin/tsx` (or `node --import tsx/esm`) directly.
- The `tsx` **CLI** forks a child and does not forward `SIGTERM` to it. Signal steps
  therefore run `node --import tsx/esm apps/server/src/main.ts`, which is one process, so
  `wait` reports the server's own exit status rather than the wrapper's. This is a
  dev-harness artifact of running from source; the shipped tool runs `node` directly.

### Post-Implementation Verification

**TEST-25 — a real process boots against a real workspace.**

```
$ CORPUS_WORKSPACE=/tmp/server003/ws CORPUS_UI_DIST=/tmp/server003/missing-ui \
    ./node_modules/.bin/tsx apps/server/src/main.ts
{"level":"error","msg":"UI build not found — run `npm run build -w apps/ui` (dev) or reinstall the corpus package","distDir":"/tmp/server003/missing-ui"}
{"level":"info","msg":"listening on http://127.0.0.1:8765","url":"http://127.0.0.1:8765","port":8765,"workspace":"/tmp/server003/ws","version":"0.0.0"}
```

The bound URL is named and the process stays alive. **PASS**

**TEST-26 — health, unauthenticated, contract-shaped.**

```
$ curl -s -i http://127.0.0.1:8765/api/health
HTTP/1.1 200 OK
content-type: application/json

{"status":"ok","version":"0.0.0","uptimeSeconds":3.769,"workspace":"/tmp/server003/ws"}
```

`uptimeSeconds`, not `uptimeMs` (Adjudication 1); `workspace` is the absolute path. The
payload is additionally asserted against `HealthSchema` in `routes/health.test.ts` and
`app.test.ts`. **PASS**

**TEST-27 / TEST-28 / TEST-40 — the auth matrix** (`/tmp/corpus-e2e/probe-auth.sh`):

```
openapi: no header                    401  www-authenticate: Bearer {"code":"unauthorized",...}
openapi: Bearer wrong                 401  www-authenticate: Bearer {"code":"unauthorized",...}
openapi: Bearer <no value>            401  www-authenticate: Bearer {"code":"unauthorized",...}
openapi: Basic abc                    401  www-authenticate: Bearer {"code":"unauthorized",...}
openapi: empty header                 401  www-authenticate: Bearer {"code":"unauthorized",...}
openapi: whitespace header            401  www-authenticate: Bearer {"code":"unauthorized",...}
openapi: correct token                200                           {"openapi":"3.1.0",...}
openapi: ?token= (must be 401)        401  www-authenticate: Bearer {"code":"unauthorized",...}
health:  ?token= (exempt route)       200                           {"status":"ok",...}
events:  ?token= correct              404                           {"code":"not_found",...}
events:  ?token= wrong                401  www-authenticate: Bearer {"code":"unauthorized",...}
events:  no credential                401  www-authenticate: Bearer {"code":"unauthorized",...}
events:  header credential            404                           {"code":"not_found",...}
attachments: no header                401  www-authenticate: Bearer {"code":"unauthorized",...}
```

Four malformed-credential shapes, none throwing, none 500. `?token=` works on `/events`
and **only** there; `/events` with no credential is 401; an authenticated `/events` is the
honest 404 that belongs to SERVER-007 (Adjudication 5). Constant-time comparison and the
short-circuit on a length mismatch are asserted in `middleware/auth.test.ts` with a spy
wrapping the real `crypto.timingSafeEqual` — it is called for equal-length inputs and not
called at all for a length mismatch, which does not throw.

Token never logged:

```
$ grep -c "b3bc73ea987c62fc25e90cff280666239d3c34ce07f8fc59" /tmp/server003/no-ui.log
0
```

The `/events?token=…` request lines read `"query":"token=redacted"`. **PASS**

**TEST-29 / TEST-30 / TEST-76 — one route mounted, everything else 404s honestly**
(`/tmp/corpus-e2e/probe-paths.sh`, valid token on every request):

```
/api/health             200 application/json  {"status":"ok",...}
/api/docs               404 application/json  {"code":"not_found","message":"no route matches GET /api/docs"}
/api/docs/x1            404 application/json  {"code":"not_found",...}
/api/threads            404 application/json  {"code":"not_found",...}
/api/threads/t1         404 application/json  {"code":"not_found",...}
/api/threads/t1/turns   404 application/json  {"code":"not_found",...}
/api/queue/status       404 application/json  {"code":"not_found",...}
/api/queue/claim-all    404 application/json  {"code":"not_found",...}
/api/queue/q1/complete  404 application/json  {"code":"not_found",...}
/api/queue/q1/fail      404 application/json  {"code":"not_found",...}
/attachments/x          404 application/json  {"code":"not_found",...}
/events                 404 application/json  {"code":"not_found",...}

$ curl -s -i -H "Authorization: Bearer <token>" .../api/definitely-not-a-route
HTTP/1.1 404 Not Found
content-type: application/json
{"code":"not_found","message":"no route matches GET /api/definitely-not-a-route"}
```

No 501, no empty 200, no HTML, no stack trace. `app.test.ts` iterates
`ALL_CONTRACT_ROUTES` with each route's own method and asserts the same, validating every
body against `ApiErrorSchema`. **PASS**

**TEST-31 — the live OpenAPI document.**

```
$ curl -s -o /dev/null -w '%{http_code}' .../api/openapi.json                      → 401
$ curl -s -H "Authorization: Bearer <token>" .../api/openapi.json > openapi.json
$ node -e "const j=require('.../openapi.json'); console.log(j.openapi, Object.keys(j.paths).length)"
3.1.0 11
```

Served behind the bearer guard as server-local introspection, outside the contract
(Adjudication 4). It is `buildOpenApiDocument()` from `@corpus/contract` — the whole
declared surface — rather than `app.doc()`, which on a one-route app would emit a document
that disagrees with the committed `packages/contract/openapi.json`. **PASS**

**TEST-32 — a missing UI build degrades, and never takes the API with it.**

```
$ curl -s -i http://127.0.0.1:8765/
HTTP/1.1 503 Service Unavailable
cache-control: no-cache
content-type: text/plain; charset=utf-8

UI build not found — run `npm run build -w apps/ui` (dev) or reinstall the corpus package

$ curl -s -o /dev/null -w '%{http_code}' .../api/health   → 200
```

The 503 is `text/plain`, not an `ApiError`: `/` is outside `/api`, and its reader is a
person who just opened the board URL. **PASS**

**TEST-33 — a present UI build** (fixture dist via `CORPUS_UI_DIST`, server restarted):

```
/                        200 text/html; charset=utf-8        cache-control: no-cache
/assets/app.a1b2c3d4.js  200 text/javascript; charset=utf-8  cache-control: public, max-age=31536000, immutable
/favicon.svg             200 image/svg+xml; charset=utf-8    cache-control: no-cache
/some/deep/route         200 text/html; charset=utf-8        cache-control: no-cache
/api/nope                404 application/json                {"code":"not_found",...}
/attachments/x           404 application/json                {"code":"not_found",...}
/events                  404 application/json                {"code":"not_found",...}
/../etc/passwd           200 text/html; charset=utf-8        (SPA shell — no traversal)
/%2e%2e/%2e%2e/etc/passwd 200 text/html; charset=utf-8       (SPA shell — no traversal)
```

Re-run against the **real Vite build** (`apps/ui/dist`, resolved through the
`<packageRoot>/../ui/dist` fallback with no `CORPUS_UI_DIST` set), which is where the
hash-naming convention is real rather than a fixture:

```
/                          200 text/html        cache-control: no-cache
/assets/index-DBo_PnNP.css 200 text/css         cache-control: public, max-age=31536000, immutable
/assets/index-CRi6zNLx.js  200 text/javascript  cache-control: public, max-age=31536000, immutable
/board/some/deep/route     200 text/html        cache-control: no-cache
```

Neither `/attachments/x` nor `/events` ever receives the SPA fallback. **PASS**

**TEST-34 — config failures name the file and the problem** (`/tmp/server003/probe-config.sh`,
every case exits 1, none prints a stack trace):

```
(d) cwd=/tmp, no env, no argument
  not a Corpus workspace: no .corpus/config.json found in /private/tmp or any parent directory; run `corpus init`
explicit --workspace at a non-workspace dir
  not a Corpus workspace: /tmp/server003/bad-none/.corpus/config.json is no such file; run `corpus init` in the workspace directory
malformed JSON
  /tmp/server003/bad-json/.corpus/config.json is not valid JSON: Expected double-quoted property name in JSON at position 50 (line 2 column 1)
schema failure
  /tmp/server003/bad-schema/.corpus/config.json is not a valid workspace config — port: Too big: expected number to be <=65535
non-loopback host  [SUPERSEDED by Adjudication 6 — now a bind-time refusal, see the addendum below]
  /tmp/server003/bad-host/.corpus/config.json is not a valid workspace config — host: must be a loopback address — this version of corpus binds 127.0.0.1 only
bad CORPUS_PORT
  CORPUS_PORT must be a port number between 0 and 65535 (0 binds an ephemeral port), got "notaport"
bad CORPUS_LOG_LEVEL
  CORPUS_LOG_LEVEL must be one of silent, info, debug — got "chatty"
unknown option
  unknown option --bogus; usage: corpus-server [--workspace <dir>]
```

**Deviation from TEST-34's parenthetical, deliberate.** TEST-34 offers "a 5-character
token" as its schema-failure example, but Adjudication 3 (later and binding) removes
`min(32)` from the reader — token strength is `corpus init`'s generator concern. The
schema-failure fixture is therefore an out-of-range `port`, which names its failing field
the same way. The adjudicated behaviour is verified separately: a 1-character token (the
shape CLI-001's fixture writes) boots with a warning and authenticates.

```
$ ./node_modules/.bin/tsx apps/server/src/main.ts --workspace /tmp/server003/short-token
{"level":"info","msg":"warning: the workspace token is 1 characters; `corpus init` generates at least 32","configPath":"/tmp/server003/short-token/.corpus/config.json"}
{"level":"info","msg":"listening on http://127.0.0.1:8791",...}
$ curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer t" .../api/openapi.json   → 200
```

**PASS**

**TEST-35 — resolution precedence** (`/tmp/server003/probe-resolution.sh`, reading the
resolved root off each server's real health payload):

```
(a) --workspace ws2 while CORPUS_WORKSPACE=ws    workspace=/tmp/server003/ws2
(b) CORPUS_WORKSPACE=ws from cwd=/tmp            workspace=/tmp/server003/ws
(c) cwd=ws/a/b/c, no env, no argument            workspace=/private/tmp/server003/ws
(d) cwd=/tmp, neither                            exit 1, "not a Corpus workspace; run `corpus init`" (above)
```

(c) reports `/private/tmp/...` because macOS `/tmp` is a symlink — same directory. **PASS**

**TEST-36 — `createServer` is pure with respect to ambient state.** Covered in
`app.test.ts`: with `CORPUS_WORKSPACE`, `CORPUS_PORT`, `CORPUS_LOG_LEVEL` and
`CORPUS_UI_DIST` all set to conflicting values, the app serves the *config's* workspace and
still reports 503 for `/` because the config said there is no UI. A spy on `process.exit`
that throws is never called. Structurally, `createServer` imports no `process.env` reader —
every env lookup lives in `config.ts`, every process interaction in `lifecycle.ts`. **PASS**

**TEST-37 — port collision.**

```
$ CORPUS_WORKSPACE=/tmp/server003/ws ./node_modules/.bin/tsx apps/server/src/main.ts   # second instance
exit=1
{"level":"error","msg":"port 8765 already in use — another corpus server may be running (corpus server status)"}
```

The documented message, and only that — the raw `EADDRINUSE` trace is deliberately
suppressed for `CorpusError`s (an anticipated failure already carries its own fix; an
*unanticipated* one still gets the full dump, asserted in `lifecycle.test.ts`). **PASS**

**TEST-38 — graceful, ordered, idempotent shutdown.** Against the real `main.ts`:

```
$ sh /tmp/server003/shutdown-e2e.sh <repo>
pid=48004 health=reachable
exit_status=0
curl_exit_after_shutdown=7 (7 == connection refused)
--- log ---
{"level":"info","msg":"listening on http://127.0.0.1:8765",...}
{"level":"info","msg":"request","method":"GET","path":"/api/health","status":200,"durationMs":1}
{"level":"info","msg":"shutting down","signal":"SIGTERM"}
{"level":"info","msg":"shutdown complete","signal":"SIGTERM"}
```

Disposer ordering and signal idempotence, via a probe that registers two disposers through
the public `registerDisposer` seam and takes two `SIGTERM`s:

```
listening on http://127.0.0.1:8766
SIGNAL SIGTERM received
SIGNAL SIGTERM ignored (already shutting down)
DISPOSER second-registered
DISPOSER first-registered
shutdown complete
exit_status=0  curl_exit_after_shutdown=7
```

Reverse registration order, one dispose per disposer, exit 0, socket refused.

The 5 s backstop, same probe with a disposer that hangs on a ref'd timer:

```
SIGNAL SIGTERM received
SIGNAL SIGTERM ignored (already shutting down)
BACKSTOP forcing exit
exit_status=1  elapsed_seconds=5
```

*Observation worth recording for SERVER-004+*: a disposer that hangs on a promise with **no**
pending I/O does not trigger the backstop — Node drains its event loop and exits 0 on its
own, because the backstop timer is `.unref()`ed as specified. The process still goes away,
which is the requirement; a subsystem that wants its cleanup guaranteed must keep the loop
alive while it runs. The probe deliberately hangs on a ref'd timer, the realistic
stuck-handle shape. `lifecycle.test.ts` asserts the same backstop in-process: armed at
exactly `SHUTDOWN_GRACE_MS`, `unref()`ed once, firing `exit(1)`. **PASS**

**TEST-39 — `localhostOnly` exists, works, is not mounted.** Unit-tested in
`middleware/localhost.test.ts` driven through Hono's real node-server `env` bindings:
`127.0.0.1`, `::1`, `::ffff:127.0.0.1` allowed; `10.0.0.5` gets 403 with an
`ApiError`-parseable body; `X-Forwarded-For`, `X-Real-IP` and `Forwarded` are ignored in
both directions. Not mounted on any route in this issue — `grep -rn "localhostOnly"
apps/server/src --include=*.ts` outside its own module and test hits only the `index.ts`
re-export. The 403 carries `code: "unauthorized"` because Adjudication 2 pins the four
CONTRACT-001 codes and `forbidden` arrives with CONTRACT-002; the *status* stays honest.
**PASS**

**TEST-41 — the development entry point.**

```
$ CORPUS_WORKSPACE=/tmp/server003/ws npm run dev -w apps/server
> tsx watch src/main.ts
{"level":"info","msg":"listening on http://127.0.0.1:8765","url":"http://127.0.0.1:8765","port":8765,"workspace":"/tmp/server003/ws","version":"0.0.0"}
{"level":"info","msg":"request","method":"GET","path":"/api/health","status":200,"durationMs":1}
{"level":"info","msg":"shutting down","signal":"SIGTERM"}
{"level":"info","msg":"shutdown complete","signal":"SIGTERM"}
```

`npm run build` from the repo root succeeds afterwards. **PASS**

**Deferred.** TEST-71 / TEST-73 / TEST-74 (CLI composition) and TEST-72 / TEST-75
(CONTRACT-002 regeneration, one-config-two-readers) are `DEFERRED → CLI-001 / CONTRACT-002`:
neither had landed at verification time. Substitute evidence held by this issue: every
error body emitted above parses as `@corpus/contract`'s `ApiErrorSchema` (asserted in
`app.test.ts`, `middleware/auth.test.ts`, `middleware/localhost.test.ts`), the health
payload parses as `HealthSchema`, and the health handler is registered via
`app.openapi(contractRoutes.getHealth, …)` with no cast or shim — `npm run typecheck`
passes across all workspaces.

### Gate

```
npm run build        ✓ (contract → kit → cli → server/ui)
npm run lint         ✓ 0 errors, 0 warnings
npm run format:check ✓ all matched files use Prettier code style
npm run typecheck    ✓ all workspaces
npx vitest run       ✓ 65 files, 1122 tests passed (server workspace: 730)
coverage             ✓ All files 99.23% lines / 96.26% branches / 100% functions
                       (gate 90%; only main.ts is uncovered — 19 lines of process wiring)
```

### Reconciliation with CONTRACT-002 (post-merge, model: opus)

SERVER-003 was implemented in parallel with CONTRACT-002 against CONTRACT-001's four error
codes. CONTRACT-002 (+ its `internal_error` addendum) landed seven — `bad_request`,
`unauthorized`, `forbidden`, `not_found`, `conflict`, `locked`, `internal_error` — which
broke one test and obsoleted two deliberate workarounds. Resolved here:

1. **`errors.ts` — `internal_error` is a contract citizen.** The `InternalErrorBody`
   interface and the `ErrorBody = ApiError | InternalErrorBody` alias are deleted;
   `HttpError.body` is now plainly `ApiError`. The 500 body is typed against the whole
   `ApiError` union, **not** a route's inferred response union — no route declares a 500 by
   design (a contract test now enforces that asymmetry), so there is no route type to widen
   from. The "deliberately outside the union" commentary is gone; `internalError`'s docstring
   now records *why* the code is in the union while the response stays undeclared.
2. **`errors.ts` — new `forbidden(message)` factory** (403, `{code: "forbidden"}`, no
   `WWW-Authenticate`: retrying with a credential does not help).
3. **`middleware/localhost.ts`** no longer hand-builds an `HttpError(403, {code:
   "unauthorized"})` as the "closest available" code — it calls `forbidden(...)`. This
   **supersedes the last two sentences of TEST-39 above**: the status was always honest, and
   now the code is too. `localhost.test.ts` asserts `code === "forbidden"` on a real Hono
   dispatch with node-server `env` bindings; the guard is still mounted nowhere (SERVER-009).
4. **`errors.test.ts`** — the pin `"uses only the four codes CONTRACT-001 declares"` asserted
   set *equality* with `ERROR_CODES` and could never survive the union growing. Rewritten to
   the adjudicated reality: every factory's code is a member of `ERROR_CODES` (one-directional
   — `conflict` is declared but has no factory until the lock routes land), each factory emits
   a distinct code, and `internal_error` is explicitly asserted to be **in** `ERROR_CODES`
   with its body now `ApiErrorSchema.safeParse(...).success === true` (it previously asserted
   `false`). A single `ALL_FACTORY_ERRORS` fixture drives the subset, distinctness and
   `ApiError`-parse assertions so a future factory cannot be added to one list and missed by
   another.

No other `until CONTRACT-002 lands` markers remained in the staged SERVER-003 code
(`grep -rn "CONTRACT-002\|until CONTRACT\|four codes\|closest available\|TODO\|FIXME"
apps/server/src` → only the new test title).

**Re-verified E2E** against a real server (`tsx apps/server/src/main.ts` in a scratch
workspace, port 8791, real `curl`):

```
GET /api/health                       → 200 {"status":"ok","version":"0.0.0",…}
GET /api/openapi.json    (no token)   → 401 www-authenticate: Bearer
                                        {"code":"unauthorized","message":"missing or invalid workspace token — …"}
GET /api/openapi.json    (bad token)  → 401 same body
GET /api/nope            (good token) → 404 {"code":"not_found","message":"no route matches GET /api/nope"}
SIGTERM                               → "shutting down" → "shutdown complete", socket refused
```

Live OpenAPI document served by the running server: **34 paths, 0 declaring a `500`**,
`403`/`ForbiddenError` declared on 5 routes, and the string `internal_error` absent from the
document entirely — exactly the asymmetry the contract intends (the code exists for the
handler, the response is never promised). The `forbidden` guard itself is not reachable over
HTTP yet because SERVER-009 mounts it; its 403 is covered by real-dispatch unit tests.

**Gate after reconciliation** (everything green, zero failures):

```
npm run build        ✓ (contract → kit → cli → server/ui)
npm run lint         ✓ 0 errors, 0 warnings
npm run format:check ✓ all matched files use Prettier code style
npm run typecheck    ✓ all 5 workspaces
npm run test:coverage ✓ 85 files, 1677 tests passed, 0 failed
                       (apps/server alone: 148 suites / 747 tests passed)
coverage             ✓ All files 99.55% lines / 96.18% branches / 100% functions
                       (apps/server/src 97.04% lines; gate 90%)
```

### Post-eval edge pin — Adjudication 6 (2026-07-26, model: opus)

Portless config parses and defaults to 8765; a routable `host` parses too and is refused at
the **bind**, not the read — superseding the TEST-34 line above ("non-loopback host →
_is not a valid workspace config_"), which recorded the pre-Adjudication-6 behaviour.

```
$ cat /tmp/corpus-s003-edge/ws/.corpus/config.json     # portless
{"version":1,"token":"8815…8831"}
$ CORPUS_WORKSPACE=… ./node_modules/.bin/tsx apps/server/src/main.ts
{"level":"info","msg":"listening on http://127.0.0.1:8765","port":8765,…}
$ lsof -nP -iTCP:8765 -sTCP:LISTEN → node … TCP 127.0.0.1:8765 (LISTEN)
$ curl -s -o /dev/null -w '%{http_code}' …/api/health → 200   (openapi.json with token → 200)

$ cat …/config.json                                    # {"version":1,"token":"…","host":"0.0.0.0"}
$ tsx -e 'readWorkspaceConfig(ws)'                     # the file PARSES — the CLI shares it
{"version":1,"port":8765,"host":"0.0.0.0","token":"8815…8831","dataDir":"data"}
$ CORPUS_WORKSPACE=… ./node_modules/.bin/tsx apps/server/src/main.ts
exit=1
{"level":"error","msg":"refusing to bind \"0.0.0.0\": this version of corpus serves loopback only — set \"host\" to 127.0.0.1 in /tmp/corpus-s003-edge/ws/.corpus/config.json, or remove the key to use the default"}
$ lsof -nP -iTCP:8765 -sTCP:LISTEN → (nothing bound)

$ …"host":"localhost", CORPUS_PORT=8799 → listening on http://localhost:8799, health 200
```

No stack trace on the refusal (anticipated `CorpusError`), nothing bound, exit 1. Scoped
gate: `npx vitest run apps/server` ✓ 30 files / 773 tests, `eslint` + `prettier --check` +
`tsc --noEmit` on `apps/server` ✓. **PASS**

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-003]` prefix
