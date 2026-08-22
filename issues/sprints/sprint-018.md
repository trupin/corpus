# Sprint 018 — Phase 6 backlog: two dependency majors, and four promises the product still owes

**Issues**: SERVER-033, UI-016 (the deferred migration pair) · SERVER-038, UI-020, UI-021, CLI-018
(the Phase 5 carry-over backlog)
**Domains**: server, ui, cli
**Branch**: the Phase 6 branch (`phase-6-*`), orchestrator-owned
**Date**: 2026-07-30
**Test numbering**: continues the ladder from sprint-017's `TEST-580`; this sprint runs
`TEST-581`–`TEST-656`.

**SHARED-003 is not in this contract.** The PR #11 non-blocking-findings ledger is triage the
orchestrator performs itself (CLAUDE.md — SHARED-\* issues are orchestrator-handled); it produces no
code and has no acceptance tests here. Where a finding in that ledger touches an issue in this batch
it is named inline below, and nowhere else.

---

## What this wave is

Two bodies of work that share a branch and nothing else.

**The deferred pair — SERVER-033 and UI-016 — are dependency majors, and their acceptance bar is
the absence of change.** Both were held out of Phase 5 for capacity, both close `npm audit`
findings, and neither is allowed to alter one byte of observable behavior. That inverts the usual
evaluation: for every other issue in this repo the question is "did the new behavior arrive?"; for
these two it is "**can you prove nothing moved?**" A migration that lands green because a test was
relaxed, or because a guard silently stopped firing, is the exact failure mode, and both of these
issues sit on top of security-relevant code — a path-traversal advisory in one, an open-redirect
advisory in the other. Each gets a **named list of specs that must stay green** below, because
"the suite passed" is not evidence when the suite is what you were allowed to edit.

**The other four are promises the shipped product makes and does not keep.** §10 says
"@agent pin me a view of unresolved finance threads just works" — no CLI verb writes a view key
(CLI-018). §7 says an archived skill is "restorable" — the reader menu offers Archive with no
inverse, and the only inverse the UI could reach is the one SERVER-039 just closed (UI-020).
SERVER-037 fixed the creation of invisible documents and said so plainly in its own log: it cleans
up nothing already committed, and `db doctor` is structurally silent about them (SERVER-038). The
server pinned a form-turn rule and documented, in a docblock, that the renderer disagrees with it
(UI-021).

The framing that matters for the evaluator: **for the four, the bar is the promise being kept; for
the two, the bar is the promise being unchanged.**

---

## Machine rules — binding on every agent in this batch

### Ports

Verified at contract time (2026-07-30, `lsof -nP -iTCP:<port> -sTCP:LISTEN`): **`8765` is bound by
node pid 15627** — the maintainer's live personal server. **`8791` is bound** (pid 44370) and
**`5274` is bound** (pid 45071) by work in flight today. `8790` is the pre-push hook's pinned
`CORPUS_SERVER_ORIGIN` (INFRA-011) and `5273` is its e2e Vite port. `8792`–`8801` and `5275`–`5279`
were each probed and are **free**.

| Consumer             | Server range  | Primary | Vite dev port |
| -------------------- | ------------- | ------- | ------------- |
| SERVER-033           | `8792`–`8793` | `8792`  | —             |
| SERVER-038           | `8794`–`8795` | `8794`  | —             |
| UI-016               | `8796`        | `8796`  | `5275`        |
| UI-020               | `8797`        | `8797`  | `5276`        |
| UI-021               | `8798`        | `8798`  | `5277`        |
| CLI-018              | `8799`–`8800` | `8799`  | `5278`        |
| sprint-018 evaluator | `8801`        | `8801`  | `5279`        |
| Automated tests, every workspace | — | `0` (ephemeral). **Never hardcode.** | — |

**`8765` is NEVER bound, NEVER killed, and NEVER proxied into, by anyone, for any reason.** It is
the maintainer's live corpus (user directive, 2026-07-29; it respawns, so a kill is not even
recoverable-by-inaction). The hazard is structural in two places:

1. `corpus init` with no `--port` probes upward from `DEFAULT_PORT` 8765
   (`apps/cli/src/commands/init/port.ts`), so **every `corpus init` in this sprint passes `--port`
   explicitly**, including runs expected to fail.
2. `apps/ui/vite.config.ts:14` is
   `const SERVER_ORIGIN = process.env.CORPUS_SERVER_ORIGIN ?? "http://127.0.0.1:8765";` and proxies
   `/api`, `/events` and `/attachments` to it. **An agent that starts `npm run dev -w apps/ui`
   without exporting `CORPUS_SERVER_ORIGIN` sends every write the browser makes — creates, `PUT`s,
   `DELETE`s — into the maintainer's personal corpus.** UI-020 in particular drives archive and
   unarchive, which move folders on disk.

So, for every agent that starts a dev server:

```sh
export CORPUS_SERVER_ORIGIN="http://127.0.0.1:<your primary port>"   # BEFORE npm run dev
npm run dev -w apps/ui -- --port <your vite port> --strictPort
```

Start your own `corpus server` **first**, then the dev server, then **prove the proxy is yours** and
paste it: a request through the dev port must be answered by your server — e.g.
`curl -s http://127.0.0.1:<vite port>/api/health` returning your workspace's health — while
`lsof -nP -iTCP:8765 -sTCP:LISTEN` still shows pid 15627 and nothing of yours. An agent that cannot
show that check has not verified anything, whatever its screenshots say.

`5173`/`5174` are held by an `ssh` process and `apps/ui/vite.config.ts` pins
`server.port: 5173, strictPort: true` without reading `CORPUS_UI_PORT`, so a bare
`npm run dev -w apps/ui` fails to start — always pass `-- --port <your port> --strictPort`.

**No issue in this batch runs `npm run e2e`.** Playwright is single-holder and starts its own Vite;
the orchestrator runs it once at harvest. Where a scoped Playwright run is unavoidable (UI-016 and
UI-020 only, see their sections), it is `./node_modules/.bin/playwright test <spec> --workers=1`
against the agent's own port, at most once, and never while another agent's dev server is up.

### Scratch directories

All scratch work lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp` — **never bare
`/tmp`**, and **never inside the repository**. This sprint uses one prefix per domain, with a
per-issue directory inside it:

| Issue      | Prefix                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------- |
| SERVER-033 | `mkdir -p …/tmp/s018-server && mktemp -d …/tmp/s018-server/033-XXXXXX`                       |
| SERVER-038 | `mkdir -p …/tmp/s018-server && mktemp -d …/tmp/s018-server/038-XXXXXX`                       |
| UI-016     | `mkdir -p …/tmp/s018-ui && mktemp -d …/tmp/s018-ui/016-XXXXXX`                               |
| UI-020     | `mkdir -p …/tmp/s018-ui && mktemp -d …/tmp/s018-ui/020-XXXXXX`                               |
| UI-021     | `mkdir -p …/tmp/s018-ui && mktemp -d …/tmp/s018-ui/021-XXXXXX`                               |
| CLI-018    | `mkdir -p …/tmp/s018-cli && mktemp -d …/tmp/s018-cli/018-XXXXXX`                             |
| evaluator  | `mkdir -p …/tmp/s018-eval && mktemp -d …/tmp/s018-eval/XXXXXX`                               |

(`…` is `/Users/theophanerupin/.claude/jobs/4dd0ddef`.) The domain prefix is **shared between two
agents in both the server and the ui lane** — so the rule that was already absolute is now
load-bearing: **never glob-delete a prefix.** Delete only paths you created and captured in a
variable. Automated tests use `fs.mkdtemp`/`mkdtempSync` and never these paths.

### Workspace creation — the subshell-cd rule still applies

```sh
# Preferred — the subshell cd is what makes the target real
( cd "$WS" && node --import tsx "$REPO/apps/cli/src/bin/corpus.ts" init --port 8792 )

# Legal since CLI-013, but only from a cwd outside this repository
corpus init --workspace "$WS" --port 8792
```

- **Every drill runs from a cwd OUTSIDE this repository.** Not the repo root, not a worktree, not
  any subdirectory of either. `cd` to your scratch directory first and `pwd` into the log. The
  2026-07-29 CLI-014 drill got this wrong and clobbered the repo's `README.md` and `.gitignore`
  irrecoverably.
- **Verify `/Users/theophanerupin/code/corpus/.corpus` is absent** at the end of your session and
  paste the check (TEST-652). Confirmed absent at contract time.
- From-source CLI is `node --import tsx apps/cli/src/bin/corpus.ts`, or the built
  `apps/cli/dist/bin/corpus.js` after `npm run build` — **never `npx`** (rtk rewrites it).

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node`, `killall node` kill sibling
agents' servers and the maintainer's `8765` server — **forbidden.** Stop what you started, by
recorded pid, and verify with `lsof -nP -iTCP:<port> -sTCP:LISTEN` before declaring done.

### Tests and load

