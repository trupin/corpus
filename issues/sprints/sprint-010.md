# Sprint 010 — Phase 3, the reading surface: reader, search, console, and the unread aggregate

**Issues**: UI-005, UI-009, UI-011, CONTRACT-012, SERVER-027
**Domains**: ui, contract, server
**Date**: 2026-07-28
**Plan phase**: Phase 3 — UI
**Branch**: `phase-3-ui` (currently at `4650a6b`, clean; agents work in worktrees cut from it)

---

## What makes this sprint different

**Three UI issues share one shell, one keyboard and one kit index file.** Sprint-009's two UI issues
overlapped on four files and it was manageable. This batch is worse: UI-005 mounts a reader inside
`Column.tsx`, UI-009 mounts an overlay above everything, UI-011 changes the shell's flex layout —
and **all three add methods to `CorpusClient` and lines to `packages/kit/src/index.ts`**. The
serialized edges are named in Merge order; the rest is genuinely parallel.

**Almost nothing is blocked on a missing contract, and that is the difference from sprint-009.**
Every route these three issues need is not only declared but **mounted and answering**: `GET/PUT/
DELETE /api/docs/{id}`, `POST /api/docs/{id}/archive|unarchive|move`, `POST /api/threads/{id}/
resolve|reopen|seen`, `GET /api/locks` + `POST /api/locks/{docId}/break`, `GET /api/jobs`,
`GET /api/jobs/{id}/log?cursor=`, `POST /api/jobs/{id}/retry|abandon`, `GET /api/queue/status`,
`POST /api/queue/halt|resume`, `GET /api/tree`, and `references=` / `q=` / `pinned=` on the
collection query. Verified by reading the `app.openapi(contractRoutes.…)` mounts, not the inventory
— sprint-008's form route was in `ENDPOINT_INVENTORY` and 404'd for a whole sprint. **These do not.**

**Three of the four issue files describe mechanisms the shipped contract deliberately replaced.**
UI-011's Technical Design says the log pane "appends lines arriving over SSE"; SPEC.md §2.2 rule 3,
§7, §10 and §12 M5 all say the opposite, `JobSchema`'s own docblock says the opposite, and
`jobs/service.ts` says *"The append deliberately broadcasts **nothing**"*. UI-009's criteria demand
`<mark>`-allowlist sanitization of server snippet HTML; `SnippetSchema` ships structured
`{text, match}` segments precisely *"so the UI renders highlights without `dangerouslySetInnerHTML`
and without an escaping contract between server and client"*. UI-011 resolves `↗ open` from
`payload.threadId ?? payload.parentId ?? payload.docId`; `Job` has no `payload` and carries
`originId` + `originTitle` instead. In all three the shipped code made the better decision and the
issue file is stale — Open Conflicts 1, 4 and 2 write the corrections back.

**UI-005 is the sprint's keystone and it replaces a file that was filed as scaffolding.**
`apps/ui/src/board/ColumnReaderScaffold.tsx` says so in its own docblock: *"**Scaffolding — UI-005
replaces this file.** … Everything a reader actually is — the body, the navigation stack, focus
mode, the ⋯ document menu, the lock banner, anchored threads — is UI-005's and is deliberately
absent rather than half-built."* UI-006, UI-007 and UI-008 all hang off what UI-005 lands, and
UI-009's `↵` and UI-011's `↗ open` both need a reader to open into.

**CONTRACT-012 + SERVER-027 is fourteen lines of work discharging a written deferral.** UI-004's log
records it verbatim: *"`DocRow.unread` is `null` on non-threads and carries **no count** even for
threads, so a document row has no wire data for 'all of its threads have been seen' (SPEC.md §7).
Deriving it client-side needs one `?parent=<id>&type=thread&unread=true` per row — the N+1 TEST-66
forbids by name."* The seam already exists (`Row`'s `unreadCount` prop, the pill reading `new`), the
SQL already exists (`UNREAD_SQL`), and the index already exists (`threads_parent_id`). It lands as
**one commit**, contract first, per the CONTRACT-011/SERVER-026 precedent: a required `DocRow` field
breaks `apps/server`'s typecheck until it is populated, so a branch tip between the two halves is red.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue                        | The real application in this sprint                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UI-005**                   | A **real `corpus init` workspace on `8962`** hand-seeded with documents that reference each other with `[[refs]]`, at least one anchored thread, one standalone thread and one unresolved ref; a **real server**; a **real browser**. Every menu action is verified on disk **and** in `git log`. A DOM assertion alone is not verification. |
| **UI-009**                   | A **real workspace on `8967`** with enough documents and turns that FTS returns both groups. Every search claim is verified against the **network panel** (request count) and the **raw `GET /api/docs` JSON** for the same parameters. Save-as-view is verified by `cat`-ing the created view document.                          |
| **CONTRACT-012 + SERVER-027** | `packages/contract` regeneration + a **real server on `8972`** against a workspace with a document carrying several threads at mixed seen state, plus a **seeded 500-document workspace** for the query-plan timing SERVER-027's AC demands. `EXPLAIN QUERY PLAN` output is quoted, not summarized.                             |
| **UI-011**                   | A **real workspace on `8977`**, a **real server**, real jobs driven by `corpus job log` / `corpus queue fail` / `corpus job retry` from a terminal, and a real browser. `.corpus/HALT` is checked on disk. "The log updated" is only true if the terminal wrote it and the browser showed it without a reload.                     |

### Port allocation

This sprint takes `8960`–`8984`. Verified free at contract time (`lsof -nP -iTCP -sTCP:LISTEN`
showed nothing bound in `8900`–`8999`; nothing from sprint-009 is still running).

| Consumer                                    | Range         | Primary                              |
| ------------------------------------------- | ------------- | ------------------------------------ |
| UI-005                                      | `8960`–`8964` | `8962` (UI: `CORPUS_UI_PORT=5273`)   |
| UI-009                                      | `8965`–`8969` | `8967` (UI: `CORPUS_UI_PORT=5273`)   |
| CONTRACT-012 + SERVER-027                   | `8970`–`8974` | `8972`                               |
| UI-011                                      | `8975`–`8979` | `8977` (UI: `CORPUS_UI_PORT=5273`)   |
| Sprint-010 integration (TEST-113…126)       | `8980`–`8984` | `8982`                               |
| Automated tests, every workspace            | —             | `0` (ephemeral). Never hardcode.     |

**Reserved:**

- **`8765` must stay UNBOUND for the whole sprint, by everyone.** It is the workspace default and the
  target of `apps/ui/vite.config.ts`'s proxy. `apps/ui/e2e/smoke.spec.ts:235` asserts the console
  strip reads exactly **`"server unreachable"`**, which is only true when nothing listens on 8765.
  Always pass `--port` explicitly to `corpus init` so its upward probe never reaches it, and check
  `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done. Verified free at contract time.
- **`5273` is a single-holder resource and this sprint has three claimants.**
  `playwright.config.ts` sets `reuseExistingServer: false` unconditionally, so `npm run e2e` always
  starts its own Vite on `CORPUS_UI_PORT` with `--strictPort`. **UI-005, UI-009 and UI-011 must not
  run `npm run e2e` concurrently, and none may leave `npm run dev -w apps/ui` running on 5273 while
  another runs e2e.** Coordinate through the orchestrator; a collision fails loudly, which is the
  intended behaviour, but it still costs a full run. Verified free at contract time.
- **`5173`** — held by an unrelated `ssh` process (PID 16094, re-confirmed at contract time). Always
  export `CORPUS_UI_PORT=5273`. `.githooks/pre-push` already defaults it to 5273.

### Scratch directories — one prefix per issue

| Issue                     | Prefix                                          |
| ------------------------- | ----------------------------------------------- |
| UI-005                    | `mktemp -d /tmp/corpus-s010-u005-XXXXXX`        |
| UI-009                    | `mktemp -d /tmp/corpus-s010-u009-XXXXXX`        |
| CONTRACT-012 + SERVER-027 | `mktemp -d /tmp/corpus-s010-c012-XXXXXX`        |
| UI-011                    | `mktemp -d /tmp/corpus-s010-u011-XXXXXX`        |
| Integration               | `mktemp -d /tmp/corpus-s010-int-XXXXXX`         |

Automated tests use `fs.mkdtemp`/`mkdtempSync` with the same prefix.
`apps/server/src/docs/write-fixture.ts`'s `createWriteWorkspace(prefix, options)` already builds a
real git repo, a real projection and a real Hono app on `port: 0` under
`tmpdir()/corpus-<sprint>-<prefix>-*` with an injectable clock (`FIXTURE_NOW =
2026-07-27T09:00:00Z`) — **SERVER-027 uses it rather than building a workspace by hand.**

**Never** `rm -rf /tmp/corpus-*` — delete only paths you created and captured in a variable.

**One scratch hazard specific to this sprint:** UI-005 and UI-011 both run `git` and `corpus`
commands against a scratch workspace to prove auto-commits and the HALT sentinel. Every `git`
invocation carries an explicit `cwd`; a `git` command with the wrong working directory operates on
**the Corpus repository itself**. Run `git status` in your worktree before declaring done.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node` and `killall node` **kill sibling
agents' servers and dev servers** and are forbidden for the duration of this sprint. Stop what you
started, by pid:

```sh
node --import tsx apps/cli/src/bin/corpus.ts server start   # then: corpus server stop
npm run dev -w apps/ui & UI=$!                              ; kill -TERM "$UI"
curl -N "http://127.0.0.1:8977/events?token=$TOK" & SSE=$!  ; kill -TERM "$SSE"
```

Before declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. Playwright's
`webServer` child and background `curl -N` SSE clients are killed by captured pid. Check `5273` too.

### Machine-load discipline — binding on every agent in this batch

This laptop is shared by the orchestrator and up to three implementation agents; a seven-agent fleet
plus overlapping gates killed a session on 2026-07-27. These are hard rules, not guidance:

- **Scoped tests only during development**: `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run <path>`.
  **Never** run the repo-wide suite, `npm test` without a workspace filter, or `npm run coverage`
  from a worktree. The orchestrator's harvest run is the single repo-wide gate.
- **One workspace-scoped run at the very end of your session is the maximum**
  (`VITEST_MAX_THREADS=4 npm test -w apps/ui`).
- **Cap workers on every vitest invocation**: `VITEST_MAX_THREADS=4`.
- **One heavy command at a time.** Never overlap builds, test runs, e2e, or `npm install`; wait for
  each to finish before starting the next. Never start a build while a backgrounded run is alive.
- **Playwright/e2e is single-holder** — it starts its own Vite. Never run it while another e2e run
  or dev server is up. See the `5273` note above; three claimants, one resource.
- **Before ending, kill every process you started (recorded pids only) and verify your ports are
  free.** After any interrupted run, sweep orphans: `ps aux | grep [v]itest`, kill by pid.

### Runtime gotchas that will otherwise be misread as bugs

Every fact below was read out of the shipped tree at `4650a6b` while writing this contract.

**The CLI entry point and the verbs that exist**

- The `corpus` bin runs from source as `node --import tsx apps/cli/src/bin/corpus.ts`. There is no
  installed `corpus` on PATH in this repo.
- Shipped verbs relevant here: `doc create|edit|move|archive|delete`, `thread reply|resolve|reopen`,
  `queue halt|resume|status|claim-all|complete|fail|abandon|idle|reap-stale`,
  `job list|log|retry|abandon`, `lock acquire|release|break|list|reap`, `db rebuild|doctor`,
  `server start|stop|status|logs`.
- **There is no CLI verb to mark a thread seen** and no `corpus doc show`. Read state is exercised
  over HTTP (`POST /api/threads/{id}/seen`) or through the browser.

**The kit's surface as it stands, and what each issue must add to it**

- Shipped read hooks: `useDocs`, `useDoc`, `useThread`, `useTree`, `useJobs`, `useLocks`, `useHealth`.
  Shipped write hooks: `useAppendTurn`, `useUpdateDoc` / `useUpdateDocById`, `useCreateDoc`,
  `useCreateThread`. `CorpusClient` writes: `appendTurn`, `createDoc`, `updateDoc`, `createThread`.
- **`useMutation`, `QueryClient` and the raw `CorpusApi` are still deliberately not re-exported.**
  The sprint-008 rule stands: **no file under `apps/ui/src` outside the provider wiring may call
  `fetch(` or import from `@corpus/contract/client`.** Everything goes through `useCorpusClient()`.
- What is **missing** and must be added as named `CorpusClient` methods + named hooks:
  - **UI-005**: break a lock, delete a document, archive/unarchive, resolve/reopen a thread, mark a
    thread seen. Plus `MarkdownView` in the kit — SPEC.md §10 names it as part of the kit contract.
  - **UI-011**: queue status (`GET /api/queue/status`), halt, resume, retry a job, abandon a job,
    and the job log (`GET /api/jobs/{id}/log?cursor=`).
  - **UI-009** needs nothing new: `useCreateDoc`, `useTree` and `useDocs` already cover it.
  - This makes `packages/kit/src/index.ts` and `client/createCorpusClient.ts` shared touch points
    for two of the three UI issues. See Merge order.
