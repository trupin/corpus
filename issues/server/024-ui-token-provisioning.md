# [SERVER-024] Provision the bearer token to the served UI

## Domain

server

## Status

done

## Priority

P1

## Model

opus — one endpoint or one injection point; the security reasoning is already settled by Decision 5 (localhost bind + token).

## Dependencies

- Depends on: SERVER-003
- Blocks: UI-003 (the board must fetch real data when served by the production server)

## Spec References

- CLAUDE.md Architecture Decision 5 (localhost bind + bearer token)
- `issues/sprints/sprint-008.md` — Open Conflict 3 (discovery: `UNPROVISIONED_TOKEN = ""`, no injection in `mountStaticUi`, no `/api/config`)

## Summary

Nothing provisions the workspace bearer token to the browser: the kit takes `{ baseUrl, token }` as config (UI-002), dev uses a `VITE_CORPUS_TOKEN` env var, but the production server serving the built UI hands it no token — every hook 401s. Decide and implement the provisioning mechanism (e.g. the server injects config into the served `index.html`, or a loopback-only tokenless `GET /api/config` mirroring the job-ingest hardening pattern), with the security tradeoff written down.

## Acceptance Criteria

- [x] The production-served UI obtains the token without manual steps; dev flow unchanged.
- [x] The mechanism's security rationale documented in the module (why it does not widen Decision 5's model).
- [x] E2E: `corpus server start` → browser (or curl of the served page + config surface) → authenticated API call succeeds.

## Technical Design

**Mechanism: HTML injection into the served `index.html`** (sprint-009 Open Conflict 8's
recommendation, adjudicated). No contract route — a `GET /api/config` would be a new endpoint in
`packages/contract`, which a SERVER change may not touch (§9.3), and it costs a second round trip
before the first authenticated request.

- `apps/server/src/ui-runtime-config.ts` (new) — the whole mechanism and the security rationale:
  `serializeRuntimeConfig` (JSON + `<`/`>`/`&`/U+2028/U+2029 escaping), `renderRuntimeConfigScript`
  (`<script id="corpus-runtime-config" type="application/json">…</script>` — a data block, inert),
  `injectRuntimeConfig` (splices just inside `<head>`), and `refuseUnsafeTokenDelivery`, which
  **reuses** the shipped `localhostOnly` + `noBrowserOrigin` middlewares rather than reimplementing
  peer-address or `Origin` handling.
- `apps/server/src/static-ui.ts` — `StaticUiOptions` gains `token`; `isAppShellPath()` routes `/`,
  `/index.html` and any directory path through `serveAppShell` instead of `serveStatic`, so **every**
  response carrying the shell goes through one guarded path. The tokenized shell is `no-store` +
  `X-Frame-Options: DENY`; assets are untouched and keep their immutable caching.
- `apps/server/src/app.ts` — passes `config.token` to `mountStaticUi`.
- `apps/ui/src/app/apiClient.ts` (narrow declared exception) — `injectedToken()` reads the block;
  precedence is **injected wins, `VITE_CORPUS_TOKEN` is the fallback**, documented in the module.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

**implemented on: opus**

### Post-Implementation Verification

Environment: worktree `.claude/worktrees/server-024`, `npm install` first, `npm run build` (which
builds `apps/ui/dist`). Scratch workspace `mktemp -d /tmp/corpus-s024-XXXXXX` →
`/tmp/corpus-s024-r6r0lh`, port **8935**, removed at the end. `8765` verified UNBOUND before and
after. All process cleanup by captured pid. Tokens redacted to a prefix throughout.

**Setup (TEST-112 — the real installed shape)**

```
$ node --import tsx apps/cli/src/bin/corpus.ts init /tmp/corpus-s024-r6r0lh --port 8935
Initialized Corpus workspace at /tmp/corpus-s024-r6r0lh
  port 8935, token in .corpus/config.json (mode 600)
$ stat -f "%Sp" .corpus/config.json     →  -rw-------          (600 before AND after the run)
$ node -e '…' .corpus/config.json       →  token prefix Fi39FsTT…  len 43
$ CORPUS_UI_DIST=$PWD/apps/ui/dist node --import tsx apps/cli/src/bin/corpus.ts server start
corpus 0.0.0 listening on http://127.0.0.1:8935 (pid 40404)
```