- **Scoped tests only**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`. Never the
  repo-wide suite, never `npm test` unfiltered, never `npm run coverage` or `npm run test:coverage`,
  never `npm run e2e`. The orchestrator's harvest run is the single repo-wide gate.
- **One workspace-scoped run at the very end of your session is the maximum.**
- **Cap workers on every vitest invocation**: `VITEST_MAX_THREADS=4`.
- **One heavy command at a time** — never overlap builds, test runs, Playwright, or `npm install`.
  This matters more than usual here: **two of these issues run `npm install`** (a dependency major
  each), and an `npm install` racing another agent's build corrupts the shared `node_modules`.
  SERVER-033 and UI-016 therefore **never run concurrently with each other** (Adjudication 3).
- **Three concurrent implementation agents maximum.**
- `npm run build` before lint/typecheck/test — `@corpus/*` imports resolve through `dist/`.

### Grep, and why this rule exists

**Use `/usr/bin/grep` for any grep-based evidence.** The `rtk` proxy has produced **false
negatives** — a search that finds nothing when the string is present. Every "X does not appear
anywhere" claim in an E2E log must come from `/usr/bin/grep` with the command pasted, or it is not
evidence. This sprint leans on such claims harder than most: UI-016's whole scope argument is
"four files import the router and no others".

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed is marked `STRUCK → Adjudication N`,
`STRUCK → Open Conflict N`, or `DEFERRED → <reason>` in the E2E Verification Log, **with the reason
and the substitute evidence supplied**. Silent omission is a fail. Each agent also states
`implemented on: opus | fable` per CLAUDE.md's Record-actuals rule.

---

## Acceptance Tests

### SERVER-033: the adapter changes major version and nothing else changes

`apps/server` — `package.json`, `src/app.ts`, `src/static-ui.ts`, and whatever the v2 API forces.
Model: **opus**. Port `8792`. Spec: `SPEC.md` §9.2 (the route surface), §2.2 (localhost bind);
npm advisory `@hono/node-server` `<2.0.5` path traversal in `serve-static`.

Shipped state, confirmed at contract time: declared `^1.19.0`, installed **1.19.17**. Four
production files touch the adapter, and three of them are load-bearing in ways the issue does not
mention:

| Fact                                                                                                 | Where                                  |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `serve({fetch, hostname, port}, (info) => …)`; the callback's `info.port` is how an ephemeral bind reports its real port | `src/app.ts:462-477`                   |
| `ServerType` handle drives `server.on/off("error")`, `server.close(cb)`, and a duck-typed `closeIdleConnections()` | `src/app.ts:202-210, 440, 485-500`      |
| **The static UI does use the adapter's `serveStatic`** — `serveStatic({root: distDir})`, called manually inside a `use("*")` middleware, with the SPA shell paths routed around it | `src/static-ui.ts:10, 88, 96-105`      |
| `localhostOnly` reads the peer address from `c.env.incoming.socket.remoteAddress`                     | `src/middleware/localhost.ts:33-42`    |
| The attachment guard reads the **raw, unnormalized** request target from `c.env.incoming.url`          | `src/attachments/serve.ts:229-240`     |

The answer to the issue's open question is therefore **yes, the advisory's surface is ours** — this
is not a migration we can wave through on "we don't use serve-static".

A sixth fact the table cannot hold: the **packaging manifest pins the v1 range**.
`scripts/package-manifest.test.ts:25,60` asserts `"@hono/node-server": "^1.19.0"` and
`scripts/package-manifest.ts:90-91` externalises both `@hono/node-server` and
`@hono/node-server/serve-static`. A migration that updates only `apps/server/package.json` passes
the server suite and fails `npm run pack:check` in CI.

**And one mitigation the issue claims is not true.** Its summary lists "the bearer guard in front of
the UI routes" among the things bounding the exposure. There is no such guard: `app.ts:229-255`
mounts `createBearerAuth` on `/api/*`, `/attachments`, `/attachments/*` and `/events` **only**, and
`mountStaticUi` is registered last (`app.ts:422`) and serves the built UI **unauthenticated** —
deliberately, since the shell is how an installed build learns its token (SERVER-024). The
`serve-static` surface is therefore reachable with no credential, and the localhost bind is the
mitigation that actually holds. The E2E log states this correction rather than repeating the issue's
sentence.

#### The risk the issue does not name

`c.env.incoming` is an adapter binding, and **two security guards read it**. The attachment
traversal guard's own docblock says the fallback for an adapter that does not expose it is
`undefined` — "`app.request` in tests, an edge runtime in principle". So if v2 renames, restructures,
or normalizes that binding, `rawRequestTarget()` returns `undefined`, the raw-target check quietly
stops running, and **every unit test in `apps/server/src/attachments/serve.test.ts` still passes**,
because that file exercises the raw forms against `parseAttachmentPath` directly — its own header
says so. The same is true of `getPeerAddress`: a shape change makes it return `undefined`, which
today means "not loopback" and fails closed, but only if the shape change is total rather than
partial. **Neither guard can be verified through `app.request`.** Adjudication 4 makes real-HTTP
probes mandatory for both.

The coverage gap is structural and worth stating outright: **`static-ui.test.ts` and
`attachments/serve.test.ts` both drive `app.request(...)`, not a real listener** —
`static-ui.test.ts:45` builds "an app shaped like `createServer`'s". So the two highest-risk v2
surfaces, `serveStatic`'s behavior and `c.env.incoming`'s presence, are precisely the two with no
real-socket coverage anywhere in the repository. That is why this issue's acceptance is written
around `curl` rather than around vitest.

`static-ui.ts` also leans on two `serveStatic` behaviors a major is entitled to re-spec: it returns
**`undefined` on a miss** — which is what lets the SPA fallback run, the code handing it an inner
`next` that resolves to `undefined` precisely so a miss does not advance the real chain — and the
`Cache-Control` header is set on the returned Response **after the fact**. Both are load-bearing and
neither is a documented guarantee.

TEST-581: The advisory is gone and the version is real
  Given: `apps/server/package.json` and the installed tree
  When: `npm ls @hono/node-server` and `npm audit` are read
  Then: The declared range is `^2` and the **installed** version is ≥ `2.0.5`, pasted from
  `node_modules/@hono/node-server/package.json` — not just the manifest, because INFRA-010 already
  found one dependency in this repo whose declared major had never actually installed. `npm audit`
  no longer reports the `serve-static` path-traversal advisory, and reports no **new** finding
  introduced by the upgrade; the before/after audit output is pasted for both.

TEST-582: The traversal probe matrix, over real HTTP, before and after
  Given: A real server on `8792` serving a real built UI (`npm run build -w apps/ui`), and
  `curl --path-as-is`
  When: The static-UI route is probed with the SERVER-010 matrix — raw `../..`, single-encoded
  `%2e%2e%2f`, mixed `..%2f`, double-encoded `%252e%252e%252f`, backslash `..\..\`, encoded
  backslash `..%5c`, absolute `//etc/hosts`, encoded absolute `%2fetc%2fhosts`, and a NUL
  (`%00`) — each aimed at a file that exists outside the UI dist (create one; a hit must be
  provable, not merely absent)
  Then: **Every one is a 404 or the SPA shell, never the file's bytes**, pre-fix and post-fix, with
  both runs pasted. The pre-migration run is not ceremony: it is the baseline that makes the
  post-migration run mean something, and it is the only way to state honestly whether v1.19.17 was
  exploitable here at all.

TEST-583: The attachment guard still sees the unnormalized target
  Given: A real server on `8792` and a real attachment on a real thread
  When: `curl --path-as-is` requests `/attachments/th_x/ts/%2e%2e/%2e%2e/outside/secret.txt` and the
  other encoded forms `serve.test.ts:112-125` enumerates
  Then: All refused with the shipped `ATTACHMENT_NOT_FOUND_BODY`, **and** the log demonstrates that
  `rawRequestTarget` actually returned a string under v2 rather than silently degrading to
  `undefined` — a one-line temporary log, an assertion added to a real-listener test, or an
  equivalent. **A passing suite is not evidence for this one** (Adjudication 4): the file that owns
  these cases tests `parseAttachmentPath` directly and would stay green with the raw-target check
  dead. A legitimate attachment URL still serves its bytes with the shipped headers.

TEST-584: The loopback guard still reads a peer address
  Given: A real server on `8792`
  When: `POST /api/jobs/{id}/log` — the one tokenless mutating endpoint — is called from `127.0.0.1`
  Then: It is **accepted** (proving `getPeerAddress` returned an address rather than `undefined`,
  which would fail closed and look like a passing guard), and a request carrying a browser `Origin`
  header is still rejected. If the machine has a second local interface, a non-loopback probe is
  also 403; if it does not, that leg is `DEFERRED → no non-loopback interface available` with the
  loopback-accept result standing as the substitute.

TEST-585: The static-UI contract is byte-identical
  Given: A real server on `8792` with a built UI
  When: `/`, `/index.html`, a content-hashed asset, an unknown path, `/api/nope`,
  `/attachments/nope`, `/events` are each requested
  Then: Unchanged from today: the shell paths answer through `serveAppShell` with
  `Cache-Control: no-cache` and the injected runtime config; a hashed asset carries
  `public, max-age=31536000, immutable`; an unknown non-reserved path gets the SPA shell (not a
  404); the three `RESERVED_PREFIXES` fall through to routing and never receive HTML. Also probe a
  `POST` to `/` — it must still `next()` rather than being answered by the static handler. The two
  undocumented v1 behaviors `static-ui.ts` rides on are checked by name: a **miss** must still leave
  the SPA fallback reachable (v2 throwing, or answering its own 404, breaks every deep link at once),
  and the `Cache-Control` header must still be settable on the returned Response.

TEST-586: An ephemeral bind still reports its real port
  Given: `port: 0`
  When: The server starts
  Then: The startup callback yields the **actual** bound port and the CLI's URL is correct. This is
  the whole test suite's binding mechanism (`app.ts:465`, `info.port`); a v2 callback-signature
  change breaks every real-listener test at once, and it is worth knowing that from one named test
  rather than from fifteen failures.

TEST-587: Graceful shutdown still terminates
  Given: A running server with a **parked long-poll** (`corpus queue idle`) and an **attached SSE
  client** (`curl -sN /events?token=…`), plus an idle keep-alive connection
  When: `close()` is called
  Then: It resolves **promptly** — seconds, not the long-poll's 480 s window — and the process
  exits. `closeIdleConnections` is duck-typed against `http.Server`; if v2's handle no longer
  carries it, the check silently no-ops and shutdown hangs on the keep-alive. Time the shutdown and
  paste the number.

TEST-588: The named server specs stay green, unmodified
  Given: The migrated tree
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server` is run once
  Then: Green, and **`git diff` shows no change to any of the real-listener specs** —
  `app.test.ts`, `lifecycle.test.ts`, `middleware/auth.test.ts`, `middleware/localhost.test.ts`,
  `static-ui.test.ts`, `attachments/serve.test.ts`, `events/sse.test.ts`, `queue/routes.test.ts`,
  `queue/service.test.ts`, `jobs/routes.test.ts`, `locks/routes.test.ts`, `locks/write-guard.test.ts`,
  `docs/routes.test.ts`, `projection/routes.test.ts`, `projection/attach.test.ts`,
  `watcher/attach.test.ts`, `skills/rollback.test.ts`. This is the migration's real bar. A change to
  any of them is not automatically wrong — a v2 type rename may reach a test's imports — but it is
  **listed, quoted, and justified** in the E2E log, and an assertion that got weaker is a fail
  (Adjudication 18).

TEST-589: SSE is unaffected
  Given: A real server on `8792`
  When: A client attaches to `/events?token=…` and a document is written
  Then: `:connected`, the 25 s heartbeat, and the `invalidate` frame all arrive exactly as before,
  and a dropped subscriber is still pruned. Named separately because SSE is the one transport whose
  behavior a Node adapter can change without any type error.

TEST-590: The type surface did not get looser
  Given: The migrated tree
  When: `npm run typecheck -w apps/server` and `npx eslint apps/server` are run
  Then: Clean, with **no new `any`, no new `as unknown as`, no new `@ts-expect-error`, and no new
  eslint suppression** introduced to absorb a v2 type change. `/usr/bin/grep` the diff and paste it.
  A major upgrade absorbed by casting is the version of this issue that looks done and is not.

TEST-591: The packaging manifest follows, and nothing else in the repo moved
  Given: The migrated tree
  When: `git diff --stat` is read, and the packaging checks are run
  Then: `apps/server/**`, `package-lock.json`, **`scripts/package-manifest.test.ts`'s pinned
  `"@hono/node-server": "^1.19.0"` fixture (`:25`, `:60`)**, and the issue file — and nothing else.
  The externalised-specifier list (`scripts/package-manifest.ts:90-91`) still names both
  `@hono/node-server` and `@hono/node-server/serve-static`, so the bundler keeps leaving them
  external. `git diff packages/contract` and `git diff apps/ui` are **empty**; no workspace version
  moved; no `dist-package/` or tarball artifact appeared. This leg is named because a migration that
  updates only the server manifest passes the whole server suite and fails CI's `pack:check`.

TEST-592: `corpus server start` still boots a browsable board
  Given: A fresh workspace on `8792`, from a cwd outside this repository
  When: `corpus init --port 8792 && corpus server start` is run, then `corpus server status`, then
  `corpus server stop`
  Then: §12 M3's check still passes end to end — the URL is printed and browsable, a second `start`
  says "already running" with exit 0, `status` gates on running state, and `stop` leaves `8792`
  free. The adapter is what binds the socket; the CLI lifecycle verbs are its only real consumer.

---

### UI-016: the router changes major version and the app does not notice

`apps/ui` — `package.json` and four source files. Model: **opus**. Port `8796`, Vite `5275`.
Advisories: `GHSA-wrjc-x8rr-h8h6` (backslash open redirect, 6.0.0–8.2.0), `GHSA-337j-9hxr-rhxg`
(SSR-only), `GHSA-qwww-vcr4-c8h2` (RSC-only, 7.12.0–8.2.0).

Shipped state, confirmed at contract time: `apps/ui/package.json:31` declares
`react-router-dom: ^6.30.4` and **6.30.4 is what is installed** (both `react-router-dom` and
`react-router`, hoisted, no nested copies) — so unlike INFRA-010's finding, the declared and
installed lines agree here.

**The entire router surface is four files**, and `/usr/bin/grep` must reproduce this list before any
change:

| File:line                       | Imported symbols               |
| ------------------------------- | ------------------------------ |
| `apps/ui/src/app/App.tsx:4`     | `BrowserRouter, Route, Routes` |
| `apps/ui/src/dev/devRoutes.tsx:2` | `Route`                      |
| `apps/ui/src/dev/DataProbe.tsx:13` | `useSearchParams`           |
| `apps/ui/src/dev/DataProbe.test.tsx:5` | `MemoryRouter`          |

Nothing in `packages/kit`, `packages/contract`, `plugins/`, `apps/cli`, `apps/server`, or
`apps/ui/e2e` imports the router. There is **no** `useNavigate`, `useLocation`, `useParams`, `Link`,
`NavLink`, `Outlet`, `createBrowserRouter` or `RouterProvider` anywhere in the repository. Both v6
`future` flags — `v7_startTransition`, `v7_relativeSplatPath` — are already on.

#### The correction this contract makes to the issue

**The issue's third acceptance criterion is aimed at the wrong code.** "Reader navigation stacks
behave identically (Back, scroll restoration, stack-empty exit)" describes
`apps/ui/src/reader/useNavStack.ts` + `apps/ui/src/board/useBoardLocalState.ts` +
`apps/ui/src/reader/useReaderSurface.ts` — a hand-rolled stack persisted in `localStorage`, with
**zero** react-router involvement, exactly as SPEC §10 requires ("Only browser-local state stays
local: scroll positions, open readers, and per-reader navigation stacks"). The migration cannot
break it, and proving it unbroken proves nothing about the migration.

The **real** regression surface is much narrower and much easier to break silently:

1. `App.tsx`'s two-route table, including the `*` catch-all that renders the Shell rather than a
   blank page.
2. The `devRoutes()` pattern — a function returning a **naked `<Route>` element spliced as a child
   of `<Routes>`**. This is precisely the shape a data-router refactor eliminates.
3. `useSearchParams` in the dev probe.
4. `MemoryRouter` in `DataProbe.test.tsx`.

So the criteria below test those, and the nav-stack criterion is restated as what it actually is:
a *no-diff* claim, not a behavioral one.

TEST-593: The router line is fixed and the old package is gone
  Given: `apps/ui/package.json` and the installed tree
  When: Read
  Then: `react-router@^8.3.0` (or later) is declared, **`react-router-dom` appears nowhere** —
  not in `apps/ui/package.json`, not in any other workspace manifest, and not as a direct entry in
  the installed tree (pasted from `npm ls react-router react-router-dom`). `npm audit` reports zero
  known-vulnerable router findings, with before/after output pasted, and no new finding.

TEST-594: Exactly four files changed imports, and no fifth appeared
  Given: The migrated tree
  When: `/usr/bin/grep -rn "react-router" apps/ apps/ui/e2e packages/ plugins/ scripts/` is run and
  pasted
  Then: The four files above, importing from `react-router`, and **nothing else** — no new importer,
  no compatibility shim module, no re-export barrel invented to avoid touching them. The v6
  `future` prop is gone from `BrowserRouter` (v8 makes both behaviors unconditional; leaving an
  unknown prop on is a silent lie about what the app opted into).

TEST-595: The route table behaves identically, including the catch-all
  Given: The migrated app
  When: `/`, `/nope`, `/some/deep/unknown/path`, and `/__probe` are each opened
  Then: `/` and every unknown path render the board Shell — never a blank page, never a router
  error boundary, never a 404 component that did not exist before — and `/__probe` renders the data
  probe in a dev build. The three cases in `apps/ui/src/app/App.test.tsx` (`:38`, `:45`, `:64`) pass
  **unmodified**, driving routes through `window.history.pushState` as they do today.

TEST-596: The dev probe route still mounts as a child element, or the pattern change is deliberate
  Given: `devRoutes()` returning a bare `<Route>` (or `null` outside dev)
  When: `apps/ui/src/dev/devRoutes.test.ts` is run
  Then: Green and **unmodified**, both branches still covered. If v8 refuses the naked-`<Route>`-as-
  child shape, the replacement keeps the same two properties the docblock names — the probe is
  mounted only when `isDev`, and **both branches remain testable through the `isDev` parameter** —
  and the change is quoted and justified in the E2E log. `import.meta.env.DEV` must still drop the
  probe from a production bundle: prove it by `/usr/bin/grep`ping the built
  `apps/ui/dist/assets/*.js` for `__probe` and finding nothing.

TEST-597: `useSearchParams` still round-trips in the probe
  Given: `apps/ui/src/dev/DataProbe.tsx` under `MemoryRouter`
  When: `apps/ui/src/dev/DataProbe.test.tsx` is run
  Then: Green. If `MemoryRouter` moved or was renamed in v8, the test's import changes and nothing
  else does; an assertion that got weaker is a fail.

TEST-598: The reader navigation stack was not touched at all
  Given: The migrated tree
  When: `git diff apps/ui/src/reader apps/ui/src/board apps/ui/src/shell` is read
  Then: **Empty.** The stack is `localStorage`-backed app state (`useNavStack.ts`,
  `useBoardLocalState.ts:30-40,157-209`, `useReaderSurface.ts:85-119`, `ReaderHead.tsx`,
  `Reader.tsx`, `FocusMode.tsx`) and the router migration has no business in any of it. This
  replaces the issue's "stacks behave identically" criterion, which was aimed at code the migration
  does not reach. `apps/ui/src/reader/useNavStack.test.ts` is green and unmodified.

TEST-599: The scoped UI suite is green and its router-touching specs are unmodified
  Given: The migrated tree
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui` is run once
  Then: Green, with `App.test.tsx`, `devRoutes.test.ts`, `DataProbe.test.tsx` and `main.test.tsx`
  unmodified except for an import rename, each such rename quoted in the log.

TEST-600: The one e2e assertion that guards the route table still passes
  Given: The migrated tree and a UI build
  When: `./node_modules/.bin/playwright test apps/ui/e2e/smoke.spec.ts --workers=1` is run **once**,
  against the agent's own port (this is the batch's one permitted scoped Playwright run for UI-016)
  Then: Green — in particular `smoke.spec.ts:255`, *"an unknown route renders the shell rather than
  a blank page"*, which is the **only** e2e test in the repository that navigates anywhere but `/`
  and therefore the only e2e coverage `App.tsx`'s route table has. Every other spec does
  `page.goto("/")` and asserts nothing about URLs; the log states that plainly rather than implying
  the e2e suite broadly covers routing.

TEST-601: The board still loads in a real browser against a real server
  Given: A real server on `8796` with seeded views, and `npm run dev -w apps/ui -- --port 5275
  --strictPort` with `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8796` exported first
  Then: The board renders its columns, a row opens a reader, Back returns to the list, and the
  reader exits to the list when the stack empties — the ordinary drill, done once, because a router
  major that type-checks and unit-tests green can still fail to mount. **The proxy proof is
  pasted** (Adjudication 2), and `lsof` shows `8765` untouched.

TEST-602: Nothing outside `apps/ui` moved
  Given: The migrated tree
  When: `git diff --stat` is read
  Then: Only `apps/ui/**`, `package-lock.json`, and the issue file. `git diff packages/kit`,
  `git diff packages/contract` and `git diff apps/server` are **empty**.

---

### SERVER-038: the documents nobody can see get named

`apps/server/src/projection/` (the doctor pass) + colocated tests; CLI output passthrough only if
the wire shape changes. Model: **opus**. Port `8794`. Spec: `SPEC.md` §5 (the document tree), §11
(`corpus db doctor` fails when files and projection rows drift).

SERVER-037 fixed creation and said, in its own TEST-564: *"This fix prevents creation. It cleans up
nothing that was already committed… `db doctor` is **silent** about them, and necessarily so:
`enumerateDocuments` skips the same segments `classifyPath` does."* Confirmed at contract time —
the skip rule exists in **two** places:

- `apps/server/src/projection/roots.ts:135` — `classifyPath`:
  `segments.some((segment) => segment.startsWith(".") || IGNORED_DIRECTORIES.has(segment))`
- `apps/server/src/projection/roots.ts:177` — inside `walk`, a **second copy** applied to directory
  entries before any `stat`: `if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;`

`IGNORED_DIRECTORIES` is `new Set(["node_modules"])` (`roots.ts:98`). The second copy is what makes
the files structurally unfindable: `doctor.ts:199` calls `enumerateDocuments`, the walk never
descends into `data/docs/.claude/`, so no `missing_row` drift can ever be produced.

#### The predicate, and why it is crisp

Under `data/docs` the root shape is `markdown-tree` — **any `*.md` at any depth is a document**
(`roots.ts:111`). So within `data/docs`, the *only* reason a markdown file is unindexed is the skip
rule. The finding predicate is therefore exactly:

> a file matching `**/*.md` under `data/docs/` for which `classifyPath(<relative path>)` returns
> `null`.

**Derived from `classifyPath` itself, never from a second hand-maintained list** — the same
principle sprint-017's Adjudication 15 applied to SERVER-037's refusal, and for the same reason: two
lists that must agree, maintained separately, is how this bug comes back.

TEST-603: The blind spot is reproduced before it is fixed
  Given: A real server on `8794` and a workspace outside this repository carrying **pre-fix**
  invisible files — seeded by writing them directly and committing them (SERVER-037's refusal now
  blocks the API route that originally created them, so the recipe is a file write plus a commit,
  and the log says so rather than pretending the old route still works)
  When: `corpus db doctor` is run
  Then: **Pre-fix, it reports the projection clean** while the files sit on disk — SERVER-037's log
  recorded exactly this (`projection is clean — 19 documents from 19 files` with three invisible
  files present) and the SDLC requires it re-observed here. `GET /api/docs/{id}` for each is 404 and
  `GET /api/docs` lists none of them. All pasted.

TEST-604: Every invisible document is named, with its creating commit
  Given: A workspace carrying, at minimum, the three shapes SERVER-037 proved reachable:
  `data/docs/.claude/skills/invisible-doc.md`, `data/docs/node_modules/ignored-dir-doc.md`,
  `data/docs/notes/.hidden/x/nested-hidden.md`
  When: `corpus db doctor` is run
  Then: **All three are named**, each with its workspace-relative path and the commit that created
  it (`git log --diff-filter=A -1 -- <path>` or equivalent — the short hash and subject are enough
  to find it). The output tells a person what to do next; a finding that names a path and nothing
  else leaves them exactly where `git log` already had them.

TEST-605: Zero false positives — the named near-miss fixture list
  Given: A **healthy** workspace containing every one of these, each holding a real document or
  file:
  - dotted-but-not-dot-leading folders: `my.notes/`, `v1.2/`, `notes/2026.07/`, `a.b/c.d/`,
    `finance/2026/`, `archive.2026/`
  - a file whose *name* resembles the ignored directory: `data/docs/node_modules.md`
  - the seeded folders: `data/docs/inbox/`, `data/docs/templates/`, `data/docs/views/`
  - `data/docs/README.md` — which **is** indexed (only the workspace-root `README.md` and a README
    beside a `SKILL.md` are not); it must not be reported as ignorable either
  - deep nesting: `data/docs/a/b/c/d/e.md`
  - legitimate non-documents under `data/docs/`: `notes.txt`, `assets/diagram.png`, `**/.gitkeep`
  - the runtime tree that is *not* under `data/docs`: `.corpus/attachments/…`, `.corpus/queue/…`,
    `.corpus/locks/…`, `.corpus/jobs/…`, `.corpus/cache.db`, and the `.claude/` roots
  When: `corpus db doctor` is run
  Then: **Silent about every one of them**, and the doctor verdict is clean with exit 0. Each item
  above is enumerated in the E2E log with the observed result — this is the issue's own
  zero-false-positive criterion and it is not satisfiable by "we ran doctor and it looked fine".

TEST-606: The walk is rooted at `data/docs`, and the reason is stated
  Given: The implementation
  When: Its root is inspected
  Then: It walks **`data/docs/` only**. Not the workspace root, and not the other four document
  roots. The `.claude/skills` root's shape is `SKILL.md`-only, so a walk there would report every
  skill's `README.md` as an invisible document; `data/threads` is flat, so it would report every
  nested file. Those are different findings about a different bug, and this issue does not open
  them — but the log **names** them as knowingly out of scope rather than leaving the reader to
  wonder (Out of Scope, below).

TEST-607: The rule is derived from `classifyPath`, provably
  Given: `roots.ts:135`'s skip condition
  When: A test adds a hypothetical entry to the ignored-directory declaration
  Then: The recovery pass follows it **without an edit** — a test that would fail if the pass
  maintained its own copy of the rule. `IGNORED_DIRECTORIES` has exactly one entry today
  (`node_modules`), which is precisely why a second copy would go unnoticed for a year.

TEST-608: A healthy workspace pays nothing
  Given: A healthy workspace with no invisible files
  When: `corpus db doctor` is run before and after
  Then: `stats.durationMs` is not materially worse, and **no `git log` subprocess runs at all** — the
  commit lookup happens per finding, and a healthy workspace has none. Doctor is a routine check
  (`rebuild && doctor` clean is the standing §11 invariant); a recovery pass that shells out once per
  markdown file turns it into something nobody runs.

TEST-609: `ok`, the exit code, and the standing invariant
  Given: (a) a healthy workspace, (b) a workspace carrying invisible files
  When: `corpus db doctor` is run on each, and `corpus db rebuild && corpus db doctor` on each
  Then: (a) is clean, `ok: true`, **exit 0** — `rebuild && doctor` clean is unchanged for every
  healthy workspace, which is §11's invariant and §12's definition of done. For (b), whichever of
  the two answers the implementer chooses — a reported finding that sets `ok: false` and exit 6, or
  a warning that leaves `ok: true` and exit 0 — is **stated with its reasoning in the issue file**,
  in terms of what a user with an affected workspace experiences, and is consistent between the
  human output, the `--json` output, and the exit code. What is not acceptable is a third state
  where the text warns and the exit code says clean, or vice versa.

TEST-610: Report-only, and deletion stays a user act
  Given: The shipped behavior
  When: Doctor names invisible files
  Then: **Nothing is moved, deleted, or rewritten.** No file is relocated into `inbox/`, no commit is
  made, `git status` in the workspace is untouched by running doctor. If a cleanup verb ships at
  all it is opt-in, explicitly invoked, refuses an `--from agent` actor (SPEC §7 — "deletion is
  user-only; the agent archives, never deletes"), and prints what it will do before doing it. The
  issue's own criterion says report-only is an acceptable v1 and this contract takes that default.

TEST-611: The `--json` shape is honest and the CLI passes it through
  Given: `corpus db doctor --json`
  When: Run on both workspaces
  Then: Exactly one JSON value on stdout (`apps/cli/src/output.ts` — `emit` writes one value and
  `line` is suppressed under `--json`), carrying the new findings in a documented field, with the
  same exit code as the human form. Human output keeps its shipped shapes — the clean line
  `projection is clean — N documents from M files (Xms)` and the per-finding
  `<kind> <path>: <detail>` — and any new line is in the same voice.

TEST-612: The dot-leading *filename* case is decided, not stumbled over
  Given: `data/docs/.hidden.md` — a markdown file whose own name starts with a dot, which
  `classifyPath` skips exactly like a dot folder (`roots.test.ts:48` pins it)
  When: Doctor runs
  Then: The behavior is whatever the agent decides, **and it is written down with its reasoning**.
  The contract's default: report it **when it carries Corpus frontmatter (an `id:` key)** and stay
  silent otherwise — the discriminator SERVER-037's own filed finding proposed ("markdown files with
  Corpus frontmatter in unindexed locations"). A dot-file with no `id` is a person hiding a file;
  a dot-file with an `id` is a document the corpus will never show again, which is the whole
  finding. Whichever way it goes, TEST-605's near-miss list stays silent.

TEST-613: `db rebuild` and boot catch-up are unaffected
  Given: The change
  When: `corpus db rebuild` is run and the server is restarted on a workspace with invisible files
  Then: Rebuild's own `skipped` reporting is unchanged, boot catch-up
  (`apps/server/src/watcher/catch-up.ts`, which calls `inspectProjection`) behaves as before, and the
  server starts normally — an invisible file must never block a boot. FIX 16's schema-stamp refusal
  in `openProjectionReadonly` still fires on a stale `cache.db` and is not swallowed by the new pass.

TEST-614: The contract question is answered, not improvised
  Given: `DoctorReportSchema` = `{ok, drift: [{kind, path, detail}], stats}` with `DRIFT_KINDS` a
  closed six-entry enum in `packages/contract/src/schemas/db.ts:89-96`, and
  `packages/contract/src/routes/db.ts:14-18` stating that `warnings` is *deliberately* absent from
  both db responses
  When: The implementation needs somewhere to put the findings
  Then: If a shape exists that needs **no** contract amendment, it is used and `git diff
  packages/contract` is empty. If it does not, the agent **stops and escalates** (Open Conflict 1) —
  it does not amend `packages/contract` in place, which has been a standing rule since sprint-008
  and which the issue's own Technical Design anticipates ("contract rider then").

---

### UI-020: the reader menu gains the inverse it always owed

`apps/ui/src/menu/docActions.ts`, `apps/ui/src/reader/FrontmatterForm.tsx`, **and the kit client**
(see below). Model: **opus**. Port `8797`, Vite `5276`. Spec: `SPEC.md` §7 (archived skills are
"restorable"; folder moves to `.claude/skills-archived/`), §10 (the reader ⋯ menu; the context menu
offers "exactly that item's existing actions… nothing invented").

Shipped state, confirmed at contract time:

| Fact                                                                                                              | Where                                            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `MenuAction` has **no** availability predicate — availability is conditional `list.push` inside `useDocActions`     | `apps/ui/src/menu/menuModel.ts:14-42`; `docActions.ts:63-176` |
| Archive is pushed **unconditionally**, gated only by `disabled: actions.isBusy`                                     | `docActions.ts:138-144`                          |
| `DocActionSubject` already carries `status: string`, so a status split needs no new plumbing                        | `docActions.ts:38-48`                            |
| Both presentations consume the same list                                                                            | `reader/DocMenu.tsx:53-60`; `menu/DocMenuItems.tsx:31-38` (rows: `menu/RowMenuItems.tsx:72`) |
| **The UI never calls the archive route.** `archive` is `useUpdateDoc(...).mutate({status: "archived"})`             | `packages/kit/src/row/useRowActions.ts:96,127-135` |
| There is **no** `archiveDoc`/`unarchiveDoc` on `CorpusClient`; `/usr/bin/grep -rn "unarchive" packages/kit/src apps/ui/src` returns **zero hits** | `packages/kit/src/client/createCorpusClient.ts:157-342` |
| Only `POST /archive` / `POST /unarchive` move a skill's folder (`setArchived` → `planFolderMove`); `PUT` merely sets `mayChangeTree` for cache invalidation | `apps/server/src/docs/archive.ts:71-89,91-101`; `apps/server/src/docs/update.ts:374` |
| The `status` `<select>` offers all three `DOC_STATUSES`, disabled only by a foreign lock                            | `FrontmatterForm.tsx:302-318`                    |
| The form also fires the same `PUT` on unmount / rebind / `pagehide`                                                 | `FrontmatterForm.tsx:172-198`                    |

#### Two things the issue does not say, and both change its scope

**1. This needs a `packages/kit` change.** There is no client method to call. The menu item cannot
be wired to "the existing unarchive route" because nothing in the UI stack reaches it. A client
method plus a mutation hook (`useUnarchiveDoc`, mirroring `useUpdateDoc`'s invalidation) is
unavoidable. Adjudication 6 makes this a **named** exception to the standing no-kit-change rule.

**2. Archive itself is broken for skills, and it is broken in the mirror-image way SERVER-039 just
closed.** The UI archives with `PUT {status: "archived"}`. For a skill that sets the frontmatter and
**leaves the folder in `.claude/skills/`** — still discovered by Claude Code, still holding its name
against `corpus skill create` — which is §7's promise inverted. SERVER-039 deliberately permits that
direction on the grounds that "the archive route heals it on the next call"; the UI never calls the
archive route, so nothing heals it. This is why the issue's own criterion 2 ("the SERVER-036 409
case recoverable from the UI") is **not reachable today**: you cannot get into the archived-skill
409 state from the UI at all, because UI archiving does not archive a skill. Adjudication 7 rules
that UI-020 moves both directions onto the routes that own them.

TEST-615: Unarchive appears exactly where Archive does, and only on archived documents
  Given: An archived document and a non-archived one
  When: The reader ⋯ menu and the right-click context menu are opened on each
  Then: The archived one offers **Unarchive** and not Archive; the non-archived one offers
  **Archive** and not Unarchive. Both presentations show the same set, from the one declaration in
  `docActions.ts` — asserted by a test that reads the action list, not by two copies of a UI
  assertion. No confirm step (a reversible act, per the issue), `meta` written in the app's voice,
  `disabled` mirroring Archive's `actions.isBusy`.

TEST-616: The menu item calls the route that owns the transition
  Given: The Unarchive item
  When: It is activated and the wire is observed
  Then: **`POST /api/docs/{id}/unarchive`**, not `PUT /api/docs/{id}`. The `PUT` is what SERVER-039
  refuses with a 400 naming this very route; wiring the affordance to it would ship an action whose
  only possible outcome is the error message telling you to use the action.

TEST-617: Archive moves onto its own route too (Adjudication 7)
  Given: `useRowActions.archive`, today `useUpdateDoc(...).mutate({status: "archived"})`
  When: Archive is activated from any surface — reader ⋯ menu, context menu, row menu, and the `e`
  keyboard shortcut (§10)
  Then: **`POST /api/docs/{id}/archive`**. Every surface that archives goes through the one route,
  the optimistic/`isBusy`/toast behavior is unchanged from the user's side, and the shipped toast
  wording is untouched.

TEST-618: A skill round-trips, folder and name included
  Given: A real server on `8797`, a real workspace outside this repository, and a skill created with
  `corpus skill create <name>`
  When: The skill is archived from the UI, then unarchived from the UI
  Then: After archive: the folder is under **`.claude/skills-archived/<name>/`**, the frontmatter
  says `archived`, and `corpus skill create <name>` **409s** with the shipped message
  (`the name \`<name>\` belongs to an archived skill (.claude/skills-archived/<name> exists) —
  unarchive it to bring it back…`). After unarchive: the folder is back under
  **`.claude/skills/<name>/`**, the frontmatter says `open`, and `corpus skill create <name>` 409s
  on the *other* branch (already installed) rather than the archived one — the name is free of the
  archive. `git log` shows both auto-commits with the acting party. **This is the criterion that
  fails today for a reason the issue did not know about** (Adjudication 7); it is the issue's
  criterion 2 made executable.

