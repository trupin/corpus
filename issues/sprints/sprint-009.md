# Sprint 009 — Phase 3, the board itself: columns, rows, and three server debts

**Issues**: UI-003, UI-004, SERVER-016, SERVER-024, SERVER-025
**Domains**: ui, server
**Date**: 2026-07-27
**Plan phase**: Phase 3 — UI
**Branch**: `phase-3-ui` (currently at `6543280`; agents work in worktrees cut from it)

---

## What makes this sprint different

**Two of the five issues are the board, and the board is the product.** UI-003 and UI-004 together
are SPEC.md §10's entire first screen — the thing a user sees when `corpus server start` prints a
URL. Everything after them (UI-005 reader, UI-006 editor, UI-007 anchored threads, UI-009 search,
PLUGINS-001) hangs off the two contracts they establish: the **column** contract (a pinned view
document) and the **row** contract (`Row`'s props, exported from `packages/kit`).

**UI-003 cannot be implemented against the shipped contract, and this is not a small gap.**
SPEC.md §10 says *"A column IS a `type: view` document with `pinned: true`; its frontmatter holds
the query … and `order`."* The workspace agrees — `assets/workspace/data/docs/views/attention.md`
ships `pinned: true`, `order: 1`, `query: {needs: me}` — and the server's document core agrees
(`core/frontmatter.ts` is explicitly *"the pre-defaults form plus passthrough for plugin keys"*).
**Only the HTTP contract disagrees.** `GET /api/docs` has no `pinned` filter and no `order` sort;
`DocRow` and `DocFrontmatter` carry no `pinned`, `order`, `query` or `column`;
`CreateDocRequestSchema` and `UpdateDocRequestSchema` cannot set any of them. Every one of UI-003's
sixteen acceptance criteria that touches a view document — query it, sort it, chip it, reorder it,
create it, edit its query — is **unimplementable today**. This is **Open Conflict 1**, it is P0, and
it needs a filed CONTRACT issue and a filed SERVER issue adjudicated *before* UI-003's agent is
spawned. Sending an agent at UI-003 without settling it produces either a board hardcoded in
TypeScript (which the first acceptance criterion forbids by name) or a silent improvisation inside
`packages/contract` (which §9.3 and sprint-008's Integration Points forbid).

**UI-004, by contrast, is fully supported and then some.** CONTRACT-005 and SERVER-015 shipped
`DocRow` with `stale`, `attention[]`, `anchorQuote`, `lastTurn`, `lastAuthor`, `unread`,
`awaitingAgent`, `turnCount`, `parent`, `agent`, `due`, `reviewed` and `evergreen`. The one thing
UI-004's issue file asks for that the wire does not carry is the **parent document's title**
(Open Conflict 6), and the one thing it asks the component to compute that the server **already
computes** is the staleness tier (Open Conflict 5). Both are corrections that make the issue
smaller, not larger.

**SERVER-016 is the sprint's one clean issue.** CONTRACT-007 pinned everything: the route, the
grammar, the fence parser, `validateFormAnswer`, `FormRespondPayloadSchema`, and — in the response
schema's own prose — the §8 resolved-thread rule (`eventId` is *"Null when the answer does not
re-trigger it — a resolved thread stops re-triggering the agent even while it is engaged"*). The
CONTRACT-007 evaluator deferred exactly three criteria here (TEST-56/57/59 of sprint-008), and they
are folded in below as TEST-79/82/91. The route currently **404s** on a running server; nothing in
`apps/server` imports `validateFormAnswer`. This is a write-path issue with every decision already
made for it.

**SERVER-024 is a two-workspace issue filed as a one-workspace issue.** The server half is real
(`mountStaticUi` serves `index.html` with no injection point, and the `*` mount is unauthenticated
by construction). But the consuming half is `apps/ui/src/app/apiClient.ts`, whose `configuredToken()`
reads `import.meta.env.VITE_CORPUS_TOKEN` — a **build-time** substitution that a server cannot
inject into after the fact. Whatever mechanism is chosen, `apps/ui` changes. **Open Conflict 8.**
And because injecting a bearer token into an unauthenticated response is the security question the
issue's own AC demands be written down, **Open Conflict 9** names the standard the rationale has to
meet.

**SERVER-025 is reproduction-first, and the reproduction is likely to fail.** `lifecycle.ts` runs
`openWorkspaceProjection` (whose boot scan, `populateFromFiles`, is fully synchronous) at line 134,
`createServer` at 135, and `server.start()` — the HTTP bind — at 150. A client physically cannot
reconnect before the boot projection has finished, because there is nothing to connect to. The
UI-002 evaluator independently failed to reproduce the race 3/3 and retracted its own recorded
failure as a fixture error. **Open Conflict 10** tells the agent what to do when the reproduction
does not reproduce, and points at the narrower window that *is* real. A "no code change, here is
why, here is the regression test that pins the ordering" close is a **full PASS** on this issue.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue          | The real application in this sprint                                                                                                                                                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI-003**     | A **real `corpus init` workspace** (so the three seed view documents exist), a **real server process** on `8905`, and a **real browser**. Column reorder verified in the UI **and** by `cat`-ing the view document on disk **and** `git log -1`. A drag whose only evidence is a DOM assertion is not verified. |
| **UI-004**     | Vitest + jsdom in `packages/kit` for the ladder/badge/reason units, plus a **real server on `8915`** seeded with documents of varied ages for the quick actions. "Still current" is verified by reading `reviewed` **and** `updated` off disk after the mutation — the whole point of the act is that they differ. |
| **SERVER-016** | A **real server on `8925`** against a **real git workspace**, driven by `curl`. There is no CLI verb for this route (`corpus thread` has only `reply`, `resolve`, `reopen`), so HTTP is the interface. Evidence is the thread markdown on disk, `git log`, and `.corpus/queue/pending/*.json`.                 |
| **SERVER-024** | `npm run build -w apps/ui` (nothing builds `apps/ui/dist` automatically), then `corpus server start` on `8935`, then a real browser or `curl` of the served page — and an **authenticated API call that succeeds with no manual token step**. A unit test asserting a template string is not this criterion.   |
| **SERVER-025** | A **real server on `8945`**, stopped and restarted, with a **real SSE client** (`curl -N /events?token=…`) attached across the restart, and the projection state read back over HTTP. Bus-level assertions are the unit half, not the E2E half.                                                              |

### Port allocation

This sprint takes the `8900`–`8999` band, one non-overlapping range per issue. Nothing from sprint
008's allocation is running (verified at contract time: nothing bound in `8900`–`8999`).

| Consumer                             | Range         | Primary                                    |
| ------------------------------------ | ------------- | ------------------------------------------ |
| UI-003                               | `8900`–`8909` | `8905` (UI: `CORPUS_UI_PORT=5273`)         |
| UI-004                               | `8910`–`8919` | `8915` (UI: `CORPUS_UI_PORT=5273`)         |
| SERVER-016                           | `8920`–`8929` | `8925`                                     |
| SERVER-024                           | `8930`–`8939` | `8935`                                     |
| SERVER-025                           | `8940`–`8949` | `8945`                                     |
| Sprint-009 integration (TEST-125…138) | `8950`–`8959` | `8955`                                     |
| Automated tests, every workspace     | —             | `0` (ephemeral). Never hardcode.           |

**Reserved:**

- **`8765` must stay UNBOUND for the whole sprint, by everyone.** It is the workspace default and
  the target of `apps/ui/vite.config.ts`'s proxy (`CORPUS_SERVER_ORIGIN ?? "http://127.0.0.1:8765"`).
  `apps/ui/e2e/smoke.spec.ts` asserts the console strip reads exactly **`"server unreachable"`**,
  which is only true when nothing listens on 8765. Pass `--port` explicitly to `corpus init` so its
  upward probe never reaches it, and check `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done.
  Verified free at contract time.
- **`5273` is a single-holder resource, and this sprint has two claimants.** `playwright.config.ts`
  now sets **`reuseExistingServer: false` unconditionally**, so `npm run e2e` always starts its own
  Vite on `CORPUS_UI_PORT` with `--strictPort`. A dev server squatting on 5273 makes the e2e run
  **fail loudly** rather than silently attaching to the wrong build — that is the intended
  behaviour, not a bug. **UI-003 and UI-004 must not run `npm run e2e` concurrently, and neither may
  leave `npm run dev -w apps/ui` running on 5273 while the other runs e2e.** Coordinate through the
  orchestrator. Verified free at contract time.
- **`5173`** — held by an unrelated `ssh` process on this machine (PID 16094, re-confirmed at
  contract time). Always export `CORPUS_UI_PORT=5273`. `.githooks/pre-push` now defaults it to 5273
  when unset (INFRA-004), so a push no longer fights this; an interactive `npm run e2e` still needs
  the export.

### Scratch directories — one prefix per issue

| Issue       | Prefix                                       |
| ----------- | -------------------------------------------- |
| UI-003      | `mktemp -d /tmp/corpus-u003-XXXXXX`          |
| UI-004      | `mktemp -d /tmp/corpus-u004-XXXXXX`          |
| SERVER-016  | `mktemp -d /tmp/corpus-s016-XXXXXX`          |
| SERVER-024  | `mktemp -d /tmp/corpus-s024-XXXXXX`          |
| SERVER-025  | `mktemp -d /tmp/corpus-s025-XXXXXX`          |
| Integration | `mktemp -d /tmp/corpus-sprint009-int-XXXXXX` |

Automated tests use `fs.mkdtemp`/`mkdtempSync` with the same prefix (the shipped precedent is
`apps/server/src/docs/write-fixture.ts`'s `createWriteWorkspace`, which already builds a real git
repo in a `mkdtempSync` directory and serves on `port: 0`). **Never** `rm -rf /tmp/corpus-*` —
delete only paths you created and captured in a variable.

**Two scratch hazards specific to this sprint:**

- **UI-003 and SERVER-016 both run `git` commands against a scratch workspace** to prove
  auto-commits. Every `git` invocation carries an explicit `cwd`. A `git` command that runs with the
  wrong working directory operates on **the Corpus repository itself**. Run `git status` in your
  worktree before declaring done and confirm it shows only files you meant to change.
- **SERVER-024 reads `.corpus/config.json`**, which holds the bearer token. Read it, never print it
  into the E2E log — redact to a prefix (`tok_abc…`) — and confirm the file's mode is still `600`
  afterwards.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node`, `killall node` **kill sibling
agents' servers and dev servers** and are forbidden for the duration of this sprint. Stop what you
started, by pid:

```sh
node --import tsx apps/cli/src/bin/corpus.ts server start   # then: corpus server stop
npm run dev -w apps/ui & UI=$!                              ; kill -TERM "$UI"
curl -N "http://127.0.0.1:8945/events?token=$TOK" & SSE=$!  ; kill -TERM "$SSE"
```

Before declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. Playwright's
`webServer` child and background `curl -N` SSE clients are killed by captured pid. Check `5273` too.

### Runtime gotchas that will otherwise be misread as bugs

Every fact below was read out of the shipped tree at `6543280` while writing this contract.

**The CLI entry point**

- The `corpus` bin runs from source as `node --import tsx apps/cli/src/bin/corpus.ts`. There is no
  installed `corpus` on PATH in this repo.

**What the kit actually exports — read this before writing a line of UI-003 or UI-004**

- The kit's public surface is **seven read hooks plus exactly one write**: `useDocs`, `useDoc`,
  `useThread`, `useTree`, `useJobs`, `useLocks`, `useHealth`, and `useAppendTurn`. `CorpusClient`
  has **one** mutating method, `appendTurn(threadId, input)`.
- **There is no `createDoc`, no `updateDoc`, no `createThread`, no archive, no move.** UI-003 needs
  `POST /api/docs` and `PUT /api/docs/{id}`; UI-004 needs `PUT /api/docs/{id}` and
  `POST /api/threads`. **Neither can reach them today.** `QueryClient`, `useQuery`, `useMutation`,
  the raw `CorpusApi` and `@corpus/contract/client`'s transport are all **deliberately not
  re-exported** — a component cannot bypass the kit. **Open Conflict 2.**
- Everything reaches the server through `useCorpusClient()`. `apps/ui`'s TEST-4 rule from sprint-008
  stands: no file under `apps/ui/src` outside the provider wiring may call `fetch(` or import from
  `@corpus/contract/client`.

**The board that exists today is not where UI-003's issue file says it is**

- The UI-001 placeholder is `apps/ui/src/shell/Board.tsx` — nine lines rendering
  `<main className="board" aria-label="Document lists"><p className="board-empty">No lists yet</p></main>`
  — with `Board.css` and `Board.test.tsx` beside it. `apps/ui/src/shell/Shell.tsx` imports it as
  `./Board`. **`apps/ui/src/board/` does not exist.** UI-003's file list assumes it does. Moving or
  wrapping is a decision, not an accident; make it explicitly and update `Shell.tsx`'s import.
- `apps/ui/src/app/global.css:56-72` already declares the reduced-motion guard for `.working-dot`,
  `.row.flash`, `.col` and `.row.leaving`, with a comment saying those elements *"arrive with later
  issues; the guard is declared once, here, so no future animated element can ship without it."*
  **Both UI issues inherit that guard and neither may re-declare it** — and it makes `global.css` a
  shared touch point (Open Conflict 3).
- There is **no toast surface** and **no error boundary** anywhere in `apps/ui/src` or
  `packages/kit/src`. Both UI issues assume a toast; UI-003's issue file already says to add a
  minimal one in `apps/ui/src/shell/` for UI-011 to take over. Only one of the two may create it.

**`DocRow` is richer than UI-004's issue file assumes, and poorer than UI-003's**

- Every row already carries, populated by SERVER-015: `stale` (`"aging" | "stale" | "very-stale" |
  null`, where **`null` is fresh** and is also what an `evergreen` document and an unknown age
  return), `attention` (an array of `NEEDS_REASONS`, *"populated on every response rather than only
  under `needs=`"*), `anchorQuote`, `lastTurn`, `lastAuthor`, `unread`, `awaitingAgent`, `turnCount`,
  `parent`, `agent`, `due`, `reviewed`, `evergreen`, `excerpt`, `snippets`.
- `NEEDS_REASONS = ["unread-reply", "form", "due", "stale", "failed-job"]`. `attention` never
  contains `me`.
- **`parent` is an id, not a title.** UI-004's "whole-document threads show their parent's title"
  has no data source on the wire (Open Conflict 6). Compare `Job.originTitle`, which CONTRACT-007
  added for exactly this reason.
- **No lock information rides a `DocRow`.** The lock chip comes from `useLocks()`, as UI-004's issue
  file already says.
- **`DocRow` carries no `pinned`, `order`, `query` or `column`**, `DocsQuerySchema` has no `pinned`
  parameter, `DOC_SORTS` has no `order`, and neither `CreateDocRequestSchema`
  (`type, title, body, folder, tags, status, due, evergreen`) nor `UpdateDocRequestSchema`
  (`title, body, tags, status, due, reviewed, evergreen`) can express one. **Open Conflict 1.**

**The prototype, verbatim — these are the numbers the criteria mean**

- `.board { flex: 1; display: flex; gap: 14px; overflow-x: auto; overflow-y: hidden; padding: 16px 18px 12px; scroll-snap-type: x proximity; }`
- `.col { scroll-snap-align: start; flex: none; width: 336px; … background: var(--surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-soft); overflow: hidden; transition: width 0.25s ease, border-color 0.3s ease; }` ·
  `.col.dragging { opacity: 0.55; border-style: dashed; }` · `.col.kactive { box-shadow: 0 0 0 2px var(--accent-wash), var(--shadow-soft); }` ·
  `.col-head { cursor: grab; }` / `.col-head:active { cursor: grabbing; }`
- `.col-title { font-weight: 600; font-size: 14px; }` · `.col-kind { font-family: var(--mono); font-size: 10px; color: var(--ink-3); letter-spacing: 0.06em; text-transform: uppercase; }` ·
  `.col-count { margin-left: auto; font-family: var(--mono); font-size: 11px; color: var(--ink-3); }` ·
  `.sort { margin-left: auto; font-size: 11px; font-family: var(--mono); color: var(--ink-3); }`
- `.chip.on { background: var(--accent-wash); border-color: transparent; color: var(--accent-ink); }` ·
  `.chip.warn { background: var(--sepia-wash-2); border-color: transparent; color: var(--sepia-ink); }`
- `.col.ghost-col { border-style: dashed; background: none; box-shadow: none; … width: 220px; cursor: pointer; }`, and its markup is
  `<button class="col ghost-col"><span class="plus">＋</span><p>New list — a folder, a view, or any filter</p></button>`
- **The kind labels in the prototype's own data are lowercase and richer than three words**:
  `"view"`, `"folder"`, `"plugin"`, `"view · pinned"`, `"view · saved search"`. The uppercase comes
  from `text-transform`. Likewise `.col-count` is not always a number in the prototype (`"3 lists"`,
  `"1 of 9"`) — UI-003's criterion that it be the **live result count** is the corpus-backed
  narrowing of that, and it is the one to satisfy.
- `.row { position: relative; display: block; width: 100%; padding: 9px 10px 9px 14px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; }` ·
  `.row:hover { background: var(--surface-2); }` ·
  `.row::before { content: ""; position: absolute; left: 4px; top: 10px; bottom: 10px; width: 3px; border-radius: 99px; background: transparent; }`
- `.row-title { font-family: var(--serif); font-size: 14.5px; font-weight: 600; }` ·
  `.row-excerpt { … -webkit-line-clamp: 2; }` · `.type-glyph { font-family: var(--mono); font-size: 9.5px; … text-transform: uppercase; border: 1px solid var(--line); border-radius: 4px; padding: 0.5px 5px; }`
- `.unread { … color: var(--accent-ink); background: var(--accent-wash); border-radius: 99px; padding: 1.5px 7px; }` with `.unread::before` a `6px` accent dot ·
  `.needs-you { … color: var(--signal); background: var(--signal-wash); … }` ·
  `.working-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }` ·
  `.age { font-family: var(--mono); font-size: 10.5px; color: var(--ink-3); }`
- The ladder, exactly: `.row.age-1 .row-title { opacity: 0.92; }` · `.row.age-2::before { background: var(--sepia); opacity: 0.45; }` + `.row.age-2 .row-title { opacity: 0.82; }` + `.row.age-2 .age { color: var(--sepia-ink); }` ·
  `.row.age-3 { background: var(--sepia-wash); border-color: var(--sepia-wash-2); }` + `.row.age-3::before { background: var(--sepia); }` + `.row.age-3 .row-title { opacity: 0.72; }` + `.row.age-3 .age { color: var(--sepia-ink); font-weight: 600; }`
- `.row.leaving { opacity: 0; transform: translateX(24px); transition: opacity 0.3s ease, transform 0.3s ease; }`
- **The reason vocabulary in the prototype is six labels over three classes, and `due today` uses
  `.r-form`, not a class of its own**: `.r-reply` — *"agent replied"*, *"agent asked back"*;
  `.r-form` — *"awaiting your answer"*, *"due today"*; `.r-stale` — *"review: archive or act"*,
  *"getting stale"*. **There is no failed-job chip in the prototype.** Open Conflict 7.
- All eleven tokens UI-004 needs exist in `packages/kit/src/tokens.css` in all four theme blocks:
  `--surface`, `--surface-2`, `--line`, `--shadow-soft`, `--accent`, `--accent-wash`, `--signal`,
  `--sepia`, `--sepia-ink`, `--sepia-wash`, `--sepia-wash-2`. The file's own comment names `--sepia`
  *"the DEDICATED staleness axis (§5) — never reused for anything else."*
- The prototype's drag is exactly: `mousedown` on `.col-head` sets `draggable = true` **unless the
  target is inside a `button`**; `mouseup` clears it; `dragover` finds
  `[...cols(:not(.dragging):not(.ghost-col))].find(c => e.clientX < c.getBoundingClientRect().left + c.offsetWidth / 2)`
  and `insertBefore(dragCol, after || ghost)`; persistence happens on `dragend`. `⇧←`/`⇧→` move the
  active column with the same `insertBefore` arithmetic and **no wrap-around at either end**.

**Forms, exactly as CONTRACT-007 left them**

- Route: `POST /api/threads/{id}/turns/{ts}/form`, where `ts` is *"the timestamp of the agent turn
  carrying the form"*. Body `FormAnswerRequest = {option: string.min(1), note?: string.min(1)}`.
  Responses **`201 / 400 / 401 / 404` and nothing else**. Optional `x-corpus-author` header. It is
  in `ENDPOINT_INVENTORY`; it **404s on a running server** because nothing mounts it.
- **No `423`, and that is correct, not an omission.** `apps/server/src/threads/turns.ts:11-13`
  records sprint-006 Adjudication 1: *"No lock guard. Commenting is not editing: §7's lock is the
  edit lock, nothing in the parent is touched by a turn, and `appendTurn` declares no `423`."*
  **SERVER-016 must not add a lock guard.**
- `FormAnswerResponse = {thread, turn, eventId (nullable), warnings}` and it **is** a §11 warnings
  carrier. `eventId`'s own description already pins the §8 rule: *"Null when the answer does not
  re-trigger it — a resolved thread stops re-triggering the agent even while it is engaged."*
- The grammar lives in `packages/contract/src/schemas/form.ts` and is **exported from
  `@corpus/contract`**: `FORM_FENCE_PATTERN`, `extractFormSource`, `containsFormFence`, `FormSchema`
  (`prompt` non-empty, `options` ≥ 1, each non-empty, all distinct), `validateFormAnswer(form,
  answer)` returning a `ValidationError` with `path: "body.option"`, `FormRespondPayloadSchema =
  {threadId, formTs, option, note: string|null}` (note is **nullable and required**, not omitted),
  and `FORM_RESPOND_EVENT_TYPE = "form.respond"`. **Nothing in `apps/server` imports any of it
  today.** SERVER-016 imports rather than reimplements.
- The §8 predicate SERVER-016 must route through already exists:
  `apps/server/src/threads/participation.ts`'s `shouldEnqueue` — explicit `requestsAgent` wins
  first, otherwise `if (thread.agent !== "engaged" || thread.status === "resolved") return false`.
- **The fence grammar now has two definitions.** `apps/server/src/docs/needs.ts`'s
  `opensFormFence()` is a hand-written SQL `instr` analogue (matching `\n```form\n` / `\n```form\r`,
  case-sensitive), not a call into the contract's regex. It also already carries the
  `t.status = 'open'` guard SERVER-022 added. Open Conflict 11.
- Appending a **user** turn moves `t.last_author` to `user` and `t.last_ts` forward, so the
  `needs=form` detector stops matching **by construction**. TEST-91 verifies that; it does not
  require a change to `needs.ts`.

**Static UI serving and auth, exactly as they are**

- `mountStaticUi(app, { distDir, logger })` takes **no token and no config**. Its SPA fallback,
  `serveAppShell`, does `readFileSync(join(distDir, "index.html"), "utf8")` **per request** and
  returns the bytes verbatim. There is no template, no nonce, no interpolation.
- It is mounted at `app.use("*", …)` and skips `["/api", "/attachments", "/events"]`. The auth
  middleware is mounted on `/api/*`, `/attachments`, `/attachments/*` and `/events` **only** — so
  **`GET /` is unauthenticated by construction**. This is load-bearing for Open Conflict 9.
- `UNAUTHENTICATED_ROUTES` is exactly `[{GET, health}, {POST, appendJobLog}]`, pinned by
  `auth.test.ts`. `/events` is the sole `allowQueryToken: true` mount.
- The loopback pattern to mirror is `apps/server/src/middleware/localhost.ts`: `localhostOnly` reads
  the **socket remote address** (`env.incoming.socket.remoteAddress`, never a header, `X-Forwarded-For`
  deliberately ignored) and 403s otherwise; `noBrowserOrigin` 403s on the **presence** of an `Origin`
  header at all, whatever its value. Both are wired onto the job-log ingest route via `methodOnly("POST", …)`.
- `resolveUiDistDir` prefers `CORPUS_UI_DIST`, then `apps/ui/dist`, then `<packageRoot>/ui`.
  **Nothing builds `apps/ui/dist` automatically**; with no dist, every non-API route 503s with
  *"UI build not found — run `npm run build -w apps/ui` …"*.
- `.corpus/config.json` is `{version, port, token, dataDir}`, written by `corpus init` at mode
  `0o600` with an explicit `chmodSync` after write.
- Adding a route to `packages/contract` moves `ENDPOINT_INVENTORY` (41 entries today),
  `openapi.json`, `ALL_CONTRACT_ROUTES.length`, and — if it carries a body —
  `expect(bodies).toHaveLength(12)`. **A SERVER agent may not make that change** (§9.3).

**Boot, projection and SSE, exactly as they are**

- `lifecycle.ts:134` `openWorkspaceProjection` → `openProjection` → **`populateFromFiles(db)`, fully
  synchronous**, wrapped in one `db.transaction`. `lifecycle.ts:135` `createServer`.
  `lifecycle.ts:150` `await server.start()` — the HTTP bind. **The boot scan completes before
  anything can connect.** `populateFromFiles` is the same function `POST /api/db/rebuild` calls.
- `populateFromFiles` touches the invalidation bus **nowhere**. That part of SERVER-025's premise is
  true.
- chokidar is constructed with **`ignoreInitial: true`**, so the initial scan emits no `add` events
  at all, produces no `flush()`, and broadcasts nothing. `WatcherHandle.ready` exists and is
  documented as *"Resolves once the initial scan is done and events are live"* — and **nothing in
  `apps/server/src` reads it**.
- The five coarse keys already exist as a named, exported constant:
  `REBUILD_QUERY_KEYS = [DOCS_KEY, TREE_KEY, QUEUE_KEY, JOBS_KEY, LOCKS_KEY]`
  (`apps/server/src/projection/routes.ts:47-53`), today used only by `POST /api/db/rebuild`. SERVER-025's
  mechanism is reusing it, not inventing one.
- `createSseHub` **already returns early when `subscribers.size === 0`**, so SERVER-025's third AC
  ("no frame when there are no subscribers … decide and document") is decided by the shipped hub;
  the deliverable is the sentence, not the code.
- Frames are `event: invalidate\ndata: {"keys":[[…],[…]]}\n\n`; `:connected` on attach; `:hb` every
  25 s (an SSE *comment* — invisible to `EventSource`, visible to `curl -N`; not a stray frame).

**Testing patterns you must follow rather than reinvent**

- jsdom is opted into **per file** with a `/** @vitest-environment jsdom */` docblock. There is one
  root `vitest.config.ts` and no per-workspace config.
- Node 25 shadows jsdom's `localStorage` with an inert built-in; the shipped workaround is
  `apps/ui/src/testing/memoryStorage.ts` (`memoryStorage()` / `throwingStorage()`) stubbed with
  `vi.stubGlobal`. **UI-003's `useBoardLocalState` tests must use it**, including its
  `throwingStorage()` for the private-mode edge case.
- `EventSource` is absent on Node 25 and on CI's Node 22. The seam is `eventSourceFactory`, and
  `@corpus/kit/testing` ships `FakeEventSource`, `fakeEventSourceFactory`, `failingEventSourceFactory`
  and `createCorpusTestHarness`. **No unit test may construct a real `EventSource`.**
- `apps/ui` component tests render through the **real** `CorpusProvider` with `fetch` stubbed via
  `vi.stubGlobal` and the event source injected — not MSW, not `vi.mock` of kit hooks.
- Playwright: `testDir: "./e2e"`, one chromium project, `globalSetup: "./e2e/coverage-setup.ts"`,
  `baseURL` from `CORPUS_UI_PORT`, `webServer` = Vite only, **`reuseExistingServer: false`**. Every
  spec imports `test`/`expect` from `./coverage`, not from `@playwright/test`.
- `apps/ui/e2e/coverage.ts` exports **`nodeCoverageEnv()`** (`NODE_V8_COVERAGE`), the seam INFRA-004
  shipped for spawned processes and demonstrated on nothing. See Open Conflict 12.
- Baseline at `6543280`: **214 test files**; lint/format/typecheck green; `npm run e2e` 13 passed;
  the merged coverage gate green at ≥ 90 on all four metrics. Any red you find at the start of your
  work is yours.

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed — because an adjudication struck it, or a dependency has
not landed at the moment of verification — is marked `DEFERRED → <issue>` or
`STRUCK → Open Conflict N` in the E2E Verification Log, with the reason and the substitute evidence
supplied. **Silent omission is a fail.**

---

## Acceptance Tests

### UI-003: Board columns — pinned view docs, reorder, new-list

Ports `8900`–`8909`, primary `8905`; UI on `CORPUS_UI_PORT=5273`. **38 criteria.** This is the
sprint's largest issue and the one whose foundation is missing: **TEST-1…TEST-6 are gated on Open
Conflict 1 and TEST-7 on Open Conflict 2** — settle both before writing code. Every persistence
criterion is verified twice: on screen **and** on disk.

#### The view-document contract, which is the whole issue

```
TEST-1: A column set comes from the corpus, not from code
  Given: A `corpus init` workspace, whose seed ships exactly three pinned view documents —
         `data/docs/views/attention.md` (order 1, query `needs: me`), `inbox.md` (order 2,
         query `folder: inbox`) and `open-threads.md` (order 3, query `type: thread, status: open`)
  When:  The board loads on a real server on 8905
  Then:  Exactly three columns render, titled Attention / Inbox / Open threads, left to right in
         `order`. Then `corpus doc archive` one of them out of band and reload: two columns render.
         No column title, query or position appears as a literal anywhere in `apps/ui/src` or
         `packages/kit/src` — grep for "Attention", "Open threads" and `needs=me` and quote the
         (empty) result

TEST-2: The pinned-view query goes over the wire, once, without an N+1
  Given: Open Conflict 1's adjudicated mechanism
  When:  The board loads with the network panel (or a proxy log) recording every request
  Then:  The column set is obtained by a bounded number of requests that does not grow with the
         number of columns. A design that issues one `GET /api/docs/{id}` per view document to read
         frontmatter the list response omits is a fail — it is the symptom of the conflict being
         worked around rather than resolved

TEST-3: Columns sort by `order`, and ties break deterministically
  Given: Four pinned view documents whose `order` values are 10, 20, 20, and absent
  When:  The board renders, and then the page is reloaded three times
  Then:  The left-to-right sequence is identical on all four renders, ascending by `order` with the
         documented tiebreak (order, then title, then id) applied, and the document with no `order`
         is placed rather than dropped

TEST-4: The chip row is the stored query, rendered
  Given: `open-threads.md`'s frontmatter query `{type: thread, status: open}`
  When:  Its column header is inspected
  Then:  Two `.chip.on` chips render naming those filters. Then edit the view document's query on
         disk to add `tag: [finance]` and, with no reload, a third chip appears. A chip row derived
         from anything other than the stored query is a fail

TEST-5: The count is the live result count
  Given: The Inbox column (`folder: inbox`)
  When:  A document is created into `data/docs/inbox/` with the real CLI while the board is open
  Then:  `.col-count` increments with no reload, and its value equals the number of rows rendered in
         that column and the `page` total of the same `GET /api/docs` query issued by hand

TEST-6: An unparseable view document degrades to a card, not a crash
  Given: A board with three columns
  When:  One view document's frontmatter is corrupted on disk (malformed YAML) and the board is
         reloaded
  Then:  That column renders an inline error card naming the document, with an affordance to open
         it; the other two columns render and remain interactive; the browser console records no
         uncaught error (`apps/ui/e2e/smoke.spec.ts` asserts `expect(uncaught).toEqual([])` in three
         unrelated tests and a global handler leak will fail them)
```

#### Mutations, which the kit cannot currently perform

```
TEST-7: The board's writes go through the kit, and the kit's surface is deliberate
  Given: `CorpusClient` today exposes exactly one write, `appendTurn`; `useMutation`, `QueryClient`
         and the raw client are deliberately not exported (Open Conflict 2)
  When:  UI-003's mutations land
  Then:  Every write the board performs is a named method on `CorpusClient` and a named hook
         exported from `packages/kit`; no file under `apps/ui/src` calls `fetch(`, constructs its
         own client, or imports `@corpus/contract/client`. The E2E log lists the added surface
         verbatim, because UI-004, UI-005 and every plugin inherit it

TEST-8: A drag writes `order` to disk and commits it
  Given: Columns in order Attention, Inbox, Open threads
  When:  The third column's header is dragged to the first position and dropped
  Then:  The board shows Open threads, Attention, Inbox; `cat` of the affected view documents shows
         changed `order` frontmatter; `git log -1` shows the auto-commit with `user` as author; and
         the untouched frontmatter keys of each edited document (`id`, `pinned`, `query`, `title`,
         `evergreen`) are **byte-identical** to before

TEST-9: The new order is corpus state, not browser state
  Given: TEST-8's drag has landed
  When:  The page is reloaded, and a second browser context is opened against the same server
  Then:  Both show the new order. Then inspect `localStorage`: the stored blob contains **no** query,
         no `order`, no column identity. This is the review-blocking correctness rule of SPEC.md §10

TEST-10: The reorder writes the minimum set of documents
  Given: Sparse `order` values (multiples of 10) across five columns
  When:  One column is moved one position
  Then:  The number of `PUT /api/docs/{id}` requests issued is stated, and is the minimum that
         realizes the target index — not a full renumber. A separately constructed gap-exhausted
         board (adjacent integers with no room) triggers one full renumber pass, and both counts are
         recorded

TEST-11: Keyboard move is the same code path, not a weaker one
  Given: The active column carries the `.kactive` cue
  When:  `⇧→` is pressed
  Then:  The column moves one position right, the same view documents change on disk as the
         equivalent drag, and the rendered order comes from the refetched-and-sorted column list
         rather than an imperative DOM insertion. At either end, `⇧←`/`⇧→` is a silent no-op that
         issues **zero** requests and writes **zero** files (verify with `git log` unchanged)

TEST-12: An interrupted drag persists nothing
  Given: A drag in progress with the `.dragging` treatment applied
  When:  The pointer is released outside the board, and separately `Esc` is pressed mid-drag
  Then:  The pre-drag order is restored on screen, no `PUT` is issued (network log quoted), and
         `git log -1` is unchanged from before the drag

TEST-13: A concurrent out-of-band reorder reconciles rather than ghosts
  Given: The board open in a browser
  When:  `order` is rewritten on a view document out of band (CLI or editor) while the user is
         interacting with the board
  Then:  The board converges on the reconciled order via SSE with no reload, and the user is never
         left looking at a position no document holds. Last write wins; state the observed order and
         the on-disk order and show they agree
```

#### The ghost column and the new-list picker

```
TEST-14: The ghost column is the prototype's, and it is the empty state
  Given: A workspace with zero pinned view documents
  When:  The board loads
  Then:  A single trailing `.ghost-col` renders — `220px`, dashed, `＋` plus the copy
         "New list — a folder, a view, or any filter" — and the board is never a blank screen

TEST-15: The picker offers real folders with real counts
  Given: A workspace with `finance/`, `home/` and `inbox/` under `data/docs/`
  When:  The ghost column is clicked
  Then:  A positioned menu opens at the click point, clamped to the viewport, listing those folders
         with document counts that match `GET /api/tree`'s response for the same workspace (compare
         the raw JSON). Presets and the plugin-column affordance are present; "from current search"
         is **absent** because no search query is active

TEST-16: A folder choice creates a real, committed view document
  Given: The picker open
  When:  `finance/` is chosen
  Then:  A new column appears and is scrolled into view; a new file exists on disk with
         `type: view`, `pinned: true`, a `folder: finance` query and `order` set to last; `git log -1`
         shows the auto-commit; and a reload (and a second browser) shows the same column

TEST-17: A preset choice and a plugin-column affordance behave consistently
  Given: The picker's preset library
  When:  A preset (e.g. "Attention", `needs=me`) is chosen
  Then:  One `POST /api/docs` creates a pinned view document carrying that query — the same call
         shape a folder choice makes. Plugin column types come from discovered manifests; until
         PLUGINS-001 ships the registry, the prototype's "plugin column types appear here too"
         affordance renders and the deferral is stated in the log as `DEFERRED → PLUGINS-001`

TEST-18: A view document referencing a missing plugin column keeps its place
  Given: A pinned view document with `column: "todos/board"` and no such plugin installed
  When:  The board loads
  Then:  A "plugin missing" card renders in that column's place (SPEC.md §12 M5) and the column is
         not dropped from the board
```

#### Creation semantics, the ⋯ menu, and local state

```
TEST-19: ＋ on a folder column creates into that folder
  Given: A `finance/` folder column
  When:  Its `＋` is pressed
  Then:  A file is created under `data/docs/finance/` on disk (not `inbox/`), it opens immediately in
         that column, and its title is focused **and selected** (verify the selection, not just the
         focus — SPEC.md §10 says "ready to type")

TEST-20: ＋ on every other column creates into inbox
  Given: The Attention column (a `needs=me` view, not folder-scoped)
  When:  Its `＋` is pressed
  Then:  The created file lands in `data/docs/inbox/`, per SPEC.md §10's inbox-first rule

TEST-21: The creation call is factored for UI-009 to share
  Given: SPEC.md §10 — the omnibox creates the same way
  Then:  The creation path is one named unit consumed by the `＋` handler, exported or importable by
         UI-009 without duplication, and the code says so. UI-009 re-implementing this is the
         failure this criterion prevents

TEST-22: Rename edits the view document
  Given: The column `⋯` menu
  When:  Rename is used
  Then:  The title changes on screen and in the view document's `title` frontmatter on disk, with an
         auto-commit; the column's `order`, `query` and `pinned` are unchanged byte-for-byte

TEST-23: Edit query changes both the rows and the stored query
  When:  `⋯` → Edit query changes a filter
  Then:  The rendered rows change to match, the chip row updates, and the view document's `query`
         frontmatter on disk holds the new filter set

TEST-24: Unpin archives, never deletes
  When:  `⋯` → Unpin is used
  Then:  The column disappears from the board, the view document **still exists on disk** with
         `status: archived`, and **no `DELETE /api/docs/{id}` was issued** (network log quoted).
         Deletion is user-only and is not what unpin means

TEST-25: Local state holds scroll and open readers, and nothing else
  Given: A namespaced, versioned `localStorage` key
  When:  A column's list is scrolled, a document is opened in it, and the page is reloaded
  Then:  Scroll position and the open reader are restored; the stored blob is quoted in full in the
         E2E log and contains only browser-local state

TEST-26: A corrupt or version-mismatched local blob degrades to defaults
  Given: The stored blob
  When:  It is replaced with garbage, and separately with a blob carrying an older version marker
  Then:  The board renders at defaults in both cases and throws nothing

TEST-27: localStorage being unavailable does not break the board
  Given: `apps/ui/src/testing/memoryStorage.ts`'s `throwingStorage()`
  When:  Every storage access throws (private-mode simulation)
  Then:  The board renders and remains interactive with in-memory state; nothing throws to the
         console
```

#### Chrome, scrolling, and the row seam

```
TEST-28: Column chrome matches the prototype
  Given: `design/index.html`'s `.col` / `.col-head` / `.col-title` / `.col-kind` / `.col-count` rules
  When:  Computed styles are read in a real browser, in BOTH light and dark themes
  Then:  Width `336px`, `--surface` background, `1px --line` border, `12px` radius, `--shadow-soft`;
         `.col-title` 14px/600; `.col-kind` mono, uppercase, `0.06em` tracking; `.col-count` mono
         and right-aligned; `＋` and `⋯` present and clickable; the `.sort` label pushed right of the
         chip row

TEST-29: The kind label is derived, not typed
  Given: A folder-scoped view, a filter view, and (if available) a plugin column
  Then:  Each renders the correct kind label, derived from the view document's own frontmatter. The
         prototype's own data uses lowercase `"view"` / `"folder"` / `"plugin"` and the uppercase
         comes from `text-transform` — matching the rendered text is what counts

TEST-30: The board is a horizontal snap scroller and the active column is cued
  Then:  `.board` has `scroll-snap-type: x proximity` and `.col` has `scroll-snap-align: start`;
         the active column carries `box-shadow: 0 0 0 2px var(--accent-wash), var(--shadow-soft)`
         and the cue follows focus and hover. `apps/ui/e2e/smoke.spec.ts`'s existing board
         assertions still pass unmodified

TEST-31: The header is the drag handle and its buttons still work
  Given: The prototype's mousedown/mouseup `draggable` toggling
  When:  `＋` and `⋯` inside the header are clicked
  Then:  Both fire their own handlers and neither starts a drag. Dragging the header (not a button)
         starts one, and the dragged column takes `opacity: 0.55` with a dashed border

TEST-32: The insertion point is computed by midpoint, as the prototype does
  When:  A column is dragged so the pointer sits just left, and then just right, of another column's
         horizontal midpoint
  Then:  The insertion lands before and after that column respectively, and never past the ghost
         column

TEST-33: Rows arrive through a contract UI-004 can satisfy
  Given: UI-004 replaces the placeholder with the kit's `Row`
  Then:  The list renders each result through a single `Row` seam taking the doc record plus column
         context, and UI-003's own markup for a row is a minimal placeholder and nothing more. The
         prop shape is written verbatim into the E2E log — it is UI-004's and PLUGINS-001's input

TEST-34: Folder columns include the threads that inherit the folder
  Given: SPEC.md §10 — "threads inherit their parent document's folder"
  When:  A document is created in `finance/` and a thread is created on it (thread files live in
         `data/threads/`), with a `finance/` folder column on the board
  Then:  Both the document row and the thread row appear in that column
```

#### Failure modes, live updates and the whole-loop check

```
TEST-35: A failing column query fails in place
  When:  One column's query is made to fail (an invalid filter value, or the server made to error
         for that query)
  Then:  That column renders an inline error card; every sibling column keeps fetching and
         rendering; no uncaught error reaches the console

TEST-36: The board is live over SSE, with no polling
  When:  A pinned view document is created, edited and archived out of band with the real CLI while
         the board is open
  Then:  The board adds, updates and removes the column each time **with no reload**. The parallel
         `curl -N /events` capture is quoted and every frame is `event: invalidate` carrying only
         contract key shapes — no document content crosses the stream (SPEC.md §2.2 rule 3)

TEST-37: A column whose view document vanishes mid-read closes gracefully
  Given: A column with a document open in its reader
  When:  Its view document is archived out of band
  Then:  The column disappears, the open reader is closed rather than orphaned, and the column's
         local-state entry is dropped

TEST-38: Long titles and many chips do not break the header
  Given: A view document with a very long title and six active filters
  Then:  The title truncates with an ellipsis, the chip row wraps, and the count, `＋` and `⋯` remain
         inside the card and clickable at `336px`
```

---

### UI-004: Type-aware rows — badges, reasons, staleness ramp

Ports `8910`–`8919`, primary `8915`. **34 criteria.** Unlike UI-003, this issue's data all exists
on the wire today. Its two risks are the opposite of missing data: **recomputing what the server
already computes** (Open Conflict 5) and **shipping a component that only UI-003's column can
render** (TEST-63). The quick actions are real committed mutations, and "Still current" is the one
whose correctness is invisible unless you read two frontmatter fields.

#### Where `Row` lives and what it may know

```
TEST-39: `Row` is kit surface, and the plugin seam exists
  Given: `packages/kit/src/index.ts` today exports no row anything, and PLUGINS-001 will replace
         `Row` per doc type via a registered `ListItem`
  When:  UI-004 lands
  Then:  `Row`, the badge primitives, and the row PROP TYPES are exported from `@corpus/kit`'s
         public entry; the built `dist/index.d.ts` is quoted verbatim in the log; and a
         `ListItem`-resolution seam exists so PLUGINS-001 is purely additive. A plugin cannot write
         a conforming `ListItem` without the exported types — that is why they are named here

TEST-40: A row knows nothing about any column
  Given: TEST-33's prop contract
  Then:  `Row` renders correctly when mounted standalone in a test with no column context beyond its
         props; grep of `packages/kit/src/row/**` finds no reference to a column, a board, a view
         document or `apps/ui`. All column-specific behaviour arrives as props

TEST-41: `Row` reaches the server only through kit hooks
  Then:  No file under `packages/kit/src/row/**` calls `fetch(` or imports `@corpus/contract/client`.
         Its mutations go through the same named client methods and hooks TEST-7 established
```

#### Anatomy and badges

```
TEST-42: Row anatomy matches the prototype
  Given: `design/index.html`'s `.row`, `.row-top`, `.type-glyph`, `.row-title`, `.row-badges`,
         `.row-excerpt`, `.row-meta` rules
  When:  Computed styles are read in a real browser in BOTH themes
  Then:  Mono bordered uppercase `.type-glyph` carrying the doc's `type`; serif `.row-title` at
         14.5px/600; right-aligned `.row-badges`; `.row-excerpt` clamped at exactly 2 lines
         (`-webkit-line-clamp: 2`); mono `.row-meta`; hover fills `--surface-2`

TEST-43: The row is a real control
  Then:  The row is `role="button"` with `tabindex="0"`, is reachable and activatable by keyboard,
         and has an accessible name that identifies the document

TEST-44: The unread badge is an accent pill with a count and a label
  Given: A thread whose `unread` is true
  Then:  `.unread` renders with the accent wash, a leading `6px` accent dot via `::before`, the count
         inside, and an accessible label — a coloured pill with no text is invisible to a screen
         reader

TEST-45: The needs-you badge uses the signal axis and short text
  Then:  `.needs-you` renders `--signal` on `--signal-wash` with short text (`form`, `3 due`) and an
         accessible label

TEST-46: The pending-agent dot is a real outstanding job, not a timer
  Given: `DocRow.awaitingAgent` — "the agent has been drawn into an open thread and the last turn is
         not yet its reply"
  When:  A row for such a thread renders, and then the agent's reply lands
  Then:  `.working-dot` pulses at `1.4s` while awaited, carries a `title` naming what is running, and
         **clears live over SSE** when the reply arrives. No `setInterval`-driven state, no fake
         progress (SPEC.md §8)

TEST-47: The pulse respects prefers-reduced-motion
  Given: `apps/ui/src/app/global.css:56-72`'s already-shipped guard
  When:  Playwright's `emulateMedia({ reducedMotion: "reduce" })` is applied
  Then:  The dot renders without animation, and UI-004 has **not** re-declared the guard

TEST-48: The lock chip is live, and it comes from the lock projection
  Given: `useLocks()` — no lock information rides a `DocRow`
  When:  A lock is acquired out of band on a visible document, then broken
  Then:  A `🔒 agent editing` chip with the `.chip.warn` treatment appears and then clears, both
         **with no reload**

TEST-49: Aggregate unread on a document row clears only when every thread is seen
  Given: SPEC.md §7 — "opening a parent document does not mark its collapsed-chip threads seen"
  When:  A document has two unread threads and one is marked seen (`POST /api/threads/:id/seen`)
  Then:  The document row still shows unread; after the second is seen it clears. Opening the
         document row itself never clears it as a side effect
```

#### The staleness ramp

```
TEST-50: Staleness comes from the server's tier, not from a second calculation
  Given: `DocRow.stale` is `"aging" | "stale" | "very-stale" | null`, already computed by
         SERVER-015, where **null is fresh**, `evergreen` documents are always null, and an unknown
         age is null rather than ancient (Open Conflict 5)
  When:  The ladder level is derived
  Then:  Levels 0–3 map from `stale` by a single pure function; the component does not recompute
         `max(updated, reviewed)` against day thresholds. If the implementer keeps a client-side
         computation anyway, the log states why and demonstrates the two agree on the full boundary
         table below — two sources of truth that can disagree about staleness is the failure this
         prevents

TEST-51: The boundary table holds against a real server
  Given: Documents seeded at roughly 10d, 45d, 120d and 300d old, plus one `evergreen: true` with a
         300d-old `updated`, plus one with no `updated` at all
  When:  `GET /api/docs` is called and the board rendered
  Then:  The four aged rows render at levels 0/1/2/3, the evergreen one at level 0, and the undated
         one at level 0. The raw JSON `stale` values are quoted beside the rendered classes

TEST-52: The decay ladder is the prototype's, exactly, in both themes
  Then:  Level 1 → `.row-title` opacity `0.92` and NO rail. Level 2 → rail via `::before` with
         `background: var(--sepia)` at `opacity: 0.45`, title opacity `0.82`, `.age` in
         `--sepia-ink`. Level 3 → row background `--sepia-wash`, border `--sepia-wash-2`,
         full-opacity sepia rail, title opacity `0.72`, `.age` in `--sepia-ink` at weight 600.
         Computed values are read in a real browser, light AND dark

TEST-53: The sepia axis is used for staleness and nothing else
  Given: `packages/kit/src/tokens.css`'s own comment — "the DEDICATED staleness axis (§5) — never
         reused for anything else"
  Then:  Grep of `packages/kit/src/row/**` shows `--sepia*` only in staleness rules, and staleness is
         never expressed with `--signal` or `--accent`

TEST-54: Stale and unread are legible together
  Given: A row that is both level 3 and unread
  Then:  Both treatments apply simultaneously and the accent unread pill remains legible on the
         level-3 sepia wash in BOTH themes — screenshot or computed contrast recorded for each

TEST-55: Only level 3 grows quick actions
  Then:  `.stale-actions` renders on level-3 rows and on no other level; an `evergreen` document
         gets no rail, no dimming and no quick actions whatever its age
```

#### The quick actions are real, committed mutations

```
TEST-56: Archive flips status and slides out
  When:  Archive is clicked on a level-3 row
  Then:  A `PUT /api/docs/{id}` sets `status: archived`; the row plays `.row.leaving`
         (`opacity: 0`, `translateX(24px)`, `0.3s`) and then leaves the list; `cat` shows
         `status: archived` on disk; `git log -1` shows the auto-commit; and the row is gone from
         default (non-archived) lists

TEST-57: "Still current" sets `reviewed` and does NOT touch `updated`
  Given: SPEC.md §5 — "'Still current' sets `reviewed: <now>` — a committed act distinct from
         editing" — and `UpdateDocRequestSchema`'s own note to the same effect
  When:  "Still current" is clicked
  Then:  The request body contains `reviewed` and **does not contain `updated` or `body`** (quote the
         request); on disk `reviewed` is the current instant and `updated` is **byte-identical** to
         its pre-click value; `git log -1` shows the auto-commit. Getting this wrong makes staleness
         lie, permanently and silently

TEST-58: "Still current" visibly resets the row through the server, not optimism
  When:  The mutation lands
  Then:  The row returns to level 0 with no reload, driven by the SSE invalidation and refetch. A
         local flag that resets the row without the server agreeing is a fail — reload and confirm
         it stayed at level 0

TEST-59: @agent triage creates a real, agent-requested thread
  When:  "@agent triage" is clicked on a stale row
  Then:  `POST /api/threads` creates a thread file in `data/threads/` with `parent` set to that
         document, `anchor: null` and the agent flag set; the thread's first turn asks the agent to
         review the document; and exactly one `evt_*.json` appears in `.corpus/queue/pending/`
         (count `evt_*.json` only, never `.gitkeep`)

TEST-60: A rejected mutation leaves the row alone and says so
  Given: A document held by an agent lock, or the server made to reject the write
  When:  A quick action is clicked
  Then:  The failure surfaces as a toast; the row is **still there**, at its previous level; nothing
         was optimistically removed; and reload confirms the on-disk state is unchanged

TEST-61: Double-clicking Archive fires exactly one mutation
  When:  Archive is double-clicked rapidly
  Then:  Exactly one `PUT` is issued (network log quoted) and exactly one commit is created

TEST-62: A quick action does not also open the document
  When:  Each of the three stale actions is clicked
  Then:  The row's own open handler does not fire. All three are real `<button>`s reachable by
         keyboard, and activating one by keyboard behaves identically

TEST-63: Archive still works with animations off
  When:  `emulateMedia({ reducedMotion: "reduce" })` is applied and Archive is clicked
  Then:  The row disappears with no slide, nothing throws, and no ghost node is left in the DOM.
         Separately: a row removed by an SSE invalidation **mid-animation** must not throw on unmount
```

#### Thread rows and the reason line

```
TEST-64: Anchored thread rows show the quote
  Given: `DocRow.anchorQuote` — null on non-threads, on whole-document threads and on standalone
         threads
  When:  An anchored thread row renders
  Then:  The anchor quote renders in serif italic; a whole-document thread and a standalone thread
         render none

TEST-65: The thread excerpt is the last turn, attributed
  Given: `DocRow.lastAuthor` and `DocRow.lastTurn`
  Then:  The excerpt reads `<author>: <text>`; a thread with no turns renders neither and does not
         print "null" or "undefined"

TEST-66: Thread context lines are honest about what they know
  Given: `DocRow.parent` is an ID, and the wire carries no parent TITLE (Open Conflict 6)
  Then:  Standalone threads show "standalone"; whole-document threads show whatever Open Conflict 6
         adjudicates, and the log states which option shipped. Rendering a raw `doc_*` id where the
         issue file promised a title is a fail; so is an N+1 `useDoc(parent)` per row

TEST-67: The reason line is data-driven from the server's own reasons
  Given: `DocRow.attention` carries `NEEDS_REASONS = ["unread-reply","form","due","stale",
         "failed-job"]` on EVERY row, not only under `needs=`
  When:  The Attention column renders
  Then:  Each row's chips correspond exactly to that row's `attention` array in the raw
         `GET /api/docs?needs=me` response (quote both and compare). The mapping is a lookup table
         from reason code to label and chip class — no string-sniffing of titles or bodies

TEST-68: The chip vocabulary matches the prototype, including its quirks
  Given: The prototype's six labels over three classes, in which "due today" uses `.r-form` and
         there is NO failed-job chip (Open Conflict 7)
  Then:  `unread-reply` → `.r-reply` accent wash; `form` → `.r-form` signal wash; `due` → `.r-form`
         per the prototype; `stale` → `.r-stale` sepia wash, with the label chosen from the row's
         `stale` tier ("getting stale" vs "review: archive or act"); `failed-job` → the adjudicated
         new chip. Every mapping is asserted in a unit test

TEST-69: An unknown reason code renders rather than disappears
  Given: SPEC.md §10 — plugins extend the system
  When:  A reason code the table does not know arrives
  Then:  A neutral chip renders carrying the raw code; the row's reason line is not dropped and the
         row is not dropped

TEST-70: Handling the reason clears the row live
  Given: SPEC.md §10 — "Handling the reason … clears the row live via SSE"
  When:  An unread thread in Attention is marked seen out of band
  Then:  The unread pill clears and the row leaves the Attention column, both with no reload
```

#### Rendering edge cases

```
TEST-71: The age label never lies and never says NaN
  Given: `reviewed` newer than `updated`; `reviewed` in the future; `updated` absent with `created`
         present; both absent
  Then:  Each renders a sensible humanized label from one shared formatter (the prototype's `3mo`,
         `stale · 8mo` shape); no negative age, no "NaN", no "Invalid Date". The undated case renders
         "—" per `DocRow`'s own description

TEST-72: Long content degrades in the right order
  Given: A row with a very long title, a very long anchor quote and four badges
  Then:  The title truncates BEFORE the badge cluster is squeezed; the excerpt stays at exactly two
         clamped lines; nothing overflows the `336px` column
```

---

### SERVER-016: Form answer write path (`form.respond` producer)

Ports `8920`–`8929`, primary `8925`. **24 criteria.** Everything this issue needs is already
exported from `@corpus/contract` and already implemented in `apps/server`'s turn-append pipeline.
**TEST-79, TEST-82 and TEST-91 are sprint-008's deferred TEST-56/57/59, folded in verbatim in
substance.** There is no CLI verb for this route; `curl` is the interface.

#### Mounting and the shapes the contract already pinned

```
TEST-73: The route exists and answers
  Given: `POST /api/threads/{id}/turns/{ts}/form` is in `ENDPOINT_INVENTORY` and currently returns
         404 on a running server ("no route matches POST …")
  When:  A real server on 8925 receives a well-formed answer
  Then:  It answers `201` with a body validating against `FormAnswerResponse`
         (`{thread, turn, eventId, warnings}`)

TEST-74: Every declared status is reachable and no undeclared one is returned
  Given: The route declares exactly `201 / 400 / 401 / 404`
  When:  Each is provoked — a valid answer; a malformed/invalid answer; a request with no token; an
         unknown thread id, and separately a `ts` naming no turn in a real thread
  Then:  Each returns its declared status with the declared error shape. **No response ever carries a
         status the route does not declare** — in particular not `403`, `409` or `423`

TEST-75: No lock guard is added
  Given: `apps/server/src/threads/turns.ts:11-13` — sprint-006 Adjudication 1: "Commenting is not
         editing … `appendTurn` declares no `423`"
  When:  A form is answered while the parent document is locked by the agent
  Then:  The answer succeeds. A `423` here would be an undeclared status AND a reversal of a closed
         adjudication

TEST-76: The acting party comes from the header, never the body
  Given: The route declares the optional `x-corpus-author` header and `FormAnswerRequest` is
         `{option, note}` only
  Then:  A body carrying `author`/`actor`/`from` does not change the git author; the header does. The
         resulting commit's author is verified with `git log --format='%an <%ae>' -1`
```

#### Validation against the fence it answers

```
TEST-77: The answer is validated against the actual form, not against a static enum
  Given: `validateFormAnswer(form, answer)` is exported from `@corpus/contract` and is imported by
         NOTHING in `apps/server` today
  When:  A thread's last agent turn carries a form with options [A, B] and an answer names "C"
  Then:  `400` with a non-empty `issues` array whose path is `body.option` and whose message names
         the offered options. An answer naming "A" is accepted. The handler CALLS the contract's
         validator rather than reimplementing membership

TEST-78: The fence grammar is the contract's, not a third definition
  Given: `FORM_FENCE_PATTERN` / `extractFormSource` / `containsFormFence` / `FormSchema` are exported
         from `@corpus/contract`, and `apps/server/src/docs/needs.ts`'s `opensFormFence()` is a
         SQL analogue of the same grammar (Open Conflict 11)
  When:  The handler locates the form in the turn at `ts`
  Then:  It uses the contract's parser. A turn whose fence is ```` ```formula ```` or
         ```` ```form-builder ```` is NOT a form and the answer is refused; a turn with no fence at
         all is refused; a fence whose YAML fails `FormSchema` is refused. Each refusal's status is
         one of the four declared, and each is exercised over real HTTP

TEST-79: An answer appends a real turn  [sprint-008 TEST-56]
  Given: SPEC.md §6 — "submitting appends a structured answer turn (chosen option + optional note)"
  When:  An answer is submitted against the real server on 8925
  Then:  A new turn exists in the thread's markdown on disk with the `## user · <ISO ts>` heading
         format §6 requires (the separator is U+00B7, as `renderTurn` writes it); its body renders
         the chosen option and any note as readable markdown; and the file is auto-committed with
         `user` as git author

TEST-80: The answer turn is a turn like any other
  Given: `nextTurnTs` guarantees strictly-increasing turn timestamps within a thread, and
         `appendThreadTurn` runs inside `mutex.run(id, …)`
  Then:  `GET /api/threads/{id}` returns the answer as the last turn, its `ts` is strictly greater
         than the answered form turn's `ts`, and re-reading the file parses back to the same turn
         list. Two answers posted concurrently to one thread produce two turns with distinct,
         ordered timestamps and neither is lost

TEST-81: The commit subject follows the shipped convention
  Given: The turn path writes `comment: turn on <id> by <actor>`
  Then:  The form answer's auto-commit subject is a deliberate, documented sibling of that pattern
         (naming the act and the thread and the actor), quoted in the log, and it is the same on
         every answer
```

#### The enqueue and the §8 rule

```
TEST-82: An answer enqueues exactly one `form.respond` event  [sprint-008 TEST-57]
  Given: `FORM_RESPOND_EVENT_TYPE = "form.respond"` and `CORE_QUEUE_EVENT_TYPES` already contains it
  When:  The answer lands on an open, engaged thread
  Then:  Exactly one `evt_*.json` appears in `.corpus/queue/pending/` (counting `evt_*.json` only,
         never `.gitkeep`) with `type: "form.respond"`, and **no `comment.created` is enqueued
         alongside it**

TEST-83: The payload matches the pinned shape exactly
  Given: `FormRespondPayloadSchema = {threadId, formTs, option, note}` where `note` is
         **nullable and required**, not optional
  Then:  The enqueued payload parses cleanly under `FormRespondPayloadSchema`; `formTs` is the
         timestamp of the turn CARRYING the form (not the answer turn); `option` is the chosen
         option **verbatim**; and an answer given with no note carries `"note": null` — a payload
         that OMITS `note` is a fail, and the raw JSON file is quoted to prove which shipped

TEST-84: `eventId` in the response names the event that was actually enqueued
  When:  An answer re-triggers the agent
  Then:  The `201` body's `eventId` equals the `id` inside the enqueued `evt_*.json`

TEST-85: A resolved thread appends the answer and enqueues nothing
  Given: SPEC.md §8 — a later turn re-triggers "unless the user marks the thread `resolved`" — and
         `FormAnswerResponse.eventId`'s own description: "Null when the answer does not re-trigger
         it — a resolved thread stops re-triggering the agent even while it is engaged"
  When:  A form in a thread with `status: resolved` and `agent: engaged` is answered
  Then:  `201`; the answer turn IS on disk and committed; `eventId` is `null`; and
         `.corpus/queue/pending/` gains **zero** `evt_*.json` files

TEST-86: The §8 decision is the shipped predicate, not a second copy
  Given: `apps/server/src/threads/participation.ts`'s `shouldEnqueue`
  Then:  The form path reaches its enqueue decision through that predicate. A parallel `if
         (status === "resolved")` written inside the form handler is a second source of truth for
         §8 and is a fail; if the predicate genuinely cannot be reused, the log says why in one
         sentence and the divergence is covered by its own test

TEST-87: A thread the agent is not engaged in is handled deliberately
  Given: `shouldEnqueue`'s auto path requires `thread.agent === "engaged"`
  When:  A form is answered in a thread whose `agent` is `requested` or `none`
  Then:  The behaviour is stated and tested — whichever way it is decided, `eventId` and the queue
         state agree with each other and with the response body. An untested corner here is how a
         form nobody answers becomes a form nobody hears about

TEST-88: A second answer to the same form is handled deliberately
  When:  The same form turn is answered twice
  Then:  The behaviour is stated and tested (a second answer turn plus a second event, or a
         rejection with one of the four declared statuses). Silent divergence between the file and
         the queue is a fail
```

#### Warnings, projection, and Attention

```
TEST-89: §11 warnings ride the response
  Given: `FormAnswerResponse` carries `warnings`, and `warningsFor()` produces `commit_failed` when
         the auto-commit is rejected
  When:  An answer is submitted in a workspace whose `pre-commit` hook exits 1
  Then:  `201` with a **non-empty** `warnings` array carrying `commit_failed` and the hook's detail;
         the answer turn **still stands on disk** (SPEC.md §11 — "The server never rolls back a file
         write because a commit failed"); and the commit count is unchanged

TEST-90: The write re-projects synchronously — read-your-write
  Given: `runMutation` projects before responding
  When:  `GET /api/threads/{id}` is issued IMMEDIATELY after the `201`, with no delay and no refetch
         loop
  Then:  The answer turn is present. A test that sleeps to make this pass is not this criterion

TEST-91: An answered form leaves Attention; an unanswered one is in it  [sprint-008 TEST-59]
  Given: `needs.ts`'s detector requires `t.status = 'open' AND t.last_author = 'agent' AND
         tu.ts = t.last_ts` plus the fence
  When:  `GET /api/docs?needs=form` and `?needs=me` are queried before and after an answer
  Then:  The thread is present before and absent after, in both queries, with the raw JSON quoted
         both times. If the detector needed no change for this to hold, say so — it is discharged by
         construction, and knowing that is worth a sentence

TEST-92: The SSE frames name the right keys and carry no content
  When:  An answer lands with a `curl -N /events?token=…` client attached
  Then:  `invalidate` frames name the contract's key shapes for the changed thread and the docs
         collection; the captured stream contains zero occurrences of the option text, the note
         text, or the form's prompt (SPEC.md §2.2 rule 3)

TEST-93: The unit suite covers the paths HTTP cannot cheaply reach
  Given: The shipped fixture pattern — `createWriteWorkspace` on a real git repo in a `mkdtemp`
         directory with `port: 0`
  Then:  New tests cover: valid answer, option not offered, no fence, wrong fence info string, YAML
         failing `FormSchema`, `ts` naming no turn, `ts` naming a non-agent turn, resolved thread,
         note present and absent. No test hardcodes a port

TEST-94: How to exercise this by hand is written down
  Given: `corpus thread` has only `reply`, `resolve` and `reopen` — no verb reaches this route
  Then:  The E2E log records the exact `curl` invocations used, including how the form turn was
         created in the first place, so the next agent (UI-008) can reproduce the fixture without
         rediscovering it

TEST-95: The `form.respond` event survives the queue's own lifecycle
  When:  The enqueued event is claimed and completed through the real queue verbs
  Then:  It moves `pending → in-progress → processed` on disk like any other event, and
         `GET /api/queue/status` counts it correctly at each step

TEST-96: Nothing else on the thread surface regressed
  When:  The full `apps/server` suite runs
  Then:  Green, with the count stated. In particular `POST /api/threads/{id}/turns`,
         `/resolve`, `/reopen`, `/seen` and the deletion cascade behave exactly as before — the form
         path reuses their pipeline and must not have altered it
```

---

### SERVER-024: Provision the bearer token to the served UI

Ports `8930`–`8939`, primary `8935`. **16 criteria.** The AC that matters is "**zero manual steps**",
and the AC that will be skipped unless it is made a criterion is the **written security rationale**.
This issue spans `apps/server` and `apps/ui`; see Open Conflicts 8 and 9.

```
TEST-97: The production-served UI reaches authenticated data with zero manual steps
  Given: A fresh `corpus init` workspace on 8935 and `npm run build -w apps/ui` (nothing builds
         `apps/ui/dist` automatically)
  When:  `corpus server start` runs and the printed board URL is opened in a real browser, with NO
         environment variable set, NO file edited and NO token pasted anywhere
  Then:  At least one authenticated API call succeeds — the network log shows a `200` on
         `GET /api/docs` (not merely `GET /api/health`, the one route that needs no token) — and the
         console strip does not read "server unreachable". This is the whole issue; a mechanism that
         works only with a manual step is a fail

TEST-98: The SSE stream authenticates too
  When:  The same page is loaded
  Then:  `/events` connects (not 401), `useConnectionState()` reaches its connected state, and an
         out-of-band CLI mutation repaints the page with no reload. `EventSource` cannot set
         headers, so this is a distinct code path from TEST-97 and fails separately

TEST-99: The dev flow is unchanged
  Given: `apps/ui/src/app/apiClient.ts` reads `import.meta.env.VITE_CORPUS_TOKEN`, and
         `apps/ui/README.md` documents the `jq`-based export
  When:  `npm run dev -w apps/ui` runs on `CORPUS_UI_PORT=5273` with `VITE_CORPUS_TOKEN` exported
         against a server on 8935
  Then:  It works exactly as it did before this issue, by the same documented command. The E2E log
         quotes the command and the result

TEST-100: The two paths compose without ambiguity
  Given: Both a server-provided token and `VITE_CORPUS_TOKEN` may be present
  Then:  The precedence is decided, documented in the module, and tested in both orders. An
         ambiguous fallback that silently picks the wrong one in dev is the bug this prevents

TEST-101: No token still degrades quietly
  Given: `apps/ui/e2e/smoke.spec.ts` asserts `expect(uncaught).toEqual([])` in three tests, and
         asserts the console strip reads exactly "server unreachable" with nothing on 8765
  When:  The UI runs with no token obtainable by any path
  Then:  The console strip reports the state honestly, the SSE bridge backs off, and **no uncaught
         error or unhandled rejection** reaches the page. `npm run e2e` still passes 13/13

TEST-102: The security rationale is written where the mechanism lives
  Given: The issue's own AC — "the mechanism's security rationale documented in the module (why it
         does not widen Decision 5's model)"
  Then:  The module carries prose that names: who can obtain the token through this path, what an
         unauthorized local process would have to do to get it, why that is not weaker than reading
         `.corpus/config.json` (mode `0600`) directly, and what would make it weaker. A comment
         saying "safe because localhost" is not this criterion

TEST-103: The token is not handed out on an unauthenticated route to an unauthenticated caller
  Given: `mountStaticUi` is mounted at `app.use("*", …)` and the auth middleware covers only
         `/api/*`, `/attachments`, `/attachments/*` and `/events` — so `GET /` is unauthenticated
         BY CONSTRUCTION
  When:  Whatever surface carries the token is requested with no credentials
  Then:  Either it is guarded, or the log demonstrates why an unguarded response is acceptable
         under Decision 5 and TEST-104/105 hold. This is the criterion the whole issue turns on

TEST-104: A non-loopback request cannot obtain the token
  Given: `apps/server/src/middleware/localhost.ts`'s `localhostOnly`, which reads the SOCKET remote
         address and deliberately ignores `X-Forwarded-For`
  When:  The token-carrying surface is requested with a spoofed `X-Forwarded-For: 127.0.0.1` from a
         non-loopback peer (or the equivalent test double)
  Then:  It is refused with `403`. Header-trusting loopback detection is the defect this prevents

TEST-105: A cross-origin browser request cannot obtain the token
  Given: `noBrowserOrigin`, which rejects on the PRESENCE of an `Origin` header, whatever its value
  When:  The token-carrying surface is requested with `Origin: https://evil.example` and separately
         with `Origin: http://127.0.0.1:8935`
  Then:  Both are refused. A same-origin allowance here would let any page on any port in the
         browser read the workspace token

TEST-106: The `.corpus/config.json` token never appears anywhere it should not
  When:  The full server log, the served HTML, and every response body from the sprint's E2E run are
         searched
  Then:  The token appears only where the adjudicated mechanism puts it. `.corpus/config.json` is
         still mode `600` afterwards, and the token is redacted to a short prefix in the E2E log

TEST-107: The change does not add a contract route without a contract issue
  Given: §9.3 and sprint-008's binding — "Nobody but the contract agent touches packages/contract";
         `ENDPOINT_INVENTORY` has 41 entries, pinned by name, and adding one moves `openapi.json`,
         `ALL_CONTRACT_ROUTES.length` and possibly `toHaveLength(12)`
  Then:  Either `git diff packages/contract` is EMPTY at this issue's commit, or the route was filed
         as a CONTRACT issue and landed there first. Quote the diff either way (Open Conflict 8)

TEST-108: The missing-build path is unchanged
  Given: `resolveUiDistDir` prefers `CORPUS_UI_DIST`, then `apps/ui/dist`, then `<packageRoot>/ui`;
         with none, every non-API route 503s with "UI build not found — run `npm run build -w apps/ui`"
  When:  The server starts with no `apps/ui/dist`
  Then:  The same 503 and the same message. The mechanism must not turn a clear missing-build error
         into a 500, an empty page, or a page that renders and then 401s

TEST-109: Serving is still correct for every other asset
  Given: `mountStaticUi`'s reserved prefixes `["/api", "/attachments", "/events"]`, its
         immutable-vs-revalidate `Cache-Control` split, and its SPA fallback
  When:  A hashed asset, an unknown deep route, and each reserved prefix are requested
  Then:  Behaviour is byte-identical to before this issue except for the adjudicated change. In
         particular a token must not end up in an immutably-cached response

TEST-110: `apps/ui`'s consuming half stays inside the kit's rules
  Given: sprint-008's TEST-4 rule — no file under `apps/ui/src` outside the provider wiring calls
         `fetch(` or imports `@corpus/contract/client`
  Then:  The resolution lives in ONE named module in `apps/ui/src/app/`, the kit still takes the
         token as pure configuration and reads no file, no env and no global, and the rule still
         holds under grep

TEST-111: The unit suite covers both halves
  Then:  Server-side tests cover the injection/serving path (following `static-ui.test.ts`'s
         `app.request(...)` pattern, no port) and the loopback and origin refusals; `apps/ui` tests
         cover token resolution with the server-provided value present, absent, and present
         alongside `VITE_CORPUS_TOKEN`. Every shipped `apps/ui` and `apps/server` test still passes,
         or each modification is listed with a reason

TEST-112: The E2E is the real installed shape, not a simulation
  Then:  The log records: `npm run build -w apps/ui`, `corpus init --port 8935`, `corpus server
         start`, the printed URL, the browser (or `curl` of the served page plus the authenticated
         call), and the raw request/response pair proving TEST-97. A unit test asserting a template
         string is explicitly not sufficient
```

---

### SERVER-025: Emit an invalidate when the boot projection completes

Ports `8940`–`8949`, primary `8945`. **12 criteria.** This is a **reproduction-first** issue whose
reproduction is very likely to fail, for a reason the agent should know before it starts (Open
Conflict 10). A well-evidenced "no code change, and here is the ordering that makes the race
impossible, pinned by a regression test" is a **full PASS**.

```
TEST-113: The reported race is reproduced, or its non-reproduction is proven
  Given: UI-002's E2E log — "the stream re-opened and the kit's `refetchQueries` fired BEFORE the
         restarted server had finished projecting the file written while it was down" — and the
         UI-002 evaluator's 3/3 non-reproduction with a corrected fixture
  When:  The sequence is run at least five times against a real server on 8945: server up, server
         stopped, a WELL-FORMED document written on disk (`id`, `type`, `title`, `created`,
         `updated`, `status`, `tags`, `anchors` — the UI-002 evaluator's own failure was a fixture
         missing these), server restarted, a client reconnecting as fast as it can
  Then:  Either the row is missing on at least one run — quote it, that is the reproduction — or it
         is present on all runs, which is stated plainly with the run count. **A fabricated
         reproduction is a fail; so is skipping the attempt**

TEST-114: The ordering that governs the race is stated as fact
  Given: `lifecycle.ts` runs `openWorkspaceProjection` (whose boot scan `populateFromFiles` is
         fully synchronous, wrapped in one `db.transaction`) at :134, `createServer` at :135, and
         `await server.start()` — the HTTP bind — at :150
  Then:  The log states whether a client can connect before the boot projection completes, with the
         evidence. If it cannot, the reported race as described is impossible and the issue's first
         AC is answered by that sentence

TEST-115: A regression test pins the ordering, whatever the verdict
  Then:  A test asserts that the boot projection has completed by the time the server accepts its
         first request — so that a future refactor which moves projection off the boot path, or
         makes it asynchronous, fails here rather than in a user's browser three phases later

TEST-116: The narrower window is examined and reported
  Given: chokidar is constructed with `ignoreInitial: true`, so its initial scan emits NO events;
         `WatcherHandle.ready` exists, is documented as "Resolves once the initial scan is done and
         events are live", and is read by NOTHING in `apps/server/src`; and `attachWatcher` runs at
         `lifecycle.ts:137`, AFTER the boot scan
  When:  A file is written into `data/docs/` in the window between the boot projection finishing and
         the watcher becoming ready
  Then:  The log states whether that file is projected, whether any invalidate names it, and how
         long the window is in practice. If such a file is silently lost until an unrelated change
         touches it, that is a real defect and is either fixed here or filed with a number — it is
         a strictly better find than the one the issue was opened for

TEST-117: If a boot-completion broadcast ships, it uses the existing coarse-key constant
  Given: `REBUILD_QUERY_KEYS = [DOCS_KEY, TREE_KEY, QUEUE_KEY, JOBS_KEY, LOCKS_KEY]` already exists
         in `apps/server/src/projection/routes.ts` and is used by `POST /api/db/rebuild`
  Then:  The boot broadcast reuses it rather than writing a second list. Two lists of "the coarse
         keys" is the drift this prevents

TEST-118: If it ships, it is exactly one frame
  When:  The server boots with a `curl -N /events?token=…` client attached as early as possible
  Then:  At most ONE `invalidate` frame attributable to boot completion is observed, carrying the
         five coarse keys, deduped, and the captured stream is quoted. A per-file storm at boot
         would make every restart a thundering refetch

TEST-119: If it ships, it carries no content
  Then:  The captured frame contains only `keys`; no document title, body, path or id appears
         anywhere in the boot frames (SPEC.md §2.2 rule 3)

TEST-120: The no-subscribers case is decided in writing
  Given: The issue's third AC, and the fact that `createSseHub` ALREADY returns early when
         `subscribers.size === 0`
  Then:  The log states that the shipped hub decides this, and whether the boot broadcast relies on
         that early return or guards separately. The deliverable here is one accurate sentence, not
         code

TEST-121: A boot broadcast, if any, is idempotent with the rebuild path
  Given: `populateFromFiles` is the SAME function `POST /api/db/rebuild` calls
  When:  `POST /api/db/rebuild` runs on a booted server
  Then:  It still emits its own single coarse invalidate and does not double-broadcast, and the boot
         path does not fire a second time. Sprint-008 blessed rebuild's coarseness; do not disturb it

TEST-122: Boot is not measurably slowed
  When:  Server start-to-first-successful-request is timed before and after, five runs each, on a
         workspace with a non-trivial number of documents
  Then:  Both numbers are recorded and the difference is stated. A broadcast that waits on anything
         is the wrong shape

TEST-123: The unit suite covers whichever branch shipped
  Given: The shipped patterns — `server.bus.subscribe((keys) => batches.push([...keys]))` for
         bus-level assertions, `fakeConnection()` in `sse.test.ts` for hub-level, and
         `queue-mirror.test.ts`'s existing double-`boot()` fixture ("rebuilds from the directories
         at boot, including files moved while it was down") as the nearest precedent
  Then:  New tests follow them, use `port: 0`, and cover the branch that shipped — including the
         no-subscribers case

TEST-124: The verdict is recorded where the next reader will find it
  Then:  The conclusion — reproduced or not, fixed or blessed, and the ordering fact from TEST-114 —
         is written into the issue file AND into `.claude/agents/server-dev.md`'s Domain Knowledge,
         so this is not re-litigated by the next agent who reads UI-002's log
```

---

## Cross-Issue Tests

Port `8955`, one `corpus init` workspace, zero stubs, real browser, real server, real CLI.
**14 criteria.** These exist because the board is the first surface where all five issues are
simultaneously visible, and because three of the five change something another one depends on.

```
TEST-125: The board renders real rows against a real server, once, end to end
  Given: A real workspace on 8955 with the three seed view documents, a real server, Vite on 5273,
         and the board open in a real browser
  When:  A document is created with the real CLI, aged (its `updated` backdated), commented on,
         replied to as the agent, marked "Still current", and archived from the row
  Then:  Every step repaints with NO reload; the frames on a parallel `curl -N /events` are quoted;
         and the on-disk state after each step is shown to match the screen

TEST-126: A column and a row agree about the same document
  When:  A stale document sits in a folder column
  Then:  The column's count, the row's age chip, the row's ladder level and the raw
         `GET /api/docs` JSON for that query all describe the same document consistently. A row
         computing staleness one way while the column filters it another is the incoherence this
         catches

TEST-127: The Attention column is reason-complete
  Given: A workspace seeded so that all five `NEEDS_REASONS` are represented — an unread agent
         reply, an unanswered form (created via SERVER-016's path), a due-today document, a stale
         document, and a failed job
  Then:  The Attention column shows five rows, each carrying the chip its `attention` array names,
         compared against the raw `GET /api/docs?needs=me` response

TEST-128: Answering a form clears its Attention row live
  Given: SERVER-016 landed
  When:  The form's thread is answered over HTTP while the board is open
  Then:  The "awaiting your answer" row leaves the Attention column with NO reload, and one
         `form.respond` event is in `.corpus/queue/pending/`. This is the first time SERVER-016 and
         the board are proven to close the loop together

TEST-129: The production-served board works, not just the dev-served one
  Given: SERVER-024 landed and `npm run build -w apps/ui` has run
  When:  The board is opened at the URL `corpus server start` prints — no Vite, no env var
  Then:  Columns render with real data, rows render with real badges, and `/events` is connected.
         This is the composed proof of TEST-97/98 and it is what an installed user gets

TEST-130: A restart does not lose the board
  Given: SERVER-025's verdict, whatever it was
  When:  The server is stopped with the board open, a document is created on disk, and the server is
         restarted
  Then:  The board converges on the correct contents. The number of reconnect refetch bursts is
         stated, and the run count is stated — a single lucky pass is not evidence here

TEST-131: No document content ever crosses the SSE stream
  When:  The whole captured `/events` stream from TEST-125 is grepped
  Then:  Zero matches for any document title, turn body, anchor quote, form prompt, option text, job
         log line or attachment filename. Every frame is `event: invalidate` with `keys` only

TEST-132: The generated artifacts are green at the tip
  When:  `node --import tsx scripts/check-generated-artifacts.ts` runs on the phase branch tip
  Then:  Green TWICE IN A ROW for `openapi.json`, `schema.generated.ts` and `docs/cli.md`

TEST-133: The whole repo gate is green at the tip
  When:  `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck` and `npm test`
         run on the phase branch tip
  Then:  All pass. The test-file and test counts are stated and compared to today's 214 files

TEST-134: The merged coverage gate holds with the board in it
  Given: This sprint adds a substantial `apps/ui/src/board/**` and `packages/kit/src/row/**`
  When:  `npm run coverage` runs on the phase branch tip
  Then:  All four metrics at or above 90, per-workspace numbers recorded, and
         `coverage/merged/e2e-attribution.json` inspected to say whether the new e2e specs
         contributed anything or whether the units already covered the same lines

TEST-135: e2e is green at the tip, with the reserved ports respected
  When:  `CORPUS_UI_PORT=5273 npm run e2e` runs with nothing bound on 8765
  Then:  All specs pass — 13 shipped plus whatever `board.spec.ts` and `rows.spec.ts` add — and the
         "server unreachable" assertion still holds, which is only true if 8765 is free. Confirm
         with `lsof` and say so. `reuseExistingServer: false` means a stray dev server on 5273 fails
         this loudly; if it did, say that too

TEST-136: The kit surface UI-005 and PLUGINS-001 are promised is written down
  Given: UI-005, UI-009 and PLUGINS-001 all depend on UI-003 or UI-004
  Then:  The E2E logs carry, verbatim: the added `CorpusClient` methods and mutation hooks (TEST-7),
         the `Row` prop contract (TEST-33), and the reason-code mapping table (TEST-68), so the next
         issues consume a written contract rather than reading `dist/index.d.ts`

TEST-137: Every Open Conflict was adjudicated BEFORE implementation, and written back
  Then:  Each conflict below has a recorded decision, and the decision is written into the issue
         file it affects — not only into this contract and not only into a chat message. Conflicts
         1 and 2 additionally produce filed issues with numbers

TEST-138: Nothing was left running and the repo is clean
  When:  The sprint closes
  Then:  No process bound in `8900`–`8999`, nothing on `8765`, nothing on `5273`, no orphaned Vite
         or Playwright children, and `git status` shows only intended files in each worktree and in
         the Corpus repository. Each issue's E2E log states which model the implementing agent ran
         on ("implemented on: opus | fable")
```

---

## Out of Scope

- **The reader.** UI-005 owns opening a document in a column, the per-column navigation stack, focus
  mode, the ⋯ document menu and the lock banner. UI-003 opens a newly created document far enough to
  select its title (TEST-19) and no further; whatever minimal surface that needs is scaffolding
  UI-005 replaces, and the log says which files are scaffolding.
- **The editor.** UI-006 (TipTap, autosave, markdown shortcuts). Nothing in this sprint edits a
  document body except the create-with-title-selected path.
- **Anchored threads in the reader.** UI-007. UI-004 renders a thread ROW's anchor quote; it does not
  render highlights, chips or margin cards.
- **The thread view, composer, attachments and form CONTROLS.** UI-008. SERVER-016 ships the write
  path; **no form UI is built in this sprint.**
- **The search overlay, omnibox create and save-as-view.** UI-009. UI-003's picker shows "from
  current search" only when a search query exists, which it never will in this sprint — that entry
  is `DEFERRED → UI-009` with the affordance rendered inert.
- **The global Ask/Capture composer and the full keyboard scheme.** UI-010. This sprint implements
  only `⇧←`/`⇧→` (column move) and the active-column cue; `⌘K`, `c`, `j`/`k`, `↵`, `f`, `e`, `r` and
  `?` are UI-009/UI-010's.
- **The console drawer's master-detail and live logs.** UI-011. The collapsed strip UI-001 shipped
  stays as it is; UI-003 may add a minimal toast surface for UI-011 to take over, and only one of the
  two UI issues may create it.
- **The plugin registry.** PLUGINS-001. UI-003 renders the "plugin column types appear here too"
  affordance and the "plugin missing" card; it does not build discovery. UI-004 exposes the
  `ListItem` seam; it does not build the lookup.
- **Populating `Job.originTitle`.** Already shipped by SERVER-023 — do not re-do it.
- **Changing the query-key vocabulary.** Nine contract shapes plus the kit's `["health"]` and
  `["x", …]`. Closed. A board that needs a tenth is a design error, not a contract change.
- **Anchor engine behaviour.** SERVER-002/012/013/014's five closed adjudications and the amended §6
  are not re-opened by anything in this batch.
- **Lock semantics.** SERVER-016 explicitly does NOT add a lock guard (TEST-75). UI-004 renders the
  lock chip from `useLocks()` and does not change lock behaviour.
- **`corpus doc check`, `corpus skill rollback`, and any new CLI verb.** CONTRACT-008 / SERVER-019 /
  CLI-006 are Phase 4. SERVER-016 does **not** add a `corpus thread form` verb; if UI-008 later wants
  one, that is UI-008's or a CLI issue's call.
- **Rewriting the e2e suite to drive a real server** as a mandate. Open Conflict 12 recommends it for
  UI-003 and explains the payoff; it is a recommendation, not a requirement, and if declined the
  reason is recorded.
- **Packaging.** INFRA-008.

---

## Integration Points

**The view-document surface produces → UI-003 consumes, and without it UI-003 does not exist.**
Open Conflict 1's adjudicated issues must land before UI-003's agent starts. The shape they owe,
written as the contract:

```
Read side (needed by UI-003 TEST-1..5, 8, 22..24):
  A pinned view document's `pinned`, `order`, `query` and `column` must be readable from a
  COLLECTION response — one request for the whole column set, not one per column (TEST-2).

Write side (needed by UI-003 TEST-8, 10, 11, 16, 17, 23):
  `POST /api/docs` must be able to create a document carrying `pinned`, `order`, `query` and
  optionally `column`; `PUT /api/docs/{id}` must be able to set `order` and `query` WITHOUT
  disturbing any other frontmatter key (TEST-8 asserts byte-identity of the untouched keys).

Selection side (needed by UI-003 TEST-1, 3):
  Either a `pinned` filter on `GET /api/docs`, or a documented client-side narrowing of
  `type=view` that TEST-2's request-count criterion still permits.

Invariant: the workspace file format does NOT change. `assets/workspace/data/docs/views/*.md`
already carry exactly these keys, and `core/frontmatter.ts` already passes plugin keys through.
This is a wire gap, not a model gap — resist any design that changes the seed files.
```

**`packages/kit` produces → UI-003 and UI-004 both consume, and only one of them may write it.**
The kit has one write method today. The added surface (TEST-7) is:

```
Needed by UI-003:  create a document (POST /api/docs), update a document (PUT /api/docs/{id})
Needed by UI-004:  update a document (PUT /api/docs/{id}) — for `status: archived` and `reviewed`
                   create a thread (POST /api/threads) — for @agent triage
Shared:            both land as named CorpusClient methods + named hooks exported from
                   packages/kit/src/index.ts, following useAppendTurn's shape (optimistic where the
                   transition is visual only; authoritative state via SSE invalidation).
Owner:             UI-003, as the first to land. UI-004 consumes and adds only POST /api/threads if
                   UI-003 did not need it. See Open Conflict 2 for the alternative.
```

**UI-003 produces → UI-004 consumes.** `apps/ui/src/board/ColumnList.tsx` and the `Row` prop
contract (TEST-33). UI-004's declared file list edits `ColumnList.tsx` directly; that file does not
exist until UI-003 creates it. **This is a hard prerequisite, not just a shared file.**

**SERVER-024 produces → UI-003 consumes.** UI-003's TEST-97-equivalent path — a production-served
board reaching real data — is SERVER-024's mechanism. UI-003's own E2E may run against Vite with
`VITE_CORPUS_TOKEN`, but TEST-129 (composed) requires SERVER-024. **UI-003's agent starts after
SERVER-024 lands** (Open Conflict 4).

**SERVER-024 spans `apps/server` AND `apps/ui`.** The consuming half is
`apps/ui/src/app/apiClient.ts`'s `configuredToken()`. UI-003 does not otherwise touch that file, but
the orchestrator must confirm it before running the two in parallel. See Open Conflict 8.

**CONTRACT-007 produced → SERVER-016 consumes, entirely.** `FORM_FENCE_PATTERN`,
`extractFormSource`, `containsFormFence`, `FormSchema`, `validateFormAnswer`,
`FormRespondPayloadSchema`, `FORM_RESPOND_EVENT_TYPE` and `FormAnswerResponseSchema` are all
exported from `@corpus/contract` and imported by **nothing** in `apps/server` today. SERVER-016
imports rather than reimplements (TEST-77, TEST-78, TEST-83).

**SERVER-016 produces → UI-008 consumes** (next sprint). The E2E log's `curl` recipe (TEST-94) is
the handoff artifact, because there is no CLI verb to point UI-008 at.

**`apps/server/src/docs/needs.ts` holds the second definition of the fence grammar.** SERVER-016
must not add a third. If the two are found to disagree on any input, that is a filed finding, not a
silent third parser (Open Conflict 11).

**SERVER-016, SERVER-024 and SERVER-025 are file-disjoint.** SERVER-016 works in `threads/`,
SERVER-024 in `static-ui.ts` / `middleware/` / `app.ts` (plus `apps/ui/src/app/`), SERVER-025 in
`lifecycle.ts` / `projection/` / `watcher/` / `events/`. `app.ts` is the only plausible brush point
(SERVER-024 mounts; SERVER-025 does not). All three can run in parallel worktrees.

**Nobody but the contract agent touches `packages/contract`** (§9.3, restated from sprint-008). Open
Conflicts 1, 6 and 8 all describe changes that must be filed as CONTRACT issues rather than
improvised by a UI or SERVER agent.

---

## Merge order (recommendation)

1. **Adjudicate Open Conflicts 1, 2, 3, 4, 5, 6 and 8 first.** Conflicts 1 and 2 block UI-003's
   first line of code and produce filed issues; 3 and 4 decide how the two UI agents are launched;
   5 and 6 shrink UI-004 before it starts; 8 decides whether SERVER-024 is one agent or two. None is
   discoverable cheaply mid-implementation.
2. **SERVER-016, SERVER-024 and SERVER-025 in parallel, in worktrees**, immediately. They are
   file-disjoint, none depends on the others, and SERVER-024 is on UI-003's critical path.
   SERVER-025 may finish in an hour with no code change; per Open Conflict 10, that is a success.
3. **The view-document contract rider (Open Conflict 1) in parallel from the start**, as a filed
   CONTRACT issue followed immediately by its SERVER consumer — the phase branch must not sit red,
   and UI-003 cannot start until both land.
4. **UI-003 next, alone at first.** It owns the creation of `apps/ui/src/board/`, the kit's mutation
   surface (TEST-7), and — if it is the one to do it — the toast surface. It starts **after
   SERVER-024** and after the Conflict-1 rider.
5. **UI-004 in a worktree, starting as soon as UI-003's `ColumnList.tsx` and kit mutation surface
   exist.** Most of UI-004 (`packages/kit/src/row/**`, the staleness ladder, badges, reasons) is
   genuinely independent and can be built against a stub; only the `ColumnList.tsx` wiring and the
   `packages/kit/src/index.ts` export line collide. Rebase that one line rather than serializing.
6. **Only one of UI-003 / UI-004 holds `5273` and `8765` at a time.** `reuseExistingServer: false`
   makes a collision loud rather than silent, but it still costs a run.
7. **Cross-issue tests (TEST-125…138) after everything**, on 8955.

The batch splits into four workspaces — `apps/server` (×3 disjoint files), `packages/contract` +
its server consumer, `apps/ui` + `packages/kit` (×2, lightly overlapping), and the shared
`apps/ui` e2e resource. The genuinely serialized edges are: Conflict-1 rider → UI-003, SERVER-024 →
UI-003, and UI-003 → UI-004's wiring.

---

## Open Conflicts — orchestrator decision required before implementation

### 1. UI-003's view-document contract does not exist on the wire (**P0, blocks the issue entirely**)

SPEC.md §10: *"A column IS a `type: view` document with `pinned: true`; its frontmatter holds the
query (filters, search text, sort) and `order` (board position)."* The workspace agrees —
`assets/workspace/data/docs/views/attention.md` ships `pinned: true`, `order: 1`, `query: {needs: me}`
— and `apps/server/src/core/frontmatter.ts` is documented as *"the pre-defaults form plus passthrough
for plugin keys"*, so the file layer already round-trips these keys.

The HTTP contract does not:

- `DocsQuerySchema` has **no `pinned` parameter**. `DOC_SORTS` is
  `["updated","-updated","created","-created","due","title","relevance"]` — **no `order`**.
- `docRowBaseShape` is `{id, type, title, path, status, tags, created, updated, due, reviewed,
  evergreen, excerpt}` and `DocRowSchema` adds `stale`, the thread fields, `attention` and
  `snippets`. **No `pinned`, `order`, `query` or `column`.** `DocFrontmatterSchema` is the same
  closed set.
- `CreateDocRequestSchema` is `{type, title, body, folder, tags, status, due, evergreen}` and
  `UpdateDocRequestSchema` is `{title, body, tags, status, due, reviewed, evergreen}`. **Neither can
  set `pinned`, `order`, `query` or `column`.**

So UI-003 cannot query the column set (TEST-1), sort it (TEST-3), render its chips (TEST-4), persist
a reorder (TEST-8/10/11), create a column (TEST-16/17), or edit a query (TEST-23). That is
essentially the whole issue. The three workarounds available to an agent that discovers this
mid-implementation are all bad: hardcode the columns (forbidden by TEST-1 and by the issue's first
AC), issue `GET /api/docs/{id}` per column to read the frontmatter the list omits (an N+1 that
TEST-2 fails, and it still cannot WRITE `order`), or edit `packages/contract` from a UI issue
(forbidden by §9.3).

**Recommendation: file two issues and land them before UI-003 starts.**

1. **A CONTRACT issue** exposing plugin/extra frontmatter on the document surface. SPEC.md §5
   already says *"plugins may add fields under their own keys"* and §10 already says a plugin column
   is `column: "<plugin>/<type>"` in a view document's frontmatter — so this is not a new concept
   being invented for the board, it is the concept §5/§10 already promised, finally reaching the
   wire. Preferred shape: a single namespaced `extra`/`fields` object on `DocRow` and
   `DocFrontmatter`, settable on create and update, rather than nine new top-level keys — it serves
   `todo`'s `items` (SPEC.md §12) and every future plugin type by the same mechanism, and it keeps
   `DocRow` from growing a column per plugin. Add a `pinned` filter (or an equivalent narrowing that
   satisfies TEST-2) and decide whether `order` becomes a sort key or the client sorts a bounded
   set. **The `warnings` and actor invariants, the closed error union, and the nine key shapes are
   untouched by any of this.**
2. **A SERVER issue** consuming it: project the extra keys, return them on the collection query,
   and accept them on create/update **without disturbing untouched YAML** — commit `73bb3e7`
   ("Fix mutation reformatting untouched YAML lines") is the precedent and TEST-8's byte-identity
   assertion is the check.

**Do not** solve this by teaching UI-003 to write view documents through some other path — the
server is the sole writer (Architecture Decision 2), and a board that edits `data/docs/views/*.md`
any other way breaks the auto-commit audit trail that makes column layout agent-stewardable in the
first place, which is the entire justification for columns being documents.

### 2. The kit has exactly one write method, and both UI issues need more

`CorpusClient`'s only mutating method is `appendTurn(threadId, input)`. `useAppendTurn` is the only
mutation hook. `useMutation`, `QueryClient`, the raw `CorpusApi` and `@corpus/contract/client`'s
transport are all **deliberately** not re-exported — sprint-008's TEST-2 pinned that surface and
sprint-008's TEST-4 forbids `apps/ui` from reaching around it.

UI-003 needs `POST /api/docs` and `PUT /api/docs/{id}`. UI-004 needs `PUT /api/docs/{id}` and
`POST /api/threads`. Neither can reach them. Both issues' declared file lists touch
`packages/kit/src/index.ts`.

**Recommendation: UI-003 owns the addition; UI-004 consumes it and adds only what UI-003 did not
need.** UI-003 lands first regardless (Conflict 3), it needs both doc mutations, and having two
agents independently design a mutation-hook convention for the same package is how the kit ends up
with two conventions. Follow `useAppendTurn`'s shape: optimistic only for the visual transition,
authoritative state via SSE invalidation, errors surfaced rather than swallowed. **The added surface
is quoted verbatim in UI-003's E2E log (TEST-7)** because UI-005, UI-009 and every plugin inherit
it. If the orchestrator prefers to decouple, the alternative is a tiny orchestrator-owned prelude
commit adding the four client methods and their hooks before either agent starts — cleaner, at the
cost of one more sequencing edge.

### 3. UI-003 and UI-004 overlap on four existing files, and one hard prerequisite

Measured, not assumed:

- **`apps/ui/src/board/ColumnList.tsx`** — declared by both. UI-003 creates it; UI-004 edits it to
  render `Row`. **This is a prerequisite, not a collision: the file does not exist until UI-003
  makes it.**
- **`packages/kit/src/index.ts`** — UI-004 declares it (to export `row/**`); UI-003 must edit it too
  (Conflict 2). One export line each; a trivial rebase.
- **`apps/ui/src/app/global.css`** — undeclared by both, but its `prefers-reduced-motion` block
  already names `.working-dot`, `.row.flash` (UI-004) and `.col`, `.row.leaving` (both), with a
  comment saying the guard is declared once here so no future animated element ships without it.
  **Neither issue may re-declare it**, and neither should need to edit it.
- **`apps/ui/src/shell/Shell.tsx`** — undeclared by both. The UI-001 placeholder lives at
  `apps/ui/src/shell/Board.tsx` and `Shell.tsx` imports it as `./Board`. UI-003's file list assumes
  `apps/ui/src/board/`, which does not exist. Moving `shell/Board.tsx` → `board/Board.tsx` (and
  updating the import, `Board.css` and `Board.test.tsx`) is the honest option; leaving a re-export
  behind is the low-risk one.

Also shared but not edited: `apps/ui/e2e/coverage.ts` (every spec imports `test`/`expect` from it,
never from `@playwright/test`), `apps/ui/e2e/tokens.ts`, and `playwright.config.ts`.

**Recommendation: run both in worktrees, sequence UI-004's WIRING behind UI-003, and let its bulk
run in parallel.** `packages/kit/src/row/**` — the staleness ladder, the badges, the reason map, the
thread-row derivations, and every unit test for them — is 20-odd of UI-004's 34 criteria and needs
nothing from UI-003. Build it against a stub, then rebase the `ColumnList.tsx` wiring and the one
`index.ts` export line onto UI-003's landing. Serializing the whole issue to avoid two one-line
rebases is the wrong trade. **Explicitly assign the `shell/Board.tsx` decision and the toast surface
to UI-003**, so UI-004 never touches either.

### 4. UI-003 starts after SERVER-024, and the reason is narrower than it looks

UI-003 is blocked on SERVER-024 in `issues/PLAN.md`, and SERVER-024's issue file says so
("Blocks: UI-003 — the board must fetch real data when served by the production server").

The dependency is real but **narrow**: UI-003's own development and E2E can run against
`npm run dev -w apps/ui` with `VITE_CORPUS_TOKEN` exported, which is exactly what UI-002 did and
what `apps/ui/README.md` documents. What genuinely needs SERVER-024 is the **installed shape** —
the board reached at the URL `corpus server start` prints, with no env var — which is TEST-129, a
cross-issue criterion, not a UI-003 criterion.

**Recommendation: honour the sequencing as stated — SERVER-024 lands first — because it costs
nothing.** SERVER-024 is a 16-criterion issue with no dependencies of its own; it can start
immediately, in parallel with the Conflict-1 rider that UI-003 is *also* waiting on. UI-003 is
blocked on the rider regardless, and the rider is the longer pole. So the sequencing imposes **zero
additional delay**, and taking it removes the one scenario worth avoiding: UI-003 declaring done
against a dev server, and the installed board turning out to 401 everywhere a week later, in a phase
PR, with nobody owning it. If the orchestrator nonetheless wants UI-003 started early, the condition
is that **TEST-129 is not marked PASS by UI-003's agent** and the issue does not close until
SERVER-024 has landed and TEST-129 has been run.

### 5. UI-004 would compute staleness the server already computed

UI-004's AC says *"Staleness is computed from `max(updated, reviewed)` against 30 / 90 / 180-day
thresholds (thresholds injected, not hard-coded) producing levels 0–3."* But `DocRow.stale` already
arrives as `"aging" | "stale" | "very-stale" | null`, computed by SERVER-015, and the contract's own
description carries three subtleties a client reimplementation will get wrong:

- **`null` is fresh**, and *"the tiers name degrees of staleness and freshness is their absence,
  which is also why `stale=` takes a tier and never `fresh`"*;
- **`evergreen: true` is always null**;
- **an unknown age (both `updated` and `reviewed` null) is null** — *"an unknown age is not an old
  one"* — which is a real case, because a hand-written `SKILL.md` legitimately carries no timestamps
  and `DocRow.created`/`updated` are nullable for exactly that reason.

A client that computes `now - max(updated, reviewed)` will render an undated skill document as
maximally stale, complete with archive-or-act buttons, while the server's `stale=` filter says it is
fresh. The column and the row would then disagree about the same document — which is TEST-126.

**Recommendation: consume `row.stale`; do not recompute.** Keep a pure `stalenessLevel()` in
`packages/kit/src/row/` as the tier → level 0–3 mapping plus the humanized age LABEL (which the
server does not provide and which genuinely belongs in the kit), and keep the thresholds out of the
component entirely — they are the server's, and a workspace retuning them retunes one place. This
shrinks UI-004's `staleness.ts` from a threshold engine to a lookup and a formatter, and it makes
TEST-51's boundary table a check of the server's arithmetic rather than a second implementation of
it. If the implementer disagrees, TEST-50 requires demonstrating the two agree across the full
boundary table including the evergreen and undated cases.

### 6. UI-004 needs a parent document's title; the wire carries only its id

UI-004's AC: *"whole-document threads show their parent's title."* `DocRow.parent` is a
`DocumentId`, and its description says the null case distinguishes standalone from non-thread — it
carries no title. There is no `parentTitle`.

The precedent is directly on point: CONTRACT-007 added `Job.originTitle` for exactly this problem,
with its rule written into the schema description — *"the current title of whatever `originId`
names, or null"* — and SERVER-023 populated it in the same commit.

**Recommendation: mirror `Job.originTitle` — file `DocRow.parentTitle` as part of Conflict 1's
CONTRACT issue**, with the same one-sentence rule and the same nullability, and populate it in the
same SERVER consumer. It is one join in the collection query, it is the same shape the codebase
already blessed once, and it costs one field on a rider that is being cut anyway. **The fallback —
`useDoc(parent)` per thread row — is an N+1 on the busiest surface in the product and TEST-66 fails
it.** The interim, if the rider cannot absorb it, is to render the row without a parent title (never
a raw `doc_*` id) and mark TEST-66 `DEFERRED → <the filed issue>`.

### 7. Five server reason codes, six prototype labels, and no failed-job chip

`NEEDS_REASONS` is `["unread-reply", "form", "due", "stale", "failed-job"]`. The prototype's
Attention column shows six labels across three chip classes: `.r-reply` — "agent replied", "agent
asked back"; `.r-form` — "awaiting your answer", **"due today"**; `.r-stale` — "review: archive or
act", "getting stale". Two frictions: **"due today" uses `.r-form`, not a class of its own**, and
**there is no failed-job chip in the prototype at all** — while UI-004's AC lists "failed job" as
required.

**Recommendation: one table, code → {label, chipClass}, with `stale` reading the row's tier.**
`unread-reply` → `.r-reply`; `form` → `.r-form`; `due` → `.r-form` (follow the prototype rather than
inventing a fourth class for one label); `stale` → `.r-stale`, label chosen from `row.stale`
(`aging`/`stale` → "getting stale"; `very-stale` → "review: archive or act") — which is also the
cleanest use of the tier information UI-004 is now consuming rather than recomputing (Conflict 5);
`failed-job` → a new chip. For the new one, **do not reach for `--signal` or `--accent`**: signal is
the needs-you axis and accent is the agent/unread axis. A neutral `.r-chip` with no modifier, or a
purpose-named class using existing tokens, keeps the three-axis discipline UI-001 established.
Whatever ships, TEST-68 asserts every mapping and TEST-69 asserts an unknown code still renders.

### 8. SERVER-024 is filed as a server issue but cannot be one

`apps/ui/src/app/apiClient.ts`'s `configuredToken()` reads
`import.meta.env.VITE_CORPUS_TOKEN` — a **build-time** substitution baked into the bundle by Vite.
A server cannot inject into that after the fact. So whatever SERVER-024 chooses, `apps/ui` changes:
the client must learn to prefer a runtime-provided value.

The two candidate mechanisms differ sharply in blast radius:

- **Inject into the served `index.html`.** `serveAppShell` already does
  `readFileSync(indexPath, "utf8")` **per request** and returns the string — there is a natural
  seam, and it needs **no contract change at all**. Cost: `apps/ui` must read a global, and the
  token now rides an HTML response (Conflict 9).
- **A loopback-only `GET /api/config`.** Mirrors the job-log ingest hardening exactly. But it is a
  **new contract route**, which moves `ENDPOINT_INVENTORY` (41 entries, pinned by name),
  `openapi.json`, `ALL_CONTRACT_ROUTES.length` and the operation-count test — and **a SERVER agent
  may not touch `packages/contract`** (§9.3, restated in sprint-008's Integration Points). It also
  needs a second round trip before the first authenticated request.

**Recommendation: the injection mechanism, with the `apps/ui` half explicitly in SERVER-024's
scope.** It needs no contract change, no new endpoint, no extra round trip, and it delivers the
token on the same origin the SPA was served from — which is precisely the *"same-origin delivery"*
SPEC.md §2.1 already describes for the installed tool. Widen SERVER-024's scope in the issue file to
name `apps/ui/src/app/apiClient.ts`, and confirm no other in-flight agent holds that file (UI-003
should not). If the orchestrator prefers the endpoint, it becomes a CONTRACT issue plus a SERVER
issue and TEST-107 is how it is checked.

### 9. Injecting a token into an unauthenticated response is the security question, and it has a standard to meet

`mountStaticUi` is mounted at `app.use("*", …)` and the bearer middleware covers only `/api/*`,
`/attachments`, `/attachments/*` and `/events`. **`GET /` is unauthenticated by construction.** If
the token is injected into `index.html` naively, then any process on the machine that can reach the
port — including a page in the user's browser on any other origin, via a plain `fetch` or an image
or a form post whose response it can read — obtains the workspace bearer token.

This is exactly the threat the job-log ingest endpoint was hardened against, and the shipped answer
is two middlewares in `apps/server/src/middleware/localhost.ts`: `localhostOnly`, which reads the
**socket remote address** and deliberately ignores `X-Forwarded-For`, and `noBrowserOrigin`, which
rejects on the **presence** of an `Origin` header at all, whatever its value. The `Origin` check is
the one that matters here, because a cross-origin `fetch` from a web page always sends one and a
navigation from the address bar does not.

**Recommendation: mirror both middlewares onto whatever surface carries the token, and make the
rationale meet a stated bar.** The rationale (TEST-102) must name: who can obtain the token through
this path; what an unauthorized process would have to do; why that is not weaker than reading
`.corpus/config.json` directly (mode `0600`, owner-only); and what change would make it weaker.
"Safe because localhost" is not that. Two further specifics: **the token must never land in an
immutably-cached response** (`mountStaticUi` splits `Cache-Control` between immutable assets and
revalidated shells — the shell is the right side of that split, and TEST-109 checks it), and **the
missing-build 503 must stay exactly as it is** (TEST-108) so a missing `apps/ui/dist` does not
become a page that renders and then 401s everywhere.

### 10. SERVER-025's race is probably not reproducible, and the issue should say so rather than invent one

`apps/server/src/lifecycle.ts` runs `openWorkspaceProjection` at :134 — whose boot scan
`populateFromFiles` is **fully synchronous**, wrapped in a single `db.transaction` — then
`createServer` at :135, then `await server.start()` (the HTTP bind) at :150. **A client cannot
connect before the boot projection has finished, because there is nothing listening.** Independently,
the UI-002 evaluator ran the sequence three more times with a well-formed fixture, got the row every
time, and **retracted its own recorded failure** as a fixture error (its hand-written "offline" file
omitted `id`, `created`, `updated` and `status`, so nothing could ever have projected it).

The half of the premise that IS true: `populateFromFiles` touches the invalidation bus nowhere, and
chokidar runs with `ignoreInitial: true` so its initial scan broadcasts nothing.

There is also a narrower window that nobody has looked at: **between the boot projection finishing
and the watcher becoming ready**, a file written into `data/docs/` is neither projected (populate
already ran) nor announced (chokidar treats it as part of the initial scan and, with
`ignoreInitial: true`, says nothing). `WatcherHandle.ready` exists and is documented — and is read by
**nothing** in `apps/server/src`. If that window loses files until an unrelated change touches them,
it is a strictly more interesting bug than the one filed, and a coarse invalidate would not fix it
(the row is not in the projection to be refetched).

**Recommendation: keep the issue reproduction-first, and pre-authorize the honest outcomes.** Run
the sequence at least five times with a WELL-FORMED document (TEST-113). If it does not reproduce,
the deliverables are: the ordering stated as fact (TEST-114), a regression test that pins it so a
future refactor moving projection off the boot path fails here rather than in a browser (TEST-115),
and an examination of the narrower window (TEST-116) — fixed if cheap, filed with a number if not.
**A "no code change" close is a full PASS**; do not let an evaluator read it as an incomplete issue.
If a broadcast does ship, it reuses `REBUILD_QUERY_KEYS` (TEST-117) and fires at most once
(TEST-118). And note the third AC is already answered by the shipped hub: `createSseHub` returns
early when `subscribers.size === 0`, so the deliverable there is one accurate sentence (TEST-120).

### 11. The form fence grammar now has two definitions, and SERVER-016 could easily make three

`packages/contract/src/schemas/form.ts` owns the grammar:
`FORM_FENCE_PATTERN = /(?:^|\r?\n)```form[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*(?=\r?\n|$)/`, plus
`extractFormSource`, `containsFormFence`, `FormSchema` and `validateFormAnswer` — all exported from
`@corpus/contract` and imported by **nothing outside the contract's own tests**.

`apps/server/src/docs/needs.ts` owns a second: `opensFormFence()`, an `instr`-based SQL analogue
matching `\n```form\n` / `\n```form\r`, deliberately case-sensitive (SQLite `LIKE` is
ASCII-case-insensitive), carrying the `t.status = 'open'` guard SERVER-022 added. It is a reasonable
analogue — SQL cannot run the regex — but it is a second statement of the same rule.

**Recommendation: SERVER-016 imports the contract's parser and adds no third definition.** The
handler locates and parses the fence with `extractFormSource`/`FormSchema` and validates the answer
with `validateFormAnswer` (TEST-77, TEST-78). Additionally, **cross-check the two definitions on the
inputs that matter** — ```` ```formula ````, ```` ```form-builder ````, a fence with trailing
whitespace, CRLF line endings, a form that is not the last turn — and if they disagree on any of
them, that is a filed finding against `needs.ts`, not something SERVER-016 patches around. Recording
the pairing in `.claude/agents/server-dev.md`'s Domain Knowledge is what stops a third parser
appearing in UI-008.

### 12. A server-backed e2e spec would finally pay off the merged coverage gate (**recommendation, not a requirement**)

INFRA-004 shipped the merged unit + browser coverage gate and, per the sprint-008 evaluation, it
*"currently adds +0 (browser-reachable files already 100% unit-covered; the payoff waits on the
server-backed e2e)"*. Its TEST-151 was explicitly permitted to defer AC 2 — the `NODE_V8_COVERAGE`
seam for spawned processes — because *"the e2e suite spawns NO `corpus` server and NO CLI"*, and the
sprint-008 contract recorded that a server-backed spec *"is a UI issue's deliverable and should be
filed as one."*

UI-003 is the first UI issue that genuinely cannot be verified without a real server: its columns
come from real seed view documents, and its reorder criterion (TEST-8) asserts on frontmatter and
`git log`. The seam already exists: `apps/ui/e2e/coverage.ts` exports **`nodeCoverageEnv()`**,
demonstrated on nothing. Spawning a real `corpus server` from `apps/ui/e2e/board.spec.ts` with that
env would exercise it on a real spawn and discharge INFRA-004's deferred half.

**Recommendation: encourage it, do not mandate it.** If UI-003's agent can spawn a real server from
its Playwright spec without fighting the port reservations, it should — and it should say in its log
that TEST-151's seam was exercised, so INFRA-004's deferral can be closed. **Two hard constraints if
it does**: (a) the spawned server must take a port from UI-003's own `8900`–`8909` band and
**never 8765**, because `smoke.spec.ts` asserts the console strip reads exactly "server unreachable"
and that assertion requires 8765 unbound — a server-backed spec that binds 8765 turns three
unrelated tests red in a way that reads like a UI regression; and (b) `reuseExistingServer: false`
means the whole suite is a single-holder resource, so this must not run concurrently with UI-004's
e2e. If it turns into a fight, **drop it** — UI-003's E2E evidence via a manually started server is
fully acceptable, and this stays filed for whoever wants it.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above has a verdict** in the evaluator's report — PASS, or
  `STRUCK → Open Conflict N` / `DEFERRED → <issue>` with the reason and substitute evidence
  recorded. Silent omission is a fail.
- **Every Open Conflict was adjudicated before implementation started**, and each adjudication is
  written back into the issue file it affects (TEST-137) — not only into this contract. Conflicts 1
  and 2 additionally produce filed issues with numbers in `issues/PLAN.md`.
- **The view-document contract exists on the wire** and UI-003's columns are corpus state, not code:
  TEST-1 (nothing hardwired), TEST-8 (`order` on disk and committed) and TEST-9 (a second browser
  agrees) all PASS. Without these three the board is a mockup.
- **UI-004's "Still current" writes `reviewed` and leaves `updated` alone** (TEST-57), verified on
  disk. This is the one criterion whose failure is invisible and permanent.
- **SERVER-016's route answers 201 on a real server**, appends a real committed turn, enqueues
  exactly one correctly-shaped `form.respond`, and enqueues **nothing** in a resolved thread
  (TEST-79, TEST-82, TEST-83, TEST-85) — sprint-008's three deferred criteria, discharged.
- **The production-served board reaches authenticated data with zero manual steps** (TEST-97,
  TEST-98, TEST-129) and its security rationale meets TEST-102's bar.
- **SERVER-025 has a recorded verdict either way**, with the ordering fact and the regression test
  (TEST-113, TEST-114, TEST-115) and the narrower window examined (TEST-116).
- **Each issue's E2E Verification Log is filled with concrete evidence** — actual commands, actual
  output, actual file/git/sqlite/SSE/browser state — and states which model the implementing agent
  ran on (TEST-138).
- **The logs carry the three artifacts the next issues depend on** (TEST-136): the kit's added
  mutation surface, the `Row` prop contract, and the reason-code mapping table.
- `npm run build` succeeds in dependency order; `/lint` passes (ESLint, Prettier, `tsc --noEmit`
  across all workspaces); `/test` passes with no regressions against the 214-file baseline.
- **The merged coverage gate is green at 90 % on all four metrics** (TEST-134), with
  `coverage/merged/e2e-attribution.json` inspected rather than assumed.
- `CORPUS_UI_PORT=5273 npm run e2e` passes with **nothing bound on 8765** (TEST-135).
- `node --import tsx scripts/check-generated-artifacts.ts` is green **twice in a row** — all three
  artifacts (`openapi.json`, `schema.generated.ts`, `docs/cli.md`).
- **`/audit` has been run on UI-003** (P0, cross-domain — it writes corpus state and PLUGINS-001
  consumes its column contract), **on UI-004** (P0, kit surface consumed by plugins), and on
  **SERVER-024** (security-sensitive — it moves a bearer token onto a new surface).
- **Any user-observable behavior change carries its SPEC.md amendment**, drafted by spec-writer and
  held for user sign-off at the phase PR — SHARED-002's adopted process rule. In this batch the
  candidate is Conflict 1's extra-frontmatter surface if the adjudication changes what §5's
  "plugins may add fields under their own keys" means in practice.
- **pr-reviewer verdict APPROVE** on the phase PR, with CRITICAL and MAJOR findings fixed or
  explicitly waived by the user.
- **No stray processes**: nothing bound in `8900`–`8999`, `8765` free, `5273` free, no orphaned Vite
  or Playwright children, and `git status` clean in every worktree and in the Corpus repository
  (TEST-138).