**TEST-97 — zero manual steps, real browser, authenticated data.** Headless Chromium (Playwright
1.62) opened the printed URL with no env var, no edited file, no pasted token:

```
== API/SSE responses the page itself made ==
  200 GET /api/health
  200 GET /events?<query>
  200 GET /api/docs?<query>
  401 GET /api/docs?<query>
== browser-context authenticated call == {
  resolved: true, tokenPrefix: 'HB44La…',
  withToken: 200, withoutToken: 401,
  titles: [ 'Attention', 'Inbox', 'Open threads' ], total: 6 }
== uncaught page errors == 0 []
== console strip == "▴consolecorpus 0.0.0"      (not "server unreachable")
```

The `200 GET /api/docs` / `401 GET /api/docs` pair is the page resolving its own credential exactly
as `apiClient.ts` does and calling an authenticated route with and without it. Note the shipped
production bundle has no board yet (UI-003), so `/api/docs` is the browser-context reproduction; the
page's **own** authenticated call is `200 GET /events?token=…`, which 401s with a wrong token.

Raw request/response pair, by hand:

```
$ curl -sS -D - http://127.0.0.1:8935/
HTTP/1.1 200 OK
cache-control: no-store
content-type: text/html; charset=utf-8
x-frame-options: DENY

<!doctype html>
<html lang="en">
  <head><script id="corpus-runtime-config" type="application/json">{"token":"Fi39Fs…"}</script>
    <meta charset="UTF-8" />
$ curl -H "Authorization: Bearer <token read out of that block>" '…/api/docs?limit=3'  → 200
    items: 3  total: 6  titles: Attention, Inbox, Open threads
$ curl '…/api/docs?limit=3'                                                            → 401
    {"code":"unauthorized","message":"missing or invalid workspace token …"}
```

**TEST-98 — the SSE stream authenticates too.** `/events` 200 in the browser (above). By hand, and
live across an out-of-band CLI mutation:

```
$ curl -N "…/events?token=$TOK" &      → :connected
$ corpus doc create --title "SERVER-024 live check" --type note --folder inbox
created doc_ghht66ku — data/docs/inbox/server-024-live-check.md
event: invalidate
data: {"keys":[["docs"],["docs","doc_ghht66ku"],["tree"]]}
$ curl -N "…/events?token=nope"        → 401
```

**TEST-99 — the dev flow is unchanged.** `5273` was held by a sibling agent, so the dev server ran on
`5279` (`5173` is held by an unrelated `ssh`); the command is otherwise the documented one:

```
$ CORPUS_SERVER_ORIGIN=http://127.0.0.1:8935 \
  VITE_CORPUS_TOKEN="$(node -e 'console.log(require(p).token)' …/.corpus/config.json)" \
  npm run dev -w apps/ui -- --port 5279 --strictPort
== dev page: injected config block present? == false
== responses == [ '200 /api/health', '200 /events?<query>' ]
== uncaught == 0
```

Vite serves the unmodified `index.html` (no block), so the `200 /events` proves the env-var fallback
carried the credential through the proxy. Same dev server **without** `VITE_CORPUS_TOKEN`:
`[ '200 /api/health', '401 /events?<query>' ]`, 0 uncaught errors, strip still renders — TEST-101's
quiet degradation.

**TEST-100 — precedence.** Injected wins; env var is the fallback. Documented in
`apps/ui/src/app/apiClient.ts` (the env var is a *build-time* guess about which workspace will serve
the bundle; the injected value comes from the server that just handed out this page). Tested in both
orders in `apiClient.test.ts`: injected-only, env-only, both-present (injected wins), injected-empty
(falls back).