TEST-619: SERVER-039's refusal is unreachable from the frontmatter form
  Given: An archived document open in the reader, with the frontmatter form in edit mode
  When: The user tries to change `status`
  Then: They cannot produce the refused write. Either the `status` control is **disabled on archived
  documents** with the Unarchive affordance named as the way out, or selecting a non-archived value
  is redirected to that affordance. The choice is the implementer's; the outcome is not.

TEST-620: The exit flush cannot produce it either
  Given: The same reader, with `status` somehow drafted to a non-archived value
  When: The reader is closed, the doc is rebound, or the page is hidden — the three paths through
  `FrontmatterForm.tsx:172-198`'s `outgoingWrite`/`flush`/`onPageHide`
  Then: **No `PUT` carrying `status` is sent**, and no 400 toast appears. This is the leg that gets
  missed: guarding the Save button while leaving the unmount flush open ships an error the user
  cannot connect to anything they did.

TEST-621: The write-boundary guard is still there, and is still the enforcement
  Given: The migrated UI and a real server on `8797`
  When: `curl -X PUT -d '{"status":"open"}' /api/docs/{archived id}` is sent directly
  Then: Still **HTTP 400**, `code: bad_request`, `message: "request failed validation"`,
  `issues[0].path = "body.status"`, message naming `POST /api/docs/{id}/unarchive` — byte-identical
  to SERVER-039's shipped behavior. `git diff apps/server` is **empty**. The UI guard is a better
  error, not the enforcement; a UI change that "made the guard unnecessary" and relaxed it has
  inverted the sole-writer architecture.

