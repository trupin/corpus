# [SERVER-169] `/openapi.json` answers with the shell, and the shell carries the token

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Origin

Re-filed 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger),
Phase 7 eval ledger additions, 2026-07-31:

> **`/openapi.json` and `/doc` fall through to the SPA shell** — a 200 with HTML
> (carrying the runtime-config bearer token, by SERVER-024 design) answers what a
> tool meant as an API request; the real document lives at `/api/openapi.json`.
> Consider a 404 or redirect for well-known API-ish paths at triage.
> Localhost-only; not urgent.

The 2026-09-06 audit re-checked the path and raised the priority. The ledger's
own "not urgent" was written about the wrong-answer half. The half that matters
is that the wrong answer is **credential-bearing**: an unauthenticated GET of a
mistyped API path returns 200 with the workspace bearer token embedded in it.

## Spec References

- SPEC.md §2.1 — the installed tool bundles the UI and the server hands it out
  statically
- SPEC.md §9.2 — the API surface; the OpenAPI document lives under `/api`
- Architecture Decision 5 — localhost bind plus a bearer token

## Summary

`mountStaticUi` answers every non-reserved `GET`/`HEAD` with the SPA shell when no
static file matches. `RESERVED_PREFIXES` is `["/api", "/attachments", "/events"]`,
so `/openapi.json`, `/doc`, `/openapi.yaml`, `/swagger.json` and every other
well-known API-ish path miss the reserved list, miss the static files, and land on
`serveAppShell` — which returns **200 with `index.html` and the runtime bearer
token injected into it**. A tool that asks for the schema at the conventional
place gets a credential instead of a 404, and has no way to tell a typo from an
outage.

The three guards in `ui-runtime-config.ts` (loopback peer, no browser `Origin`,
loopback `Host`) are intact and this is not a remote exposure. They are also
exactly what an ordinary local `curl` satisfies, so any local process that can
open the port — including one running as a different local user, the residual
that module names — obtains the token by asking for `/openapi.json`.

## Acceptance Criteria

- [x] A defined set of well-known API-ish paths does **not** receive the SPA
      shell. They receive a 404 (or a redirect to the real document where one
      exists) with no token in the response.
- [x] `/openapi.json` specifically either 404s or redirects to
      `/api/openapi.json`. Whichever is chosen is stated in the module comment
      with the reason.
- [x] The chosen behaviour is expressed as data next to `RESERVED_PREFIXES`, not
      as an `if` chain in the middleware, so the list is reviewable in one place.
- [x] Deep links the React router owns (`/doc/<id>`, `/board/<name>`, and the
      rest) still reach the shell. The fix must not break the SPA fallback, which
      is the reason the fallback exists.
- [x] `/doc` — the bare path, no id — is decided explicitly: it is both a
      plausible API convention and a plausible router path. Say which it is and
      why, in the comment.
- [x] A test asserts that a 200 HTML response is never returned for any entry in
      the new list, and that the response body for those paths contains no token.
- [x] An existing test that a legitimate deep link still gets the shell is kept
      or added.

## Technical Design

### Files to Create/Modify

- `apps/server/src/static-ui.ts` — `RESERVED_PREFIXES` (line 25), `isReservedPath`
  (lines 30-32), the middleware in `mountStaticUi` (lines 100-124), and
  `serveAppShell` (lines 139-172).
- `apps/server/src/static-ui.test.ts` — the new cases.

### Key Implementation Details

`apps/server/src/static-ui.ts:19-32` is the existing list and its stated rule:

```ts
/**
 * Path prefixes the UI never owns. They must fall through to routing (and from
 * there to the 404 handler) rather than being answered with `index.html` — an
 * API client that receives an HTML shell instead of an error has no way to tell
 * a typo from an outage.
 */
export const RESERVED_PREFIXES = ["/api", "/attachments", "/events"] as const;
```

The docblock already states the principle this issue is about. The list is simply
short. Note that `RESERVED_PREFIXES` entries are **prefixes**, matched as `path
=== prefix || path.startsWith(`${prefix}/`)`. The new entries are mostly exact
filenames (`/openapi.json`), not prefixes, so they want a second list and a second
predicate rather than being jammed into this one.

`apps/server/src/static-ui.ts:100-124` is the middleware:

```ts
  app.use("*", async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD") return next();
    if (isReservedPath(c.req.path)) return next();

    if (staticHandler !== undefined && !isAppShellPath(c.req.path)) {
      …
    }

    return serveAppShell(c, distDir, logger, token);
  });
```

Reserved paths `next()` into routing and reach the 404 handler. The simplest fix
adds a second guard beside line 103 for the exact-match list. Prefer that over
touching `serveAppShell`, because the invariant being restored is "this path never
reaches the shell", and the guard belongs where the other one is.

`apps/server/src/static-ui.ts:136-142` is the shell path the token rides:

```ts
async function serveAppShell(
  c: GuardedContext,
  distDir: string | undefined,
  logger: Logger,
  token: string,
): Promise<Response> {
```

The injection itself (line 158, `injectRuntimeConfig(html, { token })`) is
**correct and stays** — SERVER-024 designed it, and `ui-runtime-config.ts` carries
the full security rationale plus an explicit list of "what would make it weaker".
Read that list before touching anything: this fix must not drop a guard, widen a
`Host` allowlist, or make the shell cacheable. It narrows *which paths* reach the
shell and nothing else.

Suggested list to start from, to be settled by the implementing agent:
`/openapi.json`, `/openapi.yaml`, `/swagger.json`, `/.well-known/*`, `/health`,
`/metrics`. Justify additions and omissions in the comment. Do not add anything
the React router actually routes.

### Edge Cases