**TEST-102 — the written rationale.** `apps/server/src/ui-runtime-config.ts`, module header. It
names: who can obtain the token through this path (loopback peer, no `Origin` — the two shipped
guards); what an unauthorized process would have to do (run on this machine and connect to the
loopback port — the server refuses to bind anywhere else); why that is not weaker than reading
`.corpus/config.json` for the workspace's own user (that user already holds the file and every
markdown file behind the API); **the residual, named** (loopback ports are not owner-scoped, so a
*different* local uid gains something the 0600 file would not — the same exposure the shipped
job-log ingest route already accepts for an unauthenticated write); and what would make it weaker
(dropping either guard or allowlisting `Origin` values; letting the token ride a cacheable response;
putting the token in a URL; serving the shell framable; weakening the escaping).

**TEST-103/104/105 — the guard, on a real server.**

```
$ curl -H "Origin: https://evil.example"  …/       → 403 {"code":"forbidden","message":"this endpoint refuses requests carrying an Origin header; it is not a browser API"}
$ curl -H "Origin: http://127.0.0.1:8935" …/       → 403   (same-origin-looking is refused too)
$ curl -H "Origin: https://evil.example"  …/doc/abc→ 403   (the SPA fallback is the same shell)
$ curl -H "X-Forwarded-For: 8.8.8.8"      …/       → 200   (the peer IS loopback; the header is ignored)
$ lsof -nP -iTCP:8935 -sTCP:LISTEN                 →  TCP 127.0.0.1:8935 (LISTEN)
$ curl http://192.168.68.52:8935/                  →  curl (7) Couldn't connect  (no non-loopback path exists at all)
```

A non-loopback *peer* cannot be produced over a real socket because the bind refuses it, so the
`localhostOnly` half is proven at the unit level with a synthesized peer address
(`ui-runtime-config.test.ts`: `192.168.1.50` → 403, `203.0.113.7` + `X-Forwarded-For: 127.0.0.1` →
403, no peer address → 403) plus the bind evidence above.

**TEST-106 — the token appears only where the mechanism puts it.**

```
$ grep -rl "$TOK" .corpus | grep -v config.json   → (nothing; server.log is clean)
$ grep -c "$TOK" <hashed js asset>                → 0
$ grep -c "$TOK" <hashed css asset>               → 0
$ stat -f "%Sp" .corpus/config.json               → -rw-------
```

**Escaping, with a crafted token in `config.json`.** Token replaced with
`</script><script>window.__pwned=1</script><img/src=x/onerror=alert(1)>&"'` + backtick + `<>`
(no whitespace: the shipped `parseBearerHeader` rejects any credential containing whitespace, which
predates this issue). Server restarted; served page:

```
<script id="corpus-runtime-config" type="application/json">{"token":"</script><script>window.__pwned=1</script><img/src=x/onerror=alert(1)>&\"'`<>"}</script>
round-trips: true
<script tags in served page: 3   closers: 3    (pristine index.html has 2 — exactly one added)
```

Real browser on that page: `window.__pwned == null`, `dialogs opened == 0`,
`uncaught page errors == 0`, and the hostile token still authenticated:
`withToken: 200, withoutToken: 401, total: 6`. An ordinary token was restored afterwards and the
probe re-run with the same result.

**TEST-108 — the missing-build path is unchanged.** Real server started with
`CORPUS_UI_DIST=/tmp/corpus-s024-no-such-dist`:

```
$ curl …/          → 503  "UI build not found — run `npm run build -w apps/ui` (dev) or reinstall the corpus package"
$ curl …/doc/abc   → 503
$ curl …/api/health→ 200
```

The guard runs *after* the shell is read, precisely so a missing build stays a 503 and never becomes
a 403.

**TEST-109 — every other asset is unchanged.**

```
$ curl -D - …/assets/index-XseFK-6h.js  → 200, cache-control: public, max-age=31536000, immutable
$ curl -H "Origin: http://127.0.0.1:8935" …/assets/index-XseFK-6h.js → 200
```

The `Origin` guard is deliberately **not** applied to assets: same-origin ES module scripts are
fetched in CORS mode and DO send `Origin`, so guarding every static response would break the app it
protects. Assets carry no token (greps above), reserved prefixes still fall through, and the deep
SPA route still returns the shell (200). The one adjudicated deviation: the **tokenized** shell moved
from `no-cache` to `no-store` (plus `X-Frame-Options: DENY`); an untokenized shell is byte-identical
to before, including its `no-cache`.

**TEST-107 — no contract change.** Files touched: `apps/server/src/ui-runtime-config.ts` (new),
`apps/server/src/ui-runtime-config.test.ts` (new), `apps/server/src/static-ui.ts`,
`apps/server/src/static-ui.test.ts`, `apps/server/src/app.ts`, `apps/server/src/app.test.ts`,
`apps/ui/src/app/apiClient.ts`, `apps/ui/src/app/apiClient.test.ts`, and this issue file. **Nothing
under `packages/contract`**; `ENDPOINT_INVENTORY` is untouched (the mechanism adds no route).

**TEST-110 — `apps/ui` stays inside the kit's rules.** The resolution lives in one named module,
`apps/ui/src/app/apiClient.ts` (the provider wiring). `grep -rn "fetch(\|@corpus/contract/client"
apps/ui/src` (non-test) returns exactly the one pre-existing line inside `createUiClient`. The kit
was not touched and still takes the token as pure configuration.

**TEST-111 — the unit suite.** `apps/server/src/ui-runtime-config.test.ts` (new, 24 cases:
escaping incl. `</script>`, HTML comment openers, JSON escapes, U+2028/29, non-ASCII; injection
placement and fallbacks; the loopback and `Origin` refusals). `apps/server/src/static-ui.test.ts`
(+13: injection on `/`, `/index.html` and deep routes, `no-store`, `X-Frame-Options`, no injection
into assets, immutable caching intact, hostile-token escaping, 403 refusals, assets still served to
an `Origin`-bearing request, the 503 unchanged, and the no-token path byte-identical).
`apps/ui/src/app/apiClient.test.ts` (+10: injected present/absent/empty, both-orders precedence,
hostile characters, and five malformed-block degradations). Modifications to shipped tests, with
reasons: `static-ui.test.ts`'s `INDEX_HTML` gained a `<head>` (realistic shell; body assertions use
the constant, so nothing weakened); `app.test.ts`'s two shell requests now pass loopback bindings
(`app.request` synthesizes no socket, and the shell is now credential-bearing).

**Full check suite**

```
npm run build     → green (contract → kit → cli → server + ui)
npm run lint      → 0 errors, 0 warnings
npm run format:check → all files use Prettier code style
npm run typecheck → green in every workspace
npm test          → 215 test files, 3871 tests, all passed  (baseline 214 files; +1 is this issue's)
CORPUS_UI_PORT=5279 npm run e2e → 13 passed  (5273 was held by a sibling agent; 8765 unbound throughout)
```

**Post-refinement re-verification.** After the checks above, `isAppShellPath` was tightened from
"any trailing slash or `index.html` basename" to exactly `/` and `/index.html`, so a nested
`index.html` a build ships keeps `serveStatic`'s old behaviour and gets no token. Because that
changes serving, the E2E was re-run on a second scratch workspace (`corpus init --port 8935`,
`corpus server start`):

```
/              cache-control: no-store  content-type: text/html; charset=utf-8  x-frame-options: DENY  (block: 1)
/index.html    cache-control: no-store  content-type: text/html; charset=utf-8  x-frame-options: DENY  (block: 1)
/doc/abc       cache-control: no-store  content-type: text/html; charset=utf-8  x-frame-options: DENY  (block: 1)
/assets/index-XseFK-6h.js   cache-control: public, max-age=31536000, immutable   token occurrences: 0
Origin: https://evil.example on /   → 403
GET /api/docs with the injected token → 200
```

(The hashed asset does contain the literal string `corpus-runtime-config` — that is
`apiClient.ts`'s own constant compiled into the bundle, not an injection. The **token** count is 0.)

Cleanup: both servers stopped by pid, both scratch workspaces removed, `8935` / `5279` / `8765` all
verified free, no stray probe scripts left in the worktree.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [x] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-024]` prefix