TEST-622: A non-skill archives and unarchives with no folder move
  Given: An ordinary `type: note` document
  When: Archived and unarchived from the UI
  Then: `status` flips both ways, the file **does not move**, the id never changes, and it leaves
  and re-enters the default (non-archived) lists live over SSE. The "include archived" search chip
  still shows it as a union member while archived (§10), and the archived chip renders on the row.

TEST-623: The context menu invented nothing
  Given: §10 — the context menu lists "exactly that item's existing actions — the same set its ⋯ /
  header menu offers, nothing invented"
  When: Both menus are compared on the same subject
  Then: Identical action sets, including the new item, because both read `useDocActions`. A test
  asserts the equality rather than two hand-written expectations that could drift.

TEST-624: The kit change is minimal and additive
  Given: `git diff packages/kit`
  When: Read
  Then: **Non-empty by permission (Adjudication 6)** and confined to the client method + the
  mutation hook + their tests. No change to `useDocs`, `usePluginQuery`, query-key shapes, or any
  existing hook's signature; no plugin-facing behavior change. The diff is quoted in the E2E log
  and the E2E log states why the exception was needed, because the standing rule is that this
  package does not move for a UI issue.

TEST-625: Scoped suites green, plus one scoped e2e
  Given: The change
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/ui packages/kit` is run once, and
  `./node_modules/.bin/playwright test apps/ui/e2e/context-menu.spec.ts --workers=1` once against
  the agent's own port (UI-020's one permitted scoped Playwright run)
  Then: Green, with the e2e menu spec extended by the archived/unarchived case rather than replaced.

TEST-626: Both halves of the UI evidence rule
  Given: `apps/ui/playwright.config.ts:16-22` starts **no** workspace server
  When: Evidence is assembled
  Then: The Playwright leg proves the UI-observable half and the **manual real-app drill on `8797`
  proves the disk/git/name half** (TEST-618's folder move and 409 are only observable there).
  Neither is acceptance alone. The proxy proof and the `8765` check are pasted.

---

### UI-021: the renderer stops disagreeing with the detector

`apps/ui/src/thread/parseFormBlock.ts` + its test. Model: **opus**. Port `8798` (only if the agent
wants a live thread; the fixture path needs no server). Spec: `SPEC.md` §6 (forms), §11
(`needs=form`).

The bug is one `continue`. `mapFormAnswers` (`parseFormBlock.ts:145-169`) closes the earliest open
form matching the answer and then **returns before registering the turn's own form** (`:163`), so a
turn that both answers a form and carries one leaves its own form rendered live forever. The server
converged the other way in SERVER-032's audit round and documented the divergence in
`apps/server/src/core/form.ts:170-193`, which says in so many words: *"This is the single point
where the rule is deliberately wider than the renderer's `mapFormAnswers`, which `continue`s past
its own registration on that turn and therefore leaves such a form live forever… of the two
behaviours the clearable one is the one to converge on."*

Only a hand-edited thread file produces the turn — the answer route writes the label and the note
and nothing else — so this is low-urgency and high-precision: a one-line change, a paired test, and
a docblock that stops describing a live divergence.

TEST-627: The renderer registers the turn's own form
  Given: The server's own named case — `[form(0,1), answeringForm(1,"F1-yes",2)]`
  (`apps/server/src/core/form.test.ts:180`)
  When: `mapFormAnswers` runs over the equivalent UI turns
  Then: The first form is answered **and** the second is open — the renderer shows controls for the
  new form and none for the closed one. Today the second is open-forever and never clearable.

TEST-628: Answering the newly-opened form clears it
  Given: `[form(0,1), answeringForm(1,"F1-yes",2), answer(2,"F2-no")]` — the server's
  `form.test.ts:211` fixture
  When: The renderer maps it
  Then: **Both** forms are answered and no live control remains. This is the issue's criterion 2 and
  the reason the server rejected the `answered: false` alternative: §10's reasons must have an action
  that clears them.

TEST-629: The paired test mirrors the server's block, case for case
  Given: `apps/server/src/core/form.test.ts`'s
  `describe("a turn that both answers a form and carries one")` and its four cases —
  *"closes the earlier form and opens its own"* (`:180`), *"can then be answered like any other
  form, so the reason clears"* (`:189`), *"never answers itself, however its own options read"*
  (`:194`), *"opens its form even when its answer matches nothing"* (`:201`)
  When: `apps/ui/src/thread/parseFormBlock.test.ts` is extended
  Then: A nested `describe` under `describe("answers")` carries the **same block name and the same
  four case names**, in the file's existing lowercase-behavioural-sentence voice (no "should"). A
  paired test that is merely similar is how the two sides drift again.

TEST-630: No existing pairing rule regressed
  Given: The seven cases under `describe("two unanswered forms")` (`parseFormBlock.test.ts:113-190`)
  and the three under `describe("answers")`
  When: The scoped suite runs
  Then: All green and **unmodified** — in particular *"credits the form the session actually
  answered, not the earlier one"*, *"leaves a known pairing's form alone when a later answer could
  also fit it"*, *"still answers the earlier one after the later one has been answered"* and *"keys
  every answer by the carrying turn's ts, never by the option's prose"*. The fix removes a
  `continue`; the three-tier `open.find` precedence above it is untouched, and so is the
  `turn.author !== "agent"` guard the fall-through now reaches.

TEST-631: The server docblock and its pinned test stop describing a divergence that no longer exists
  Given: `apps/server/src/core/form.ts:170-193` (the "deliberately wider… reported for a UI
  follow-up" paragraph) and `form.test.ts:211`'s
  `it("diverges from the renderer, which would leave that form unanswerable")`
  When: UI-021 lands
  Then: Both are updated to say the two sides now agree. **Bounded by Adjudication 8**: comments and
  one test *name* only — `git diff apps/server` must contain **no executable-line change**, the
  server's behavior and every assertion are identical, and the diff is quoted in the E2E log. The
  renderer's own docblock (`parseFormBlock.ts:118-144`), which today lists only the two pairing
  rules, gains the third.

TEST-632: The fixture round-trips against the real detector
  Given: A hand-edited thread file carrying the both-answer-and-form turn, in a real workspace
  When: `GET /api/docs?type=thread&needs=form` is asked, and the same thread is rendered
  Then: The renderer's count of live forms **equals** what `needs=form` advertises, before and after
  answering. The issue's whole content is that these two disagreed; the acceptance evidence is the
  two numbers side by side, not a green unit test.

---

### CLI-018: §10's "pin me a view" becomes a thing the agent can actually do

`apps/cli` (`doc create` / `doc edit`, or a new `view` topic) + tests + `docs/cli.md`. Model:
**opus**. Ports `8799`–`8800`, Vite `5278`. Spec: `SPEC.md` §10 — *"Adding, removing, reordering…
or reconfiguring a column edits that document — auto-committed and agent-stewardable ('@agent pin me
a view of unresolved finance threads' just works)"*.

Shipped state, confirmed at contract time — and it is better than the issue assumes:

| Fact                                                                                                        | Where                                                     |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `pinned`/`order`/`query`/`column` are core-reserved and refused by `--extra`                                  | `packages/contract/src/schemas/extra.ts:46-68`             |
| **They are already accepted on `POST /api/docs` and `PUT /api/docs/:id`** — optional, typed, validated          | `packages/contract/src/schemas/doc.ts:242-262, 286-297`    |
| `query` is a **flat map** of `GET /api/docs` parameter names to a scalar or array of scalars; arrays OR together (`{type:["note","view"]} ≡ type=note,view`) | `doc.ts:103-120`, `ViewQuerySchema`                        |
| `column` must match `/^[^/\s]+\/[^/\s]+$/` — exactly one slash                                                 | `doc.ts:123`, `COLUMN_REF_PATTERN`                         |
| `order` is any finite number, nulls-last; tiebreak `order` → `title` → `id`                                    | `doc.ts:98-101`                                            |
| The board's column set is **one** query: `{pinned: true, type: "view", sort: "order"}`                          | `apps/ui/src/board/useColumns.ts:20-25`                    |
| `doc create` flags today: `--type --title --folder --tags --due`                                               | `apps/cli/src/commands/doc/create.ts:69-101`               |
| `doc edit` flags today: `--title --status --due --add-tag --remove-tag --extra --from`                          | `apps/cli/src/commands/doc/edit.ts`                        |
| Seed views are the shape to match: `type: view`, `pinned: true`, `order: N`, `query:` mapping                   | `assets/workspace/data/docs/views/{attention,inbox,open-threads}.md` |
| `extra` **does** accept objects on the wire — `EXTRA_MAX_DEPTH = 8`, "`todo.items` … is depth 2"                | `packages/contract/src/schemas/extra.ts:72-80`             |

So **no contract change is expected** (TEST-645) — this is a verb surface over a mechanism that
already works, exactly as CLI-016 was. And SPEC 38's premise needs correcting: `--extra`'s
scalars-only limit is a **CLI value-grammar** decision, not a contract limitation. The contract has
accepted nested objects since CONTRACT-011.

TEST-633: The §10 sentence, walked end to end as the agent, with nothing but documented verbs
  Given: A real server on `8799`, a workspace outside this repository, and only commands
  `docs/cli.md` documents — no `curl`, no file edit
  When: The agent does what §10 promises: creates a view of unresolved finance threads, pins it, and
  gives it a board position
  Then: A `type: view` document exists on disk carrying `pinned: true`, an `order`, and a `query`
  mapping equivalent to `{type: thread, status: open, tag: finance}`; `git log` shows the
  auto-commit **authored by `agent`**; and `corpus doc list --type view --json` shows it. The exact
  command sequence is pasted. This is the issue's criterion 1 and the sprint's headline: if a CLI-only
  agent cannot type this, §10 is still a lie.

TEST-634: The board renders it live, in a browser, without a reload
  Given: The document from TEST-633, a real server on `8799`, and
  `CORPUS_SERVER_ORIGIN=http://127.0.0.1:8799 npm run dev -w apps/ui -- --port 5278 --strictPort`
  with the board already open **before** the CLI runs
  When: The create/pin commands run
  Then: The new column **appears on the board with no reload**, in its `order` position, titled from
  the document, and its rows are the documents the query selects (seed a matching thread and a
  non-matching one and show both outcomes). The SSE frame is captured off
  `curl -sN "http://127.0.0.1:8799/events?token=$TOKEN"` and pasted, showing the `["docs"]`
  invalidation `useColumns` subscribes to. **The proxy proof is pasted** (Adjudication 2). This is
  the end-to-end path the issue's criterion 1 names ("it appears as a board column over SSE") and it
  is not satisfiable by asserting a query key.

