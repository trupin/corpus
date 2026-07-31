# [SERVER-033] Migrate @hono/node-server to v2 (serve-static path traversal advisory)

## Domain

server

## Status

done

## Priority

P1

## Model

opus — a dependency major with the full server suite + e2e as the bar.

## Dependencies

- Depends on: SERVER-003
- Blocks: —

## Spec References

- npm advisory: @hono/node-server <2.0.5 — path traversal in `serve-static` (moderate)
- issues/infra/010-audit-brace-expansion-vitest-peer.md

## Summary

`npm audit` flags the server's `@hono/node-server@^1.19.0`: a path-traversal advisory in the
adapter's `serve-static`, patched only in ≥2.0.5 (a major). The Corpus server serves the built UI
statically, so the surface is nominally ours; mitigations already in place: the localhost bind,
~~the bearer guard in front of the UI routes~~ (**corrected — see the log: there is no such guard;
`mountStaticUi` is deliberately unauthenticated per SERVER-024, so the localhost bind is the only
mitigation that holds**), and the attachment route's own hardened traversal guard (SERVER-010) which
does not use the adapter's serve-static. Confirm during the migration whether the static-UI path
uses the adapter's `serveStatic` at all. **It does** (`static-ui.ts:10,98`).

**The real hazard is not `serveStatic` at all** (sprint-018's diligence): two security guards read
`c.env.incoming`, an adapter binding — `localhostOnly`'s peer address and the attachment route's raw
request target — and both degrade *silently* to `undefined` under an adapter shape change, with the
whole shipped suite staying green. That is what the two new real-listener specs exist for.

Migrate to `@hono/node-server@^2.0.12`: absorb the v2 API changes (server creation, serve-static
options), full `apps/server` suite + e2e green, and an explicit traversal probe against the
static-UI route in the E2E log (encoded/backslash/dotted paths → 404, mirroring SERVER-010's
matrix).

## Acceptance Criteria

- [x] `@hono/node-server@^2` in apps/server; boot, SSE, static UI, attachments all green
      (unit + e2e). — declared `^2.0.12`, installed `2.0.12`; `vitest run apps/server` 2505/2505.
      The repo-wide e2e run is the orchestrator's harvest gate.
- [x] `npm audit` no longer reports the adapter advisory. — 3 findings → 2, only UI-016's remain.
- [x] Traversal probe matrix against the static-UI route logged pre/post migration. — 18 rows,
      both runs, with a positive control proving the detector fires.
- [x] **(added by sprint-018, Adjudication 4)** Both `c.env.incoming` guards verified over real
      HTTP, not through `app.request` — two new real-listener spec files, plus a stub-mutation run
      showing `attachments/serve.test.ts` stays green through the degradation they catch.
- [x] **(added by sprint-018, TEST-591)** `scripts/package-manifest.test.ts`'s pinned range follows.

## E2E Verification Log

**implemented on: opus** (Opus 5, 1M context). Sprint contract: `issues/sprints/sprint-018.md`,
criteria `TEST-581`–`TEST-592`. Port `8792`. Scratch:
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-server/033-1fDD95` (created with `mktemp -d`,
never glob-deleted). Every drill ran with `cwd` = that scratch directory (`pwd` pasted in each run's
header), never inside this repository.

### What actually changed

Production code: **nothing**. The entire migration is one dependency range.

| File | Change |
| ---- | ------ |
| `apps/server/package.json` | `"@hono/node-server": "^1.19.0"` → `"^2.0.12"` |
| `package-lock.json` | the adapter's three lines (declared range, `node_modules/@hono/node-server` version + resolved + integrity) |
| `scripts/package-manifest.test.ts:25,60` | the pinned fixture range, `^1.19.0` → `^2.0.12` |
| `apps/server/src/middleware/localhost.real-listener.test.ts` | **new** (4 tests) |
| `apps/server/src/attachments/serve.real-listener.test.ts` | **new** (8 tests) |

`src/app.ts`, `src/static-ui.ts`, `src/middleware/localhost.ts`, `src/attachments/serve.ts` are
**untouched** — v2 kept `serve(options, (info: AddressInfo) => void) => ServerType`,
`ServerType = Server | Http2Server | Http2SecureServer`, `HttpBindings.incoming: IncomingMessage`,
and `serveStatic`'s `return next()` on a miss. `tsc --noEmit` was clean on the first try.

### Two corrections to this issue's own text

1. **"the bearer guard in front of the UI routes" does not exist.** `app.ts:229-255` mounts
   `createBearerAuth` on `/api/*`, `/attachments`, `/attachments/*` and `/events` only;
   `mountStaticUi` is registered last (`app.ts:422`) and serves the built UI **unauthenticated**, by
   design (SERVER-024 — the shell is how an installed build learns its token). Confirmed live: on
   the pre-migration run `GET /` answered `200 text/html` with the injected
   `<script id="corpus-runtime-config">` and **no** `Authorization` header, while `/api/nope`,
   `/attachments/nope` and `/events` each answered `401`. The `serve-static` surface is reachable
   with no credential; **the localhost bind is the mitigation that actually holds**.
2. **The static UI does use the adapter's `serveStatic`** (`static-ui.ts:10,98`) — so the advisory's
   surface is ours. Positive control below proves the handler is live on that route.

### TEST-581 — the advisory is gone and the version is real

```
# before
$ npm audit
@hono/node-server  <2.0.5
Severity: moderate
Node.js Adapter for Hono: Path traversal in `serve-static` on Windows via encoded backslash (`%5C`)
  - https://github.com/advisories/GHSA-frvp-7c67-39w9
node_modules/@hono/node-server
react-router  6.0.0 - 7.17.0   … (UI-016's, 2 advisories)
3 moderate severity vulnerabilities

$ node -p "require('./node_modules/@hono/node-server/package.json').version"
1.19.17

# after
$ npm install            # changed 1 package, audited 563 packages
$ node -p "require('./node_modules/@hono/node-server/package.json').version"
2.0.12
$ npm ls @hono/node-server
corpus-monorepo@0.0.0 /Users/theophanerupin/code/corpus
└─┬ @corpus/server@0.0.0 -> ./apps/server
  └── @hono/node-server@2.0.12
$ npm audit
react-router  6.0.0 - 7.17.0   … (UI-016's, 2 advisories)
2 moderate severity vulnerabilities
```

Installed version pasted from the tree, not the manifest (INFRA-010's lesson). The adapter finding
is gone; **no new finding was introduced** — the count dropped 3 → 2 and the only remaining entries
are UI-016's react-router pair. `npm ls --workspaces --depth=0` reports no invalid, unmet or
extraneous entry; `hono` stays `4.12.32`, satisfying v2's `peerDependencies: {"hono": "^4"}`.
`npm run version:check` → `every manifest is 0.0.0` (TEST-654).

### TEST-582 — the traversal probe matrix, over real HTTP, before and after

Setup: `apps/ui/dist` copied to `…/033-1fDD95/uiroot/dist`, so `CORPUS_UI_DIST` pointed the server at
a tree with a **real canary outside it** — `…/uiroot/secret.txt` and `…/033-1fDD95/secret.txt`, both
containing `CORPUS-TRAVERSAL-CANARY`. Every probe used `curl --path-as-is`, and each response body
was grepped for the canary string and for `/etc/hosts` content.

**Positive control first — the detector and the handler are both live.** A canary placed *inside*
dist is served by `serveStatic`, and the detector fires on it:

```
$ curl -s --path-as-is -D - http://127.0.0.1:8792/canary-inside.txt
HTTP/1.1 200 OK
cache-control: no-cache
content-type: text/plain; charset=utf-8
last-modified: Fri, 31 Jul 2026 07:47:21 GMT
CORPUS-TRAVERSAL-CANARY-INSIDE-DIST
```

**pre-migration (1.19.17)** and **post-migration (2.0.12)** — identical, row for row:

```
desc                              path                                          status  leak?     content-type
CONTROL canary is readable        /../secret.txt                                200     no-leak   text/html; charset=utf-8
raw dotted                        /../../secret.txt                             200     no-leak   text/html; charset=utf-8
raw dotted deep                   /../../../../../../etc/hosts                  200     no-leak   text/html; charset=utf-8
single-encoded                    /%2e%2e/secret.txt                            200     no-leak   text/html; charset=utf-8
single-encoded slash              /%2e%2e%2fsecret.txt                          200     no-leak   text/html; charset=utf-8
mixed ..%2f                       /..%2fsecret.txt                              200     no-leak   text/html; charset=utf-8
double-encoded                    /%252e%252e%252fsecret.txt                    200     no-leak   text/html; charset=utf-8
backslash                         /..\..\secret.txt                             200     no-leak   text/html; charset=utf-8
encoded backslash (ADVISORY)      /..%5csecret.txt                              200     no-leak   text/html; charset=utf-8
encoded backslash deep            /%2e%2e%5c%2e%2e%5csecret.txt                 200     no-leak   text/html; charset=utf-8
encoded backslash upper           /..%5Csecret.txt                              200     no-leak   text/html; charset=utf-8
absolute                          //etc/hosts                                   200     no-leak   text/html; charset=utf-8
encoded absolute                  /%2fetc%2fhosts                               200     no-leak   text/html; charset=utf-8
NUL                               /secret.txt%00                                200     no-leak   text/html; charset=utf-8
NUL suffixed traversal            /..%2fsecret.txt%00                           200     no-leak   text/html; charset=utf-8
asset dir traversal               /assets/../../secret.txt                      200     no-leak   text/html; charset=utf-8
asset dir encoded traversal       /assets/%2e%2e%2f%2e%2e%2fsecret.txt          200     no-leak   text/html; charset=utf-8
asset dir encoded backslash       /assets/%2e%2e%5c%2e%2e%5csecret.txt          200     no-leak   text/html; charset=utf-8
```

Every one is the SPA shell, never the file's bytes, in both runs.

**Was v1.19.17 exploitable here? No, and the honest reason is that the fix was already in it.** I
extracted 1.19.17's own `dist/serve-static.mjs` from its npm tarball: its traversal guard is
`/(?:^|[\/\\])\.{1,2}(?:$|[\/\\])|[\/\\]{2,}|\\/` — **byte-identical to 2.0.12's**, including the
bare `\\` alternative that is the advisory's fix. The advisory's range (`<2.0.5`) is wider than the
code warrants for the 1.19.x tail. Two further reasons the surface was never reachable on this
platform: the WHATWG URL parser resolves `..`, `%2e%2e` and `\` before routing (so most rows never
reach `serveStatic` as traversals at all), and the advisory is Windows-specific. **The upgrade
closes the audit finding; it does not close an exploitable hole in this deployment.** That is the
finding, and it is worth stating rather than implying the opposite.

### TEST-583 — the attachment guard still sees the unnormalized target

**A passing suite is not evidence here, and I proved that rather than asserting it.** With
`rawRequestTarget` stubbed to `return undefined` (a temporary local mutation, reverted immediately
and verified byte-identical afterwards):

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run \
    apps/server/src/attachments/serve.real-listener.test.ts \
    apps/server/src/middleware/localhost.real-listener.test.ts \
    apps/server/src/attachments/serve.test.ts \
    apps/server/src/middleware/localhost.test.ts
 Test Files  3 failed | 1 passed (4)
      Tests  13 failed | 108 passed (121)
```

**The one file that stayed green is `attachments/serve.test.ts`** — exactly the silent degradation
sprint-018 predicted. The five failures in `serve.real-listener.test.ts` are the new coverage.

Live evidence, both runs (`curl --path-as-is`, bearer token attached):

```
-- legitimate attachment serves its bytes --                     [pre 1.19.17 and post 2.0.12, identical]
HTTP/1.1 200 OK
cache-control: private, max-age=31536000, immutable
content-disposition: attachment; filename="att.txt"; filename*=UTF-8''att.txt
content-type: text/plain; charset=utf-8
x-content-type-options: nosniff
attachment-bytes-ok

-- THE DISCRIMINATOR: a raw target the WHATWG parser normalizes back onto the REAL attachment.
   With the raw-target check alive this is a 404; with c.env.incoming gone the route is handed a
   perfectly valid path and answers 200 with the bytes.
   /attachments/th_af2sozp4/2026-07-31T07%3A43%3A27Z/nonexistent/%2e%2e/att.txt  -> 404
   /attachments/th_af2sozp4/2026-07-31T07%3A43%3A27Z/nonexistent/../att.txt      -> 404
   both bodies: {"code":"not_found","message":"no such attachment"}

   (proof the normalization is real:
    new URL("http://x/attachments/th_x/TS/nonexistent/%2e%2e/att.txt").pathname
      === "/attachments/th_x/TS/att.txt")

-- every form serve.test.ts:112-125 enumerates, over the wire --  [pre and post, identical]
raw ..            encoded ..        mixed .%2e        single dot %2e    backslash
encoded backslash empty segment     absolute          NUL               nonexistent
double-encoded
→ all 11: 404 {"code":"not_found","message":"no such attachment"}  (one uniform body, no oracle)
```

And the binding is asserted directly, not inferred: `serve.real-listener.test.ts`'s
`the adapter's raw request target > reaches c.env.incoming.url unnormalized` sends
`/attachments/th_a/ts/nonexistent/%2e%2e/note.txt` on a real socket and asserts `c.env.incoming.url`
equals that string **byte-for-byte** under v2.

### TEST-584 — the loopback guard still reads a peer address

```
-- POST /api/jobs/{id}/log, real socket, real claimed event --   [pre and post, identical]
loopback accept (no token)  -> 201 {"eventId":"evt_jcwm2gesnahi","appended":true}
with browser Origin         -> 403 {"code":"forbidden","message":"this endpoint refuses requests
                                    carrying an Origin header; it is not a browser API"}
spoofed X-Forwarded-For     -> 201  (the header cannot talk the guard out of its answer)
-- .corpus/jobs/evt_jcwm2gesnahi.jsonl --
{"ts":"2026-07-31T07:43:27Z","source":"hook","line":"from 127.0.0.1"}
{"ts":"2026-07-31T07:43:27Z","source":"hook","line":"xff"}
```

The `201` is the load-bearing result: `undefined` from `getPeerAddress` fails closed as `403`, which
is indistinguishable from a working guard when you only probe the refusal side. `localhost.test.ts`
would have caught a *total* shape change (it asserts the pure function), so
`localhost.real-listener.test.ts` closes the other half: the shipped `serve()` really does hand the
guard a socket. Under the same stub mutation, 3 of its 4 cases fail.

**Non-loopback leg — DEFERRED → stronger result available.** This machine does have a second IPv4
interface (`192.168.68.52`), but the server binds `127.0.0.1`, so the connection is **refused at the
socket** before any guard runs (`curl → 000`, "connection refused"). There is no 403 to observe
because there is no connection. The loopback-accept `201` above is the substitute evidence the
criterion asks for, and the refused connection is a strictly stronger outcome than a 403.

### TEST-585 — the static-UI contract

```
                           pre 1.19.17                                     post 2.0.12
GET /                      200  cache-control: no-store  text/html  X-Frame-Options: DENY   identical
GET /index.html            200  cache-control: no-store  text/html  X-Frame-Options: DENY   identical
GET hashed asset           200  cache-control: public, max-age=31536000, immutable          identical
GET /doc/deep-link         200  cache-control: no-store  text/html  (the SPA shell)         identical
GET /api/nope              401  application/json  (falls through to routing, never HTML)    identical
GET /attachments/nope      401  application/json                                            identical
GET /events                401  application/json                                            identical
POST /                     404  application/json  (next()s past the static handler)         identical
HEAD hashed asset          200  cache-control: public, max-age=31536000, immutable          identical
runtime config injected into the shell: 1 occurrence of id="corpus-runtime-config"          identical
miss reaches the SPA fallback (id="root" in /doc/deep-link):  1                             identical
```

Both undocumented v1 behaviours `static-ui.ts` rides on **survive v2**, and I checked the source as
well as the wire:

- **`serveStatic` returns `undefined` on a miss.** v2's implementation still ends the miss path with
  `return next()` (`dist/serve-static.mjs`), so the inner `next` `static-ui.ts:109` supplies —
  `() => Promise.resolve(undefined)` — still yields `undefined` and the SPA fallback still runs.
  Observed: `/doc/deep-link` is the shell, not a 404. A v2 that threw or answered its own 404 would
  have broken every deep link at once.
- **`Cache-Control` is still settable on the returned Response after the fact.** The hashed asset
  carries `public, max-age=31536000, immutable`, which `static-ui.ts:115` sets *after*
  `serveStatic` builds the Response.

**One observable difference, and it is additive.** v2's `serve-static` sets
`Last-Modified: <mtime>` on every hit; 1.19.17 set no `Last-Modified` at all and instead set a
(wrong) `Date: <birthtime>` inside the range branch only — I read both sources to be sure rather
than diffing header dumps. Full post-migration header set for a hashed asset:

```
HTTP/1.1 200 OK
cache-control: public, max-age=31536000, immutable
content-length: 1232135
content-type: text/javascript; charset=utf-8
last-modified: Fri, 31 Jul 2026 07:28:32 GMT      <- new in v2; correct where v1's `Date` was wrong

# Range still works, now with a proper 416/edge handling path:
HTTP/1.1 206 Partial Content
accept-ranges: bytes
content-range: bytes 0-9/1232135
```

The shell path (`serveAppShell`, which never goes through `serveStatic`) is byte-identical.

### TEST-586 — an ephemeral bind still reports its real port

`app.test.ts`'s `createServer — lifecycle > binds an ephemeral port and answers over a real socket`
asserts `address.port > 0`, `address.url === http://127.0.0.1:<port>`, and a real `fetch` of
`/api/health` — green, unmodified. v2's declared signature is
`serve(options, listeningListener?: (info: AddressInfo) => void)`, so `info.port` (`app.ts:465`) is
still the bound port; the two new spec files bind the same way and the whole 124-file suite (which
uses `port: 0` throughout) is green. Corroborating detail: eslint's
`no-unnecessary-type-assertion` flagged an `info as AddressInfo` cast I had written defensively —
v2 types it directly. The cast was removed rather than kept.

### TEST-587 — graceful shutdown still terminates

Real server, with a parked `GET /api/queue/idle?timeout=480` long poll, an attached
`curl -sN /events?token=…`, and an idle keep-alive connection (4 ESTABLISHED connections counted at
`lsof` before the signal):

```
pre  1.19.17:  shutdown took 171 ms; process alive? no;  8792 free
post 2.0.12:   shutdown took 172 ms; process alive? no;  8792 free
server log: {"msg":"shutting down","signal":"SIGTERM"}
            {"msg":"request","path":"/api/queue/idle","status":204,"durationMs":3145}
            {"msg":"shutdown complete","signal":"SIGTERM"}
```

Seconds, not the long poll's 480 s window. `closeIdleConnections` is still satisfied: v2's
`ServerType` is still `Server | Http2Server | Http2SecureServer`, so the duck-typed lookup in
`app.ts:202-210` still finds `http.Server#closeIdleConnections` — if it had silently no-op'd, the
keep-alive connection would have held `close()` for its idle timeout and the number above would be
seconds, not 172 ms.

### TEST-588 — the named server specs stay green, unmodified

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server
 Test Files  124 passed (124)
      Tests  2505 passed (2505)
   Duration  44.38s
```

**Not one of the 17 named specs was edited** — `app.test.ts`, `lifecycle.test.ts`,
`middleware/auth.test.ts`, `middleware/localhost.test.ts`, `static-ui.test.ts`,
`attachments/serve.test.ts`, `events/sse.test.ts`, `queue/routes.test.ts`, `queue/service.test.ts`,
`jobs/routes.test.ts`, `locks/routes.test.ts`, `locks/write-guard.test.ts`, `docs/routes.test.ts`,
`projection/routes.test.ts`, `projection/attach.test.ts`, `watcher/attach.test.ts`,
`skills/rollback.test.ts`. No assertion anywhere was weakened, deleted or relaxed; the only test
change in `apps/server` is **two entirely new files** adding 12 tests (2493 → 2505). The v2 type
rename that the criterion anticipated did not happen — no spec's imports needed touching.

### TEST-589 — SSE is unaffected

```
                        [pre and post, identical]
:connected
event: invalidate
data: {"keys":[["jobs"],["jobs","evt_jcwm2gesnahi"]]}
event: invalidate
data: {"keys":[["jobs"],["jobs","evt_jcwm2gesnahi"]]}
event: invalidate
data: {"keys":[["docs"],["docs","doc_de6gapqp"]]}
PUT /api/docs/doc_de6gapqp -> 200
```

Heartbeat and subscriber pruning are covered by `events/sse.test.ts`, green and unmodified; the
`close()` drill above also proves an attached stream is released on shutdown rather than holding it.

### TEST-590 — the type surface did not get looser

```
$ cd apps/server && ../../node_modules/.bin/tsc --noEmit
SERVER TYPECHECK CLEAN
$ ./node_modules/.bin/eslint apps/server scripts/package-manifest.test.ts
ESLINT CLEAN
$ ./node_modules/.bin/prettier --check <the four touched files>
All matched files use Prettier code style!

$ /usr/bin/grep -n "as unknown as\|@ts-expect-error\|@ts-ignore\|eslint-disable\|: any\b\|<any>" \
    apps/server/src/attachments/serve.real-listener.test.ts \
    apps/server/src/middleware/localhost.real-listener.test.ts \
    scripts/package-manifest.test.ts apps/server/package.json
NONE FOUND
```

The strongest statement available: **no production line changed at all**, so no cast, `any`,
`@ts-expect-error` or suppression could have been introduced to absorb a v2 type change. The
migration went the other way — v2's types are *tighter*: eslint deleted a cast I had written.

### TEST-591 — the packaging manifest follows, and nothing else moved

`scripts/package-manifest.test.ts:25` and `:60` now pin `"@hono/node-server": "^2.0.12"`; without
this a server-only bump passes the whole server suite and fails CI's `pack:check`.

```
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run scripts/package-manifest.test.ts
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

The externalised-specifier list (`scripts/package-manifest.ts:90-91`) still names both
`@hono/node-server` and `@hono/node-server/serve-static` and needed no change — v2 kept the
`./serve-static` subpath export (it dropped `./vercel` and the `globals` entry, neither of which
this repo imports; `/usr/bin/grep -rn "hono/node-server"` over the tree, `node_modules` and
`package-lock.json` excluded, shows the only importers are `static-ui.ts`, `app.ts` and the two new
specs). `package-lock.json` carries exactly the adapter's three lines:

```
$ /usr/bin/grep -n "@hono/node-server" package-lock.json
54:        "@hono/node-server": "^2.0.12",
1196:    "node_modules/@hono/node-server": {
1198:      "resolved": "https://registry.npmjs.org/@hono/node-server/-/node-server-2.0.12.tgz",
```

No workspace version moved (`npm run version:check` ✓). No `dist-package/` or tarball artifact was
produced by this issue; the pre-existing untracked `corpus-0.0.0.tgz` at the repo root was left
alone. `packages/contract`, `packages/kit` and `apps/ui` were not opened.

**`git diff`/`git status` legs — DEFERRED → this agent is forbidden from running any git command
(CLAUDE.md; server-dev agent definition).** Substitute evidence: the complete file inventory in the
"What actually changed" table above (six paths, nothing else was written), plus:

```
$ ls -d /Users/theophanerupin/code/corpus/.corpus
ls: /Users/theophanerupin/code/corpus/.corpus: No such file or directory      (TEST-652 ✓)
$ /bin/ls -1 /Users/theophanerupin/code/corpus
apps assets CLAUDE.md corpus-0.0.0.tgz coverage-raw design dist-package docs eslint.config.js
issues LICENSE node_modules package-lock.json package.json packages plugins README.md scripts
SPEC.md tsconfig.base.json vitest.config.ts
```

No `data/`, no `.corpus/`, no `.claude/skills/`, no clobbered `README.md`/`.gitignore`, no stray
Playwright output. (`coverage-raw/` and `dist-package/` are gitignored, lines 6 and 9.) The
orchestrator should run the `git diff --stat` leg at harvest.

### TEST-592 — `corpus server start` still boots a browsable board

Fresh workspace, `cwd` outside this repository, from-source CLI (`node --import tsx
apps/cli/src/bin/corpus.ts`, never `npx`):

```
$ pwd
/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-server/033-1fDD95/ws2
$ corpus init --port 8792
  port 8792, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
$ corpus server start --workspace "$WS"
corpus 0.0.0 listening on http://127.0.0.1:8792 (pid 63910)      exit=0
$ curl http://127.0.0.1:8792/           -> 200 text/html; charset=utf-8, 1x id="root"
$ corpus server start --workspace "$WS"
already running on :8792 (pid 63910) — http://127.0.0.1:8792     exit=0
$ corpus server status --workspace "$WS"
running — pid 63910 on :8792, corpus 0.0.0, up 1s, http://127.0.0.1:8792   exit=0
$ corpus server stop --workspace "$WS"
stopped (pid 63910)                                              exit=0
$ corpus server status --workspace "$WS"
not running / corpus: the workspace server is not running        exit=6
$ lsof -nP -iTCP:8792 -sTCP:LISTEN
8792 free
```

§15 M3's check passes end to end against the v2 adapter.

### Machine hygiene

- Ports used: **`8792` only**. Free at the end (`lsof -nP -iTCP:8792 -sTCP:LISTEN` → nothing).
  **`8765` was never bound, never killed, never proxied into**; `8791`, `5274` and the `5xxx` Vite
  range were never touched (this issue starts no dev server).
- Every server this issue started was stopped by recorded pid (`kill -TERM $PID`), never by
  `pkill`/`killall`.
- Scoped tests only. One workspace-scoped run (`vitest run apps/server`) at the end, plus targeted
  single-file runs during development; `VITEST_MAX_THREADS=4` throughout. No `npm run e2e`, no
  `npm run coverage`, no repo-wide suite, no `npm run build` (only `contract`/`kit` `dist/` were
  needed and both were already current).
- One `npm install`, run alone (Adjudication 3). No other heavy command overlapped it.
- All grep-based claims above came from `/usr/bin/grep`.

### Unresolved / for the orchestrator

1. **`git diff --stat`, `git diff packages/contract`, `git diff apps/ui`, `git status --porcelain`**
   (TEST-591, TEST-647–TEST-651) — not runnable by this agent; the file inventory above is the
   substitute. Please run them at harvest.
2. **`npm run pack:check`** builds and packs and is explicitly outside a domain agent's scoped-test
   budget; `scripts/package-manifest.test.ts` (23 tests) is green with the new pin, which is the
   unit-level half. The full `pack:check` runs in CI.
3. **The honest security finding** (TEST-582): 1.19.17 already carried the identical traversal
   regex, and the advisory is Windows-only. The upgrade is correct and closes the audit finding, but
   nobody should record it as having closed an exploitable hole in this deployment.
4. **`static-ui.ts` gains a `Last-Modified` header on assets under v2.** Additive, correct, and it
   replaces a header v1 set wrongly (`Date: birthtime`). No test asserted the absence of
   `Last-Modified`, so nothing had to change — flagging it because "byte-identical" is not literally
   true and the evaluator should see it stated rather than discover it.

## Completion Checklist (domain agent)

- [x] Tests written and passing — 12 new (4 + 8) in two new real-listener spec files;
      `apps/server` 2505/2505 across 124 files; `scripts/package-manifest.test.ts` 23/23
- [x] `/lint` passes — eslint clean on `apps/server` and the touched script test, prettier clean,
      `tsc --noEmit` clean in `apps/server` (repo-wide `/lint` is the orchestrator's gate)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