- **`useRowActions` already implements Archive and "Still current"** — `archive` PUTs
  `{status: "archived"}`, `stillCurrent` PUTs `{reviewed: clock().toISOString()}` **and nothing
  else**, `triage` creates an `@agent` thread with `triagePrompt(title)`. UI-005's ⋯ menu **reuses
  that unit rather than reimplementing those two mutations** (TEST-14).
- **`react-markdown` and `remark-gfm` are in neither `apps/ui/package.json` nor
  `packages/kit/package.json`.** SPEC.md §3 names them; UI-005 adds the dependency to
  `packages/kit`, not to `apps/ui`.

**The board as UI-003/UI-004 left it**

- `apps/ui/src/board/` exists: `Column.tsx`, `ColumnHead.tsx`, `ColumnList.tsx`, `ColumnMenu.tsx`,
  `NewListPicker.tsx`, `NewListGhost.tsx`, `viewDoc.ts`, `columnDrag.ts`, `columnOrder.ts`,
  `useColumns.ts`, `useCreateInColumn.ts`, `useColumnOrder.ts`, `useBoardLocalState.ts`,
  `ColumnReaderScaffold.tsx`. `Row` is rendered by `ColumnList.tsx`. The `rows/` scaffold UI-004
  shipped is gone.
- `Column.tsx:114` sets the `reading` class from `local.open === null ? "" : "reading"` and mounts
  `<ColumnReaderScaffold docId={local.open} …>` at line 182. `Column.css:27` already declares
  `.col.reading { width: 560px }`, and `.reader`, `.reader-head`, `.reader-id`, `.reader-scroll`,
  `.doc-title` and `.reader-note` already exist as scaffold styles. **UI-005 replaces the scaffold
  and its `.reader-note` copy** (*"The document view — body, threads, focus mode — arrives with the
  reader."*).
- **`useBoardLocalState` is `corpus.board`, `BOARD_STATE_VERSION = 1`, shape
  `{version, columns: Record<colId, {scroll: number, open: string | null}>}`.** A blob whose
  `version` does not match reads as `EMPTY_BOARD_STATE` **by design** — so extending it to hold a
  nav stack means bumping the version and discarding every user's current scroll/open state. That is
  a decision, not an accident (Open Conflict 8). Its own docblock is the rule to obey: *"which
  columns exist, what they query, what they are called and what order they sit in is **corpus**
  state … Where you had scrolled and which document each column had open is **local**. Anything that
  ends up in the blob below and is not one of those two things is a bug."*
- `Board.tsx:110-119` already does the scroll-into-view UI-009 needs, verbatim:
  `element.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })`, guarded by
  `typeof element.scrollIntoView === "function"` because **jsdom implements no layout**. Reuse it.
- A **toast surface exists**: `apps/ui/src/shell/Toasts.tsx` (provider), wired in `Shell.tsx`.
  Nobody creates a second one. **There is still no error boundary anywhere.**
- `apps/ui/src/app/global.css:50-72` declares `@keyframes pulse { 50% { opacity: 0.35 } }` and the
  reduced-motion guard, which today covers `.agent-pill .dot.busy`, `.working-dot`, `.row.flash`
  (`animation: none`) and `.col`, `.row.leaving` (`transition: none`). **`.job-dot.running` is not
  covered** and neither is any flash UI-005 adds. The file's comment says the guard is declared once
  *"so no future animated element can ship without it"* — **extend it there; do not re-declare it.**
- **`.overlay`, `.focus`, `.col.flash` and every console-body class do not exist yet.**

**The console strip already exists and UI-011 walks into a live e2e assertion**

- `apps/ui/src/shell/ConsoleStrip.tsx` renders `.console > .console-strip` with `.c-caret ▴`,
  the word `console`, a `.spacer`, and a `<ServerStatus />` that renders
  **`<span className="c-failed" role="status">server unreachable</span>`** when `useHealth()` errors.
- `apps/ui/e2e/smoke.spec.ts:235` asserts
  `expect(page.locator(".console-strip .c-failed")).toHaveText("server unreachable")`. **UI-011's
  failed-job count is also a `.c-failed` span in the same strip** — two matches, Playwright strict
  mode, a failing shipped spec. **Open Conflict 5.**
- Two more shipped assertions UI-011 must keep true: `smoke.spec.ts:111`
  `expect(grow).toEqual({ topbar: "0", board: "1", console: "0" })`, and `smoke.spec.ts:130`
  `expect(consoleBox.height).toBeLessThan(48)` — **the drawer's default state is collapsed**, and
  the shell must stay `flex-grow` 0/1/0.
- `Shell.tsx` is already `<div className="app"><Topbar /><Board /><ConsoleStrip /></div>` and
  `Shell.css` already declares `.app { display: flex; flex-direction: column; height: 100vh }`.
  **The push-not-overlay layout is already correct** — UI-011 adds a body to a sibling that is
  already a sibling. It must not introduce `position: fixed`.

**The search bar as it stands, and the spec UI-009 must not break**

- The top bar's `.searchbar` is a **`<button>`**, not an input. `smoke.spec.ts:68` asserts
  `expect(page.locator(".searchbar input")).toHaveCount(0)` — **the query input lives in the overlay
  panel, never in the top bar.**
- `smoke.spec.ts:75` — *"the not-yet-wired affordances are enabled and inert"* — clicks `.searchbar`
  and `.btn-compose` and asserts no uncaught error. After UI-009 the searchbar is wired and the test
  name is a lie; **UI-009 updates that spec** (split it: searchbar wired, compose still inert until
  UI-010) rather than leaving a misleading green.

**Search, exactly as the contract and server implement it**

- **Snippets are structured, not HTML.** `SnippetSchema` is
  `{field, threadId?, segments: [{text: string, match: boolean}]}`, and its own docblock says:
  *"FTS5's `snippet()` output, converted server-side into alternating matched and unmatched
  segments. Structured rather than marked-up HTML so the UI renders highlights without
  `dangerouslySetInnerHTML` and without an escaping contract between server and client."* The server
  delimits with ASCII control characters (`SNIPPET_OPEN = STX (U+0002)`, `SNIPPET_CLOSE = ETX (U+0003)`) and
  strips them at the wire boundary. **Open Conflict 4.**
- `snippets` is `[]` when the query carried no `q`. A `turn` snippet carries `threadId`.
- **FTS tokenization**: `toFtsMatchExpression` quotes each token and makes only the **last** a
  prefix — `mort gage` → `"mort" AND "gage"*`. Tokens are capped at `MAX_QUERY_TOKENS`.
- **The archived default is server-side and is not a union.** `docs/query.ts:155-161`:
  `query.status === undefined ? "d.status <> 'archived'" : "d.status = @status"`. `DocsQuerySchema.
  status` is `z.enum(DOC_STATUSES)` — **one value, no comma-OR, no negation**. So `status=archived`
  means *only* archived, not *also* archived. **Open Conflict 3.**
- `DOC_SORTS` is now `["updated","-updated","created","-created","due","title","order","relevance"]`,
  default `-updated`. `relevance` is the sort a search wants.
- `DocsQuerySchema` accepts `q, type, status, tag, folder, parent, references, agent, author, since,
  due, stale, unread, pinned, needs, sort` + pagination. **There is no `id`/`ids` filter** — see
  Open Conflict 6.
- `CreateDocRequestSchema` accepts `type, title, body?, folder?, tags?, status?, due?, evergreen?,
  pinned?, order?, query?, column?, extra?`. Omnibox create is `{type: "note", title, folder: "inbox"}`.
- `UpdateDocRequestSchema` accepts `title, body, tags, status, due, reviewed, evergreen, pinned,
  order, query, column, extra`. Server-side, `update.ts` updates
  `title|tags|status|due|reviewed|evergreen|pinned` and treats `order|query|column` as clearable with
  `null`; `extra` is an RFC-7386 shallow merge patch. Untouched keys are compared structurally
  (`sameValue()`) and **not re-written** — that is SERVER-001's byte-identity guarantee.

**Jobs, queue and locks, exactly as they are**

- **`Job` is `{eventId, status, started, updated, lastLine, originId, originTitle}`.** There is **no
  `payload`** and — the one that matters — **no event `type`**. `lastLine` is *"Most recent log line,
  for the collapsed console row."* `originTitle` is resolved at response time, never stored.
  **Open Conflict 2.**
- `QueueEventStatus` is `"pending" | "in-progress" | "processed" | "failed" | "abandoned"`. The
  prototype's dot classes are `running | pending | done | failed`. The mapping is the issue's to
  write down, and **`abandoned` has no prototype treatment** (Open Conflict 10).
- `JobsQuery.recent` defaults to `50`, max `200`. `JobList` is `{jobs: Job[]}`, *"most recent first"*.
- **`GET /api/jobs/{id}/log?cursor=`** returns `{lines: [{ts, line}], nextCursor}` where `nextCursor`
  *"equals the total line count"*, and the cursor is *"Lines already held by the caller; pass back
  `nextCursor` to fetch only new ones."* The stored `source` field (`hook|cli|server`) is dropped at
  the wire. **This is the deduplication mechanism** — not a client-side line diff.
- **`POST /api/jobs/{id}/log` broadcasts nothing.** `jobs/service.ts`: *"The append deliberately
  broadcasts **nothing**. The watcher tails `.corpus/jobs/` (SPEC.md §9.1) and its debounce is what
  turns a chatty job's hundreds of lines into a handful of `invalidate` frames per second."*
  **Open Conflict 1.**
- Log caps: **8 KB per line** (truncated lines get ` …[truncated]`), **4 MB per file**.
  `AppendLogResult.appended` is `false` when the cap dropped the line — *"the call still succeeds
  with `201` … A caller that reports progress from this endpoint reports the flag, not the status
  code."*
- The job-log ingest route is the one unauthenticated mutating endpoint: `methodOnly("POST",
  localhostOnly)` plus the no-browser-`Origin` guard.
- `GET /api/queue/status` returns `{halted, pending, inProgress, processed, failed, abandoned}` —
  **everything the strip needs from one call**: depth = `pending`, running = `inProgress`,
  done = `processed`, failed = `failed`. No separate poller.
- `.corpus/HALT` is a JSON sentinel `{reason?, at}` written atomically at mode `0o600` by
  `POST /api/queue/halt` and removed by `POST /api/queue/resume`.
- **Retry and abandon for a job are `POST /api/jobs/{id}/retry` and `POST /api/jobs/{id}/abandon`.**
  `DELETE /api/queue/{id}` also abandons an *event*; the console is a job surface and uses the job
  routes. Pick one and say which.
- **`POST /api/locks/{docId}/break` already does everything UI-005's toast wants to claim.**
  `locks/service.ts` `forceBreak` is user-only (*"force-breaking a lock is user-only; the agent waits
  or defers"*), records an empty git commit
  `lock: force-break on <docId> (was <holder>) by user` with a lock-holder trailer, and calls
  `requeueDeferred` to put the lock's `deferredEventId` back in `pending/`. The response is
  `{docId, released: true, holder}`. **The toast is honest — and it is verifiable in `git log` and
  `.corpus/queue/pending/`.**
- `Lock` on the wire is `{docId, holder, acquired, ttl}`; expired leases are dropped by
  `GET /api/locks` before it answers. **No lock information rides a `DocRow`.**

**Unread, exactly as it is computed**

- `UNREAD_SQL` (`apps/server/src/docs/needs.ts:28`):
  `(t.id IS NOT NULL AND t.last_ts IS NOT NULL AND t.last_ts > COALESCE(s.last_seen_ts, ''))` — a
  lexicographic comparison over normalized ISO timestamps, correct by construction. Its docblock:
  *"'Still unread' — a thread whose last turn is newer than the mark it is compared against — with
  the mark left to the caller."*
- The collection query's FROM is
  `FROM documents d LEFT JOIN threads t ON t.id = d.id LEFT JOIN seen s ON s.thread_id = d.id`.
  SERVER-027's aggregate is a **correlated subquery over the doc's child threads**, not a change to
  this join.
- Indexes that make it cheap already exist: `threads_parent_id` and `threads_last_ts`.
- `POST /api/threads/{id}/seen` accepts an optional `lastSeenTs` **before** the last turn, recording
  a partial read — so "seen" does not always mean "fully read", and `unreadThreads` must agree with
  per-thread `unread` on exactly that definition.

**SSE, exactly as it is**

- Frames are `event: invalidate\ndata: {"keys":[[…],[…]]}\n\n`. `:connected` on attach, `:hb` every
  25 s (an SSE *comment* — invisible to `EventSource`, visible to `curl -N`; not a stray frame).
- `events/sse.ts`: *"Rule 3 is absolute (§2.2): the only event name on this wire is `invalidate` and
  its only payload field is `keys`. No handler may put document, thread, job or queue *data* on the
  stream."*
- The key vocabulary is closed: `DOCS_KEY`, `TREE_KEY`, `QUEUE_KEY`, `JOBS_KEY`, `LOCKS_KEY`,
  `docKey`, `jobKey`, `lockKey`, `threadKey`, plus the kit's `HEALTH_KEY` and the plugin `x/…`
  prefix. **`jobKey` exists** — per-job invalidation is available to UI-011 without a new key.

**Testing patterns you must follow rather than reinvent**

- jsdom is opted into **per file** with a `/** @vitest-environment jsdom */` docblock. One root
  `vitest.config.ts`; no per-workspace config.
- Node 25 shadows jsdom's `localStorage`; the shipped workaround is
  `apps/ui/src/testing/memoryStorage.ts` — `memoryStorage(initial?)` and `throwingStorage()` (which
  models Safari private mode by throwing `SecurityError`), stubbed with `vi.stubGlobal`. **UI-005's
  nav-stack persistence and UI-011's `corpus.console` tests both use it, including
  `throwingStorage()` for the blocked-storage edge case.**
- `EventSource` is absent on Node 25 and CI's Node 22. The seam is `eventSourceFactory`, and
  `@corpus/kit/testing` ships `FakeEventSource`, `fakeEventSourceFactory`,
  `failingEventSourceFactory`, `docRowFixture` and `createCorpusTestHarness`. **No unit test may
  construct a real `EventSource`.**
- `apps/ui` component tests render through the **real** `CorpusProvider` with `fetch` stubbed via
  `vi.stubGlobal` and the event source injected — not MSW, not `vi.mock` of kit hooks.
- Playwright: `testDir: "./e2e"`, one chromium project, `globalSetup: "./e2e/coverage-setup.ts"`,
  `baseURL` from `CORPUS_UI_PORT`, `webServer` = Vite only, `reuseExistingServer: false`. Every spec
  imports `test`/`expect` from `./coverage`, not from `@playwright/test`.
- **Coverage globs need no change**: `COVERAGE_INCLUDE = ["apps/*/src/**", "packages/*/src/**",
  "plugins/*/src/**"]`, so every new directory this sprint creates is in the ≥ 90 % merged gate the
  moment it is written. Three large, branchy UI features is exactly where that gate slips.
- **Baseline at `4650a6b`, measured while writing this contract**: **241 test files** repo-wide
  (`apps/server` 111, `apps/cli` 51, `packages/contract` 34, `apps/ui` 24, `packages/kit` 18);
  **20 Playwright tests in 2 spec files** (`smoke.spec.ts` 13, `board.spec.ts` 7); lint, format,
  typecheck and the merged coverage gate green. Any red you find at the start of your work is yours.
  *(Sprint-009's logs disagreed with each other by 4× on this number — count with
  `find … -not -path '*/node_modules/*'` and state the command.)*

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed — because an adjudication struck it, or a dependency has
not landed at the moment of verification — is marked `DEFERRED → <issue>` or
`STRUCK → Open Conflict N` in the E2E Verification Log, with the reason and the substitute evidence
supplied. **Silent omission is a fail.**

---

## Acceptance Tests

### UI-005: Reader, navigation stacks, doc menu, focus shell, lock banner

Ports `8960`–`8964`, primary `8962`; UI on `CORPUS_UI_PORT=5273`. **42 criteria.** This is the
sprint's keystone: UI-006, UI-007, UI-008 and both other UI issues open into what it builds. Every
mutation criterion is verified twice — on screen **and** on disk with `git log`.

#### The reader in its column

```
TEST-1: Clicking a row opens the document in that column
  Given: A board on 8962 with a folder column containing documents
  When:  A row is clicked
  Then:  That column takes the `reading` class and computes to `width: 560px` with the `0.25s` width
         transition; the row list and the header chip row are hidden; the reader renders. No other
         column changes width. The scaffold's `.reader-note` copy ("The document view — body,
         threads, focus mode — arrives with the reader.") is gone from the tree

TEST-2: Two columns read independently
  Given: Two columns with different documents open
  When:  One reader is scrolled and one document is edited
  Then:  Both readers render their own document, scrolling one does not move the other, and their
         nav stacks are separate. This is SPEC.md §10's wide-screen workflow and it is the reason
         the reader is per-column rather than a route

TEST-3: The reader head is the prototype's, element for element
  Then:  `.reader-head` contains, in order: a `.back` accent button; a `.reader-id` mono span reading
         `<docId> · git ✓` pushed right by `margin-left: auto`; an (empty) `.save-chip` slot; a
         `.comments-btn` (`💬 n`) hidden when the document has no threads; a `.expand`
         `data-doc-menu` ⋯ button with `aria-label="Document actions"`; and a `.expand`
         `data-expand` ⤢ button with `aria-label="Read full screen"`. Both ⋯ and ⤢ use the
         prototype's `.expand` class — a new class for either is a fail

TEST-4: The back label names where Back actually goes
  Given: A column titled Finance with `Mortgage options` open, then a `[[ref]]` followed to `Rates`
  Then:  With an empty stack the button reads `‹ Finance` (the column's title); with depth it reads
         `‹ Mortgage options` (the PREVIOUS document's title, not the current one, not the column's).
         Its `title` attribute documents the shift-click behaviour

TEST-5: Shift-click Back empties the stack in one act
  Given: A stack three documents deep
  When:  Back is shift-clicked (and, separately, the documented keyboard shortcut is pressed)
  Then:  The column returns straight to its list. No intermediate document renders and no
         intermediate scroll restoration flashes — assert the reader unmounts once, not three times

TEST-6: The reader scrolls, the board does not
  Given: A document long enough to overflow
  Then:  `.reader-scroll` is the scrolling element; the board's vertical overflow is unchanged
         (`overflow-y: hidden`, asserted by the shipped `smoke.spec.ts`) and the page never scrolls
```

#### The body, refs and backlinks

```
TEST-7: The body renders through the kit, in the prototype's measure
  Then:  `packages/kit` gains `MarkdownView` (SPEC.md §10 names it in the kit contract) built on
         `react-markdown` + `remark-gfm`, added as a `packages/kit` dependency — NOT an `apps/ui`
         one. `.doc-body` computes to serif 15px / line-height 1.62 / max-width 62ch; in focus mode
         16.5px / 1.7 / 66ch. GFM tables and task lists render

TEST-8: Raw HTML in a body is not injected
  Given: A document whose body contains `<script>alert(1)</script>` and `<img src=x onerror=alert(1)>`
  When:  It is opened in the reader
  Then:  Both render as visible text or are dropped; neither executes. Assert with a page-error
         listener collecting nothing, not by eyeballing. The shipped e2e convention is
         `expect(uncaught).toEqual([])`

TEST-9: A `[[ref]]` renders the target's CURRENT title
  Given: `doc_a`'s body contains `[[doc_b]]` and `doc_b` is titled "Rates"
  Then:  The link text is `Rates` on a `.ref` element. Rename `doc_b` out of band with
         `corpus doc edit` while the reader is open: the link text updates live via SSE with no
         reload. A stored copy of the title is the failure this catches (SPEC.md §5: "rename/move-proof")

TEST-10: The alias form overrides the title, and only the display
  Given: `[[doc_b|the rate assumption]]`
  Then:  The rendered text is `the rate assumption`; clicking it still navigates to `doc_b`

TEST-11: An unresolved ref is visibly broken and inert
  Given: `[[doc_doesnotexist]]`
  Then:  It renders with a distinct non-`.ref` treatment, is NOT a link and NOT clickable, and
         carries a `title` explaining the target does not exist yet. Per SPEC.md §5 this is
         legitimate — a warning, not an error state — so nothing is logged to the console and no
         toast fires

TEST-12: Ref titles are resolved without a request per ref, and never twice for the same id
  Given: A body containing eight refs, three of them to the same document
  When:  The document is opened with the network panel recording
  Then:  The number of requests issued to resolve titles is STATED, is at most the number of DISTINCT
         unresolved-in-cache ids, and is zero for ids already in the query cache from the column's
         list response. `GET /api/docs` has no `ids` filter (Open Conflict 6) — the strategy chosen
         is written into the E2E log, because UI-006 and UI-007 inherit it

TEST-13: Backlinks come from the references filter and push like any ref
  Given: `doc_a` references `doc_b`
  When:  `doc_b` is open
  Then:  A "Referenced by" panel below the body (mono uppercase heading, `.backlinks`, max-width
         62ch) lists `doc_a` with its type glyph and title, sourced from `useDocs({references: "doc_b"})`
         — one request, not one per candidate. Clicking it pushes onto the nav stack
```

#### The ⋯ menu, and the two-click delete

```
TEST-14: Archive and Still current reuse the kit unit that already exists
  Then:  The menu's Archive and Still current go through `useRowActions`' `archive` and
         `stillCurrent` (or a shared unit factored out of them), not through a second `updateDoc`
         call written in the reader. The E2E log names the unit. Reimplementing them is the failure
         this criterion prevents — UI-004 already shipped and verified them

TEST-15: Still current writes `reviewed` and leaves `updated` alone
  When:  ⋯ → Still current on a document
  Then:  `reviewed` is set on disk to now, `updated` is BYTE-IDENTICAL to before, and `git log -1`
         shows the auto-commit with `user` as author. This is the criterion whose failure is
         invisible and permanent (SPEC.md §5: a committed act distinct from editing)

TEST-16: The menu's item set is type-aware
  Then:  On a note: Still current, Archive, Delete. On a thread document: Still current,
         Resolve/Reopen (label reflecting current status), Archive, Delete. The Resolve item flips
         `status` on disk via `POST /api/threads/{id}/resolve` and its label becomes Reopen, live.
         Google-Docs items per Open Conflict 7's adjudication

TEST-17: Delete arms before it fires
  When:  ⋯ → Delete is clicked once
  Then:  The item re-labels to exactly `Really delete? Click again` with the sub-label
         `permanent · git keeps history · its threads become orphaned records`, and NO request is
         issued (network log quoted). The second click issues `DELETE /api/docs/{id}`

TEST-18: Delete is user-only and says so
  Then:  The unarmed item's sub-label reads `user-only · click twice to confirm` and renders in
         `--signal`. Independently: `curl -X DELETE` with the agent actor header is refused by the
         server (403). The UI label and the server rule are verified separately, not conflated

TEST-19: Delete removes the file and keeps the history
  When:  The second click lands
  Then:  The markdown file is gone from disk, `git log` still contains its history, `git log -1`
         shows the deletion auto-commit, the reader leaves the document, and — for an anchored
         thread — the parent's `anchors` entry is gone in the SAME commit

TEST-20: The menu popover is clamped into the viewport
  Given: A column at the right edge of a horizontally scrolled board
  When:  ⋯ and 💬 are opened
  Then:  Neither popover overflows the viewport. Both reuse the prototype's `.comments-pop` /
         `.cp-item` styling (bold `.cp-quote` action line + mono `.cp-meta` explanation line)
```

#### The 💬 popover

```
TEST-21: The popover lists this document's threads and hides when there are none
  Then:  `.comments-btn` is hidden entirely for a document with no threads and reads `💬 n` otherwise.
         Open, each `.cp-item` shows a serif-italic `.cp-quote` (the anchor quote in quotes, or
         `whole-document thread`) and a mono `.cp-meta` reading `<n> turns · last: <author> · <status>`.
         With zero threads the empty copy is the prototype's:
         `No threads on this document yet — select some text to start one.`

TEST-22: Selecting a thread scrolls to it and flashes it
  When:  A `.cp-item` is activated
  Then:  That thread's slot in the body expands, the reader smooth-scrolls to it, and a `--signal`
         border flashes for ~1.2 s. Under `prefers-reduced-motion: reduce` the flash does not
         animate — and the guard is added to `apps/ui/src/app/global.css`'s existing block, not
         re-declared elsewhere
```

#### Frontmatter

```
TEST-23: The chip strip is the document's frontmatter, rendered
  Then:  `.fm-chips` shows type · folder · `#tags` · status · `updated` and author, from the
         document's own frontmatter — not from the column's query

TEST-24: The form edits exactly the fields it shows, and only the changed ones
  When:  Title, a tag, status and due are edited
  Then:  A single `PUT /api/docs/{id}` carries ONLY the changed fields (request body quoted); on
         disk those keys change, every other frontmatter key is byte-identical, and `git log -1`
         shows one auto-commit with `user` as author

TEST-25: The form is disabled while the document is locked
  Given: An agent lock on the open document
  Then:  The title field and every frontmatter control are non-editable. If the lock is acquired
         while the user is mid-edit, the form disables AND the typed values are preserved and
         warned about — silently discarding them is the failure this catches
```

#### Navigation stack and persistence

```
TEST-26: Following a ref pushes, Back pops, and the scroll comes back exactly
  When:  The reader is scrolled to a known offset, a `[[ref]]` is followed, then Back is pressed
  Then:  The scroll offset is restored EXACTLY (assert the number, not "roughly"). Restoration
         happens in a layout effect after the body mounts; a later height change (backlinks
         resolving) must NOT re-restore and yank the user

TEST-27: Backlinks and thread-context links push the same way as refs
  Then:  All three navigation sources push `{docId, scrollY}` onto one stack. Popping the last entry
         exits to the list rather than leaving an empty reader

TEST-28: A self-referential ref does not strand the user
  Given: A document whose body contains a ref to itself
  When:  The ref is followed and Back is pressed
  Then:  A stack entry was pushed, Back returns to the same document at the prior scroll, and a
         second Back exits to the list. De-duplicating it into a no-op is a fail

TEST-29: A ref to a thread opens the thread
  Given: `[[th_…]]` in a body (legitimate per SPEC.md §5)
  Then:  The thread document opens in the reader with its conversation as the body and its ⋯ menu
         showing Resolve/Reopen

TEST-30: Readers, stacks and scroll positions survive a reload
  When:  Two columns have documents open at depth, then the page is reloaded
  Then:  Both readers, both stacks and both scroll positions are restored. `BOARD_STATE_VERSION` is
         bumped and the stored blob still contains NO query, NO order, NO column identity and NO
         document content — only scroll and open/stack state (Open Conflict 8; the localStorage rule
         of SPEC.md §10 is review-blocking)

TEST-31: A stack entry pointing at a deleted document is skipped, not rendered
  Given: A restored stack whose middle entry names a document deleted meanwhile
  Then:  That entry is dropped and popping continues; no error card, no throw, no dead reader
```

#### Focus mode and escape precedence

```
TEST-32: Focus mode is a full-viewport overlay with the prototype's measure
  When:  ⤢ is pressed
  Then:  `.focus` computes to `position: fixed; inset: 0; z-index: 35`, background `--bg`;
         `.focus-inner` max-width 76ch and `.focus .doc-body` max-width 66ch at 16.5px/1.7. Its head
         carries a back control, a close control, a mono `.focus-hint`, the doc id, a save-chip slot,
         💬 and ⋯ — the same actions as the column head (Open Conflict 11 governs the hint's copy)

TEST-33: One DocView, two hosts
  Then:  The column reader and focus mode render the SAME component for the document — same menu,
         same 💬, same ref handling. Grep the diff and show there is exactly one body-rendering call
         site, because UI-006 replaces it in exactly one place

TEST-34: Focus mode keeps its own stack
  When:  Focus is opened from a column reader and two refs are followed inside it
  Then:  The underlying column's stack is UNCHANGED (assert its depth and top entry before and
         after). Closing focus returns to the column at its own position. Back past the bottom of the
         focus stack closes focus rather than stranding an empty overlay

TEST-35: Escape precedence is a registry, not a chain of ifs
  Given: A column reader, focus mode over it, and a ⋯ menu open inside focus
  When:  Escape is pressed three times
  Then:  The menu closes, then focus, then the column reader — matching SPEC.md §10 ("overlays and
         focus mode take precedence, then the column reader"). The implementation is a layer
         registry each surface registers into on mount; UI-009's overlay and UI-010's composer must
         be able to join it without editing a conditional. The prototype's hard-coded chain
         (`overlay → compose → kbd → focus`, with no reader) is the design this criterion replaces
```

#### Locks

```
TEST-36: A lock renders the sepia banner, live, everywhere
  Given: The same document open in two columns
  When:  An agent lock is acquired out of band (`corpus lock acquire` / an agent edit)
  Then:  Both readers show `.lock-banner` — sepia wash, a `.working-dot` in `--sepia`, the text
         "agent is editing — <note> · document is read-only", a Force unlock button — with NO
         reload, driven by the lock projection over SSE

TEST-37: Force unlock does what the toast says it does
  When:  Force unlock is clicked
  Then:  `POST /api/locks/{docId}/break` answers `{docId, released: true, holder}`; the lock file is
         gone from `.corpus/locks/`; the banner clears live in BOTH columns; editing is re-enabled;
         and the toast's two claims are each verified independently — `git log -1` shows
         `lock: force-break on <docId> (was agent) by user`, and (with a deferred edit registered)
         the event is back in `.corpus/queue/pending/`

TEST-38: A failed break never claims success
  Given: A lock already released, or a server error injected
  Then:  The toast reports the failure, the lock state is refreshed, and the UI never claims a break
         that did not happen. Surface the server's response rather than asserting optimistically
```

#### Read state, live changes, and thread bodies

```
TEST-39: Opening a document marks IT seen; opening a parent marks nothing else
  When:  An unread thread is opened in a column reader
  Then:  `POST /api/threads/{id}/seen` fires for that thread, its unread badge clears everywhere via
         SSE, and its parent document's aggregate count decrements. Then open a PARENT document with
         two unseen threads: NO seen call fires for either, and their unread state is unchanged on
         `GET /api/docs`. SPEC.md §7's rule is "displayed content only"

TEST-40: A thread opened from a column is readable as a conversation
  Then:  Turns render with author and timestamp as the document body. The composer, forms,
         attachments and per-turn deletion are UI-008's and are absent, not half-built

TEST-41: A document deleted or archived while open degrades honestly
  When:  The open document is deleted (and separately archived) out of band by the agent
  Then:  The reader shows a clear "no longer exists" / "was archived" state with a Back affordance.
         It does not render stale content indefinitely, does not throw, and logs no uncaught error

TEST-42: An edit landing while the reader is open repaints without a reload
  When:  The open document's body and title are changed out of band with `corpus doc edit`
  Then:  Both update live in every column showing it, refs to it re-render their new title (TEST-9),
         and the scroll position is not reset
```

---

### UI-009: Search overlay, omnibox create, save-as-view

Ports `8965`–`8969`, primary `8967`; UI on `CORPUS_UI_PORT=5273`. **28 criteria.** The whole issue is
one endpoint composed correctly. **TEST-52 is gated on Open Conflict 3** and **TEST-49/50 are struck
or rewritten by Open Conflict 4** — settle both before writing code.

#### Opening, chrome and focus

```
TEST-43: ⌘K and the search bar open the same overlay
  When:  ⌘K is pressed, and separately the top bar's `.searchbar` button is clicked
  Then:  `.overlay.open` renders — `backdrop-filter: blur(3px)`,
         `color-mix(in srgb, var(--ink) 18%, transparent)`, `z-index: 40` (above focus mode's 35) —
         with `.search-panel` at `min(760px, 100vw - 48px)`, `margin: 7vh auto 0`,
         `max-height: 78vh`, and focus lands in the query input

TEST-44: The query input lives in the overlay, never in the top bar
  Then:  `.searchbar` is still a `<button>` and `page.locator(".searchbar input")` still counts 0 —
         the shipped `smoke.spec.ts:68` assertion holds unchanged. The overlay's input is serif 19px,
         borderless, on `.search-input-row`, with the `save as view` `.chip.ghost` at its right

TEST-45: The overlay is a real dialog
  Then:  `role="dialog"` with an accessible label, Tab is trapped inside the panel, and focus returns
         to the search bar on close. `esc` closes; a scrim click closes; a click inside the panel
         does not

TEST-46: The stale "inert affordances" spec is corrected, not left green-and-wrong
  Then:  `smoke.spec.ts:75` ("the not-yet-wired affordances are enabled and inert") is updated so it
         asserts the searchbar is WIRED and the compose button is still inert (UI-010). A test whose
         name contradicts the shipped behaviour is a fail even while it passes
```

#### One request, composed server-side

```
TEST-47: Typing issues exactly one debounced request per burst
  Given: The network panel recording
  When:  `mortgage` is typed at speed
  Then:  ONE `GET /api/docs` request is issued per ~200 ms debounce window, carrying `q` and every
         active filter. The request count is quoted. Out-of-order responses are discarded by query key

TEST-48: There is no client-side filtering and no second request per group
  Then:  The rendered result set equals the response's items exactly — no post-filtering, no
         re-sorting, no second request for the Threads group. Compare the rendered rows against the
         raw JSON of the same query issued by hand with `curl` and show they match item for item

TEST-49: Snippets render from structured segments, never from injected HTML
  Then:  `.sr-snippet` is built from `snippet.segments` — `match: true` segments rendered inside a
         `<mark>` ELEMENT created by React, `match: false` as text. There is NO
         `dangerouslySetInnerHTML` anywhere in `apps/ui/src` (grep it and quote the empty result) and
         NO sanitizer, because `SnippetSchema` was designed to make one unnecessary (Open Conflict 4)

TEST-50: A snippet whose text looks like markup renders as text
  Given: A document body containing `<script>alert(1)</script>` matched by the query
  Then:  The segment's text renders literally and visibly; nothing executes; the page-error listener
         collects nothing. This is the criterion that replaces the issue file's `<mark>`-allowlist test

TEST-51: Filter chips are query parameters, sourced from real data
  Then:  Chips toggle `type`, `tag`, `status`, `folder`, `since`, `due`, `unread`, `references`, and
         the thread-only `agent`, `needs=form` and `parent`. Folder options come from
         `GET /api/tree`. Each toggle produces exactly one new request carrying the corresponding
         parameter. Active chips take `.chip.on`. `references:` opens a title picker rather than
         expecting a typed id

TEST-52: The archived default is the server's, and the chip's semantics are stated
  Then:  With no status chip the request omits `status` entirely and the server's
         `d.status <> 'archived'` default applies — verify a `corpus doc archive`d document is absent.
         The archived chip (`.chip.warn`) behaves per Open Conflict 3's adjudication, its LABEL
         matches what it actually does, and the E2E log states which of the two semantics shipped.
         A chip labelled "include archived" that returns only archived documents is a fail

TEST-53: Results are grouped from the single response
  Then:  `.sr-group` headers read `Documents · 3` and `Threads · 2` (label · count), derived by
         partitioning the ONE response — not by counting a second query. Each `.sr` row carries a
         `.type-glyph`, a serif `.sr-title`, the `.sr-snippet`, and a mono `.sr-path` (folder +
         updated for documents; thread context such as `on Mortgage options · open` for threads,
         using `parentTitle` — never a raw `doc_*` id)

TEST-54: An empty query with filters is a valid search
  Then:  Filters compose without `q`; results render; `snippets` is empty and no snippet element is
         rendered; the create row is hidden
```

#### Keyboard and opening in a column

```
TEST-55: ↑↓ move a single cursor, including over the create row
  Then:  Exactly one row carries `.sr.kbd` (2px accent outline, inset) at any time; the cursor
         clamps at both ends; the create row participates at position 0; the list scrolls the cursor
         into view with `{block: "nearest"}`

TEST-56: ↵ opens the result in its home column, with the flash
  When:  A result is highlighted and ↵ pressed
  Then:  The overlay closes; the board smooth-scrolls that column into view
         (`{behavior: "smooth", inline: "center"}` — reuse `Board.tsx:110-119`, do not write a
         second one); `.col.flash` is applied for 1.5 s and then REMOVED; and the document opens in
         that column's reader. `.col.flash` sets `border-color: var(--accent)` and its transition is
         already covered by the shipped `.col` reduced-motion guard — verify, do not re-declare

TEST-57: Column resolution has a stated precedence and a fallback
  Then:  `useOpenInColumn` resolves folder match → type/status match → first column, the precedence
         is unit-tested, and a document whose home column was deleted still opens somewhere. The
         resolution rule is written into the E2E log verbatim, because UI-011 consumes this hook

TEST-58: While the overlay is open it owns the keyboard
  Then:  Board shortcuts do not fire; the overlay's keys are handled on the panel, not globally; and
         it registers into UI-005's escape layer registry (TEST-35) rather than adding a branch to a
         global handler. A simple "an overlay is open" signal is exported for UI-010
```

#### Save as view

```
TEST-59: One query shape, two serializers, proven equal
  Then:  `searchQuery.ts` exports `SearchQuery`, `toApiParams(q)` and `toViewFrontmatter(q)`, and a
         unit test round-trips them: `toViewFrontmatter` → parse back → `toApiParams` equals the
         original params, for every chip combination including the archived default

TEST-60: Save as view creates a real, committed, pinned view document
  When:  The `save as view` chip is used on a refined query
  Then:  ONE `POST /api/docs` creates a `type: view` document with `pinned: true`, the query in its
         frontmatter, and `order` placing it last; the overlay closes; the new column appears and is
         scrolled to. On disk: the file exists, `cat` shows `type: view`, `pinned: true`, the query
         fields and an `order`; `git log -1` shows the auto-commit. Reload and open a SECOND browser
         context: the column is there in both. This is SPEC.md §12 M3's save-as-view check

TEST-61: ⇧↵ is the same code path as the chip
  Then:  `⇧↵` inside the overlay produces an identical `POST /api/docs` body to the chip's (quote
         both). Note the chord means something else on the BOARD (SPEC.md §10: open in full screen) —
         the overlay's scope is what makes both true; state the precedence

TEST-62: A duplicate view is created, with a warning
  Given: A pinned view whose query already matches the current one
  Then:  The new column is still created (views are documents; duplicates are the user's business)
         AND a toast says a matching column exists

TEST-63: A failed save leaves no phantom column
  Given: The write fails
  Then:  The overlay stays open, an error toast fires, and no column is added — verify the board's
         column count and the on-disk view-document count are both unchanged
```

#### Omnibox create

```
TEST-64: The create row appears exactly when it should
  Then:  Hidden below 2 characters; hidden when a returned result's `title` equals the trimmed query
         case-insensitively; visible otherwise. Exact-title detection uses the RESPONSE — assert no
         extra request is issued for it. With zero results and no exact match the create row is the
         only row and starts highlighted

TEST-65: The create row's copy is the prototype's
  Then:  It reads `＋ Create "<query>" — opens ready to edit, in inbox/` with the query in a serif
         `<b>`, on `.sr-create` (`--accent-ink`, 600). The query is escaped — a query containing
         `<b>` renders literally

TEST-66: Creating lands in inbox and opens ready to type
  When:  The create row is activated
  Then:  `POST /api/docs` with `{type, title: <query>, folder: "inbox"}`; the overlay closes; the
         Inbox column scrolls into view and flashes; the document opens in that column with its
         title field focused **and its text selected** (assert the SELECTION, not just the focus —
         SPEC.md §10 says "ready to type"). Type immediately: the typed text REPLACES the title. On
         disk the file is under `data/docs/inbox/` and `git log -1` shows the auto-commit. This is
         SPEC.md §12 M3's omnibox-create check

TEST-67: Creation reuses UI-003's unit
  Then:  The create path calls the same named unit as the column `＋` (`useCreateInColumn` or the
         unit behind it), which sprint-009's TEST-21 required be factored for exactly this. A second
         creation implementation in `features/search/` is the failure this prevents

TEST-68: A title collision is the server's business, not the UI's
  Given: An inbox document already titled the same
  Then:  The create still succeeds, the server generates a unique id, and the UI does NOT dedupe or
         warn on titles

TEST-69: `[[`, `@` and `/` are literal text in the search input
  Then:  Typing them opens no autocomplete inside the overlay (the footer legend hints at composer
         behaviour, not overlay behaviour) and they are passed through to `q` as typed

TEST-70: The footer legend is the prototype's, verbatim
  Then:  `.search-foot` reads `↑↓ navigate`, `↵ open in its list`, `⇧↵ new list from search`, and
         right-aligned (`margin-left: auto`) `@ agents · / skills · [[ refs`, with the key glyphs in
         `<b>` on `--ink-2`, mono 10.5px, on `--surface-2`
```

---

### CONTRACT-012 + SERVER-027: `DocRow.unreadThreads` — one coupled commit

Ports `8970`–`8974`, primary `8972`. **14 criteria.** **These two issues are evaluated and committed
as a unit.** Adding a required field to `DocRow` breaks `apps/server`'s typecheck until the server
populates it, so a branch tip between the halves is red — the CONTRACT-011/SERVER-026 precedent
(`d0268db`). The contract lands first inside the commit; neither is verifiable alone.

```
TEST-71: The field is declared with semantics, not just a type
  Then:  `DocRow.unreadThreads` is a REQUIRED `z.number().int().min(0)` whose `.describe()` states:
         what it counts (this document's threads that are currently unread for the user, SPEC.md §7),
         that it is `0` for thread rows and for documents with no threads, that `0` therefore means
         "nothing unread" and never "unknown", and that it agrees with per-thread `unread` by
         construction. A description that omits the thread-row case is incomplete

TEST-72: The parentTitle rider is corrected
  Given: `packages/contract/src/schemas/query.ts:263-271` currently ends
         "…render such a thread as standalone rather than showing a raw id."
  Then:  That clause is replaced to match what the kit actually does — `threadRow.ts`'s `rowContext`
         returns `on <parentTitle>` or nothing, so the row renders an EMPTY context cell, never the
         word "standalone" and never a raw id. One line, in the same commit. The adjudication is
         written back into `issues/contract/012-unread-threads-rider.md`

TEST-73: The standing contract invariants hold
  Then:  `npm run generate -w packages/contract` is idempotent (run it TWICE from a clean tree, no
         diff either time); `node --import tsx scripts/check-generated-artifacts.ts` is green twice
         in a row for `openapi.json`, `schema.generated.ts` and `docs/cli.md`; `ENDPOINT_INVENTORY`
         is unchanged at 42 entries (this rider adds no route); and schema round-trip tests cover
         the new field

TEST-74: The downstream break list is measured, not guessed
  Then:  Before the server half lands, the contract agent records the exact `tsc` errors the new
         required field produces in `apps/server` (file:line list quoted). That list IS the server
         half's work item and the proof the coupling is real

TEST-75: The server computes it with the existing fragment, not a second definition
  Then:  SERVER-027 reuses `unreadSql`/`UNREAD_SQL` from `apps/server/src/docs/needs.ts` — the
         SERVER-021 precedent of one source of truth. A hand-written second copy of
         `t.last_ts > COALESCE(s.last_seen_ts, '')` inside `query.ts` is a fail even if it returns
         the right numbers

TEST-76: The value is correct across the cases that matter
  Given: A document with four threads: two unread, one seen fully, one marked seen at a `lastSeenTs`
         BEFORE its last turn (a partial read)
  Then:  `unreadThreads` is `3` — the partial read counts as unread, matching the contract's own
         definition ("turns after the mark"). Verified against the raw `GET /api/docs` JSON and
         against `?parent=<id>&type=thread&unread=true`'s item count for the same document

TEST-77: Thread rows and childless documents report 0
  Then:  Every row with `type: thread` carries `unreadThreads: 0` (a thread does not aggregate its
         children here), and a document with no threads carries `0` — not `null`, not absent

TEST-78: It is consistent with per-thread `unread`, always
  Then:  For a sampled workspace, for every document, `unreadThreads` equals the number of rows
         returned by `?parent=<id>&type=thread&unread=true`. Assert this as a property over several
         documents in one run, not on a single happy case

TEST-79: It moves live, in both directions
  When:  A thread of the document receives an agent reply, then is marked seen over HTTP
  Then:  `unreadThreads` increments and then decrements on the next `GET /api/docs`, and the SSE
         invalidation that announces it carries KEYS ONLY

TEST-80: There is no N+1 and no per-row subquery explosion
  Then:  The number of SQL statements per `GET /api/docs` is unchanged (still the page statement plus
         the COUNT). `EXPLAIN QUERY PLAN` output for the new subquery is QUOTED and shows the
         `threads_parent_id` index in use — not a full table scan per row

TEST-81: The cost is measured on a real corpus, not asserted
  Given: A seeded workspace of 500 documents with threads (SERVER-027's own AC)
  Then:  The p50 and p95 wall time of `GET /api/docs?limit=50` is stated BEFORE and AFTER the change,
         from the same seeded workspace, and the delta is reported. "No noticeable regression" is not
         a measurement

TEST-82: `db rebuild && db doctor` stays clean
  Then:  The standing §11 invariant holds after the change — this is a query-time aggregate, so the
         projection schema and `SCHEMA_VERSION` must be UNCHANGED. A projected column here would be
         derived state that can drift; say so in the log

TEST-83: UI-004's deferral is discharged, visibly
  Then:  `issues/ui/004-type-aware-rows.md`'s `DEFERRED → a filed CONTRACT issue` entry for TEST-49's
         aggregate unread is closed with the issue id, and `Row`'s `unreadCount` prop docblock (which
         currently explains why the wire cannot supply it) is corrected. Leaving a docblock that
         describes a solved problem is the FIND-3-class staleness sprint-009 caught

TEST-84: The commit is one commit
  Then:  `git log` shows a single commit prefixed `[CONTRACT-012][SERVER-027]` containing both halves,
         and `npm run build` + `npm run typecheck` are green AT that commit — verified by checking it
         out and running them, not by running them on a working tree that contains both
```

---

### UI-011: Console drawer — jobs master-detail, live logs, HALT

Ports `8975`–`8979`, primary `8977`; UI on `CORPUS_UI_PORT=5273`. **28 criteria.** **TEST-92 is gated
on Open Conflict 2** and **TEST-85 on Open Conflict 5** — settle both before writing code. The
layout is already correct in the shell; what UI-011 adds is a body, a data path, and one live e2e
assertion it must not break.

#### The collapsed strip

```
TEST-85: The health notice and the failed-job count coexist
  Given: `ConsoleStrip.tsx` renders `<span className="c-failed">server unreachable</span>` on health
         error, and `smoke.spec.ts:235` asserts `.console-strip .c-failed` has exactly that text
  Then:  Both the health notice and the failed-job count render correctly in the strip, and the
         shipped assertion passes unmodified OR is deliberately updated with the reason recorded
         (Open Conflict 5). A Playwright strict-mode violation from two `.c-failed` matches is the
         failure this catches, and it will not show up in unit tests

TEST-86: The strip is the prototype's, and clicking it toggles
  Then:  `.console-strip` is mono 11px, `padding: 7px 18px`, `user-select: none`, hover `--surface-2`,
         containing `.c-caret ▴` (rotating 180° when `.console.open`), the word `console`, the agent
         pill, the counts, a `.spacer`, and `.halt-btn` pinned right. Clicking anywhere on the strip
         toggles the drawer; the button inside it does not toggle it

TEST-87: The counts are formatted exactly as the prototype formats them
  Then:  `N running · N queued · N done · <span class="c-failed">N failed</span>`, where the queued
         segment is OMITTED when zero, and the failed count is in `--signal`. The numbers come from
         `GET /api/queue/status` — `inProgress` → running, `pending` → queued, `processed` → done,
         `failed` → failed. With no jobs at all the strip still renders `0 running · 0 done · 0 failed`

TEST-88: The agent pill is derived, not polled
  Then:  `working` (pulsing `--accent` dot) when `inProgress > 0`, `halted` when `status.halted`,
         `idle` otherwise; the text reads `agent: working · queue 2`. It comes from the SAME
         `GET /api/queue/status` + `GET /api/jobs` data as the counts — a separate poller or a new
         endpoint is a fail. This is the ONLY place agent/system status appears; nothing is added to
         the top bar (SPEC.md §10)

TEST-89: HALT is server state, both ways
  When:  `HALT ○` is clicked
  Then:  `POST /api/queue/halt` fires, `.corpus/HALT` EXISTS on disk, the button becomes `HALT ●`
         with `.halted` (signal wash, signal text, transparent border), the pill reads `halted`, and
         `corpus queue claim-all` returns empty. Click again: the sentinel is gone and claiming
         works. Then run `corpus queue halt` FROM THE CLI with the drawer open: the UI reflects
         `halted` via SSE with NO reload. Local-only halt state is the failure this catches
```

#### The drawer: push, resize, persist

```
TEST-90: Expanding pushes the board and never overlays it
  When:  The drawer is expanded
  Then:  The board's rendered height SHRINKS by the drawer's body height; the topmost board row stays
         visible and clickable; `getComputedStyle(.console).position` is NOT `fixed` or `absolute`;
         and the shipped `smoke.spec.ts:111` flex-grow assertion (`topbar 0 / board 1 / console 0`)
         still passes. `.console-body` defaults to `height: 210px` and `display: flex` when open

TEST-91: Drag resize clamps at both ends and the clamp survives a window resize
  Then:  A 5px `.console-resizer` (`cursor: ns-resize`, `role="separator"` with an accessible label,
         accent wash on hover and `.dragging`, hidden while collapsed) sets the body height to
         `clamp(startH + (startY - clientY), 120, innerHeight * 0.6)`. Drag past both limits and
         confirm it stops at 120px and 60vh. Then shrink the WINDOW below the stored height and
         confirm it re-clamps rather than squeezing the board toward zero. Arrow keys resize it too

TEST-92: Expanded state and height are sticky and isolated
  When:  The drawer is expanded, dragged to a height, and the browser reloaded
  Then:  It is still expanded at that height — SPEC.md §12 M3's "drawer height persists after
         drag-resize" check. State lives under its own key (`corpus.console`), NOT inside
         `corpus.board`, is read once on mount behind a schema guard, and a corrupted value falls
         back to defaults instead of throwing. With `throwingStorage()` the drawer still works from
         in-memory defaults
```

#### Master-detail

```
TEST-93: The job list is the prototype's, and the dot mapping is written down
  Then:  A `380px` `flex: none` `.job-list` with a right hairline; each `.job` row is a `.job-dot`,
         a sans 12px ellipsized `.job-title`, and a right-aligned mono `.job-meta`. The dot classes
         map from the wire's `pending | in-progress | processed | failed | abandoned` to the
         prototype's `pending | running | done | failed` — the full mapping including `abandoned`
         (Open Conflict 10) is stated in the E2E log, because it is a five-to-four mapping and the
         prototype has no fifth treatment

TEST-94: The job title is derivable from what the wire actually carries
  Given: `Job` is `{eventId, status, started, updated, lastLine, originId, originTitle}` — there is
         NO event `type` field (Open Conflict 2)
  Then:  The row's label follows the adjudication: either the contract gained a `type` field in a
         filed rider, or the row is labelled from `originTitle` with the deferral recorded. A label
         that invents an event type from the id, or that renders `undefined ·`, is a fail

TEST-95: Selection policy — newest by default, never stolen once chosen
  Then:  The newest job is auto-selected and takes `.job.sel` (accent wash) — exactly one row at a
         time. After the user clicks a different row, a NEWER job arriving does not steal the
         selection. If the selected job disappears from the list, selection falls back to the newest

TEST-96: The detail header carries status, title, link and the failed-only actions
  Then:  `.job-detail-head` (mono 11px, 8/14px padding, bottom hairline) shows a status dot, the job
         title, mono meta `<status> · started <time> · <eventId>`, an `↗ open` link when `originId`
         resolves, and — for `failed` jobs ONLY — Retry and Abandon buttons, as 1px `--line` pills
         that go accent on hover

TEST-97: `↗ open` reuses UI-009's hook and degrades when the target is gone
  Then:  It resolves `job.originId` (NOT a `payload` — there is none) and calls UI-009's
         `useOpenInColumn`: the board scrolls that column into view, flashes it, and opens the
         document (or thread) in its reader. When `originId` is null or no longer resolves, the link
         renders DISABLED with a tooltip rather than disappearing

TEST-98: With no jobs, the detail pane says so
  Then:  `.job-empty` renders exactly `No jobs yet — agent activity will stream here.` in `--ink-3`,
         20px padding, and the job list is empty rather than showing a skeleton row
```

#### The live log

```
TEST-99: The log is fetched over HTTP and refetched on invalidation — never streamed
  Given: SPEC.md §2.2 rule 3, §7, §10 and §12 M5, `JobSchema`'s docblock, and `jobs/service.ts`'s
         "The append deliberately broadcasts nothing" (Open Conflict 1)
  When:  `corpus job log <eventId> "reading thread context"` is run from a terminal
  Then:  The line appears in the selected job's pane within ~a second. The mechanism is verified,
         not just the outcome: a parallel `curl -N /events` capture shows ONLY `invalidate` frames
         carrying keys — grep the capture for the log line's text and quote the empty result — and
         the network panel shows a `GET /api/jobs/{id}/log?cursor=<n>` refetch. This is SPEC.md §12
         M4's console check

TEST-100: The cursor is what prevents duplicates
  When:  Twenty lines are emitted, then the SSE connection is dropped and reconnected mid-stream
  Then:  Each line appears EXACTLY once. The refetch passes the previously returned `nextCursor` and
         receives only new lines. A client-side line-diff or a full re-read on every invalidation is
         a fail — `nextCursor` "equals the total line count" and exists for this

TEST-101: ERR lines are classified at render time
  Then:  A line containing `ERR` takes `.err` (`--signal`); classification happens at render, not
         stored on the line. `.job-log-lines` is mono 11px, `--ink-2`, 10/16px padding, line-height 1.8

TEST-102: Auto-scroll pins to the bottom without ever yanking the user
  Then:  `pinned = scrollHeight - scrollTop - clientHeight < 24`. While pinned, appends scroll to the
         bottom. Scroll UP mid-stream: new lines arrive and the viewport does NOT move. Scroll back
         to the bottom: pinning resumes. `scrollIntoView` is not used (it perturbs a short drawer)

TEST-103: A chatty job does not melt the pane
  When:  ~50 lines are emitted rapidly, then a burst large enough to exercise the buffer cap
  Then:  Appends are batched per animation frame (not one render per line), the rendered buffer is
         capped with a visible "…truncated" head marker, and the pane stays responsive. A single
         very long line WRAPS or scrolls within the pane and never widens the drawer or the page

TEST-104: The log's own caps are surfaced honestly
  Given: The server caps a line at 8 KB (appending ` …[truncated]`) and a file at 4 MB, after which
         `AppendLogResult.appended` is `false` while the call still answers 201
  Then:  The E2E log states which of these were exercised and what the UI shows. The UI must never
         imply a dropped line was written

TEST-105: A collapsed drawer consumes nothing
  Then:  With the drawer collapsed, no `GET /api/jobs/{id}/log` request is issued and no per-job
         subscription is held (verify in the network panel / EventSource inspector). Expanding starts
         it; collapsing stops it

TEST-106: A job completing while selected updates in place
  When:  The selected job moves from in-progress to processed
  Then:  Its dot and the header meta update without losing the log's final lines and without the
         selection jumping
```

#### Failed jobs, Attention, and the loop

```
TEST-107: A failed job turns red in three places at once
  When:  `corpus queue fail <eventId>` runs with the drawer open
  Then:  The job row's dot and the row turn `--signal`, the strip's failed count increments in
         `--signal`, and an Attention row appears with a reason chip — all with NO reload

TEST-108: Retry clears the Attention row live
  When:  Retry is pressed in the detail header
  Then:  `POST /api/jobs/{id}/retry` fires, the job re-enters the queue (verify `.corpus/queue/`),
         AND the Attention row disappears without a reload. Verify the invalidation reaches BOTH the
         jobs query and the `needs=me` query — assert it, do not trust a blanket invalidation

TEST-109: Abandon does the same, and the detail pane recovers
  When:  Abandon is pressed
  Then:  `POST /api/jobs/{id}/abandon` fires, the job leaves failed/running, its Attention row clears
         live, and the detail pane falls back to the newest remaining job rather than rendering empty
         while a list still has rows

TEST-110: Retrying a reaped job surfaces the server's error
  Given: A job whose event was already reaped
  Then:  The server's error is shown as a toast and the list refreshes — no silent failure, no
         optimistic row that never comes back

TEST-111: The console is keyboard-reachable
  Then:  The strip is `role="button"` with `tabindex` and toggles on Enter and Space; the resizer is
         a `role="separator"` with an accessible label and arrow-key resizing; the job list is
         navigable. The shipped focus-ring rule in `global.css:42-48` applies without a new one

TEST-112: The pulsing dots respect reduced motion
  Then:  `.job-dot.running` is ADDED to the existing guard in `apps/ui/src/app/global.css:61-72`
         (which already covers `.agent-pill .dot.busy`) rather than a new `@media` block elsewhere.
         Under `reducedMotion: "reduce"` both compute to `animation-name: none`
```

---

## Cross-Issue Tests

Port `8982`, one `corpus init` workspace, zero stubs, real browser, real server, real CLI.
**14 criteria.** These exist because this is the first sprint where the board, the reader, the
search overlay and the console are all on screen at once, sharing one keyboard and one shell.

```
TEST-113: Search → reader → back is one continuous act
  Given: A real workspace on 8982 with the seed columns and real documents
  When:  ⌘K, a query, ↵ on a result
  Then:  The overlay closes, the column flashes and scrolls in, the reader opens the document, and
         Back returns to that column's LIST — the three issues' surfaces hand off without a reload,
         a flicker, or a lost scroll position. Quote the network log for the whole sequence

TEST-114: One escape chain, three registrants, no conditionals
  Given: The console expanded, a document open in a reader, focus mode over it, the search overlay
         over that, and a ⋯ menu open
  When:  Escape is pressed repeatedly
  Then:  Layers close in SPEC.md §10's order — overlay, then focus, then the column reader — with
         menus and popovers closing before their host. Every layer registered into one registry
         (TEST-35); grep for a hard-coded `if (overlayOpen) … else if (focusOpen) …` and quote the
         empty result

TEST-115: The console's ↗ open and search's ↵ are the same code path
  Then:  Both go through `useOpenInColumn` with the same resolution precedence (TEST-57), and
         `apps/ui/src` contains exactly ONE implementation of scroll + flash + open. UI-010 inherits
         it; a second copy here is the divergence this catches

TEST-116: The aggregate unread badge closes its loop end to end
  Given: A document with three threads, two unread, visible as a row on the board
  When:  One thread is opened in a column reader
  Then:  Its own badge clears, the parent row's aggregate pill goes from 2 to 1 with NO reload, and
         `GET /api/docs`'s `unreadThreads` for that document agrees. Then open the PARENT document:
         the remaining count does NOT change. This is CONTRACT-012 + SERVER-027 + UI-004's seam +
         UI-005's read-state rule proven together, and it is the whole point of the coupled commit

TEST-117: A failed job is one thing seen from three surfaces
  When:  A job fails
  Then:  The console's job row, the strip's failed count, and the Attention column's row with its
         `failed-job` reason chip all describe the same event; retrying from the console clears all
         three live. Sprint-009's TEST-127 recorded `failed-job` as unit-verified only — this is
         where that coverage gap closes

TEST-118: The board still works with the console expanded
  Then:  With the drawer at 60vh, columns still scroll horizontally and snap, a reader still opens
         at 560px, rows are still clickable, and the search overlay still centres correctly at
         `7vh`. The board being pushed must not make any of it unreachable

TEST-119: The production-served board carries all of it
  Given: `npm run build -w apps/ui`, then `corpus server start`
  When:  The board is opened at the URL the server prints — no Vite, no env var
  Then:  Reader, search overlay and console all work against real data with the injected token
         (SERVER-024's mechanism). This is what an installed user gets, and it is the environment
         the whole UI evaluation should prefer

TEST-120: No document content ever crosses the SSE stream
  When:  The full `/events` capture from TEST-113…117 is grepped
  Then:  Zero matches for any document title, body text, turn body, anchor quote, search snippet,
         job log line or attachment filename. Every frame is `event: invalidate` with `keys` only.
         The job-log capture from TEST-99 is included in the grep — this is the sprint where a
         "live log stream" makes rule 3 easiest to break

TEST-121: Generated artifacts green at the tip
  When:  `node --import tsx scripts/check-generated-artifacts.ts` runs on the phase branch tip
  Then:  Green TWICE IN A ROW for `openapi.json`, `schema.generated.ts` and `docs/cli.md`

TEST-122: The whole repo gate is green at the tip
  When:  `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck` and `npm test`
         run on the phase branch tip — as the ORCHESTRATOR's single harvest run, not duplicated by
         any agent or by the evaluator
  Then:  All pass. The test-file count is stated with the command that produced it and compared to
         today's 241 (server 111, cli 51, contract 34, ui 24, kit 18)

TEST-123: The merged coverage gate holds with three large UI features in it
  When:  `npm run coverage` runs on the phase branch tip
  Then:  All four metrics at or above 90. Per-workspace numbers are recorded, and
         `coverage/merged/e2e-attribution.json` is inspected to say whether the new e2e specs
         contributed anything. `apps/ui/src/reader/**`, `features/search/**` and `features/console/**`
         are in the gate automatically — this is where a sprint of branchy UI code slips

TEST-124: e2e green at the tip with the reserved ports respected
  When:  `CORPUS_UI_PORT=5273 npm run e2e` runs with nothing bound on 8765
  Then:  All specs pass — the 20 shipped plus whatever `reader.spec.ts`, `search.spec.ts` and
         `console.spec.ts` add — and the `"server unreachable"` assertion still holds, which is only
         true if 8765 is free (confirm with `lsof` and say so). Both smoke assertions UI-011 could
         break (flex-grow, collapsed height) pass, and the corrected "inert affordances" spec
         (TEST-46) is honest about what is now wired

TEST-125: The three artifacts the next issues depend on are written down
  Given: UI-006, UI-007, UI-008 and UI-010 all consume this sprint
  Then:  The E2E logs carry, verbatim: the kit's newly added `CorpusClient` methods and hooks; the
         `DocView` / body-render seam UI-006 replaces and where its single call site is (TEST-33);
         and `useOpenInColumn`'s resolution precedence (TEST-57). The next issues consume a written
         contract rather than reading `dist/index.d.ts`

TEST-126: Nothing left running and the repo is clean
  When:  The sprint closes
  Then:  Nothing bound in `8960`–`8984`, nothing on `8765`, nothing on `5273`, no orphaned Vite or
         Playwright children, no stray `vitest` workers (`ps aux | grep [v]itest`), every
         `/tmp/corpus-s010-*` path created here removed BY NAME, and `git status` clean in every
         worktree and in the Corpus repository. Each issue's E2E log states which model the
         implementing agent ran on ("implemented on: opus | fable")
```

---

## Out of Scope

- **The TipTap editor.** UI-006. Nothing in this sprint edits a document BODY. UI-005 renders the
  body read-only through `MarkdownView` and leaves the `.save-chip` slot present and empty; UI-006
  replaces the body renderer at the one call site TEST-33 pins. No autosave, no markdown shortcuts,
  no selection toolbar, no §4 commit squashing.
- **Anchored threads in the reader.** UI-007. No highlights, no `.anchor-hl`, no `.anchor-pip`, no
  margin cards. UI-005 ships the `.focus-inner.with-margin` grid SEAM and renders the collapsed
  inline path; the Docs-style margin placement is UI-007/UI-008's.
- **The thread view proper.** UI-008. UI-005 renders a thread's turns as a readable body; the
  composer, attachments, form CONTROLS, per-turn deletion and child threads are not built.
- **The global Ask/Capture composer and the full keyboard scheme.** UI-010. This sprint adds ⌘K
  (UI-009), the overlay's own keys, and the reader's Escape/Back — not `c`, `j`/`k`, `↵` from the
  board, `f`, `e`, `r`, `?`, or `⇧↵`-as-open-in-full-screen. UI-009 exposes the "an overlay is open"
  signal UI-010 will consume and nothing more.
- **The keyboard cheat-sheet overlay** (`?`). UI-010.
- **The plugin registry.** PLUGINS-001. `Row`'s `ListItem` seam and the `DocPanel` slot are not wired
  here; a plugin `View` renderer for the reader is PLUGINS-001's.
- **The publish plugin.** SPEC.md §13. Copy for Google Docs and Push update are the plugin's; see
  Open Conflict 7 for what, if anything, core renders in the meantime.
- **Changing the SSE key vocabulary.** Closed. `jobKey` already exists; a console that needs a new
  key is a design error, not a contract change.
- **Streaming anything over SSE.** SPEC.md §2.2 rule 3 is absolute and this sprint does not test its
  boundaries — it obeys it (Open Conflict 1, TEST-99, TEST-120).
- **Projecting `unreadThreads` into SQLite.** SERVER-027 is a query-time aggregate; the projection
  schema and `SCHEMA_VERSION` do not change (TEST-82).
- **New routes of any kind.** `ENDPOINT_INVENTORY` stays at 42. Everything this sprint needs is
  mounted. Open Conflicts 2 and 3 may produce a filed CONTRACT rider for a FIELD or a PARAMETER —
  neither adds a route.
- **`corpus doc check`, `corpus skill rollback`, and any new CLI verb.** Phase 4.
- **An error boundary.** Still absent, still nobody's in this batch — SPEC.md §10 requires one per
  plugin column, which is PLUGINS-001's. If a UI agent adds one opportunistically it says so.
- **Rewriting the e2e suite to drive a real server.** Still the standing recommendation from
  sprint-009's Open Conflict 12, still not a requirement. If declined, the reason is recorded.
- **Packaging.** INFRA-008.

---

## Integration Points

**`packages/kit` produces → all three UI issues consume, and two of them must write it.**
The kit has eleven read/write hooks today (listed in Runtime gotchas). The additions:

```
Needed by UI-005:  breakLock (POST /api/locks/{docId}/break)
                   deleteDoc (DELETE /api/docs/{id})
                   archiveDoc / unarchiveDoc (POST /api/docs/{id}/archive|unarchive)
                   resolveThread / reopenThread (POST /api/threads/{id}/resolve|reopen)
                   markThreadSeen (POST /api/threads/{id}/seen)
                   MarkdownView + the [[ref]] helpers (SPEC.md §10 names MarkdownView)
Needed by UI-011:  queueStatus (GET /api/queue/status)
                   haltQueue / resumeQueue (POST /api/queue/halt|resume)
                   retryJob / abandonJob (POST /api/jobs/{id}/retry|abandon)
                   jobLog (GET /api/jobs/{id}/log?cursor=)
Needed by UI-009:  nothing new — useCreateDoc, useTree and useDocs already cover it
Shared:            all land as named CorpusClient methods + named hooks exported from
                   packages/kit/src/index.ts, following useAppendTurn's and useUpdateDoc's shape.
Collision:         packages/kit/src/index.ts and client/createCorpusClient.ts are edited by BOTH
                   UI-005 and UI-011. The additions are disjoint in content and adjacent in the
                   file — rebase those two files rather than serializing the issues.
```

**UI-005 produces → UI-009 and UI-011 consume.** Both need a reader to open a document INTO.
`ColumnReaderScaffold` can absorb `↵` and `↗ open` in the interim (it already takes a `docId` and
sets `.reading`), so neither is hard-blocked — but the composed criteria TEST-113 and TEST-115 are
only satisfiable once UI-005 lands, and the E2E log records which of the two states it verified in.

**UI-009 produces → UI-011 consumes, and this dependency is not in the issue file.**
`useOpenInColumn` (`apps/ui/src/features/board/useOpenInColumn.ts`) is built by UI-009 and called by
UI-011's `↗ open`. UI-011's declared dependencies are UI-002 and SERVER-009 and do **not** mention
UI-009. **Add the dependency to `issues/PLAN.md`**, or accept that UI-011 stubs it and the stub is
replaced — say which, in writing.

**UI-005 produces → UI-009, UI-011 and UI-010 consume.** The escape layer registry (`useEscapeStack`).
UI-009's overlay and UI-011's drawer both register into it; UI-010 adds two more layers. UI-005 owns
its shape and the E2E log states the registration API, because three later issues call it.

**CONTRACT-012 produces → SERVER-027 consumes, in the same commit.** The read side:

```
DocRow gains: unreadThreads: number (required, >= 0)
              0 on thread rows and on documents with no threads — never null, never absent
              equals |{threads whose parent is this doc AND whose last turn is newer than the mark}|
              computed with the SAME unreadSql fragment the per-thread `unread` flag uses
Invariant:    no new route, no projection column, no SCHEMA_VERSION bump, no second SQL definition.
Break list:   the required field breaks apps/server's typecheck; that list IS the server's work item
              (TEST-74) and the reason the two land as one commit.
```

**CONTRACT-012 + SERVER-027 produces → UI-004's shipped seam consumes, with no UI work in this batch.**
`Row` already takes `unreadCount` and already renders `<UnreadBadge count={unreadCount} />` when
`row.unread === true`. **Wiring `unreadCount={row.unreadThreads}` at the `ColumnList.tsx` call site
is a one-line change** — assign it explicitly (UI-005 is the UI agent already in that file) rather
than leaving the field populated on the wire and unused on screen, which would make TEST-116
unverifiable.

**UI-003 produces → UI-009 consumes.** `useCreateInColumn` is the creation unit sprint-009's TEST-21
required be factored for exactly this reuse (TEST-67). `Board.tsx`'s `scrollTo` effect is the
scroll-into-view UI-009 reuses (TEST-56).

**UI-004 produces → UI-005 consumes.** `useRowActions`' `archive` and `stillCurrent` are the ⋯ menu's
two mutations, already shipped and already verified on disk (TEST-14).

**The shell is a shared file and three issues touch it.** `Shell.tsx` / `Shell.css` (UI-011's flex
body), `global.css`'s reduced-motion guard (UI-005's flash, UI-011's `.job-dot.running` — both EXTEND
the existing block, neither re-declares it), and `Topbar.tsx` (UI-009's ⌘K wiring). Small, adjacent,
rebasable — but the guard block is the one where two edits to the same six lines will conflict.

**Nobody but the contract agent touches `packages/contract`** (§9.3, restated from sprints 008 and
009). Open Conflicts 2 and 3 both describe changes that must be **filed as CONTRACT riders** rather
than improvised by a UI agent.

**`apps/ui/e2e/smoke.spec.ts` is shared and two issues must edit it** — UI-009 corrects the
"inert affordances" test (TEST-46), UI-011 may need to touch the `.c-failed` assertion (TEST-85).
Coordinate; do not let two agents rewrite the same spec in parallel worktrees.

---

## Merge order (recommendation)

1. **Adjudicate Open Conflicts 1, 2, 3, 4 and 5 first.** 1 and 4 shrink UI-011 and UI-009 before they
   start (both are "the shipped code already decided this"). 2 and 3 may produce filed CONTRACT
   riders and block one criterion each. 5 is a shipped e2e assertion that will fail in UI-011's first
   e2e run and cost a cycle to diagnose. None is discoverable cheaply mid-implementation.
2. **CONTRACT-012 + SERVER-027 immediately, as one agent pair on one commit.** It is small, it is
   file-disjoint from everything else in the batch (`packages/contract/src/schemas/query.ts` and
   `apps/server/src/docs/query.ts`), and it unblocks TEST-116. The phase branch must not sit red
   between the halves, so the contract agent hands the break list (TEST-74) to the server agent
   rather than committing alone.
3. **UI-005 next, and give it room.** It owns the reader, `DocView`, the escape registry, the nav
   stack, the `BOARD_STATE_VERSION` bump and half the kit's new surface. It replaces
   `ColumnReaderScaffold.tsx`. It is the largest issue in the batch and the one three later issues
   inherit from.
4. **UI-009 in a worktree, starting as soon as UI-005's reader-open API is settled** — most of it
   (`searchQuery.ts`, the panel, chips, results, the create row) is independent and testable against
   the scaffold. Only `↵`-into-a-reader and the escape registration need UI-005.
5. **UI-011 in a worktree, in parallel with UI-009**, accepting that `↗ open` is stubbed until
   `useOpenInColumn` lands. Its kit additions are disjoint from UI-005's in content; rebase
   `packages/kit/src/index.ts`.
6. **Only one of UI-005 / UI-009 / UI-011 holds `5273` and runs `npm run e2e` at a time.** Three
   claimants, one resource, and `reuseExistingServer: false` makes a collision loud but still costs a
   run. The orchestrator schedules the three e2e runs; agents do not race for it.
7. **Cap concurrent implementation agents at three** and stagger their launches so their end-of-
   session workspace test runs do not collide (CLAUDE.md's machine-load discipline).
8. **Cross-issue tests (TEST-113…126) after everything**, on 8982, preferably against the
   production-served board (TEST-119).

The batch splits into three workspaces — `packages/contract` + its server consumer (one coupled
commit), and `apps/ui` + `packages/kit` (×3, overlapping on two files and one CSS block). The
genuinely serialized edges are: UI-005 → UI-009's `↵`, UI-009 → UI-011's `↗ open`, and
CONTRACT-012 → SERVER-027 → TEST-116.

---

## Open Conflicts — orchestrator decision required before implementation

### 1. UI-011's live log stream contradicts the spec, the contract and the server (**resolution is unambiguous; the issue file needs correcting**)

UI-011's Technical Design says the log pane *"subscribes to the SSE stream's job-log events filtered
to that job id, appending to a local buffer"*, and its acceptance criteria say *"then appends lines
arriving over SSE"*. Four independent sources say otherwise:

- **SPEC.md §2.2 rule 3**: *"The server never pushes data over SSE — only `invalidate` events carrying
  query keys. … **This includes job logs**: the console fetches and refetches log content over HTTP;
  SSE only announces that a job's log grew."*
- **SPEC.md §7**: *"The server tails these files and broadcasts **invalidations only** (§2 rule 3) —
  the console fetches and refetches the log content over HTTP."*
- **SPEC.md §10 and §12 M5**: *"fetched over HTTP and refetched on SSE invalidation"* /
  *"lines emitted via `corpus job log` appear in the console row for that job (fetched over HTTP on
  invalidation)"*.
- **The shipped code**: `JobSchema`'s docblock (*"fetched over HTTP — SSE only announces that the log
  grew"*), `JobLogQuerySchema`'s docblock (*"The cursor makes that refetch incremental"*), and
  `jobs/service.ts` (*"The append deliberately broadcasts **nothing**"*).

**Recommendation**: the spec wins; there is nothing to weigh. `useJobLogStream` becomes a cursored
refetch keyed on `jobKey(eventId)` invalidation. **Write the correction back into
`issues/ui/011-console-drawer.md`** — including the `↗ open` payload error (Conflict 2) — so the
implementing agent is not reading a design the codebase forbids. TEST-99 and TEST-100 encode the
correct mechanism and TEST-120 polices it.

### 2. `Job` carries no event type, and both the prototype and SPEC.md ask for one (**P1, blocks TEST-94**)

The prototype's job row is `<event type> · <title>` and SPEC.md §10 describes the job list as
*"status dot, event, one-line state"*. The wire carries
`{eventId, status, started, updated, lastLine, originId, originTitle}` — **no event type**, and no
`payload` to derive one from. The queue's own event files have `type` (`comment.created`,
`form.respond`, `agent.done`), and `events(id, type, status, created, payload_json)` is projected —
so the data exists in the projection and simply does not ride the `Job` row.

Three options, in descending order of my preference:

1. **File a CONTRACT rider adding `Job.type`** — exactly the CONTRACT-012 pattern, one field, one
   projection column already present, no new route. It also makes the strip's counts groupable later.
2. **Label the row from `originTitle` alone** and record `DEFERRED → <a filed CONTRACT issue>`,
   accepting that the console cannot say what KIND of work a job is — which is most of the value of
   the list when several jobs are running.
3. Derive it client-side from the payload. **Not available** — there is no payload on the wire.

This is the same shape as sprint-009's Open Conflict 6 (`parentTitle`) and CONTRACT-012 itself, both
of which were resolved by option 1.

### 3. "Include archived" cannot be expressed, and the chip's label promises a union (**P0 for UI-009's TEST-52**)

SPEC.md §10: *"Default state excludes `status: archived`; an 'archived' chip brings them back."*
The prototype's chip reads **`include archived`** (`.chip.warn`), which reads as a union.

The contract and server implement a narrowing, not a union.
`DocsQuerySchema.status` is `z.enum(DOC_STATUSES)` — one value, no comma-OR, no negation — and
`docs/query.ts:155-161` is literally
`query.status === undefined ? "d.status <> 'archived'" : "d.status = @status"`. So `status=archived`
returns **only** archived documents. There is no parameter value that means "open + resolved +
archived".

Options:

1. **Relabel the chip to what it does** — `archived only` — and note the divergence from the
   prototype's copy. Zero code, honest, but it is not what §10's sentence describes.
2. **File a CONTRACT rider** widening `status` (a repeatable parameter, or an explicit
   `includeArchived` boolean). This is what makes the prototype's chip true and is a one-parameter
   change with no new route.
3. Issue two requests and merge client-side. **Forbidden** — TEST-47/48 and SPEC.md §10's "all
   through the single `GET /api/docs` endpoint".

Whatever is chosen, TEST-52 requires the chip's LABEL and its BEHAVIOUR to agree. Note this also
affects save-as-view: `toViewFrontmatter` must round-trip whichever representation is chosen, so a
column saved from a search inherits the same default (TEST-59).

### 4. UI-009's snippet sanitization criteria describe a contract that was deliberately not built

Two of UI-009's acceptance criteria require rendering server snippet HTML with a `<mark>` allowlist,
and its testing strategy asks for a `Snippet.test.tsx` proving `<script>` and `onerror` are stripped.
`SnippetSchema` ships `{field, threadId?, segments: [{text, match}]}` and says why:
*"Structured rather than marked-up HTML so the UI renders highlights without
`dangerouslySetInnerHTML` and without an escaping contract between server and client."* The server
delimits with `U+0002`/`U+0003` internally and strips them at the wire boundary.

**Recommendation**: strike the sanitizer criteria and replace them with TEST-49 (segments → React
`<mark>` elements, zero `dangerouslySetInnerHTML` in `apps/ui/src`) and TEST-50 (markup-looking text
renders literally). This makes the issue **smaller**, and the safety property stronger — there is no
sanitizer to get wrong. Write it back into `issues/ui/009-search-overlay.md`.

### 5. `.c-failed` means two things in one strip, and a shipped e2e assertion is about to break (**cheap to fix, expensive to discover**)

`ConsoleStrip.tsx` renders the health failure as `<span className="c-failed">server unreachable</span>`.
`smoke.spec.ts:235` asserts `page.locator(".console-strip .c-failed")` has exactly that text.
UI-011's counts add a second `.c-failed` span to the same strip for the failed-job count. Playwright
strict mode will fail on two matches — in an e2e run, not in a unit test, after the implementation
looks finished.

There is also a design question underneath it: **SPEC.md §10 says the console strip is the single
home of agent/system status.** Once UI-011 owns the strip, is "server unreachable" a third thing the
strip says, or does it become the agent pill's `unreachable` state?

Options: give the health notice its own class (`.c-unreachable`) and narrow the spec's locator; or
fold it into the agent pill and update the spec to match. Either is fine; **deciding it after the
e2e run fails is what costs a cycle.**

### 6. `[[ref]]` title resolution has no batch mechanism (**non-blocking; needs a stated strategy**)

UI-005's Technical Design says to *"batch the lookups for a body rather than firing one query per
ref"*. `DocsQuerySchema` has no `id`/`ids` filter, so there is **no way to ask for N documents by id
in one request**. What is available: the column's list response already carries titles for documents
in that column; TanStack Query dedupes `useDoc(id)` by key, so repeated refs to the same document
cost one request; and unresolved refs are detected by a 404.

This is materially different from the N+1 sprint-009's TEST-66 forbade (one request **per row of a
list**, growing with the list). Here it is bounded by the distinct refs in the one document the user
is looking at.

**Recommendation**: accept per-ref `useDoc` with cache dedupe now, require TEST-12 to state the
request count and the strategy in the E2E log, and file a CONTRACT rider **only if** a realistic body
proves pathological. Do not let this block UI-005.

### 7. The prototype's ⋯ menu contains two publish-plugin items, and core owning them is a §10 question

The prototype's `toggleDocMenu` renders, for `type === "note"` only, **Copy for Google Docs**
(*"rich HTML via the style map — paste keeps formatting"*) and **Push update to Google Doc…**
(*"user-only diff sync — untouched Doc comments survive"*). UI-005's issue file mentions only the
first, and says to render it inert with an explanatory sub-label.

SPEC.md §13 says *"the ⋯ menu **gains** Copy for Google Docs, Push update…, Pull comments, and Link
existing Doc"* — i.e. the publish PLUGIN adds them. SPEC.md §10 says *"The core must not import from
any plugin except through these discovery mechanisms."* Rendering a hardcoded, inert, plugin-named
menu item in core is not an import, but it is core knowing a plugin's name.

Options: (a) render neither and let the plugin add them through the manifest later — cleanest against
§10, diverges from the prototype; (b) render one inert with a sub-label naming §13, as the issue file
says; (c) render both inert. **This is cheap either way and only needs deciding once** — TEST-16
takes whichever answer.

### 8. Extending the board's local state discards every user's current scroll and open readers

`useBoardLocalState` is versioned (`BOARD_STATE_VERSION = 1`) and *"an older blob degrades to
defaults"*. UI-005 must store a per-column nav stack of `{docId, scrollY}` plus focus-mode state, so
the version goes to 2 and every existing `corpus.board` blob is discarded on first load.

At this stage of the project that is plainly fine — but it should be a **decision** rather than a
side effect noticed later, and the version bump belongs in the same commit as the shape change.
TEST-30 also re-checks the file's own review-blocking rule: no query, no order, no column identity
and no document content in that blob.

### 9. One chord, two meanings, and a keyboard scheme that arrives in UI-010

`⇧↵` means **"new list from search"** inside the overlay (the prototype's footer legend, UI-009's
TEST-61) and **"open the highlighted document directly in full screen"** on the board (SPEC.md §10's
keyboard scheme, UI-010's). Both are correct in their own scope, but only if overlay scope strictly
precedes board scope — which is TEST-58's "while the overlay is open it owns the keyboard".

Related: the reader's `Escape` and `⌫` behaviour, the shipped `ColumnReaderScaffold`'s own Escape
handler (which reverts a title draft), and UI-010's future layers all want one precedence chain.
**UI-005 owns the registry (TEST-35); confirm that assignment before three issues each write their
own handler.**

### 10. Five job statuses, four prototype dots

The wire's `QueueEventStatus` is `pending | in-progress | processed | failed | abandoned`. The
prototype has `.job-dot.pending` (sepia), `.running` (pulsing accent), `.done` (good) and `.failed`
(signal). **`abandoned` has no treatment**, and `in-progress`/`processed` need explicit mapping to
`running`/`done`. UI-004 hit the same shape with reason codes (five server codes, six prototype
labels) and resolved it by writing the mapping table into its E2E log and using a neutral treatment
for the unmapped case — **the same resolution works here** (TEST-93), but it should be decided rather
than improvised.

### 11. The focus-mode hint tells the user to do something UI-006 has not built

The prototype's `.focus-hint` reads `esc closes · click anywhere to edit`. Until UI-006 lands there
is no editing — clicking anywhere does nothing. UI-005's own AC asks only for *"an 'esc closes' mono
hint"*, which suggests the author already noticed.

**Recommendation**: ship `esc closes` alone, and record that the second clause arrives with UI-006.
Trivial, but it is the class of thing that ships as a lie and survives three sprints.

### 12. Three UI agents, one Vite port, one e2e suite

`playwright.config.ts` sets `reuseExistingServer: false` with `--strictPort`, so `5273` is
single-holder and a collision fails loudly. Sprint-009 had two claimants and coordinated through the
orchestrator; this sprint has three, each of which wants a `reader.spec.ts` / `search.spec.ts` /
`console.spec.ts` run. Combined with the machine-load rules (one heavy command at a time, cap three
concurrent agents), **the orchestrator should schedule the three e2e runs explicitly** rather than
letting agents discover the contention. This is a logistics decision, not a technical one, but it is
the one most likely to burn wall-clock time.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above has a verdict** in the evaluator's report — PASS, or
  `STRUCK → Open Conflict N` / `DEFERRED → <issue>` with the reason and substitute evidence recorded.
  Silent omission is a fail.
- **Every Open Conflict was adjudicated before implementation started**, and each adjudication is
  written back into the issue file it affects — not only into this contract. Conflicts 2 and 3 either
  produce filed CONTRACT riders with numbers in `issues/PLAN.md` or produce a recorded, reasoned
  narrowing. Conflicts 1 and 4 correct stale issue-file text before the agent reads it.
- **The reader is a reader**: a document opens in its column (TEST-1), `[[refs]]` render their
  target's current title and update on rename (TEST-9), backlinks list the referrer (TEST-13), the
  nav stack restores scroll exactly (TEST-26), and focus mode keeps its own stack (TEST-34). Without
  these five, UI-006/007/008 have nothing to build on.
- **The two destructive/irreversible acts are provably correct**: Delete arms before it fires, is
  user-only, and leaves git history intact (TEST-17, TEST-18, TEST-19); and Still current writes
  `reviewed` while leaving `updated` byte-identical (TEST-15) — the criterion whose failure is
  invisible and permanent.
- **Force unlock's toast is true in both of its claims** (TEST-37), verified in `git log` and
  `.corpus/queue/pending/` rather than asserted from the UI.
- **Search is one endpoint, composed** (TEST-47, TEST-48), snippets render without any HTML injection
  path (TEST-49, TEST-50), save-as-view produces a real committed view document a second browser
  agrees with (TEST-60), and omnibox create lands in `inbox/` and opens title-SELECTED (TEST-66) —
  SPEC.md §12 M3's two named checks.
- **The console pushes, persists and streams honestly**: the board is pushed not overlaid (TEST-90),
  the dragged height survives a reload (TEST-92 — §12 M3's named check), log lines arrive over HTTP
  on invalidation with the cursor preventing duplicates (TEST-99, TEST-100 — §12 M4's named check),
  and HALT is server state in both directions (TEST-89).
- **No shipped e2e assertion is broken or left dishonest** (TEST-46, TEST-85, TEST-124).
- **`unreadThreads` lands as one commit that is green at that commit** (TEST-84), agrees with
  per-thread `unread` as a property (TEST-78), costs measured query time on a 500-document workspace
  (TEST-81), and is actually wired to the pill so TEST-116 can be verified.
- **Each issue's E2E Verification Log is filled with concrete evidence** — actual commands, actual
  output, actual file/git/sqlite/SSE/browser state — and states which model the implementing agent
  ran on (TEST-126).
- **The logs carry the three artifacts the next issues depend on** (TEST-125): the kit's added
  surface, the `DocView` body-render seam and its single call site, and `useOpenInColumn`'s
  resolution precedence.
- `npm run build` succeeds in dependency order; `/lint` passes (ESLint, Prettier, `tsc --noEmit`
  across all workspaces); `/test` passes with no regressions against the **241-file** baseline —
  as the orchestrator's single harvest run (TEST-122).
- **The merged coverage gate is green at 90 % on all four metrics** (TEST-123), with
  `coverage/merged/e2e-attribution.json` inspected rather than assumed.
- `CORPUS_UI_PORT=5273 npm run e2e` passes with **nothing bound on 8765** (TEST-124).
- `node --import tsx scripts/check-generated-artifacts.ts` is green **twice in a row** (TEST-121).
- **`/audit` has been run on UI-005** (P0, largest surface in the batch, includes a destructive
  user-only action and a lock-breaking escape hatch) and **on UI-009** (P0, creates corpus state from
  user input and is the omnibox creation path).
- **Any user-observable behavior change carries its SPEC.md amendment**, drafted by spec-writer and
  held for user sign-off at the phase PR — SHARED-002's adopted process rule. In this batch the
  candidates are Conflict 3's archived-chip semantics (§10's sentence is what is ambiguous) and, if
  adjudicated that way, Conflict 7's plugin-menu placement.
- **pr-reviewer verdict APPROVE** on the phase PR, with CRITICAL and MAJOR findings fixed or
  explicitly waived by the user.
- **No stray processes**: nothing bound in `8960`–`8984`, `8765` free, `5273` free, no orphaned Vite,
  Playwright or vitest children, and `git status` clean in every worktree and in the Corpus
  repository (TEST-126).

## Orchestrator Adjudications (2026-07-28)

Rulings on the Open Conflicts above — these are binding for implementing agents and the evaluator.

1. **Conflict 1 (UI-011 SSE log streaming): the issue file was stale — struck.** The mechanism is
   cursored HTTP refetch (`JobLog.nextCursor`) triggered by `jobKey` invalidation, exactly as the
   shipped contract and `jobs/service.ts` say. UI-011's issue file is corrected in place.
2. **Conflict 2 (`Job` has no event type): CONTRACT-012 gains a rider adding `Job.type`**, populated
   by SERVER-027 from the projection's `events.type` (both halves land in the coupled commit). The
   prototype's `<event type> · <title>` row stands; UI-011 therefore also depends on the pair.
3. **Conflict 3 ("include archived" inexpressible): CONTRACT-012 gains a rider adding
   `includeArchived` (stringbool, `pinned` precedent) to `DocsQuerySchema`**, lifting the default
   archived exclusion — a union, per the prototype's chip label; `status=archived` alone keeps
   meaning "archived only". SERVER-027 implements it. SPEC §10's ambiguous sentence goes to the
   phase-end spec pass for user sign-off.
4. **Conflict 4 (UI-009 `<mark>` sanitization): struck.** `SnippetSchema`'s `{text, match}` segments
   exist precisely so highlights never touch `dangerouslySetInnerHTML`; the criteria about
   sanitizing markup are void. UI-009's issue file is corrected in place.
5. **Conflict 5 (`.c-failed` collision): UI-011 must NOT reuse `.c-failed`** for its failed-count
   span — pick a console-drawer-scoped class; `smoke.spec.ts:235`'s strict-mode assertion on
   `.console-strip .c-failed` must keep passing unmodified.
6. **Conflict 6 (no `ids` filter): accepted — cache-deduped per-id `useDoc` for `[[ref]]` title
   lookups**, and the implementing agent states this strategy in the E2E log. Different in kind
   from the forbidden collection N+1.
7. **UI-011 `↗ open`**: reads `originId` (there is no `payload`). Issue file corrected.
8. **Misc**: publish-plugin menu items stay OUT of core menus (a §13 extension-point seam is fine);
   `BOARD_STATE_VERSION` 1→2 discard is accepted; `⇧↵` follows the prototype in both scopes;
   `abandoned` gets a neutral dot (no prototype color to copy); the focus-mode hint must not
   promise editing UI-006 hasn't shipped; UI dev-server ports are per-agent (UI-005 → 5274,
   UI-009 → 5275, UI-011 → 5276) so no agent contends for 5273.
9. **Dependency correction**: UI-011 depends on UI-009 (`useOpenInColumn`) and SERVER-027
   (`Job.type`) — PLAN.md updated. UI-011 is therefore wave B of this sprint.