TEST-635: Unpin and reorder are reachable too
  Given: The pinned view
  When: The agent unpins it, then re-pins it with a different `order`
  Then: The column leaves and re-enters the board live, and lands in the new position. §10's
  promise is "adding, removing, reordering, or reconfiguring", and a verb that can only ever add is
  half a feature. `order` accepts a midpoint (e.g. `1.5`) so a reorder need not renumber every
  column — the shipped tiebreak's whole rationale.

TEST-636: The query grammar covers what `ViewQuerySchema` allows, and nothing it does not
  Given: `ViewQuerySchema` — a flat record of `string | number | boolean | array of those`
  When: The agent writes a query
  Then: Repeatable single-key form and the array form both work (`--query type=thread --query
  tag=finance`, and a comma form for `{type: ["note","view"]}`); a nested object is refused **before
  any request** with a message saying the map is flat; the refusal is a usage error, exit **2**, the
  CLI's shipped code. A `needs=me`-style value round-trips, since that is what the shipped Attention
  seed carries. Two edges are decided and documented rather than discovered: **clearing** a key —
  `UpdateDocRequestSchema` is a `strictObject` in which `null` removes the key from the file, so
  there is a shipped meaning for "unset `query`", "unset `order`" and "unset `column`" and the flags
  should reach it — and whether writing `--query` **replaces** the whole map or merges into it
  (`query` is a single core field, not an RFC 7386 sub-object like `extra`, so replacement is the
  shipped semantic; a merge would have to be built, and if it is, it is stated).

