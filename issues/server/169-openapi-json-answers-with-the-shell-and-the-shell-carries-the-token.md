# [SERVER-169] `/openapi.json` answers with the shell, and the shell carries the token

## Domain

server

## Status

todo

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

- [ ] A defined set of well-known API-ish paths does **not** receive the SPA
      shell. They receive a 404 (or a redirect to the real document where one
      exists) with no token in the response.
- [ ] `/openapi.json` specifically either 404s or redirects to
      `/api/openapi.json`. Whichever is chosen is stated in the module comment
      with the reason.
- [ ] The chosen behaviour is expressed as data next to `RESERVED_PREFIXES`, not
      as an `if` chain in the middleware, so the list is reviewable in one place.
- [ ] Deep links the React router owns (`/doc/<id>`, `/board/<name>`, and the
      rest) still reach the shell. The fix must not break the SPA fallback, which
      is the reason the fallback exists.
- [ ] `/doc` — the bare path, no id — is decided explicitly: it is both a
      plausible API convention and a plausible router path. Say which it is and
      why, in the comment.
- [ ] A test asserts that a 200 HTML response is never returned for any entry in
      the new list, and that the response body for those paths contains no token.
- [ ] An existing test that a legitimate deep link still gets the shell is kept
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

_[Agent fills: include the actual `curl -i` output for the reproduction and the
verification, with the token redacted but its presence/absence stated. State
which model the implementing agent ran on.]_

### Reproduction (bugs only)

_[Agent fills]_

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] `ui-runtime-config.ts`'s "what would make it weaker" list re-read and none
      of its entries violated
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0 and security-sensitive — qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-169]` prefix