- A workspace whose UI build genuinely contains a file at one of these names.
  `serveStatic` runs before the fallback, so a real file still wins — confirm
  that ordering is preserved, and decide whether it should be (a UI build
  shipping `/openapi.json` would be surprising but is not this issue's problem).
- `HEAD` follows `GET` through the same guard.
- The 404 that routing produces for these paths should be the API's `ApiError`
  JSON shape where the path looks like an API request. Check what the 404 handler
  currently returns for a non-`/api` path before asserting on it.
- No token may appear in the refusal body. `refuseUnsafeTokenDelivery` already
  guarantees this for its own refusals — the new path must match.

## Testing Strategy

Unit tests over the mounted app: each entry in the new list returns a non-200,
non-HTML response and its body contains neither the token nor `<!doctype`. A
control case asserts `/doc/abc123` still returns the shell with the token, so the
SPA fallback is proven intact rather than assumed.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus server start` in a workspace. Note the token in `.corpus/config.json`.
2. `curl -i http://localhost:<port>/openapi.json`
3. Expected: 404, or a redirect to `/api/openapi.json`.
4. Actual: `200`, `Content-Type: text/html`, and the response body contains the
   workspace bearer token in the injected runtime-config block.
5. Repeat for `/doc`.

### Verification Steps

1. Rebuild and restart the server.
2. `curl -i http://localhost:<port>/openapi.json` → expect the decided answer,
   and grep the body for the token to confirm it is absent.
3. `curl -i http://localhost:<port>/api/openapi.json` → unchanged, still the real
   document.
4. Open the board in a browser and navigate to a deep link (`/doc/<id>`) with a
   hard reload — the shell must still be served and the UI must still
   authenticate, proving the runtime-config channel is untouched.

## E2E Verification Log

Implementing agent: server-dev, running on **opus** (Claude Opus 5.5).

Scratch workspace: `corpus init <scratchpad>/ws169 --port 8931`, then
`corpus server start`, built from this worktree. The token was read from
`.corpus/config.json`. Every body below has the token replaced by
`<REDACTED-TOKEN>`, and each probe states whether the raw response contained it.
The user's server on 8765 was never touched.

### Reproduction (bugs only)

```
== GET /openapi.json
HTTP/1.1 200 OK
cache-control: no-store
content-type: text/html; charset=utf-8
x-frame-options: DENY
Content-Length: 1545

  <head><script id="corpus-runtime-config" type="application/json">{"token":"<REDACTED-TOKEN>"}</script>
    <meta charset="UTF-8" />
    <title>Corpus</title> …
-- token PRESENT in response
== GET /doc
HTTP/1.1 200 OK
content-type: text/html; charset=utf-8
… same shell …
-- token PRESENT in response
```

Controls at the same time: `GET /api/openapi.json` without a token → `401`
`{"code":"unauthorized",…}`, with the token → `200` OpenAPI 3.1.0 JSON.
`GET /api/health` → `200`, unauthenticated. So the real schema was behind the
bearer guard while the mistyped path handed out the bearer itself.

### Post-Implementation Verification

Server stopped, restarted from the patched source, same workspace and port.

```
== GET /openapi.json
HTTP/1.1 307 Temporary Redirect
cache-control: no-cache
location: /api/openapi.json
-- token absent
== HEAD /openapi.json
HTTP/1.1 307 Temporary Redirect
cache-control: no-cache
location: /api/openapi.json
-- token absent
== GET /doc
HTTP/1.1 307 Temporary Redirect
location: /api/openapi.json
-- token absent
== GET /health
HTTP/1.1 307 Temporary Redirect
location: /api/health
-- token absent
== GET /swagger.json
HTTP/1.1 404 Not Found
Content-Type: application/json
{"code":"not_found","message":"no route matches GET /swagger.json"}
-- token absent
== GET /.well-known/security.txt
HTTP/1.1 404 Not Found
Content-Type: application/json
{"code":"not_found","message":"no route matches GET /.well-known/security.txt"}
-- token absent
== GET /api/openapi.json  (with bearer)          -- unchanged
HTTP/1.1 200 OK
Content-Type: application/json
{"openapi":"3.1.0","info":{"title":"Corpus API",…
curl -L /openapi.json (no bearer) -> final 401 at http://127.0.0.1:8931/api/openapi.json
== GET /doc/doc_seedboardattention                -- deep link, real seed doc id
HTTP/1.1 200 OK
cache-control: no-store
content-type: text/html; charset=utf-8
x-frame-options: DENY
<!doctype html> … <script id="corpus-runtime-config" type="application/json">{"token":"<REDACTED-TOKEN>"}</script> …
-- token PRESENT in response (the SPA fallback and the runtime-config channel are intact)
== GET /
HTTP/1.1 200 OK, cache-control: no-store   -- unchanged
```

Not done: the browser hard-reload in Verification step 4. The deep-link curl
shows the shell, its `no-store`/`DENY` headers and the runtime-config block are
byte-for-byte the pre-fix shape, and `serveAppShell` and `ui-runtime-config.ts`
are unchanged by this diff.

Checks: `VITEST_MAX_WORKERS=4 vitest run apps/server/src/static-ui.test.ts
apps/server/src/app.test.ts apps/server/src/ui-runtime-config.test.ts` → 3
files, 212 tests passed. `eslint` and `prettier --check` on both touched files
clean. `tsc --noEmit -p apps/server/tsconfig.json` exit 0.

### Decisions

- **`/openapi.json` redirects (307) to `/api/openapi.json`.** The document
  exists, in the same format, one level down. A 404 would say "no schema"
  when the truth is "it lives here". The target answers an unauthenticated
  caller with a 401 that names the token, so a typo is still distinguishable
  from an outage. 307, not 308, so a browser does not cache the move forever.
  The `Location` is a fixed path and carries no token.
- **Bare `/doc` is reserved (exact) and redirects to the document.** It is
  `@hono/zod-openapi`'s documented `app.doc("/doc", …)` location. It is not a
  router path: `apps/ui/src/app/App.tsx` routes `/` and `*` to the same `Shell`
  and nothing in `apps/ui` or `packages/kit` reads a path segment
  (`useParams`/`useLocation`/`window.location` appear only in the dev-only
  `DataProbe`). `/doc/<id>` and `/doc/` still reach the shell.
- **`/health` redirects to the contract's `HEALTH_PATH`** (same probe, no
  token needed). `/openapi.yaml`, `/openapi.yml`, `/swagger.json`,
  `/swagger.yaml`, `/healthz`, `/metrics` and the `/.well-known/` prefix fall
  through to routing's `ApiError` JSON 404: this server publishes no YAML form,
  no Swagger 2.0 document, and no k8s/Prometheus format.
- **Not listed:** `/docs`, `/swagger-ui` — by convention HTML for a person.
- **Ordering:** the guard sits after `serveStatic` and before the shell, so a
  file the UI build really ships under a listed name still wins (it is our own
  bytes and carries no token). A test pins that.
- The list is data (`WELL_KNOWN_PATHS` map + `WELL_KNOWN_PREFIXES`) next to
  `RESERVED_PREFIXES`, read by one predicate `wellKnownAnswer`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] `ui-runtime-config.ts`'s "what would make it weaker" list re-read and none
      of its entries violated
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0 and security-sensitive — qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-169]` prefix