TEST-637: The value grammar is the one the CLI already documents, or the difference is justified
  Given: CLI-016's five-rule grammar for `--extra` (`null` deletes · `true`/`false` · a **finite**
  canonical JSON number · a JSON string literal as the force-a-string escape hatch · otherwise the
  string as typed), hardened by the wave-3 audit's FIX 1
  When: The new flags parse values
  Then: **The same grammar**, reused rather than re-implemented — or a documented, justified
  divergence in the flag's own description. Two value grammars in one CLI is the defect this test
  exists to prevent. Two specifics are not optional: a finiteness gate (`1e400` must not become a
  deletion), and `order` must reach the file as a **YAML number** — the board sorts on it, and a
  quoted `"1"` is a green unit test and a column in the wrong place, exactly as CLI-016's
  `extra.width` was.

TEST-638: `column` is validated, and the plugin-missing path still works
  Given: `COLUMN_REF_PATTERN`
  When: `--column todos/board` and `--column nonsense` are each written
  Then: The first succeeds and renders the plugin column; the second is refused naming the
  `<plugin>/<type>` shape. A reference to an **uninstalled** plugin is accepted and the board shows
  the plugin-missing card, keeping its position (§12 M6) — the refusal is about the *shape*, never
  about whether the plugin happens to be installed. Note the asymmetry the agent must not "fix":
  `readColumn` (`apps/server/src/core/view-frontmatter.ts:150`) does **not** pattern-check on read,
  so the regex is a request-side guard only. Tightening the reader is a different issue.

TEST-639: SPEC 38 is adjudicated in writing, and implemented
  Given: audit SPEC 38 — "`--extra` scalars only; publish plugin needs objects. Decide escape hatch
  or drop 'total'"
  When: The agent decides
  Then: One of two outcomes, recorded in the issue file with its reasoning and shipped: **(a)** a
  documented object escape hatch (e.g. a JSON-valued form) whose depth and size are bounded by the
  contract's own `EXTRA_MAX_DEPTH = 8` / `EXTRA_MAX_BYTES` rather than by a second CLI-side limit;
  or **(b)** the word "total" leaves the `--extra` description and the limitation is stated plainly,
  naming what a plugin storing an object is expected to do instead. **What is not acceptable is
  leaving the description claiming totality it does not have** — that claim was already falsified
  once (wave-3 FIX 1 / CLEAN 56) and re-shipping it is a regression. The log states the fact this
  contract established: the *contract* has accepted objects since CONTRACT-011, so this is purely a
  CLI grammar decision.

TEST-640: The reserved-key refusal still stands where it should
  Given: `--extra pinned=true`, `--extra order=1`, `--extra query=x`, `--extra column=a/b`
  When: Run after the new flags ship
  Then: **Still refused**, exit 2, no request sent — and now the message names the **real flag**.
  Today all four fall to `FLAG_FOR_RESERVED_KEY`'s *generic* branch (`edit.ts:230-237` maps only
  `title, status, due, reviewed, evergreen, tags`), so an agent that tries `--extra pinned=true` is
  told "Core keys are not user-writable through `--extra`" and given nowhere to go. That is the hole
  this issue closes, and closing it means adding the four entries, not just the four flags.
  `RESERVED_FRONTMATTER_KEYS` is still iterated from the contract, never copied
  (`edit.ts:3,239` — the unit test walks every key the contract declares).

TEST-641: The view is a document like any other
  Given: The created view
  When: It is edited, archived, and read back
  Then: `corpus doc edit` on it works, `corpus doc archive` removes its column from the board (the
  board's filter is `pinned=true&type=view`, and an archived view is excluded by default — check
  which of unpin-vs-archive the board actually honors and state it), `corpus doc unarchive` restores
  it, and `corpus db doctor` is clean throughout. §10: "deletable like any document, nothing
  hardwired."

TEST-642: A CLI-created view is indistinguishable from one the board itself creates
  Given: Three reference shapes — the seed `assets/workspace/data/docs/views/attention.md`, the
  board's own `columnRequest` (`apps/ui/src/board/newList.ts:162-173`, which sends
  `{type: "view", title, folder: "views", pinned: true, order, query, evergreen: true, column?}`),
  and the CLI-created document
  When: Their frontmatter is compared
  Then: The same key set and the same YAML shapes — `type: view`, `pinned: true`, `order` as a
  number, `query` as a nested mapping. A CLI that writes a view the board's own creator would not
  produce has invented a second dialect of one document type. Two specifics to decide and record:
  the default **folder** (the board uses `views/`; `doc create`'s default is `inbox/`) and whether
  `evergreen: true` is set (the board sets it; a column that goes stale and asks to be reviewed is
  not what §5's staleness ramp is for). Note there is **no `type: view` template document** in
  `assets/workspace/data/docs/templates/` — only `note.md` — so nothing pre-fills a view's body, and
  §10's "a `view` … is one of the two exceptions" to the editable document view still holds.

TEST-643: `docs/cli.md` is regenerated, never hand-edited
  Given: The new flags or verb
  When: `npm run docs:cli -w apps/cli` is run on the merged tree
  Then: `docs/cli.md` regenerates with no diff afterwards, `apps/cli/src/docs/generate.test.ts`
  passes, `npx prettier --check docs/cli.md` passes, and
  `scripts/workspace-template.test.ts` is green with **no new allowlist entry**. The flags document
  themselves through the registry (`repeated: true` where repeatable, as `--add-tag` and `--extra`
  do). Hand-merging a generated file is drift by construction (Adjudication 12). If a `corpus view`
  topic ships, note the second gate: `scripts/workspace-template.ts:220` resolves **every** `corpus …`
  invocation in the workspace template tree against `docs/cli.md`'s headings, so a product skill that
  starts naming the new verb fails until the docs carry it — regenerate before touching
  `assets/workspace/` (and this batch touches none of it).

TEST-644: The verb-shape decision is recorded
  Given: The issue's two candidate designs — flags on `doc create`/`doc edit`, or a
  `corpus view create|pin` topic
  When: One is chosen
  Then: The choice and its reasoning are in the issue file, argued from what a CLI-only agent
  reading `corpus --help` would find. Both are acceptable; an unrecorded choice is not. If a new
  topic ships, it is registered like every other so all three help levels render it.

TEST-645: No contract change
  Given: `git diff packages/contract`
  When: Read
  Then: **Empty.** Verified at contract time: all four keys are already optional-and-validated on
  create (`doc.ts:242-262`) and update (`doc.ts:286-297`), and `ViewQuerySchema` already types the
  map. If the agent finds otherwise, it escalates rather than amending in place (standing rule since
  sprint-008).

TEST-646: Scoped suite green, and CLI-016/017's guards intact
  Given: The change
  When: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/cli` is run once
  Then: Green, and `apps/cli/src/commands/doc/edit.test.ts`'s existing cases still pass unmodified —
  CLI-017's `assertNotArchived` refusal and CLI-016's `--extra` grammar are neither weakened nor
  routed around. `edit.ts` now carries a third concern; the test file proves the three compose.

---

## Cross-cutting

TEST-647: No agent amended `SPEC.md`
  Given: `git diff SPEC.md`
  When: Inspected
  Then: **Empty.** Phase 6 has had no spec pass, and none of these six issues needs one. Two places
  invite a passing edit and neither is taken: §10's ⋯-menu sentence enumerates "Archive, Delete, and
  Resolve/Reopen" and does not name Unarchive (UI-020), and §11's `db doctor` sentence does not
  contemplate a warning pass (SERVER-038). If an agent believes either must change, that is a
  **spec rider escalated to the orchestrator** for the phase PR with user sign-off — routed to
  spec-writer, never patched in passing.

TEST-648: No agent amended `packages/contract`
  Given: `git diff packages/contract`
  When: Inspected
  Then: **Empty.** Verified at contract time for CLI-018 (all four view keys already ship on both
  write routes) and expected for the rest. SERVER-038 is the one issue that might genuinely need a
  rider; it escalates (Open Conflict 1) rather than editing.

TEST-649: `packages/kit` moved only where this contract allows it
  Given: `git diff packages/kit`
  When: Inspected
  Then: **Empty except UI-020's client method + mutation hook** (Adjudication 6), which is quoted
  and justified in that issue's log. A kit change in SERVER-033, SERVER-038, UI-016, UI-021 or
  CLI-018 is an escalation.

TEST-650: No agent ran a state-changing git command
  Given: Every agent's transcript and the repository's reflog
  When: Audited
  Then: No `git commit`, `push`, `checkout`, `reset`, `stash`, `mv`, or `rm` by an implementing agent
  **in this repository**. Git activity inside a scratch workspace is the *server's* own auto-commit
  and is expected — that is what TEST-604, TEST-618 and TEST-633 read.

TEST-651: The repository is clean of scratch escape
  Given: `git -C /Users/theophanerupin/code/corpus status --porcelain` at the end of each session
  When: Read
  Then: Only intended source edits. No `data/`, no `.corpus/`, no `.claude/skills/` entries, no
  clobbered `README.md`/`.gitignore`, no stray coverage or Playwright output, no `corpus-*.tgz`.
  Pasted by **every** agent. Note the repo root already carries an untracked `corpus-0.0.0.tgz` from
  earlier packaging work — leave it alone and do not add to it.

TEST-652: No workspace was scaffolded into the dev repo
  Given: `ls -d /Users/theophanerupin/code/corpus/.corpus` at the end of each session
  When: Run
  Then: Absent — "No such file or directory", pasted. **Verified absent at contract time.** Every
  drill ran from a cwd outside this repository (Adjudication 15). This is the CLI-014 incident's
  direct check and it is not optional for any issue in this batch, including the ones that never run
  `corpus init`.

TEST-653: Ports and processes are clean, and `8765` was never touched or proxied
  Given: The end of each session
  When: `lsof -nP -iTCP:<port> -sTCP:LISTEN` is run for each allocated server port, each Vite port,
  and for `8765`
  Then: Nothing bound that the agent started; no orphaned vitest or Playwright workers
  (`ps aux | grep -E 'vitest|playwright'`); and `8765` still shows **pid 15627** — never bound by us,
  never killed, **never proxied into**. Each agent that started a Vite dev server (UI-016, UI-020,
  CLI-018) pastes its `CORPUS_SERVER_ORIGIN` export **and** the request proving the proxy answered
  from its own server. `8791` (pid 44370) and `5274` (pid 45071) belong to other work in flight and
  are equally untouchable.

TEST-654: The two `npm install`s did not corrupt the shared tree
  Given: SERVER-033 and UI-016 each change a dependency major, serialized (Adjudication 3)
  When: Each finishes
  Then: `package-lock.json` carries exactly the intended change and nothing else, `npm ls` reports
  no unmet peer or invalid tree, `npm run build` succeeds from a clean `dist/`, and **no workspace
  version moved** (`npm run version:check`). The second of the two rebases onto the first's lock
  rather than regenerating it (Adjudication 3).

TEST-655: Generated artifacts regenerate cleanly at harvest
  Given: The merged tree, on which **one** issue regenerates `docs/cli.md` (CLI-018)
  When: The orchestrator runs the generated-artifact drift checks for `docs/cli.md` and
  `openapi.json`
  Then: **Green.** `docs/cli.md` regenerated from the registry on the merged tree, never hand-merged.
  `openapi.json` has no reason to move at all — no issue in this batch changes the API surface, so
  any diff there is a symptom of something nobody intended (or of SERVER-038's Open Conflict 1
  having been resolved by editing rather than escalating).

TEST-656: The repo-wide gate passes at harvest
  Given: The merged tree
  When: The orchestrator runs the single repo-wide `npm run coverage`
  Then: Lint, format, typecheck, unit tests, e2e and the ≥90% four-metric merged gate all pass, with
  **no new per-path exemption** in `scripts/coverage-config.ts` (Adjudication 17). This is the
  batch's only repo-wide run and the only full `npm run e2e` execution — and it is the first run in
  which the whole e2e suite meets both dependency majors at once.

---

## Out of Scope

- **Any `SPEC.md` edit.** Phase 6 has had no spec pass; the two invitations are named in TEST-647
  and both are riders, not edits.
- **Any in-place `packages/contract` amendment.** Standing rule since sprint-008. SERVER-038
  escalates instead (Open Conflict 1).
- **Any `packages/kit` change outside UI-020's client method + hook** (Adjudication 6).
- **A data-router refactor of the UI** (`createBrowserRouter`/`RouterProvider`). UI-016 is a
  dependency major, not a routing redesign; the app has two routes and a dev probe. Adding `/doc/:id`
  or `/thread/:id` routes — which `App.tsx`'s own docblock anticipates — is a separate issue nobody
  has filed.
- **Making the reader navigation stack router-backed.** SPEC §10 says browser-local state stays
  local; the stack is `localStorage`, deliberately (TEST-598).
- **A recovery pass over the other four document roots** (`data/threads`, `.claude/skills`,
  `.claude/skills-archived`, `.claude/agents`). SERVER-038 walks `data/docs/` only, for the reasons
  in TEST-606; the others would need their own shape rules (a `README.md` beside a `SKILL.md` is
  legitimately not a document) and are a different finding.
- **Teaching `classifyPath` to index dot-segment paths.** That would make `data/docs/.claude/` a
  supported location — a product decision nobody has made (carried from sprint-017).
- **Deleting or moving invisible documents automatically** (SERVER-038 TEST-610). Deletion is a user
  act, per §7 and §9.2.
- **Changing any shipped toast wording** in UI-020. The issue is about which route the action calls,
  not what it says afterwards.
- **`carriesForm`'s dead-code cleanup** (wave-3 CLEAN 41) and the other CLEAN-tier residue from
  `issues/evals/AUDIT-S017-wave3.md`. That ledger is SHARED-003's, and SHARED-003 is the
  orchestrator's.
- **SPEC 33, 35, 36, 39, 40** from the same audit (the `todos migrate` spec gap, the comment skill's
  non-executable unarchive line, the "reversible" clauses naming no verb, `TodoDocPanel`'s overdue
  treatment, the stale `View` documentation). Routed to the phase-PR spec rider and separate issues.
- **UI-022, UI-023, UI-024** — the dogfood reports in the Phase 6 table. A separate batch.

---

## Integration Points

The six issues are independent in code. Three seams matter anyway:

- **UI-020 ⇄ SERVER-039 (shipped).** The server refuses `PUT` with a non-archived `status` on an
  archived document: `400` / `bad_request` / `issues[0].path = "body.status"`, message naming
  `POST /api/docs/{id}/unarchive`. UI-020 consumes that contract in two directions — it stops
  producing the refused request (TEST-619, TEST-620) and it starts calling the named route
  (TEST-616) — and it must not weaken the guard (TEST-621). **`git diff apps/server` empty.**
- **UI-020 ⇄ SERVER-036 (shipped).** `POST /api/skills` 409s when the name belongs to an archived
  skill, with a message that says "unarchive it to bring it back". TEST-618 makes that sentence
  executable from the UI for the first time — and only because Adjudication 7 moves Archive onto the
  route that actually archives a skill.
- **CLI-018 ⇄ the board (shipped, unchanged).** The producer is the CLI writing
  `{pinned, order, query, column}` through `POST /api/docs` / `PUT /api/docs/:id`; the consumer is
  `apps/ui/src/board/useColumns.ts`'s single query `{pinned: true, type: "view", sort: "order"}`,
  woken by the `["docs"]` SSE invalidation. **`git diff apps/ui` must be empty for CLI-018** — if the
  board needs a change to render an agent-created view, the agent has written a shape the board does
  not read, which is the failure TEST-642 is for.

---

## Escalations and Open Conflicts

### 1. SERVER-038 may need a `DoctorReport` shape change (**P2 — ESCALATED, default supplied**)

`DoctorReportSchema` is `{ok, drift: [{kind, path, detail}], stats}`, `DRIFT_KINDS` is a closed
six-entry enum in `packages/contract`, and `routes/db.ts:14-18` records that `warnings` is
*deliberately* absent from both db responses. There are three ways out and they are not equal:

- **(a)** Reuse the existing shape — a new `DriftKind` value. Cheapest to consume, but `DRIFT_KINDS`
  lives in the contract, so it **is** a contract change, and it makes an invisible file "drift",
  which flips `ok` and the exit code for affected workspaces.
- **(b)** A new `warnings` array — a contract change that reverses a documented decision.
- **(c)** Something the existing shape already carries.

**Recommended default (proceed on this unless overruled):** the agent looks for (c) first. If the
answer is (a) or (b), it **stops and escalates the same session** with the shape it needs and a
one-paragraph rationale, marks TEST-611 and TEST-614 `STRUCK → Open Conflict 1`, and does **not**
amend `packages/contract` in place. The orchestrator then rules between filing a CONTRACT rider
inside this wave and carrying SERVER-038 to the next. Landing the pass with the findings printed
only in the CLI's human output and absent from `--json` is **not** an acceptable fallback: the agent
reads `--json`, and a recovery surface the agent cannot see is a recovery surface for nobody.

### 2. UI-016 may hit a v8 shape the `<Route>`-as-child pattern cannot express (**P2 — ESCALATED, default supplied**)

`devRoutes()` returns a naked `<Route>` element spliced into `<Routes>`. v8's element-based
`<Routes>` is expected to keep accepting that, but it was not verified against a v8 tree at contract
time.

**Recommended default (proceed on this unless overruled):** if v8 refuses the pattern, the agent
takes the **smallest** replacement that preserves the two properties `devRoutes`'s docblock names —
dev-only mounting via `import.meta.env.DEV`, and both branches testable through the `isDev`
parameter — quotes the change in the E2E log, and reports it when it reports done. It does **not**
take this as licence to move the app onto a data router (Out of Scope). If the smallest replacement
is still a structural change to `App.tsx`'s route table, it escalates instead.

### 3. UI-020's kit hook may need an invalidation shape the kit does not expose (**P3 — ESCALATED, default supplied**)

The unarchive mutation must invalidate the same keys the archive path does today
(`useUpdateDoc`'s `onSuccess`), including the board's column query and the tree.

**Recommended default:** mirror `useUpdateDoc`'s invalidation exactly, by composition at the call
site where possible. If mirroring requires changing an existing kit hook's signature, the agent
stops and escalates rather than widening Adjudication 6's exception from "additive" to "whatever the
change needs".

---

## Orchestrator Adjudications (2026-07-30)

Binding rulings. Implementing agents follow these; the evaluator evaluates with them.

1. **`8765` is never bound, never killed, and never proxied into, by anyone.** It is bound right now
   by pid 15627 — the maintainer's live corpus. Every `corpus init` passes `--port` explicitly,
   because init's default probes upward from 8765. `8791` (pid 44370) and `5274` (pid 45071) belong
   to other work in flight and are equally off-limits. Carried forward from sprint-015/016/017.
2. **`CORPUS_SERVER_ORIGIN` is exported before any Vite dev server starts**, pointing at the agent's
   own port, and the proxy target is **proved** in the E2E log. UI-020 is this sprint's worst
   exposure: it drives archive/unarchive, which move folders on disk.
3. **SERVER-033 and UI-016 never run concurrently with each other.** Each runs `npm install` against
   a shared `node_modules`, and an install racing another agent's build corrupts the tree for both.
   Whichever lands second rebases onto the first's `package-lock.json` rather than regenerating it.
   Either may run alongside a non-installing issue.
4. **A migration's security guards are verified over real HTTP, never through `app.request`.** Both
   `apps/server` guards that read `c.env.incoming` — `localhostOnly`'s peer address and the
   attachment route's raw request target — degrade to `undefined` under an adapter that does not
   supply the binding, and the shipped unit tests would stay green through that degradation because
   they exercise the pure functions directly. TEST-583 and TEST-584 are not satisfiable by a passing
   suite.
5. **UI-016's "no behavior change" bar is the named spec list, not the suite total.** The reader
   navigation stack is not react-router (SPEC §10 — browser-local state), so the issue's third
   acceptance criterion is restated as a no-diff claim (TEST-598). The genuine surface is
   `App.tsx`'s route table, `devRoutes`'s `<Route>`-as-child pattern, `useSearchParams`, and
   `MemoryRouter` — plus `smoke.spec.ts:255`, the **only** e2e test in the repository that navigates
   anywhere but `/`.
6. **UI-020 may change `packages/kit`, additively, by name.** There is no `archiveDoc`/`unarchiveDoc`
   on `CorpusClient` and zero occurrences of "unarchive" anywhere in `packages/kit/src` or
   `apps/ui/src`; the menu item has nothing to call. Scope: one client method, one mutation hook,
   their tests. This is an exception **by name**, not by category — no other issue in this batch may
   invoke it, and it does not extend to changing an existing hook's signature (Open Conflict 3).
7. **UI-020 moves Archive onto `POST /api/docs/{id}/archive` as well as adding Unarchive.** The UI
   archives with `PUT {status: "archived"}` (`useRowActions.ts:127-135`), which for a skill sets the
   frontmatter and leaves the folder in `.claude/skills/` — the mirror image of the half-state
   SERVER-039 closed, and the reason the issue's own criterion 2 is unreachable today. Only
   `setArchived` moves the folder; `mayChangeTree` is cache invalidation, not a move. Adding the
   inverse to a transition that was never right in the first place is half a fix.
8. **UI-021 may touch `apps/server` for comments and one test name only.** Convergence makes
   `core/form.ts:170-193`'s "deliberately wider… reported for a UI follow-up" paragraph and
   `form.test.ts:211`'s `it("diverges from the renderer…")` false. The change is bounded:
   `git diff apps/server` must contain **no executable-line change**, every assertion identical, the
   diff quoted in the log. Leaving a docblock that documents a divergence which no longer exists is
   drift, and filing a separate issue for a comment is ceremony.
9. **SERVER-038 derives its predicate from `classifyPath`, never from a second list** — the same
   rule sprint-017's Adjudication 15 applied to SERVER-037's refusal, for the same reason. Under
   `data/docs` the shape is `markdown-tree`, so "a `*.md` file for which `classifyPath` returns
   `null`" is the whole predicate, and TEST-607 proves it is derived rather than copied.
10. **SERVER-038 is report-only in v1, and the near-miss list in TEST-605 is the false-positive bar.**
    Deletion stays a user act (§7). Every item on that list is enumerated in the log with its
    observed result; "we ran doctor and it looked fine" is not evidence of zero false positives.
11. **CLI-018 reuses CLI-016's documented value grammar or justifies the divergence in writing**
    (TEST-637), including the finiteness gate the wave-3 audit's FIX 1 added. `order` must land as a
    YAML number — the board sorts on it, and CLI-016 already lost this exact bet once with
    `extra.width`.
12. **`docs/cli.md` is regenerated, never hand-edited and never hand-merged.** Only CLI-018 touches
    it in this batch; the orchestrator runs the drift check at harvest (TEST-655).
13. **SPEC 38 is CLI-018's to decide, between two named outcomes** (TEST-639), and the decision is
    recorded. The premise needs correcting first: `extra` accepts objects on the wire
    (`EXTRA_MAX_DEPTH = 8`), so the scalars-only limit is a CLI grammar choice and not a contract
    limitation.
14. **Scoped tests only**, `VITEST_MAX_THREADS=4`, one workspace-scoped run per session maximum, one
    heavy command at a time; nobody runs `npm run e2e` or `npm run coverage`. Playwright, where
    permitted (UI-016 and UI-020 only), runs scoped with `--workers=1` against the agent's own port,
    at most once, never while another dev server is up.
15. **All scratch lives under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`**, one prefix per
    domain and one directory per issue, never bare `/tmp`, never inside the repository, **never
    glob-deleted** — two agents share each of the `s018-server` and `s018-ui` prefixes. Every drill
    runs from a cwd outside this repository and every agent verifies
    `/Users/theophanerupin/code/corpus/.corpus` is absent before declaring done (TEST-652).
16. **`/usr/bin/grep` for every grep-based claim.** The `rtk` proxy has produced false negatives.
    UI-016's entire scope argument rests on one such search (TEST-594).
17. **No new per-path coverage exemption** in `scripts/coverage-config.ts`, in any issue.
18. **Deleting or weakening a test to reach green is a fail.** For the two migrations this is the
    central rule: a spec that changed is listed, quoted and justified (TEST-588, TEST-599), and an
    assertion that got weaker is a fail even when the suite is green.
19. **UI evidence is two-part.** `apps/ui/playwright.config.ts:16-22` starts **no** workspace server,
    so a Playwright spec proves only the UI-observable half; the disk / git / projection half comes
    from the manual real-app drill against the agent's own server. Neither is acceptance alone
    (carried forward from sprint-016/017).
20. **No implementing agent runs a state-changing git command in this repository** (TEST-650).

---

## Merge order (recommendation)

1. **UI-021 first — it is the smallest thing here.** One `continue`, one paired test block, one
   docblock. Landing it early frees a slot and puts a clean commit on the branch.
2. **SERVER-038 and CLI-018 in parallel** — different domains, no shared files, neither runs
   `npm install`. CLI-018 is the higher-value one (it closes a §10 promise) and the more likely to
   need a browser drill, so give it the Vite port.
3. **UI-020 next**, once one of the above frees a slot. It is the widest of the four (kit + menu +
   frontmatter form + the Archive re-route) and it wants a real workspace on `8797` for TEST-618's
   folder-and-409 evidence.
4. **SERVER-033, then UI-016 — serialized, one at a time, alone against the dependency tree**
   (Adjudication 3). Put them last: they are the two issues whose failure mode is "everything else
   stops building", and running them after the behavioral work means a bad install never blocks a
   fix that was ready.
5. **Respect the ~3-agent cap throughout**, and stagger launches so end-of-session scoped test runs
   do not collide. Six issues do not mean six agents.
6. **Rule Open Conflict 1 the moment SERVER-038 reports a contract need**, not at harvest — a
   CONTRACT rider inside this wave is cheap; discovering the need at harvest is not.
7. **Harvest** — regenerate `docs/cli.md` on the merged tree, run the generated-artifact drift
   checks, then the single repo-wide gate (`npm run coverage`, including the one `npm run e2e`).
8. **Audit** — `/audit` qualifies for **SERVER-033** (security-sensitive: a path-traversal advisory
   in a static-file server, with two guards reading adapter internals) and for **UI-020**
   (cross-package, changes a shipped write path). UI-016 qualifies if the router change reached
   beyond the four files.
9. **Evaluate**, then route the wave's spec riders — this batch is expected to surface at least the
   §10 ⋯-menu enumeration (UI-020) and possibly §11's doctor sentence (SERVER-038) — to spec-writer
   for the phase PR, with user sign-off. Neither is patched in passing.

---

## Done Criteria

This sprint is complete when:

- All non-struck acceptance tests PASS in the evaluator's verdict, with every `STRUCK`/`DEFERRED`
  criterion carrying its reason and substitute evidence
- **TEST-618 passes** — a skill archived from the UI lands in `.claude/skills-archived/`, 409s
  `corpus skill create`, and comes all the way back from the reader menu with its name freed. It is
  the single gate that separates UI-020 from a menu item, and no combination of passing unit tests
  substitutes for it
- **TEST-634 passes** — the board renders an agent-created, agent-pinned view live in a real
  browser, with the SSE frame and the proxy proof pasted. §10's "just works" is a claim about a
  browser, not about a frontmatter key
- **TEST-605 passes with every named near-miss enumerated individually** — `my.notes`, `v1.2`,
  `notes/2026.07`, `a.b/c.d`, `finance/2026`, `archive.2026`, `node_modules.md`, the seeded folders,
  `data/docs/README.md`, the deep nest, the non-markdown files, and the `.corpus`/`.claude` trees
- **Both migrations carry a no-behavior-change proof, not a green suite** — TEST-582/583/584/588 for
  SERVER-033, TEST-594/595/598/599/600 for UI-016 — with every touched spec listed and justified
- Both bug-shaped issues (SERVER-038, UI-021) carry a **pre-fix reproduction** in their logs, per the
  SDLC's bug rule; SERVER-038's is the doctor-reports-clean-while-files-exist observation (TEST-603)
- SERVER-038's `ok`/exit-code decision (TEST-609) and CLI-018's SPEC 38 adjudication (TEST-639) and
  verb-shape choice (TEST-644) are each recorded in their issue files, with the rejected option and
  the reasoning
- `docs/cli.md` regenerates cleanly on the merged tree and `openapi.json` has not moved
- `/test` passes with no regressions and `/lint` passes
- The repo-wide coverage gate passes at harvest with no new exemptions
- `git diff SPEC.md` and `git diff packages/contract` are empty across the whole batch;
  `git diff packages/kit` is empty except UI-020's named exception
- `git status` is clean of scratch escape, `/Users/theophanerupin/code/corpus/.corpus` is absent, and
  `8765` still shows pid 15627 — untouched and unproxied
- Every escalated Open Conflict is either ruled or explicitly carried forward
