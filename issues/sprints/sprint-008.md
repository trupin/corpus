# Sprint 008 — Phase 3 Opening Batch: The Data Layer, the Forms Surface, and Four Debts

**Issues**: UI-002, CONTRACT-007, CONTRACT-009, SERVER-014, SERVER-020, SERVER-022, CLI-008, INFRA-004
**Domains**: ui, contract, server, cli, infra
**Date**: 2026-07-27
**Plan phase**: Phase 3 — UI (opening batch)
**Branch**: `phase-3-ui` (currently at `abb6b48`, identical to `main`; agents work in pre-created worktrees cut from it)

---

## What makes this sprint different

Phase 3 is "the UI", and this batch builds almost none of it. That is deliberate.

**UI-002 is the only P0, and it is the whole phase's foundation.** `packages/kit` today exports
exactly one symbol — `PACKAGE_NAME` — plus a stylesheet. Six UI issues (UI-003, 004, 005, 009,
011, and transitively everything after) declare it as a dependency. Nothing renders a document,
a thread, a board column or a console row until the kit can fetch one and know when it went
stale. This sprint's single largest risk is that UI-002 ships a key scheme that the server's
`invalidate` frames do not name, in which case the board looks correct in every test and never
updates in the real application. **Open Conflict 1 is exactly that, and it is already latent in
the issue file.**

**Two issues change the wire, and every wire change in this batch breaks a shipped consumer.**
CONTRACT-007's three riders each add a field to a response that `apps/server` already returns
and, for one of them, that `apps/cli` already prints. The contract package cannot land them
alone: the moment `ReapStaleResult` requires `failed`, `apps/server/src/queue/routes.ts:35`
(`return c.json({ reaped }, 200)`) stops typechecking, and the phase branch goes red for every
other agent in the sprint. **Open Conflicts 5, 6 and 7 are the sequencing this requires** — and
they are not optional, because `packages/contract` is not allowed to edit `apps/server`
(SPEC.md §9.3, and sprint-007's Integration Points binding).

**Four of the eight are debt, and this is the last cheap moment to pay it.** SERVER-022 (11
findings) and CLI-008 (5 findings) are PR #9's deferred MINORs. SERVER-014 and SERVER-020 are
escalations the sprint-004 and sprint-007 evaluators refused to lose. All four touch code that
six UI issues are about to build on top of — a watcher that lies about `["tree"]` is a board
column that silently stops refreshing, and it is far harder to diagnose through three layers of
React than it is here.

**INFRA-004 changes the gate every other issue is measured by.** It is sequenced last for that
reason, and its own premise needs correcting before it starts: the Playwright suite does not
exercise the server or the CLI at all today (Open Conflict 12).

**SPEC.md was amended by SHARED-002 on 2026-07-27** (commit `a2bec87`, signed off by the user
with PR #9). The amended §6 is not background — **it pre-resolves SERVER-014** (Open Conflict 8)
and it is the text every anchor criterion below is written against. The superseded five-step
`reconcileAnchors(oldBody, newBody, anchors)` procedure is **gone from the spec**; quoting it is
a spec-drift finding, not a citation. SHARED-002 also adopted a standing process rule that binds
this sprint: **an adjudication that changes user-observable behavior lands with its SPEC.md
amendment**, drafted by spec-writer and held for user sign-off at the phase PR.

---

## Verification Environment (read this first)

### What counts as the "real application", per issue

| Issue                          | The real application in this sprint |
| ------------------------------ | ----------------------------------- |
| **UI-002**                     | Vitest + jsdom in `packages/kit` for the units, and a **real browser against a real server** for the loop. The E2E half needs three real things at once: a **real `corpus init` workspace**, a **real server process** on port `8905`, and the **real Vite dev server** on `CORPUS_UI_PORT=5273` proxying `/api` and `/events` to it. A live-update claim verified with a fake `EventSource` is **not** verified — the invalidate → refetch → repaint loop is the thing being proven (SPEC.md §15 M2/M3). Conversely, **no unit test may open a real `EventSource`**: see "Runtime gotchas". |
| **CONTRACT-007 / CONTRACT-009** | The **generated artifacts**, and a **server actually mounting the routes**. `openapi.json` and `src/client/schema.generated.ts` regenerated from the route definitions with `node --import tsx scripts/check-generated-artifacts.ts` green **twice in a row**; the typed client exercised against the contract's routes mounted on a real app (the existing `routes/index.test.ts` harness); and, for anything a server handler must produce, a **real server on `8915`** answering **real HTTP** (`curl -sD-`). A shape asserted only in a schema round-trip is a contract claim, not a behavior claim. |
| **SERVER-014**                 | The engine as a **library through its public API** (`reconcileAnchors`, `resolveAnchor` from `@corpus/server`), which is how SERVER-002/012/013 and their evaluators verified it, **plus** one pass through a **real `corpus init` workspace** on port `8925` where the same edit is made via `PUT /api/docs/{id}` and the resulting `anchors:` map is read **off disk** and out of `git diff`. **No port need be bound if the disk pass is driven by `corpus doc edit` against a server the issue starts and stops** — but the on-disk read-back is mandatory either way. |
| **SERVER-020**                 | A **real server process** on port `8935` with a **real `curl -N /events`** subscriber attached across the whole sequence, and **real out-of-band edits** (`printf >>`, `sed -i`, `cp`, `rm` on real files — never an API call, that is the mutation path this issue is not about). `GET /api/tree` read over real HTTP immediately before and immediately after every edit. |
| **SERVER-022**                 | A **real server process** on port `8945` against a **real `corpus init` workspace** that is a **real git repository**, with `curl -N /events` attached for the invalidation items. Effects read from the surface the finding is about: HTTP status + headers + body, `.corpus/` on disk, `git log`/`git show --stat`, `sqlite3 .corpus/cache.db`, or the SSE frame. Several findings are genuinely internal — each one below states its required evidence explicitly, and "a colocated unit test" is named where that is the honest answer. |
| **CLI-008**                    | The **real `corpus` binary** against **real servers**. **The from-source entry point is `apps/cli/src/bin/corpus.ts`** — `node --import tsx apps/cli/src/bin/corpus.ts <args>`. `apps/cli/src/index.ts` is the library barrel and running it does nothing; **never `npx`**. Item 1 needs **two real workspaces contending for one port** (`8955`); scripted `node:http` stubs are acceptable for unit tests and are **never** E2E evidence for an exit code, an attribution, or a pidfile claim. |
| **INFRA-004**                  | A **real `npm run test:coverage`**, a **real `npm run e2e`** and a **real merged report**, run locally end to end, plus **a real CI run on the phase PR**. A gate that has never been observed failing has not been verified: the negative control (TEST-149/150) is mandatory. |
| **Integration**                | UI-002 + SERVER-020 + SERVER-022 composed on port `8975` in one `corpus init` workspace, driven from a real browser through the real dev proxy, **zero stubs in the chain**. See "Cross-Issue Tests". |

**Build before verifying.** `@corpus/*` imports resolve through each package's `exports` map into
`dist/`. Each worktree is a separate checkout: run `npm install` (if `node_modules` is absent) and
`npm run build` **inside your own worktree** before any verification step. Two workspaces in this
sprint make this sharper than usual:

- **UI-002 must rebuild `packages/kit` before `apps/ui` can see a new export.** `apps/ui` imports
  `@corpus/kit`, which resolves to `packages/kit/dist/index.js`. A hook added to `src/index.ts` and
  not built is invisible to the app, to `tsc`, and to Vite — and the failure reads like a missing
  export, not a stale build.
- **CONTRACT-007/009 must rebuild `packages/contract` before `apps/server` or `apps/cli`
  typecheck.** The generated client is consumed from `dist/`; a regenerated `schema.generated.ts`
  that has not been built through `tsc` will not surface the type errors the sequencing in Open
  Conflicts 5–7 depends on you seeing.

### Port allocation

This sprint takes the `8900`–`8999` band, one non-overlapping range per issue. Earlier sprints
recorded evidence at specific ports inside this band (`8900`–`8935` sprint 006, `8950` SERVER-017,
`8965` sprint 004, `8970`–`8999` sprint 007); **nothing from them is running**, and this
allocation supersedes theirs for the duration of the sprint. If you re-run an earlier sprint's
evidence, do it on your own assigned range and say so.

| Consumer                              | Range         | Primary                                        |
| ------------------------------------- | ------------- | ---------------------------------------------- |
| UI-002                                | `8900`–`8909` | `8905` (UI: `CORPUS_UI_PORT=5273`)             |
| CONTRACT-007 + CONTRACT-009           | `8910`–`8919` | `8915`                                         |
| SERVER-014                            | `8920`–`8929` | `8925` (only if a server is bound at all)      |
| SERVER-020                            | `8930`–`8939` | `8935`                                         |
| SERVER-022                            | `8940`–`8949` | `8945`                                         |
| CLI-008                               | `8951`–`8959` | `8955` (and `8956`; stub servers: ephemeral `0`) |
| INFRA-004                             | `8960`–`8969` | `8962`                                         |
| Sprint-008 integration (TEST-155…166) | `8970`–`8979` | `8975`                                         |
| Automated tests, every workspace      | —             | `0` (ephemeral). Never hardcode.               |

**Reserved — and this sprint has a genuinely new hazard here:**

- **`8765` must stay UNBOUND for the whole sprint, by everyone.** It is the documented workspace
  default and the target of `apps/ui/vite.config.ts`'s proxy (`SERVER_ORIGIN =
  "http://127.0.0.1:8765"`). The shipped Playwright suite asserts the console strip reads exactly
  **`"server unreachable"`** (`apps/ui/e2e/smoke.spec.ts`, `describe("server state")`) — that
  assertion **requires nothing to be listening on 8765**. A sprint agent who leaves a server bound
  there turns the e2e suite red in a way that reads like a UI regression and will cost someone an
  afternoon. Pass `--port` explicitly to `corpus init` so its upward probe never reaches 8765,
  and check `lsof -nP -iTCP:8765 -sTCP:LISTEN` before declaring done.
- **The e2e suite is a single-holder resource.** `npm run e2e` binds `CORPUS_UI_PORT` (5273) via
  Playwright's `webServer` and requires 8765 free. **Only one agent runs it at a time.**
  INFRA-004 owns it by default; anyone else needing an e2e pass coordinates through the
  orchestrator. Two concurrent runs produce a `strictPort` failure that looks like a config bug.
- **`5173`** — held by an unrelated `ssh` process on this machine (independently confirmed in the
  UI-001 evaluation, PID 16094). Playwright and Vite use `CORPUS_UI_PORT=5273`. **`.githooks/pre-push`
  runs `npm run e2e` with no port override**, so a `git push` from this machine fails at the e2e
  step unless `CORPUS_UI_PORT=5273` is exported in the pushing shell. See Open Conflict 13.

### Scratch directories — one prefix per issue

| Issue                       | Prefix                                       |
| --------------------------- | -------------------------------------------- |
| UI-002                      | `mktemp -d /tmp/corpus-u002-XXXXXX`          |
| CONTRACT-007 + CONTRACT-009 | `mktemp -d /tmp/corpus-c007-XXXXXX`          |
| SERVER-014                  | `mktemp -d /tmp/corpus-s014-XXXXXX`          |
| SERVER-020                  | `mktemp -d /tmp/corpus-s020-XXXXXX`          |
| SERVER-022                  | `mktemp -d /tmp/corpus-s022-XXXXXX`          |
| CLI-008                     | `mktemp -d /tmp/corpus-c008-XXXXXX`          |
| INFRA-004                   | `mktemp -d /tmp/corpus-i004-XXXXXX`          |
| Integration                 | `mktemp -d /tmp/corpus-sprint008-int-XXXXXX` |

Automated tests use `fs.mkdtemp` with the same prefix. **Never** `rm -rf /tmp/corpus-*` — delete
only paths you created and captured in a variable.

**Two scratch hazards specific to this sprint:**

- **SERVER-022 item 5 deliberately constructs a dirty git index.** Its fixture stages a file that
  the mutation must *not* commit. Every `git` invocation in that test carries an explicit `cwd`
  pointing at your scratch workspace. A `git` command that runs with the wrong working directory
  operates on **the Corpus repository itself** and will stage or commit sprint work. Before
  declaring done, run `git status` in your worktree and confirm it shows only files you meant to
  change.
- **SERVER-022 item 9 edits `.corpus/config.json`.** That file holds the workspace's bearer token.
  Edit only `dataDir`, never print the token, and confirm the file's mode is still `600`
  afterwards.

### Process cleanup — pid-targeted only

`pkill -f main.ts`, `pkill -f tsx`, `pkill -f vite`, `pkill node`, `killall node` **kill sibling
agents' servers and dev servers** and are forbidden for the duration of this sprint. Stop what you
started, by pid:

```sh
npx tsx apps/server/src/main.ts & SRV=$!   ; kill -TERM "$SRV"
corpus server stop                          # or: kill -TERM "$(jq -r .pid .corpus/server.pid)"
npm run dev -w apps/ui & UI=$!              ; kill -TERM "$UI"
```

Before declaring a port free, check it with `lsof -nP -iTCP:<port> -sTCP:LISTEN`. Background
`curl -N` SSE clients and Playwright `webServer` children are killed by captured pid. UI-002 and
INFRA-004 both leave Vite processes behind if the shell is interrupted — check `5273` too.

### Runtime gotchas that will otherwise be misread as bugs

Every fact below was read out of the shipped tree while writing this contract.

**The query keys — read this before writing a single line of UI-002**

- **The vocabulary is the contract's, it is closed at nine shapes, and
  `packages/contract/src/query-keys.test.ts` fails on a tenth.** The shipped builders are:
  `DOCS_KEY = ["docs"]` · `TREE_KEY = ["tree"]` · `QUEUE_KEY = ["queue"]` · `JOBS_KEY = ["jobs"]` ·
  `LOCKS_KEY = ["locks"]` · `docKey(id) = ["docs", id]` · `threadKey(id) = ["threads", id]` ·
  `jobKey(eventId) = ["jobs", eventId]` · `lockKey(docId) = ["locks", docId]`.
- **UI-002's issue file prescribes a different scheme, and it is wrong.** Its Technical Design
  names `["doc", id]` and `["thread", id]` (singular). The server emits `["docs", id]` and
  `["threads", id]`. A kit built to the issue file's spelling would cache under keys **no
  `invalidate` frame ever names**, and every single-document reader would go stale forever while
  every test passed. **Open Conflict 1. Build the keys from the contract's exported builders, not
  from literals, and not from the issue file.**
- **`QUERY_KEY_NAMES` is `["docs","doc","tree","thread","queue","jobs","job","locks","lock"]` —
  those are the *names of the shapes*, not their first segments.** `doc`'s shape is
  `["docs","<id>"]`. Reading that list as key literals is the fastest way to make the mistake above.
- **There is no `["health"]` and no `["x", plugin, …]` in the contract.** Both are things UI-002
  needs (its own ACs demand them) and neither may be added to `packages/contract` — the closed set
  is pinned by a test and by the `GET /events` description in `openapi.json`. **Open Conflict 2.**
- **Prefix invalidation is asymmetric and that is intended.** `invalidateQueries({queryKey:
  ["docs"]})` matches `["docs", {…filters}]` **and** `["docs", "doc_x"]`. Since every document and
  thread mutation emits `["docs"]`, every open reader refetches on every mutation anywhere. That is
  the shipped server behavior, not a kit bug; do not "optimize" it by switching to exact matching,
  which would break collection refresh entirely.

**SSE, exactly as it is on the wire**

- **`GET /events` authenticates by `?token=<bearer>` query parameter only** — `EventSource` cannot
  set headers, and `app.ts` mounts `allowQueryToken: true` on `/events` and nowhere else.
- **Frame format**: `:connected\n\n` on attach · `:hb\n\n` every **25 s** (an SSE *comment* —
  invisible to `EventSource`, visible to `curl -N`; do not report heartbeats as stray frames) ·
  data frames are `event: invalidate\ndata: {"keys":[[…],[…]]}\n\n`. **`invalidate` is the only
  event name and `keys` the only payload field**; `keys` is an array **of arrays**. Keys are
  deduped per frame, first-seen order preserved.
- **The contract already ships the client half.** `packages/contract/src/client/events.ts` exports
  `createEventStream({baseUrl, token, onInvalidate, onError, eventSourceFactory})`, `eventStreamUrl()`
  and `EventStream {url, close()}`. It already validates each frame with `InvalidatePayloadSchema`
  and routes failures to `onError`. **UI-002 wraps this; it does not write a second parser.**

**EventSource is not available to your tests, and that is the seam**

- **Node here is v25.2.1; CI pins Node 22. `"EventSource" in globalThis` is `false` on both** —
  Node gates it behind `--experimental-eventsource`. jsdom's own implementation is not something
  to rely on either.
- **The seam the issue needs is already shipped**: `eventSourceFactory: (url: string) =>
  EventSourceLike` on `createEventStream`, with a working precedent —
  `packages/contract/src/client/events.test.ts` defines `class FakeEventSource implements
  EventSourceLike` with a test-only `emit(type, data)`. **Every kit unit test injects a fake
  through this seam. No unit test may construct a real `EventSource`.** The kit must forward the
  factory through `CorpusProvider` for that to be possible — if it does not, the criteria below
  are unverifiable and the design is wrong.
- **Node 25 shadows jsdom's `localStorage` with an inert built-in.** The shipped workaround is
  `apps/ui/src/testing/memoryStorage.ts` (`memoryStorage()` / `throwingStorage()`), stubbed with
  `vi.stubGlobal`. Any kit or UI test touching web globals follows that pattern rather than the
  ambient global. jsdom is opted into **per file** with a `/** @vitest-environment jsdom */`
  docblock — there is no `setupFiles` and no per-workspace vitest config anywhere in the repo.

**The UI as UI-001 left it**

- **There is no token.** `apps/ui/src/app/apiClient.ts` holds `const UNPROVISIONED_TOKEN = ""` with
  a comment naming UI-002 as the issue that fixes it. `mountStaticUi` serves `index.html` byte-for-byte
  with **no injection point**, and there is no `/api/config` route. Today the UI issues exactly one
  request — `GET /api/health`, the one route the contract declares unauthenticated. **Every hook
  UI-002 adds will 401, and `/events` will 401, until this is decided. Open Conflict 3 — settle it
  before writing code.**
- **The health query is frozen by design and must be unfrozen.** `apps/ui/src/app/queryClient.ts`
  sets `staleTime: Number.POSITIVE_INFINITY`, `refetchOnWindowFocus: false`,
  `refetchOnReconnect: false`, `retry: 1`. `apps/ui/src/shell/useHealth.ts` exports
  `healthQueryKey = ["health"]` and adds no overrides. So the console strip's verdict is the
  boot-time probe, forever. This is the `pr-reviewer #8` handoff UI-002's ACs already carry.
- **`appQueryClient` is a module-level singleton** and `App` takes an injectable `client?:
  QueryClient` prop. Replacing this wiring with `CorpusProvider` must keep `App`'s test seam or
  eleven shipped `apps/ui` tests break.
- **The Vite proxy is already tuned for SSE** (`timeout: 0`, `proxyTimeout: 0`,
  `Accept-Encoding: identity`, `x-accel-buffering: no`) and was measured delivering a first frame at
  +0.16 s in the UI-001 evaluation. A bridge that opens but never receives is **not** a proxy bug —
  look at the token first.
- **`apps/ui/e2e/smoke.spec.ts` asserts `expect(uncaught).toEqual([])` in three tests.** A reconnect
  loop that surfaces an unhandled rejection or an uncaught `error` event will fail tests that have
  nothing to do with SSE.

**The contract's standing invariants — CONTRACT-007/009 will trip these**

Named tests in `packages/contract/src/openapi.test.ts` and `routes/index.test.ts` that a careless
addition breaks:

- `"declares exactly the endpoints the pinned inventory names"` — a new route **must** be added to
  `ENDPOINT_INVENTORY` (`src/routes/inventory.ts`) in the same change.
- `"declares 401 on every authenticated operation"`, `"declares 400 on every operation that
  validates request input"`, `"does not declare 400 on operations that take no request input"`,
  `"declares 500 on no operation, since an unexpected failure is not contract surface"`.
- `"keeps every named component a plain, non-nullable, undefaulted object"` — this guards the
  **component**, not its properties. `lastLine` and `originId` are already `.nullable()` inside
  `Job`. A nullable *property* is fine; `Job.nullable()` is not.
- `"declares no server-applied default anywhere in a request body"` + `"lists no defaulted property
  in a request body's `required` array"` — CONTRACT-003's guard.
- The CONTRACT-004 block: `"finds every request body in the surface"` asserts
  `expect(bodies).toHaveLength(11)` — **adding a route changes that number**; `"earns no exemption
  from the rule at all"` pins `RULE_EXEMPTIONS` to `{}`; and a hard-coded mandatory/omittable
  partition already contains `"POST /api/threads": true`.
- The CONTRACT-006 block: `CARRIERS = ["DocMutationResponse", "UpdateDocResponse", "DeleteDocResult",
  "CreateThreadResponse", "AppendTurnResponse", "CaptureResult", "DeleteTurnResult"]` with
  `"declares `warnings` required on %s"` per carrier, plus `"finds no other component carrying a
  differently-shaped warnings field"`. **`ThreadSummary` is deliberately not a carrier today.**
- `"offers both a JSON and a multipart body on turn-append"` asserts
  `expect(Object.keys(content)).toEqual(["application/json", "multipart/form-data"])` — **order
  matters**. `"declares capture as multipart only"`. `"types the attached files as an array of
  binaries"` currently checks `["MultipartAppendTurnRequest", "CaptureRequest"]` and must gain
  CONTRACT-009's new component.

**The shapes CONTRACT-007/009 are changing, verbatim**

- `POST /api/threads` is **`application/json` only**, `required: true`, responses `201/400/401/404/423`.
- `POST /api/capture` is **`multipart/form-data` only**; `CaptureRequestSchema = {text: min(1),
  requestsAgent, files: AttachmentFilesSchema}`. `AttachmentFilesSchema` publishes as
  `{type: "array", items: {type: "string", format: "binary"}}`; the part name is
  `FILES_FIELD = "files"`. **This is the shape CONTRACT-009 mirrors.**
- `POST /api/threads/{id}/resolve` and `/reopen` return a **bare `ThreadSummarySchema`** —
  `{id, title, status, parent, anchor, agent, created, updated, turnCount, lastAuthor, lastTs}`,
  **no `warnings`**. `apps/server/src/threads/routes.ts` calls `reportWarnings(...)` (log-only) and
  then `c.json(thread, 200)`.
- `ReapStaleResultSchema = {reaped: EventId[]}`. The server **already computes the other half**:
  `QueueService.reapStale()` returns `ReapResult {reaped: string[]; failed: string[]}` and
  `apps/server/src/queue/routes.ts:35` destructures `const { reaped } = await queue.reapStale();`,
  dropping `failed` on the floor.
- `JobSchema = {eventId, status, started, updated, lastLine (nullable), originId (nullable)}`. There
  is **no title field**, and `apps/server/src/jobs/project.ts`'s `resolveOriginId()` returns an id
  only — it never looks a title up.
- **`413` appears nowhere in `packages/contract`.** The interim `400` is deliberate and documented:
  `apps/server/src/attachments/limits.ts` says *"The status is `400`, not `413` (sprint-007 Open
  Conflict 5b) … `413` follows in the CONTRACT rider."* Caps are
  `DEFAULT_MAX_FILE_BYTES = 25 MB`, `DEFAULT_MAX_REQUEST_BYTES = 100 MB`, enforced both pre-parse
  (`createUploadSizeGuard`, from `Content-Length`) and post-parse (`assertWithinLimits`).
- **The error union is closed**: `ERROR_CODES = ["bad_request","unauthorized","forbidden",
  "not_found","conflict","locked","internal_error"]`, and `internal_error` is declared on no route.
  A `413` needs a code; `bad_request` is the only member whose shape (`{code, message, issues[]}`)
  already fits. Deciding otherwise means extending a discriminated union that eight schemas and the
  CLI's error renderer depend on. **Open Conflict 4.**

**Forms: what exists is three words and a SQL `LIKE`**

- SPEC.md §6 gives the whole grammar in one clause: *"a fenced ```` ```form ```` block (YAML: a
  prompt + options) … submitting appends a structured answer turn (chosen option + optional note)
  and enqueues a `form.respond` event"*. There are **no field names, no form id, no multi-select,
  no required/optional, no free-text**. **Open Conflict 4a.**
- `form.respond` **is** already a declared literal in `CORE_QUEUE_EVENT_TYPES`, but
  `QueueEventSchema.payload` is `z.record(z.string(), z.unknown())` for **every** event type — there
  is no per-type payload union to extend, only one to invent.
- `NEEDS_REASONS` already contains `"form"`, and `apps/server/src/docs/needs.ts` already has a
  detector — `tu.body_md LIKE '%```form%'` gated on `t.last_author = 'agent'` and `tu.ts = t.last_ts`,
  with **no `t.status = 'open'` guard**. That detector is simultaneously CONTRACT-007's consumer and
  SERVER-022 finding 3. See Integration Points.
- Nothing else exists: no `formAnswer` schema, no submission route, no producer, no UI.

**Anchors, §6 as amended, and the SERVER-014 corner**

- The shipped suite **already contains both halves of the "tension"**, and both pass:
  `reconcile.test.ts:648` has `"true duplication during a reorder leaves the mapper's choice standing
  (TEST-65)"` (**no orphan**) and `:662` has `"a non-unique survivor goes through the chain's
  uniqueness rules: ambiguity orphans, selector preserved (TEST-64)"` (**orphan**). The engine
  already distinguishes them.
- **There is no unit test named TEST-66 anywhere in `apps/server`.** The issue file's "TEST-66" is
  the **A/B must-hold harness** from `issues/server/013-anchor-substitution-class.md` — 42 named
  fixtures run through both engines with the full result JSON compared. Looking for it as a
  `describe`/`it` will waste an hour.
- **The mechanism is in `reconcile.ts:112-146`, and it explains everything.** Per anchor:
  `classification === "deleted"` → `verifiedSurvivor(selector)`, which is the **only** place
  ambiguity is ever checked (it delegates to `resolveAnchorExact` and returns `null` on a non-unique
  match → orphan). Otherwise the mapped slice is taken, and `verifiedSurvivor` is reached only when
  `suspect` is true (`blank`, or `rewritten` plus a straddling replacement or a failed round-trip).
  **When the mapped slice's text is unchanged (`rewritten === false`), the anchor takes
  `newRange: mapped` at line 145 and the uniqueness rules never run at all.**
- **Consequence, and it changes SERVER-014's shape**: the repo's `it(…TEST-64)` fixture is **not**
  the evaluator's fixture. In the repo's test, `HIRE` already appears **twice in `oldBody`** (once
  in `OPS_OLD`, once in a static "Appendix repeats:" line) and the edit relocates the anchor's own
  occurrence, so the classification is `"deleted"` and `verifiedSurvivor` runs and orphans. In the
  **evaluator's** reproduction, `B` appears **once** in `oldBody` and is duplicated only as an
  artifact of the constructed `newBody`, so it takes the line-145 fast path. **The passing test
  named TEST-64 does not cover the escalated scenario.** Anyone who reads the green suite as
  evidence the corner is covered will close this issue wrongly.
- **The evaluator's escalation is a third shape, and its own conclusion names the mechanism**:
  `issues/evals/SERVER-013-eval.md` records *"The mapper produced a trusted slice, so the uniqueness
  rules never ran; the choice is positional (diff-derived), not arbitrary"*, and confirms the
  outcome is **byte-identical on the shipped round-2 engine** — long-standing policy, not a
  SERVER-013 regression.
- The 4-step reproduction, verbatim from that file: `oldBody` = four wholly-distinct paragraphs
  `[A,B,C,D]` with one whole-paragraph anchor on `B`; `newBody` = `[C,B,A,B,D]`, leaving `B` at two
  locations (offsets **87** and **263**, occurrence count **2**); run `reconcileAnchors`; observe
  `{"unchanged":[],"remapped":["anc_b"],"orphaned":[]}` with `resolveAnchor` at **`[263, 348]`** —
  `exact` and `prefix` byte-preserved, **`suffix` rewritten**.
- **§6 as amended by SHARED-002 governs this and points one way.** "Threads orphan when their text
  is **genuinely gone**" — `B` is not gone. "An anchor whose text the edit left alone keeps its
  `exact`, with **`prefix`/`suffix` refreshed** from the new surroundings" — a rewritten suffix is
  *required* of a remap, and byte-preservation of the whole selector is promised only for
  **orphans**. TEST-64's criterion text asked for orphan-semantics on a remap outcome. **Open
  Conflict 8.**

**The watcher, the tree, and where SERVER-020 and SERVER-022 collide**

- `apps/server/src/watcher/watcher.ts` picks the tree key from a boolean:
  ```
  const documentKeys = (id, type, structural) => [
    DOCS_KEY, docKey(id), ...(type === "thread" ? [threadKey(id)] : []),
    ...(structural ? [TREE_KEY] : []),
  ];
  ```
  `structural` is `true` for add/unlink and `false` for change. Both reproduced directions follow
  from that by inspection: an on-disk `status: archived` edit is a **change** (no `["tree"]`) while
  `GET /api/tree` **excludes archived documents**, so the tree changed silently; and a skill file
  appearing under `.claude/skills/` is an **add** (`["tree"]` emitted) while `folderTree()` counts
  only `data/docs/`, so nothing changed.
- **The mechanism to copy already exists, and so does its test harness.**
  `folderTreeSignature(db)` is exported from `apps/server/src/docs/tree.ts:130` (it is
  `JSON.stringify(folderTree(db))` — the same structure `GET /api/tree` returns).
  `runMutation` uses it at `apps/server/src/docs/write.ts:630` and `:640-642`:
  `const treeBefore = plan.mayChangeTree === true ? folderTreeSignature(...) : null;` … `const
  treeChanged = treeBefore !== null && folderTreeSignature(...) !== treeBefore;`. And
  `apps/server/src/docs/tree-key.test.ts` already asserts the biconditional directly —
  `expect(observation.announced).toBe(observation.changed)`. **SERVER-020 drops the same compare
  into the watcher and extends that harness; it writes no second signature function.**
- `structural`'s three call sites in `collectDocument` are `watcher.ts:143` (unlink → always
  `true`), `:175` (`existing === undefined`, i.e. only a brand-new path) and `:179` (removed with a
  prior row → always `true`). An edit to an existing file is therefore always `false`, which is
  direction (i) by construction.
- `.claude/skills` is a full `DOCUMENT_ROOT` (`projection/roots.ts:65-73`) routed through the same
  `collectDocument`, while `folderTree()`'s SQL selects only `WHERE d.path LIKE 'data/docs/%'` and
  `d.status <> 'archived'` (`docs/tree.ts:25-35`) — so a new skill file can never change the tree,
  which is direction (ii) by construction.
- **`GET /api/tree` counts threads in their *parent's* folder**; a standalone thread (`parent: null`)
  contributes nothing; archived documents are excluded. Sprint-007 established this and SERVER-018
  was written against it.
- **`POST /api/db/rebuild` emits `["tree"]` on a byte-identical tree.** The SERVER-018 evaluation
  disclosed it as *"deliberately coarse (SERVER-017), not a per-mutation frame"*, failing only
  toward over-invalidation. That is SERVER-020's optional decision item.
- **File overlap is real and this contract's merge order turns on it.** SERVER-020 touches
  `watcher/watcher.ts`; SERVER-022 finding 10 touches `watcher/watcher.ts` **and** `git-head.ts`.
  SERVER-014 touches `anchors/reconcile.ts`; SERVER-022 finding 4 touches `anchors/reconcile.ts`.
  **Open Conflict 9.**

**The CLI as CLI-004/007 left it**

- **`GET /api/health` returns `{status, version, uptimeSeconds, workspace}`**, where `workspace` is
  documented as *"Absolute path of the workspace this server owns."* — the identity field
  `probeHealth` should compare and does not. `probeHealth` (`commands/server/state.ts:30`) returns
  the whole payload; `inspectServer` branches only on `undefined` vs defined.
- **`start` writes the pidfile last, on purpose** (its own module comment: *"a file naming a pid
  that never became a server is worse than no file"*) — but the readiness it waits on is
  `probeHealth`, so a foreign server on the same port satisfies it while the real child died
  `EADDRINUSE`.
- **`lock break` hardcodes the actor**: `commands/lock/break.ts` sends
  `header: {"x-corpus-author": "user"}` and never reads `context.actor`. Its module header still
  says *"the actor is overridden per call"* — that prose is what CLI-008 refreshes.
- **The guard to mirror is `doc delete`'s**: `AGENT_REFUSAL = "deletion is user-only — the agent
  archives, never deletes"`, thrown as a `UsageError` (**exit 2**) **before any request is sent**.
- **`readAll` is already deduplicated** — `commands/job/log.ts` imports `readAll` and
  `stdinCarriesABody` from `../../input.js` and defines nothing locally. CLI-007 closed it. Item 4
  is a *verify-and-close*.
- **The hygiene test exists** and is `apps/cli/src/commands/hygiene.test.ts` — not
  `registry/validate.test.ts`. It scans `TOPICS = ["doc","thread","db"]` only, strips comments and
  string literals via `stripProse()`, and asserts: no fs/child_process imports, no write API or
  spawn call, no `git` token in code, no direct `fetch`, no hand-built URL, and that any
  `api.METHOD(` call goes through `client.request`. **It does not look at stdin, and it does not
  scan `job/`, `lock/`, `queue/`, `server/`, `init/` or `health.ts` at all.**
- **`process.stdin` appears in exactly four places** under `apps/cli/src`: `input.ts:115`
  (`stdinCarriesABody`, the `isTTY` probe), `input.ts:159` (`readAll(dependencies.stdin ??
  process.stdin)`), `commands/job/log.ts:43` (same default-parameter idiom), and
  `commands/doc/delete.ts:67` (`process.stdin.isTTY`) and `:86` (`input: NodeJS.ReadableStream =
  process.stdin`). `testing/stdin.ts` mentions it in a comment only. **A naive ban breaks two
  legitimate call sites. Open Conflict 10.**
- **Exit codes are fixed and documented** in `docs/cli.md`: `0` success · `1` internal · `2` usage ·
  `3` not a workspace / bad config · `4` server unreachable · `5` server returned an error · `6` a
  check-style command reported a failure. CLI-008 introduces none.
- **`out.emit()` may be called exactly once** and writes only under `--json`; a second call throws
  `InternalError`. Under `--json`, failures go to **stderr** as one `{"error":{…}}` line and stdout
  stays empty.
- **`docs/cli.md` is a drift-checked generated artifact.** Any help-text or summary change —
  including refreshing `lock break`'s prose — requires `npm run generate` and a re-run of
  `scripts/check-generated-artifacts.ts`.

**The gate, as it stands today**

- **One root `vitest.config.ts`**, no per-workspace configs. Coverage: provider `v8`, `include:
  ["apps/*/src/**","packages/*/src/**","plugins/*/src/**"]`, `exclude: ["**/*.test.{ts,tsx}",
  "apps/*/src/bin/**","**/*.generated.ts"]`, reporters `["text","json-summary","json"]`,
  `reportsDirectory: "coverage"`, thresholds **90 on all four metrics**. Its own comment names
  INFRA-004 and says *"Until then the unit-test run carries the 90% bar alone."*
- **Current unit-only baseline, read from `coverage/coverage-summary.json`** (do not re-derive it,
  and do not report a lower number without explaining it): lines **98.71 %** (15653/15856),
  statements **98.71 %**, functions **98.48 %** (1043/1059), branches **94.73 %** (4682/4942).
  Per workspace — `apps/cli` 99.29 % lines, `apps/server` 98.06 %, `apps/ui` **100 %** (271/271),
  `packages/contract` **100 %**, `packages/kit` 100 % **of one line**.
- **`npm run e2e` is not a no-op and has not been for a while.** The root script is
  `playwright test --config apps/ui/playwright.config.ts` with **no** skip logic; the skip lives in
  CI's `compgen -G` guard and in `.githooks/pre-push`, and both globs **match**.
  `apps/ui/e2e/smoke.spec.ts` holds **13 tests**. **`CLAUDE.md`'s Build & Dev Commands line
  ("skipped automatically when no specs exist") is stale.**
- **The e2e suite starts no `corpus` server and no CLI.** `playwright.config.ts`'s `webServer` runs
  `npm run dev -- --port ${PORT} --strictPort` — the Vite dev server, nothing else — and its own
  comment says it *"deliberately does not start a workspace server"*. **INFRA-004's AC 2 has no
  spawn point to attach to. Open Conflict 12.**
- **Nothing merges coverage today.** `monocart-coverage-reports` is not a dependency anywhere;
  `NODE_V8_COVERAGE` appears in the repo only inside `issues/infra/004-merge-e2e-coverage.md`;
  `scripts/` contains `check-generated-artifacts.ts`, `generated-artifacts.ts`,
  `workspace-template.ts` and their tests, and no coverage script.
- **CI is one job, `validate`**, in this order: `npm ci` → `npm run build` → generated-artifacts
  drift → lint → format:check → typecheck → **`npm run test:coverage` (the only place the 90 % gate
  lives)** → e2e. e2e runs *after* the gate and contributes nothing to it.
- **`eslint.config.js` has no `no-restricted-*` rule of any kind**, and expresses per-path scoping
  exactly once (the `files: ["**/*.js","**/*.cjs","**/*.mjs"]` block). **There is no
  `eslint-plugin-react-hooks`** — UI-002 introduces the repo's first React hooks package with no
  rules-of-hooks or exhaustive-deps lint behind it. **Open Conflict 11.**

**General**

- **`corpus init` seeds a small corpus and makes one initial commit**: one `template` (`note`),
  three `view`s (`inbox`, `open-threads`, `attention`), two `skill`s (`comment`, `orchestrate`),
  zero `agent-def`s, all `evergreen: true`. State this baseline rather than assuming an empty
  database.
- **`.gitkeep` files live inside `.corpus/queue/<status>/`.** Anything counting queue events counts
  **`evt_*.json` only**. This has bitten sprints 003–007.
- **`SQUASH_IDLE_MS = 30_000`**, matched on `Corpus-Doc` + `Corpus-Actor` trailers. Two writes to
  the same document by the same actor inside 30 s fold into one commit.
- **`better-sqlite3` is a native module.** A first-install rebuild delay in a fresh worktree is not
  a performance result.
- **The whole repo currently passes**: 201 test files, 3415 tests, lint/format/typecheck green,
  e2e 13 passed, `check-generated-artifacts.ts` green. Any red you find at the start of your work
  is yours.

### Deferred verification is recorded, not skipped

Any criterion below that cannot be executed — because an adjudication struck it, or a dependency has
not landed at the moment of verification — is marked `DEFERRED → <issue>` or
`STRUCK → Open Conflict N` in the E2E Verification Log, with the reason and the substitute evidence
supplied. **Silent omission is a fail.**

---

## Acceptance Tests

### UI-002: `@corpus/kit` data layer — hooks + SSE bridge

Ports `8900`–`8909`, primary `8905`; UI on `CORPUS_UI_PORT=5273`. **42 criteria.** This is the only
P0 in the batch and the only issue whose defects are invisible to the type system: a wrong key, a
missed reconnect refetch and a second `EventSource` all typecheck perfectly and all produce a board
that quietly serves stale data. TEST-27…TEST-38 are the loop, and **none of them is satisfiable by a
unit test** — each needs the real browser, the real proxy, the real server.

#### The package and its boundary

```
TEST-1: The kit declares the dependencies it now has
  Given: `packages/kit/package.json`, which today depends on `@corpus/contract` alone and
         declares no `peerDependencies` and no `devDependencies`
  When:  The kit is installed and built in a clean worktree
  Then:  `@tanstack/react-query` and `@corpus/contract` are dependencies, `react` is a PEER
         dependency (not a hard one — `apps/ui` and every plugin must resolve one React), the
         build emits `dist/index.js` + `dist/index.d.ts`, and `npm run build` from the repo root
         still succeeds in dependency order contract → kit → cli → server → ui

TEST-2: The public surface is deliberate and is the plugin contract
  Given: `packages/kit/src/index.ts`, which today exports only `PACKAGE_NAME`
  When:  The built `dist/index.d.ts` is read
  Then:  It exports exactly: the client factory, `CorpusProvider`, the six read hooks,
         `useConnectionState`, `useAppendTurn`, the key builders, `pluginKey`, and the types those
         need. It does NOT re-export `openapi-fetch` internals, the raw `CorpusApi`, or anything
         from `@corpus/contract/client` that a plugin could use to bypass the kit. The E2E log
         lists the surface verbatim — UI-003 onward and every plugin are bound by it

TEST-3: The kit is importable through its package entry, not its source
  Given: A consumer importing `@corpus/kit`
  When:  `npm run typecheck` runs across all workspaces
  Then:  It passes with the kit resolved through its `exports` map into `dist/`; no workspace
         deep-imports `packages/kit/src/**`

TEST-4: `apps/ui` reaches the server only through the kit
  Given: UI-001's `apps/ui/src/app/queryClient.ts`, `apiClient.ts` and `shell/useHealth.ts`
  When:  UI-002's wiring lands and `apps/ui/src` is searched for direct data access
  Then:  No file under `apps/ui/src` outside the provider wiring calls `fetch(`, constructs a
         `CorpusClient` for querying, or imports from `@corpus/contract/client` for a query. The
         E2E log names every remaining direct use and justifies it

TEST-5: `App`'s existing test seam survives
  Given: `App` accepts an injectable `client?: QueryClient` prop, used by eleven shipped
         `apps/ui` tests
  When:  `CorpusProvider` replaces the local `QueryClientProvider` wiring
  Then:  Every shipped `apps/ui` test still passes unmodified, or each modification is listed in
         the E2E log with the reason. A test deleted rather than adapted is a fail
```

#### The query keys — the criteria that decide whether the board works at all

```
TEST-6: Every key is built from the contract's exported builders
  Given: `packages/contract`'s nine shapes: DOCS_KEY, TREE_KEY, QUEUE_KEY, JOBS_KEY, LOCKS_KEY,
         docKey, threadKey, jobKey, lockKey
  When:  The kit's key module is exercised
  Then:  `useDoc("doc_x")` caches under `["docs","doc_x"]` and `useThread("th_x")` under
         `["threads","th_x"]` — the CONTRACT-005 spelling, NOT the `["doc", id]` / `["thread", id]`
         spelling in UI-002's issue file (Open Conflict 1). A test asserts the deep equality of
         each hook's key against the contract's builder called directly, so a future contract
         rename is a test failure and not a silent regression

TEST-7: Adopting the contract's spelling is recorded, not assumed
  Given: Open Conflict 1's adjudication
  Then:  `issues/ui/002-kit-data-layer.md`'s Technical Design is corrected in place to name the
         contract's shapes, and the E2E log quotes both spellings and states which shipped

TEST-8: `useDocs` canonicalizes its filters
  Given: The full GET /api/docs filter set (q, type, status, tag, folder, parent, references,
         agent, author, since, due, stale, unread, needs, sort)
  When:  Two calls pass logically identical filters in different key order, one with
         `undefined`/`null`/`""` members present and one without, and one with a `tag` array in a
         different order
  Then:  Both produce a DEEPLY EQUAL query key and share one cache entry — exactly one network
         request is issued, observed from a stubbed transport

TEST-9: Canonicalization is total and documented
  Given: The canonicalizer
  When:  It is handed each of: an empty object, an object of only-empty values, nested arrays, and
         a filter the contract does not define
  Then:  Empty/undefined/null are dropped, keys are sorted, array values are sorted, and the
         result is stable across calls. An unknown filter is preserved (the contract can grow
         without a kit release) — or rejected, if that is what ships, and the E2E log says which

TEST-10: The list key and the single-document key do not collide
  Given: `useDocs({})` caching under `["docs", <canonical object>]` and `useDoc("doc_x")` caching
         under `["docs","doc_x"]`
  When:  A frame naming `["docs","doc_x"]` arrives
  Then:  The single-document entry is invalidated and NO `useDocs` variant is; when a frame names
         `["docs"]`, every entry under both shapes is invalidated (prefix semantics, deliberately)

TEST-11: The key scheme is documented where a plugin author will find it
  Given: `packages/kit/README.md`, which does not exist today
  When:  It is read
  Then:  It states each key's exact literal shape, what emits it server-side, what refetches on it,
         the `x/<plugin>/…` namespace convention, and the rule that the kit is the only data path.
         The nine core shapes match `describeQueryKeyVocabulary()`'s output — a divergence between
         the kit's README and the contract's published vocabulary is a fail

TEST-12: `pluginKey` exists in the kit and not in the contract
  Given: The contract's vocabulary is closed at nine shapes and `query-keys.test.ts` fails on a
         tenth (Open Conflict 2)
  When:  `pluginKey("todos","board")` is called
  Then:  It yields `["x","todos","board"]`; `packages/contract` is UNCHANGED by UI-002 —
         `git diff` over `packages/contract` is empty and `check-generated-artifacts.ts` is green
```

#### The SSE bridge

```
TEST-13: Exactly one EventSource per provider, regardless of hook count
  Given: A `CorpusProvider` with an injected `eventSourceFactory`
  When:  Six hooks are mounted, then three unmounted, then two more mounted
  Then:  The factory was called exactly ONCE and `close()` was never called. Mount/unmount churn
         opens and closes nothing

TEST-14: The bridge is testable without a real EventSource
  Given: `"EventSource" in globalThis` is `false` on Node 22 and 25 without
         `--experimental-eventsource`
  When:  The kit's test suite runs under plain `npm test`
  Then:  Every SSE test injects a fake through the `eventSourceFactory` seam that
         `createEventStream` already exposes, following `packages/contract/src/client/events.test.ts`'s
         `FakeEventSource implements EventSourceLike`. No test constructs a real `EventSource`,
         no test sets `--experimental-eventsource`, and the factory is reachable from
         `CorpusProvider`'s props

TEST-15: The bridge wraps the contract's parser rather than replacing it
  Given: `createEventStream` already validates each frame with `InvalidatePayloadSchema`
  When:  The kit's bridge is exercised
  Then:  It delegates parsing to the contract helper; there is no second Zod schema for the
         invalidate payload and no second `JSON.parse` of `event.data` in `packages/kit`

TEST-16: An invalidate frame invalidates by prefix
  Given: A real `QueryClient` holding cached entries for several `useDocs` variants,
         `["docs","doc_a"]`, `["threads","th_a"]` and `["tree"]`
  When:  A frame `{"keys":[["docs"]]}` is emitted
  Then:  Every `["docs", …]` entry is marked stale and `["threads","th_a"]` and `["tree"]` are
         untouched

TEST-17: A multi-key frame dispatches every key
  Given: The real shape the server sends — `{"keys":[["docs"],["docs","th_x"],["threads","th_x"],["tree"]]}`
  When:  It arrives
  Then:  All four are invalidated, in one pass, with no key dropped and none invented

TEST-18: Unknown and plugin keys pass through unchanged
  Given: A frame naming `["x","todos","board"]` and a frame naming a shape the kit has never seen
  Then:  Both reach `invalidateQueries` verbatim. The kit does NOT allowlist the nine core shapes —
         doing so breaks plugin live updates (SPEC.md §10)

TEST-19: A malformed payload is dropped, never thrown
  Given: Frames carrying: invalid JSON, `{"keys":[]}`, `{"keys":"docs"}`, `{"keys":[[]]}`, and a
         valid JSON object with no `keys` field
  When:  Each arrives
  Then:  Each is logged and ignored; no exception escapes; the connection stays open; a subsequent
         valid frame is still dispatched

TEST-20: Heartbeats and the greeting are not events
  Given: The server sends `:connected\n\n` on attach and `:hb\n\n` every 25 s
  When:  The stream runs for longer than one heartbeat interval with no mutation
  Then:  Zero invalidations and zero refetches occur. (Note: SSE comments never reach
         `EventSource` listeners at all — the criterion is that nothing in the kit turns a
         connection-liveness signal into a refetch, and the log states how this was observed)

TEST-21: An invalidate storm coalesces
  Given: The batch window the kit implements (~50 ms or one animation frame)
  When:  20 frames naming the same key arrive inside it
  Then:  Exactly ONE refetch is issued for that key. The window's value is stated in the log

TEST-22: Coalescing does not lose a distinct key
  Given: 20 frames arriving inside one window naming three DIFFERENT keys
  Then:  Three refetches, one per key — coalescing dedupes, it never drops
```

#### Reconnect, and the invalidations missed while disconnected

```
TEST-23: Backoff is bounded, jittered and capped, and never hot-loops
  Given: Fake timers and a fake EventSource that errors immediately on every connect
  When:  Ten consecutive failures occur
  Then:  Delays grow as `min(cap, base * 2^n)` with jitter, never exceed the cap, and are never
         zero. The base and cap are stated in the log. Ten failures take at least an order of
         magnitude more wall-clock than ten immediate retries would

TEST-24: A reconnect refetches active queries; a first connect does not
  Given: A provider that has just mounted
  When:  The first connect succeeds
  Then:  `refetchQueries({type:"active"})` is NOT called (nothing is stale yet)
  When:  The connection then drops and reconnects
  Then:  It IS called, exactly ONCE per reconnect — not once per retry attempt, not twice

TEST-25: Connection state is exposed and transitions honestly
  Given: `useConnectionState()`
  When:  The bridge goes through connecting → open → (drop) → reconnecting → open
  Then:  The hook reports each transition, in order, to a subscribed component. UI-011's console
         strip and UI-001's shell can render "reconnecting" instead of silently serving stale data

TEST-26: The health key converges without a reload — both directions
  Given: UI-001's `["health"]` query with the inherited `staleTime: Infinity`,
         `refetchOnReconnect: false`, `refetchOnWindowFocus: false`
  When:  The SSE connection is lost, and later re-established
  Then:  Both transitions invalidate the health key, so the console strip's verdict follows
         reality in both directions. A strip stuck on "server unreachable" after the server
         returns — or stuck on a version string after it dies — is a fail. The E2E log states
         whether `["health"]` lives in the kit or stays an `apps/ui` key (Open Conflict 2) and
         how the bridge reaches it
```

#### The loop, in a real browser against a real server

```
TEST-27: The provider authenticates
  Given: A real `corpus init` workspace on port 8905 whose `.corpus/config.json` holds a real
         bearer token, and Open Conflict 3's adjudicated token path
  When:  The board is loaded at http://localhost:5273
  Then:  `GET /api/docs` returns 200, not 401, and the `/events` connection opens. The log states
         exactly where the token came from, and confirms the kit itself read no file and no env
         var — it received the token as configuration

TEST-28: Exactly one /events connection is open with the whole UI mounted
  Given: A dev route rendering `useDocs({})`, `useTree()`, `useJobs({})`, `useLocks()` and
         `useConnectionState()` simultaneously
  When:  The browser devtools Network tab is inspected
  Then:  Exactly ONE open `/events` request, in `eventsource` / pending state. The screenshot or
         the captured entry is in the log

TEST-29: An out-of-band CLI mutation repaints the list with no reload
  Given: The board showing a document list
  When:  `node --import tsx apps/cli/src/bin/corpus.ts doc create --title "sprint008 probe" …`
         runs in a separate terminal against the same workspace
  Then:  The row appears WITHOUT a page reload. The captured `event: invalidate` frame, its exact
         `keys` payload, and the follow-up `GET /api/docs` request are all quoted in the log

TEST-30: A direct file write also repaints — the watcher path, not the write path
  Given: The same board
  When:  `printf '\nappended\n' >> data/docs/<file>.md` is run directly on disk
  Then:  The UI updates. This proves watcher → projection → SSE → refetch, which is a different
         path from TEST-29's and is the one SERVER-020 is fixing in the same sprint

TEST-31: A thread view updates on a turn appended elsewhere
  Given: An open `useThread(id)` view
  When:  `corpus thread reply <id> --from agent` appends a turn
  Then:  The turn appears without a reload; the frame that carried it named both
         `["threads",id]` and `["docs",id]`

TEST-32: Server death is survived without a hot loop
  Given: The board connected
  When:  The server is stopped (by pid)
  Then:  Connection state flips to `reconnecting`, the console strip converges to "server
         unreachable" (TEST-26), and the retry delays observed in the browser console grow.
         Over 60 s the number of connection attempts is bounded and stated in the log — a
         per-second retry storm is a fail

TEST-33: A change made while disconnected is visible after reconnect
  Given: The server stopped with the board still open
  When:  A document is created with the CLI while the server is down (it will fail), the server is
         restarted, and a document is created immediately after
  Then:  On reconnect there is exactly ONE burst of refetches and the board shows the document
         created while it was disconnected. This is the whole reason `refetchQueries` exists on
         the reconnect path

TEST-34: A plugin-namespaced invalidation round-trips
  Given: A cached query registered under `pluginKey("todos","board")`
  When:  A frame naming `["x","todos","board"]` reaches the bridge over the real connection
  Then:  That query refetches. If no server route can emit such a frame yet, the log says so and
         supplies the frame by the most direct real means available, naming the substitute
```

#### Optimistic append

```
TEST-35: The user's turn appears synchronously
  Given: An open thread and `useAppendTurn()`
  When:  A turn is submitted
  Then:  The provisional turn is in the `["threads", id]` cache before the POST resolves, marked
         as pending so the UI can render it differently

TEST-36: The server's turn replaces the provisional one — it never sits beside it
  Given: The optimistic entry, and SPEC.md §6's guarantee that turn timestamps are unique and
         monotonic within a thread
  When:  The POST resolves and the refetch lands
  Then:  The thread shows EXACTLY ONE copy of the turn, carrying the SERVER's timestamp.
         Reconciliation is by turn timestamp, and the log states the rule

TEST-37: A failed mutation rolls the cache back
  Given: A cache snapshot taken before the optimistic write
  When:  The POST fails (403, 423 and a transport error, each tested)
  Then:  The cache is restored to the pre-mutation snapshot, the provisional turn is gone, and the
         error reaches the caller rather than being swallowed

TEST-38: An in-flight SSE invalidation does not eat the optimistic entry
  Given: An optimistic turn written to the thread cache
  When:  A `["threads", id]` invalidation arrives BEFORE the mutation settles
  Then:  The provisional entry survives until its own mutation settles — `cancelQueries` runs
         before the optimistic write, per TanStack's mutation-aware pattern — and the final state
         still has exactly one copy of the turn
```

#### Hooks, types and the constraints

```
TEST-39: Every read hook calls the operation the contract declares
  Given: A stubbed client typed by the contract
  When:  Each of useDocs, useDoc, useThread, useTree, useJobs, useLocks is rendered
  Then:  Each calls exactly `GET /api/docs`, `GET /api/docs/{id}`, `GET /api/threads/{id}`,
         `GET /api/tree`, `GET /api/jobs`, `GET /api/locks` with the expected params

TEST-40: Response types are the contract's, with nothing hand-written and no `any`
  Given: `docs/TS_GUIDELINES.md`'s Zod-at-boundaries and no-`any` rules
  When:  `npm run lint` and `npm run typecheck` run
  Then:  Zero `no-explicit-any` warnings originating in `packages/kit`, zero hand-written response
         interfaces duplicating a contract schema, and `useDocs` with a `q` preserves the FTS
         snippet highlights in its type (UI-009 consumes them)

TEST-41: Two providers are two connections, and the app asserts there is one
  Given: The documented constraint that each `CorpusProvider` owns its own EventSource
  When:  Two providers are mounted in a test harness
  Then:  Two factories are called — and `apps/ui` asserts (at runtime in dev, or by construction)
         that exactly one provider is mounted. The constraint is in `packages/kit/README.md`

TEST-42: Coverage does not fall off a cliff
  Given: `packages/kit` today has one covered line, and the combined gate is 90 % on all four
         metrics
  When:  `npm run test:coverage` runs after UI-002 lands
  Then:  The gate passes, and per-workspace numbers for `packages/kit` are stated in the log.
         Key builders, invalidation mapping, backoff/reconnect, coalescing and
         append/reconcile/rollback each have direct tests (UI-002's own Testing Strategy)
```

---

### CONTRACT-007 + CONTRACT-009: the wire changes

Ports `8910`–`8919`, primary `8915`. **34 criteria.** These two issues are implemented by **one
contract agent, sequentially**, because they regenerate the same two artifacts (`openapi.json`,
`src/client/schema.generated.ts`) and a parallel pair would each see the other's diff as drift.
Land CONTRACT-009 first (it is the smaller, better-specified one) or CONTRACT-007 first — but
regenerate, run the drift check, and get the suite green **between** them, so a failure is
attributable.

**The thing that makes this section different from every previous contract sprint**: three of these
changes make `apps/server` stop compiling, and one changes what `apps/cli` prints. `packages/contract`
must not fix either (SPEC.md §9.3). The sequencing lives in Open Conflicts 5, 6 and 7 and the
criteria below assume it was adjudicated first.

#### CONTRACT-009 — multipart `createThread` and the declared 413 (9 criteria)

```
TEST-43: `POST /api/threads` accepts a multipart variant mirroring capture
  Given: `POST /api/capture`'s declared shape — `multipart/form-data` only, with
         `AttachmentFilesSchema` published as `{type:"array", items:{type:"string",
         format:"binary"}}` under the part name `files`
  When:  `createThread` is regenerated
  Then:  `openapi.json`'s `/api/threads` post declares BOTH `application/json` and
         `multipart/form-data`, the multipart schema's file part is byte-identical in shape to
         capture's, and the part name is `files` (`FILES_FIELD`)

TEST-44: The JSON form is untouched
  Given: The shipped `CreateThreadRequestSchema` and its `required: true` body
  When:  A JSON `POST /api/threads` is made through the typed client against the mounted routes
  Then:  It behaves exactly as before — same request shape, same 201 response
         `{thread, anchorId, eventId, warnings}`, same 400/401/404/423. `git diff` on the JSON
         branch of the route definition shows no semantic change

TEST-45: The dual-media invariant is extended, not broken
  Given: `"offers both a JSON and a multipart body on turn-append"` asserts
         `Object.keys(content)` EQUALS `["application/json","multipart/form-data"]` — order
         significant
  When:  The same invariant is extended to cover `createThread`
  Then:  The key order matches turn-append's, the assertion is added rather than loosened, and
         `"types the attached files as an array of binaries"` now covers the new component
         alongside `MultipartAppendTurnRequest` and `CaptureRequest`

TEST-46: The mandatory-body table stays honest
  Given: CONTRACT-004's `"finds every request body in the surface"` asserting
         `expect(bodies).toHaveLength(11)`, the partition already recording
         `"POST /api/threads": true`, and `RULE_EXEMPTIONS === {}`
  When:  The multipart variant lands
  Then:  The count is updated to the true number, `POST /api/threads` remains mandatory (the
         multipart branch requires at least a body or files, exactly as turn-append does), and
         `RULE_EXEMPTIONS` is STILL `{}` — the turn-append precedent (`routes/turn-append.ts`
         mounting a permissive twin and restoring mandatoriness in the handler) is the pattern to
         reuse if a dual-media body needs it

TEST-47: 413 is declared on both multipart upload routes
  Given: `413` appears nowhere in `packages/contract` today, and
         `apps/server/src/attachments/limits.ts` ships an interim `400` with a comment naming this
         rider
  When:  The routes are regenerated
  Then:  `POST /api/threads/{id}/turns` and `POST /api/capture` — and `POST /api/threads` if it
         accepts files — each declare a `413` response with a body from the ApiError union, per
         Open Conflict 4's adjudication

TEST-48: The error union stays closed and coherent
  Given: `ERROR_CODES = [bad_request, unauthorized, forbidden, not_found, conflict, locked,
         internal_error]` and a discriminated union on `code`
  When:  413's body is chosen
  Then:  Either it reuses `ValidationErrorSchema`/`bad_request` (no union change), or a new member
         is added AND every consumer of the union — the CLI's error renderer included — is named
         in the E2E log as needing follow-through. The choice and its reasoning are recorded

TEST-49: The 413 declaration is reachable, not decorative
  Given: `DEFAULT_MAX_FILE_BYTES = 25 MB` and `DEFAULT_MAX_REQUEST_BYTES = 100 MB`
  When:  The server flip lands (Open Conflict 7) and a genuinely over-cap upload is made against a
         real server on 8915 with real bytes
  Then:  The response is `413` with the declared body, on BOTH the pre-parse `Content-Length` path
         and the post-parse path. If the server flip has not landed at verification time, this is
         `DEFERRED → <server rider>` and the log records the interim `400` observed instead

TEST-50: The interim-400 comment is retired with the behavior
  Given: `limits.ts`'s comment stating 413 "follows in the CONTRACT rider"
  When:  The rider lands
  Then:  The comment is updated to describe what ships. A stale comment claiming a future change
         that already happened is spec-code drift and a pr-reviewer finding

TEST-51: UI-008's reference format is restated, not re-derived
  Given: The byte string SERVER-010 pinned and CONTRACT-009's summary repeats:
         `![shot.png](attachments/th_x/2026-07-27T16%3A14%3A46Z/shot.png)` — each path segment
         percent-encoded, display text human-readable
  Then:  It appears verbatim in CONTRACT-009's E2E log. UI-008 resolves this string and cannot
         guess it; it is `Record<string, unknown>`-grade and the type system will not catch a
         rename
```

#### CONTRACT-007 — the forms surface (13 criteria)

```
TEST-52: The form fence grammar is pinned before anything consumes it
  Given: SPEC.md §6's entire specification — "a fenced ```form block (YAML: a prompt + options)"
         — with no field names, no id, no cardinality and no free-text rules (Open Conflict 4a)
  When:  The grammar is decided
  Then:  It is written down with: the fence info-string, every YAML field with its type and
         optionality, whether a form carries an identity distinct from its turn timestamp, whether
         options are single- or multi-select, and whether a free-text note is separate from the
         chosen option. Per SHARED-002's process rule, a grammar this user-observable lands with a
         SPEC.md §6 amendment drafted by spec-writer and held for user sign-off at the phase PR

TEST-53: The form-answer request schema validates against the fence it answers
  Given: A thread whose last agent turn carries a form with options [A, B]
  When:  An answer naming option "C" is submitted, and one naming "A" is submitted
  Then:  "C" is rejected with `400` and a non-empty `issues` array naming the offending field;
         "A" is accepted. Validation against the fence's own options is the point — a schema that
         accepts any string is not a forms surface

TEST-54: The submission route is declared and inventoried
  Given: `"declares exactly the endpoints the pinned inventory names"`
  When:  The route is added
  Then:  It appears in `ENDPOINT_INVENTORY` (`src/routes/inventory.ts`) in the same change,
         `openapi.json` declares exactly the inventory's set, and the route carries a summary
         (`"gives every operation a summary"`)

TEST-55: The route obeys every standing response invariant
  Given: The named invariants in `openapi.test.ts`
  Then:  It declares `401`; declares `400` because it validates request input; declares no `500`;
         declares the optional actor header (it is a mutation); and keeps the acting party out of
         the request body

TEST-56: An answer appends a real turn
  Given: SPEC.md §6 — "submitting appends a structured answer turn (chosen option + optional note)"
  When:  An answer is submitted against a real server on 8915
  Then:  A new turn exists in the thread's markdown on disk with the `## user · <ISO ts>` heading
         format §6 requires, its body renders the chosen option and any note as readable markdown,
         and the file is auto-committed with `user` as git author

TEST-57: An answer enqueues exactly one `form.respond` event
  Given: `CORE_QUEUE_EVENT_TYPES` already contains `"form.respond"`
  When:  The answer lands
  Then:  Exactly one `evt_*.json` appears in `.corpus/queue/pending/` (counting `evt_*.json` only,
         never `.gitkeep`) with `type: "form.respond"` and a payload matching the pinned shape

TEST-58: The `form.respond` payload shape is pinned in the contract
  Given: `QueueEventSchema.payload` is `z.record(z.string(), z.unknown())` for every event type,
         with no per-type union to extend
  When:  The payload is specified
  Then:  Its shape is declared in the contract (as a named schema, whatever the mechanism), it
         names the thread and the answered form unambiguously, and a round-trip test covers it.
         Whether `QueueEventSchema` gains a discriminated union or the payload is documented
         beside it is stated with reasoning — plugins own their own payload shapes (§7) and the
         open `type: string` must survive

TEST-59: An answered form leaves Attention; an unanswered one is in it
  Given: `NEEDS_REASONS` already contains `"form"` and `docs/needs.ts` already implements a
         detector
  When:  `GET /api/docs?needs=form` is queried before and after an answer
  Then:  The thread is present before and absent after. If the detector must change to recognize
         the pinned fence grammar, that is a SERVER change — named, not made here (Integration
         Points)

TEST-60: `resolve` and `reopen` return their §14 warnings
  Given: Both return a bare `ThreadSummarySchema` today, while
         `apps/server/src/threads/routes.ts` computes warnings and only logs them
  When:  The rider lands
  Then:  Both responses carry `warnings` with the same `warningsField` shape every other mutation
         response uses, and a real `resolve` against a workspace whose git hook rejects the
         auto-commit returns a non-empty `warnings` array over real HTTP

TEST-61: Warnings ride a response wrapper, not the resource
  Given: `ThreadSummary` is a RESOURCE (it appears wherever a thread is summarized), and CARRIERS
         lists only mutation-response components
  When:  The shape is chosen
  Then:  A new response component (e.g. `{thread, warnings}`, mirroring
         `DocMutationResponse`'s `{doc, warnings}`) carries it, `ThreadSummary` itself is
         unchanged, the new component is added to `CARRIERS`, and `"finds no other component
         carrying a differently-shaped warnings field"` still passes. Bolting `warnings` onto
         `ThreadSummary` would put it on every list row and is a fail

TEST-62: `ReapStaleResult` gains `failed`
  Given: `QueueService.reapStale()` already returns `{reaped, failed}` and the route drops
         `failed`
  When:  The schema gains `failed: string[]`
  Then:  A round-trip test covers it, and — after the server follow-through (Open Conflict 5) — a
         real reap that pushes an event past the attempt cap returns it in `failed` and NOT in
         `reaped`, observed over real HTTP on 8915

TEST-63: `Job` gains a nullable origin title
  Given: `JobSchema` has six fields and no title; `lastLine` and `originId` are already
         `.nullable()`, so `"keeps every named component a plain, non-nullable, undefaulted
         object"` is about the component and not its properties
  When:  The field lands
  Then:  `Job` still publishes as a plain non-nullable undefaulted object, the new field is
         nullable, and its rule is written in one sentence for UI-011 and the server to share:
         **the current title of whatever `originId` names, or `null`** (sprint-007 Integration
         Points, restated here because SERVER-018 was struck for its absence)

TEST-64: The new field does not silently become required-and-unpopulated
  Given: `resolveOriginId()` returns an id and never looks a title up
  When:  `GET /api/jobs` is called against a real server on 8915 after the contract change
  Then:  Either the server populates the field (server follow-through landed) or the response is
         still valid because the field's optionality permits it. A response that fails its own
         declared schema is a fail, and the log states which of the two shipped
```

#### Both — artifacts, drift and the blast radius (12 criteria)

```
TEST-65: Generation is idempotent, twice
  Given: `scripts/check-generated-artifacts.ts`, which hashes the artifacts, reruns the generator,
         re-hashes, and also diffs against HEAD
  When:  It is run after each issue's changes
  Then:  It is green TWICE IN A ROW for both `packages/contract/openapi.json` and
         `packages/contract/src/client/schema.generated.ts`. A single green run is not evidence of
         idempotence

TEST-66: The client types come from the committed document
  Given: `buildContractArtifacts()` feeds `openapi-typescript` the SERIALIZED bytes, not the
         in-memory document
  When:  The generated client is inspected
  Then:  Every new route and field is reachable through the typed client — `client.api.POST(<new
         path>)` typechecks — and nothing in the client describes a shape `openapi.json` does not

TEST-67: `docs/cli.md` is unaffected, or regenerated
  Given: `check-generated-artifacts.ts` covers `docs/cli.md` too
  Then:  If a contract change alters any CLI help text or output description, `docs/cli.md` is
         regenerated in the same change; if not, it is byte-unchanged. Either way the check is
         green

TEST-68: The full suite passes in `packages/contract`
  Given: 31 test files and 763 tests in `packages/contract/src` today, and no `test` script in
         that workspace (tests run from the repo root)
  When:  `npm test` runs
  Then:  All pass, the new count is stated, and every invariant this section names is exercised
         rather than relaxed

TEST-69: No invariant was weakened to make a change fit
  Given: The named invariant tests
  When:  `git diff` over `packages/contract/src/**/*.test.ts` is read
  Then:  Every diff either ADDS an assertion or updates a pinned literal (a count, a component
         name) to a new correct value. An assertion deleted, an `expect` loosened, or an entry
         added to `RULE_EXEMPTIONS` is a fail unless explicitly adjudicated and recorded

TEST-70: The blast radius is measured and reported, not discovered later
  Given: `packages/contract` must not edit `apps/server` or `apps/cli` (SPEC.md §9.3)
  When:  The contract changes are built and `npm run typecheck` runs across all workspaces
  Then:  Every resulting type error is captured verbatim in the E2E log with its file:line —
         including `apps/server/src/queue/routes.ts:35` — and each is routed to the named
         follow-through issue. "Typecheck is red" is an expected, reported intermediate state
         here; an unreported one is a fail

TEST-71: The CLI's printed shape change is surfaced
  Given: `apps/cli/src/commands/thread/status.ts:33` calls `context.out.emit(summary)` and the
         verb's help states "One JSON value: the thread summary"
  When:  resolve/reopen return `{thread, warnings}`
  Then:  The E2E log records that `corpus thread resolve --json`'s output shape changes, names the
         CLI follow-through (Open Conflict 6), and notes that `docs/cli.md` must be regenerated
         with the corrected description

TEST-72: The server flip for 413 is named as an issue, not left as a comment
  Given: CONTRACT-009's AC says "server flip noted for a small SERVER follow-up"
  Then:  The follow-up exists as a filed issue id (or a named item folded into an existing sprint
         issue), recorded in `issues/PLAN.md`, not only in a code comment

TEST-73: No route lost a status code it can still return
  Given: `"declares neither 409 nor 423 on the read-only route"` and the per-route 423 list that
         already includes `POST /api/threads`
  When:  createThread gains a media type
  Then:  Its `423` and `404` are still declared, and the multipart branch can return everything the
         JSON branch can

TEST-74: The SSE description is untouched
  Given: `"carries the whole query-key vocabulary in the SSE stream's description"` and the fact
         that this description is what keeps `openapi.json` byte-stable
  Then:  Neither issue adds a query key, and `describeQueryKeyVocabulary()`'s output is unchanged.
         The nine shapes are still nine

TEST-75: Nothing in this section changed the actor discipline
  Given: `"declares the optional actor header on every mutating operation"` and `"keeps the acting
         party out of every request body"`
  Then:  The form-answer route and the multipart createThread both carry the header and neither
         puts `author`/`actor`/`from` in a body

TEST-76: The two issues' commits are separable
  Given: One agent implementing both sequentially
  Then:  The work lands as TWO commits, `[CONTRACT-009]` and `[CONTRACT-007]`, each with the
         artifacts regenerated and the drift check green at that commit. One mixed commit makes
         a later revert of either impossible and is a fail
```

---

### SERVER-014: anchor engine — duplicate-survivor policy

Ports `8920`–`8929`. **9 criteria.** **Model: fable.** This is a POLICY-RESOLUTION issue and it may
legitimately close with **zero production-code change**. The deliverables are a written rationale
and a named reproduction test — not a behavior change. Criteria are written so that "current
behavior blessed" is a first-class PASS and not a shortfall. What is **not** acceptable is closing
it without reproducing, or changing the engine without proving the five closed adjudications still
hold byte-for-byte.

```
TEST-77: The reproduction runs before anything else, and is logged
  Given: `issues/evals/SERVER-013-eval.md`'s four steps — `oldBody` = four wholly-distinct
         paragraphs [A,B,C,D] with one whole-paragraph anchor on B; `newBody` = [C,B,A,B,D],
         leaving B at two locations (offsets 87 and 263, occurrence count 2)
  When:  `reconcileAnchors(oldBody, newBody, anchors)` is run at HEAD, before any change
  Then:  The observed report and resolved range are quoted verbatim in the E2E log. The evaluator
         recorded `{"unchanged":[],"remapped":["anc_b"],"orphaned":[]}` with `resolveAnchor` at
         `[263, 348]`, `exact` and `prefix` byte-preserved and `suffix` rewritten. If HEAD differs
         from that, THAT is the finding and the issue is re-scoped around it

TEST-78: The policy is decided in writing, against §6 as amended
  Given: SPEC.md §6 as SHARED-002 left it: threads orphan when their text is "genuinely gone"; an
         anchor whose text survives keeps its `exact` with "`prefix`/`suffix` refreshed"; a thread
         is re-attached "only to text the edit demonstrably carried forward"; and byte-for-byte
         selector preservation is promised for ORPHANS specifically
  When:  The tension is resolved
  Then:  The issue file carries a written rationale naming (a) current behavior blessed or (b)
         causal orphaning specified, and stating which sentence of §6 governs. Whichever is
         chosen, the rationale explains why B's text is or is not "genuinely gone" when it
         survives at two locations, and why a rewritten `suffix` on a REMAPPED anchor is or is not
         a violation of the byte-preservation promise

TEST-79: The causal rule that already distinguishes the shipped tests is stated in one sentence
  Given: The shipped suite ALREADY contains both `"true duplication during a reorder leaves the
         mapper's choice standing (TEST-65)"` (no orphan, `reconcile.test.ts:648`) and `"a
         non-unique survivor goes through the chain's uniqueness rules: ambiguity orphans, selector
         preserved (TEST-64)"` (orphan, `:662`), and both pass
  When:  The rationale is written
  Then:  It states, in one sentence, the causal property that separates them — the evaluator's own
         reading is *"the mapper produced a trusted slice, so the uniqueness rules never ran"*, and
         the code path is `reconcile.ts:112-146`: `verifiedSurvivor` (the only ambiguity check) is
         reached ONLY on a `"deleted"` classification or a `suspect` mapped slice; an unchanged
         mapped slice takes `newRange: mapped` at line 145 and never consults uniqueness at all.
         A rationale that cannot explain why both shipped tests are simultaneously correct has not
         resolved anything

TEST-80: The named test covers the FAST PATH, not the already-covered one
  Given: The repo's `it(…TEST-64)` fixture has `HIRE` present TWICE in `oldBody` and relocates the
         anchor's own occurrence, so it classifies `"deleted"` and exercises `verifiedSurvivor` —
         whereas the evaluator's reproduction has `B` present ONCE in `oldBody`, duplicated only by
         the edit, and takes the line-145 fast path. **The passing test does not cover the escalated
         scenario**
  When:  The named test is written
  Then:  It uses the exact fixture from TEST-77, asserts whichever policy was chosen, and the log
         states which code path it exercises — demonstrated by the fact that it FAILS if the
         opposite policy is implemented. A test that merely duplicates the existing `"deleted"`-path
         coverage has not discharged the issue. `npm test` passes

TEST-81: No similarity threshold entered the engine
  Given: The standing bar the SERVER-013 evaluation verified — zero float literals and zero code
         references to similarity/fuzzy/score/ratio/threshold/leven in the added lines of
         `reconcile.ts` (the only matches being comments that disclaim similarity)
  When:  `git diff` over `apps/server/src/anchors/` is read
  Then:  The bar still holds. A policy implemented by a threshold is a fail regardless of which
         direction it chose

TEST-82: All five closed adjudications' must-hold suites are byte-identical
  Given: The five anchor adjudications recorded in `.claude/agents/server-dev.md` → Domain
         Knowledge
  When:  The suite runs before and after
  Then:  Every must-hold assertion produces identical results. If code changed at all, an A/B
         sweep in the style of SERVER-012/013 accompanies it with seeds stated; if code did NOT
         change, the log says so and the suite pass is the evidence

TEST-83: TEST-65 and the 68c corner are specifically re-verified
  Given: `"true duplication during a reorder leaves the mapper's choice standing (TEST-65)"` and
         `"EQUAL-text survivor + wholly rewritten slice keeps the mapper's slice — the adjudicated
         corner (68c must-not-fix)"`
  Then:  Both still pass unmodified. These are the two the issue's own summary says a naive change
         would violate

TEST-84: The disk pass confirms the library result
  Given: A real `corpus init` workspace, a document with the reproduction's four paragraphs, and a
         real anchored thread on paragraph B
  When:  The [C,B,A,B,D] edit is applied through the real write path (`PUT /api/docs/{id}` or
         `corpus doc edit`)
  Then:  The `anchors:` map ON DISK and in `git diff` matches the library outcome, the response's
         `anchors: {remapped[], orphaned[]}` agrees with it, and the thread renders inline or under
         detached threads consistently with the chosen policy

TEST-85: The correction lands where the wrong expectation lived
  Given: TEST-64's criterion text asked for orphan semantics AND a byte-preserved selector on what
         is observably a remap
  When:  The policy is blessed (option a)
  Then:  The stale expectation is corrected in the record — the issue file, and
         `.claude/agents/server-dev.md` → Domain Knowledge gains a dated entry stating the rule so
         the next agent does not re-litigate it. If the SPEC's observable behavior changed
         (option b), a SPEC.md §6 amendment rides with it per SHARED-002's process rule
```

---

### SERVER-020: the watcher's tree-key invariant

Ports `8930`–`8939`, primary `8935`. **13 criteria.** The governing invariant is SERVER-018's, and
it is a **biconditional**: *a frame carries `["tree"]` exactly when `GET /api/tree`'s response
changed.* Every criterion here measures the tree on both sides of the edit and reads the frame — a
criterion verified by reading only the frame has verified half the invariant.

```
TEST-86: Both reproduced directions are reproduced BEFORE the fix, on a real server
  Given: A real workspace on 8935 with `curl -N /events` attached and `GET /api/tree` read before
         and after each edit
  When:  (i) an out-of-band edit sets `status: archived` on a document that is the last one in its
         folder, and (ii) a skill file is created under `.claude/skills/<name>/SKILL.md`
  Then:  (i) the tree CHANGED (the folder's count dropped, or the folder disappeared) and the
         frame carried NO `["tree"]`; (ii) the tree did NOT change and the frame DID carry
         `["tree"]`. Both frames and both tree bodies are quoted verbatim

TEST-87: The fix measures rather than guesses
  Given: `folderTreeSignature(db)` exported from `apps/server/src/docs/tree.ts`, and the same
         signature-compare `runMutation` already uses
  When:  The watcher's `flush()` decides the key
  Then:  It compares the signature across the re-projection instead of the `structural` boolean.
         The `structural` heuristic no longer decides `["tree"]` for any path

TEST-88: Direction (i) now satisfies the invariant
  When:  The archive-on-disk edit from TEST-86 is repeated post-fix
  Then:  The tree changed AND the frame carries `["tree"]`

TEST-89: Direction (ii) now satisfies the invariant
  When:  The skill-file creation from TEST-86 is repeated post-fix
  Then:  The tree did not change AND the frame carries NO `["tree"]`

TEST-90: Unarchiving on disk is symmetric
  Given: The archived document from TEST-88
  When:  `status: archived` is removed out of band
  Then:  The tree changed (the folder or its count returns) AND the frame carries `["tree"]`.
         Archive/unarchive symmetry was sprint-007's Open Conflict 13 on the mutation path; the
         watcher path must not reintroduce the asymmetry

TEST-91: A body-only edit still emits no tree key
  When:  `printf '\nmore text\n' >> data/docs/<file>.md` runs out of band
  Then:  The tree is byte-identical AND no `["tree"]` is emitted. The document keys (`["docs"]`,
         `["docs", id]`) still are — the fix must not cost the frame its other keys

TEST-92: A file appearing and disappearing still emits it when the tree really changed
  When:  A new markdown file is created out of band in a NEW folder, then deleted
  Then:  Both frames carry `["tree"]`, and the tree measured either side confirms it changed both
         times. Signature-compare must not become a way to MISS a real structural change

TEST-93: A thread's folder accounting is respected
  Given: `GET /api/tree` counts threads in their PARENT's folder; a standalone thread
         (`parent: null`) contributes nothing; archived documents are excluded
  When:  A parented thread file and a standalone thread file each appear out of band
  Then:  The parented one changes the tree and emits `["tree"]`; the standalone one does neither

TEST-94: An unparseable or ignored file changes nothing
  When:  A file with broken frontmatter, and a file outside every document root, appear out of band
  Then:  No `["tree"]`, no phantom document keys, and the projection is unchanged. The watcher's
         existing "no row means nothing was projected" path still holds

TEST-95: A batch containing several edits emits ONE correct verdict
  Given: The watcher's debounced batch and its per-frame key dedupe (first-seen order preserved)
  When:  A structural edit and three body edits land inside one batch window
  Then:  The frame carries `["tree"]` exactly once and the invariant holds for the batch as a
         whole. A frame carrying `["tree"]` twice, or carrying it because one member of the batch
         was structural while the net tree was unchanged, is a fail

TEST-96: No new key names, and the mutation path is untouched
  Given: The vocabulary is closed at nine shapes and `query-keys.test.ts` fails on a tenth
  Then:  `git diff` shows no key name added anywhere; SERVER-018's mutation-path behavior is
         byte-identical; sprint-007's twelve-hop loop still produces the frames its evaluation
         recorded

TEST-97: The `db rebuild` coarseness is DECIDED, either way
  Given: `REBUILD_QUERY_KEYS = [DOCS_KEY, TREE_KEY, QUEUE_KEY, JOBS_KEY, LOCKS_KEY]`
         (`projection/routes.ts:33-39`), broadcast UNCONDITIONALLY at `:107`; and the SERVER-018
         evaluation's disclosure that this is the one route emitting `["tree"]` on a byte-identical
         tree — "deliberately coarse (SERVER-017)", failing only toward over-invalidation
  When:  The decision is made
  Then:  Either rebuild joins the measured scheme (and a rebuild that changes nothing emits no
         `["tree"]`, verified on a real server), or the coarseness is blessed with a written
         rationale in the issue file explaining why a whole-cache rebuild is not a per-mutation
         frame. **Silence is a fail** — this is the one item the sprint-007 evaluator explicitly
         handed forward

TEST-98: Both directions become regression tests
  Given: SERVER-020's AC
  Then:  Colocated tests cover disk-edit-archive → key present and skill-file-appearance → key
         absent, they fail against the pre-fix `flush()`, and `npm test` passes
```

---

### SERVER-022: server hardening batch — PR #9 MINOR findings

Ports `8940`–`8949`, primary `8945`. **28 criteria, 11 findings.** The issue's AC is *"each item
fixed with a colocated regression test, or explicitly waived with a written rationale in this
file"*. A waiver is a legitimate outcome and needs the same rigor as a fix — what is not legitimate
is an item with no verdict.

**Two findings are being reassigned.** Per Open Conflict 9, finding 4 (`anchors/reconcile.ts`) goes
to the SERVER-014 agent and finding 10 (`watcher/watcher.ts`, `git-head.ts`) goes to the SERVER-020
agent, so all three server issues touch disjoint files and run in parallel. Their criteria stay here
so the coverage is visible in one place; the E2E log records where each landed.

```
TEST-99: Every one of the eleven has a verdict
  Given: The eleven findings
  When:  The issue file is read at close
  Then:  Each carries FIXED (with its regression test named) or WAIVED (with a written rationale).
         An item that is silently absent is a fail, and so is one whose only evidence is "no
         longer reproduces" without saying why

TEST-100: Every fix has a test that fails before it
  Given: `docs/TS_GUIDELINES.md` — "A bug fix lands with a regression test that fails before the
         fix"
  Then:  For each FIXED item the log records the test failing against the pre-fix code and passing
         after

TEST-101: Nothing changed beyond the findings
  Given: The AC's "no behavior changes beyond the findings"
  When:  `git diff` is read against the eleven named locations
  Then:  Every hunk maps to a numbered finding. An opportunistic refactor in a touched file is a
         pr-reviewer finding, not a bonus
```

**Finding 1 — encoded traversal spellings (`attachments/serve.ts`)**

```
TEST-102: The uniform 404 is MEASURED first — this finding may already be defended
  Given: `isUnnormalizedAttachmentTarget()` (`serve.ts:191-202`) compares raw segments against the
         LITERAL strings `""`, `"."`, `".."`, so `%2e%2e` slips past it — but layer 4,
         `parseAttachmentPath()` + `isSafeSegment()` (`serve.ts:22-54`), decodes each segment ONCE
         and rejects the decoded `..`, and the module's own defence-in-depth docstring says a
         second decode pass "is what would open that hole". By static trace `%2e%2e` never reaches
         disk. No test exercises it either way (`grep "%2e"` over the attachment tests: 0 matches)
  When:  Real requests are made to a real server on 8945 for `/attachments/%2e%2e/…`,
         `/attachments/%2E%2E/…`, `/attachments/.%2e/…`, `/attachments/%2f…` and the literal
         `/attachments/../…`, BEFORE any change
  Then:  The status, body and headers of every spelling are recorded and compared. **If they
         already agree, say so** — this finding is then a defence-in-depth consistency item whose
         honest verdict is either FIXED (extend the raw guard so the layers agree explicitly) or
         WAIVED (layer 4 covers it; rationale = this trace). What is NOT acceptable is asserting a
         fix for a difference that was never measured

TEST-103: The bait file is never disclosed
  Given: A file YOU created under your own scratch prefix (e.g. `$SCRATCH/outside/secret.txt`) —
         never `/etc/passwd` on the real machine
  When:  Every traversal spelling above is probed
  Then:  Its contents appear in no response body, and no response is anything but the uniform 404

TEST-104: Legitimate attachment serving is unaffected
  Given: A real attachment stored under `.corpus/attachments/<threadId>/<turnTs>/<name>` whose
         turn-ts segment CONTAINS COLONS and is percent-encoded in the URL
  When:  It is fetched with the correct bearer token
  Then:  200 with the right bytes. A guard that also breaks the legitimate percent-encoded path is
         a fail — this is the exact collision the finding risks
```

**Finding 2 — jobs `retry` race and the cap-notice substring**

```
TEST-105: A retry cannot re-run a job that completed
  Given: the `status === "failed"` check running outside the queue's serialize chain, and
         `requeue` moving from any directory
  When:  A retry and a complete are issued concurrently against the same failed-then-completing
         job on a real server
  Then:  Exactly one wins; the event file ends in exactly one status directory; the job is not
         re-run after completing. If the race cannot be forced reliably over HTTP, a colocated
         test driving the service directly is the required evidence AND the log states why the
         HTTP attempt was insufficient

TEST-106: The one-time cap notice is not detected by reading the log
  Given: `hasCapNotice` (`store.ts:187-197`) reads the last `CAP_NOTICE_PROBE_BYTES` (4 KB) of the
         file and does `buffer.toString("utf8").includes(FILE_CAP_NOTICE)` — a raw substring
         search, not a check that the last JSONL record's `line` field IS the notice
  When:  A job's log legitimately contains a line whose text contains that exact string
  Then:  It is NOT mistaken for the notice; the notice is still emitted exactly once when the cap
         is genuinely reached. Both halves are asserted — a fix that stops false positives by
         never emitting the notice is a fail
```

**Finding 3 — the unanswered-form detector (`docs/needs.ts`)**

```
TEST-107: A ```formula fence is not a form
  Given: `UNANSWERED_FORM_SQL`'s `tu.body_md LIKE '%```form%'`
  When:  An agent turn whose body contains a ```` ```formula ```` fence, and one containing a
         quoted/indented mention of a form fence, are created and `GET /api/docs?needs=form` is
         queried
  Then:  Neither thread appears. A real ```` ```form ```` fence in an agent's last turn still does

TEST-108: A resolved thread leaves Attention
  Given: The detector's missing `t.status = 'open'` guard
  When:  A thread with an unanswered form is resolved and `GET /api/docs?needs=form` and
         `?needs=me` are queried
  Then:  It appears in neither. SPEC.md §11 — handling the reason clears the row

TEST-109: `needs=me` still contains the union it promises
  Given: `needs=me` is the union of unread-reply ∪ form ∪ due ∪ stale ∪ failed-job (SPEC.md §9.2
         as amended)
  When:  One thread of each reason exists
  Then:  All five appear under `needs=me`, and each appears under its own individually-addressable
         reason. Tightening the form predicate must not shrink the union for the other four
```

**Finding 4 — whitespace-only `exact` (`anchors/reconcile.ts`) — reassigned to SERVER-014's agent**

```
TEST-110: An untouched save does not orphan a whitespace-only anchor
  Given: `isBlank(range)` (`reconcile.ts:83-84`) tests whether the NEW BODY'S SLICE trims to
         nothing, and is used both at `:89` inside `verifiedSurvivor` and at `:146`. For an anchor
         whose own `exact` is whitespace-only — schema-valid, since `TextQuoteSelectorSchema.exact`
         only requires `min(1)` — a correctly resolved match necessarily trims to nothing too, so
         `verifiedSurvivor` returns `null` for EVERY such anchor regardless of whether its text
         survives. The guard conflates "the new slice degenerated" (correct) with "the anchor was
         always whitespace" (wrong)
  When:  A document carrying such an anchor is saved through `PUT /api/docs/{id}` with a change
         ELSEWHERE in the body
  Then:  The response's `anchors.orphaned` does not name it, and the selector on disk is unchanged.
         The guard is gated on the `partial`/`deleted` classifications rather than firing blind

TEST-111: The guard still fires where it should, with no contract change
  When:  The whitespace-only anchor's own text IS edited or deleted
  Then:  The classification-appropriate outcome still occurs, and `git diff` over
         `packages/contract` is empty — the finding explicitly says no contract change
```

**Finding 5 — unborn-branch commit swallows the index (`git/commit.ts`)**

```
TEST-112: A fresh-commit mutation stages only its own paths
  Given: The `--only -- <paths>` scoping present on the normal path and omitted on the
         unborn-branch fresh-commit path
  When:  A workspace with an UNBORN branch (`git init`, no commits) has an unrelated file staged
         in the index, and then a document mutation runs through the server
  Then:  `git show --stat HEAD` names ONLY the mutation's paths; the unrelated staged file is
         still staged and uncommitted. Every `git` invocation in this test carries an explicit
         `cwd` into the scratch workspace

TEST-113: The normal path is unchanged
  When:  The same mutation runs on a workspace that already has commits
  Then:  Behavior is byte-identical to today, including the §4 squash window
```

**Finding 6 — template pre-fill ENOENT (`docs/templates.ts`)**

```
TEST-114: A template deleted from under the projection does not fail the create
  Given: `DocumentParseError` is already tolerated on this path and ENOENT is not
  When:  The seeded `note` template file is deleted out of band and `POST /api/docs` for a `note`
         is issued IMMEDIATELY, before the watcher re-projects
  Then:  201, the document is created with an EMPTY body (no pre-fill), and the response carries a
         warning or is silent per the shipped convention — but it is not a 500 and not a refusal

TEST-115: Pre-fill still works, and is still body-only
  Given: SPEC.md §11 as amended by SHARED-002 — "Template pre-fill is body-only: the new
         document's frontmatter comes from the create request, never from the template"
  When:  A `note` is created with the template present and no body given
  Then:  The body is the template's, and none of `type: template`, `for`, or the template's
         `evergreen` bleeds into the new document's frontmatter
```

**Finding 7 — `assertWritable` before the lane (TOCTOU)**

```
TEST-116: A lock acquired while a write is queued still blocks that write
  Given: The guard running BEFORE the lane at all six sites, confirmed —
         `docs/update.ts:79` vs `:81 mutex.run`, `docs/move.ts:32` vs `:34`,
         `docs/archive.ts:98` vs `:101`, `docs/delete.ts:170-171/:180` vs `:183 runInLanes`,
         `threads/create.ts:152` vs `:161`, `threads/cascade.ts:83` vs `:92`. The codebase already
         re-reads CONTENT inside the lane for staleness (`threads/create.ts:149-150`) but never
         re-verifies the LOCK
  When:  A write is queued behind another operation on the same document, and the OTHER party
         acquires the lock in the interval
  Then:  The queued write is refused with 423 naming the holder, not applied. If the interval
         cannot be widened reliably over HTTP, a colocated test that enters the lane deterministically
         is the required evidence and the log says so

TEST-117: The guard runs in every listed path
  Then:  Each of update, move, archive, delete, thread create and thread cascade re-checks inside
         the lane, and each has a test. A fix applied to `docs/update.ts` alone is incomplete

TEST-118: An unlocked write is not slowed into a different behavior
  When:  Ordinary writes run against an unlocked document
  Then:  Same status, same response, same single commit. Re-running the guard must not double a
         side effect
```

**Finding 8 — mark-seen omits `docKey(id)` (`threads/seen.ts`)**

```
TEST-119: Mark-seen emits the thread's own document key
  Given: `seen.ts:127` builds `[DOCS_KEY, threadKey(id)]` and appends `docKey(thread.parent)` only
         when a parent exists — so `docKey(id)` is missing, exactly as the SERVER-018 evaluation's
         observation 2 recorded (`[["docs"],["threads",id],["docs",parentId]]`). It is the SOLE
         outlier: `threads/cascade.ts:118`, `threads/create.ts:208`, `threads/status.ts:56` and
         `threads/turns.ts:145` all build `[DOCS_KEY, docKey(id), threadKey(id)]`
  When:  `POST /api/threads/{id}/seen` runs with `curl -N /events` attached
  Then:  The frame carries `["docs", id]` alongside `["threads", id]`, matching every other thread
         mutation. Both a parented and a STANDALONE thread are tested — the standalone case is the
         one where the missing key has no accidental substitute

TEST-119a: The materiality is stated, not assumed
  Given: `toWireDoc` (`docs/read.ts:209-216`), the response behind `docKey`'s registered refetch
         target `GET /api/docs/{id}`, carries NO `unread` field — `unread` appears only in the
         collection query, which `DOCS_KEY` already invalidates
  When:  The verdict is written
  Then:  It says whether this is a behavioural bug or a pattern inconsistency, with evidence. A
         WAIVED verdict is legitimate here IF the rationale shows no client response changes; a
         FIXED verdict is legitimate on consistency grounds alone (the vocabulary's own comment
         says both `["docs", threadId]` and `["threads", threadId]` are emitted for a turn).
         Claiming a user-visible fix without showing the changed response is a fail

TEST-120: No new key name, and no `["tree"]`
  Then:  Only shapes from the closed vocabulary appear, and mark-seen still emits no `["tree"]` —
         read state does not change the folder tree
```

**Finding 9 — `dataDir` parsed but ignored; phantom lock row**

```
TEST-121: `dataDir` stops being a lie
  Given: `config.ts:81` parses it and `config.ts:298` resolves it into `ServerConfig.dataDir` — and
         that assignment is the ONLY reference in the whole server; `projection/roots.ts:46-95`
         hardcodes `data/docs` and `data/threads`, and its own docstring says they are "spelled out
         rather than derived from the config's `dataDir` … one deriving it differently would be a
         silent split-brain"
  When:  `.corpus/config.json` is edited to a non-default `dataDir` and the server restarts
  Then:  EITHER the roots follow it (honored) OR the server refuses to start with a clear
         validation error naming the field (dropped). Silently continuing to use `data/` is the
         defect. **Given that roots.ts's docstring records honoring it as a deliberate
         non-goal, "drop it with a validation error" is the expected answer** — and reversing a
         documented decision instead would need its own rationale

TEST-122: A lock row keyed by file content is still removed when the file goes
  Given: `project-runtime.ts:236-242` inserts keyed on `lock.data.docId` (the lock FILE'S CONTENT),
         while `removeLock(db, docId)` (`:245-247`) is always called with the FILENAME-derived id —
         from `projectLocksDir`'s `LOCK_FILE` regex and from `watcher.ts:225-227`. `locks/store.ts:127-131`
         already corrects exactly this hazard on the service path (`{ ...parsed.data, docId }`)
         with a comment saying the path is the addressing the API uses; `projectLock` has no such
         correction
  When:  A lock is acquired and released, broken, and reaped — and separately, a
         `.corpus/locks/<id>.json` whose `docId` field disagrees with its filename is planted and
         then deleted
  Then:  `sqlite3 .corpus/cache.db "SELECT * FROM locks"` is empty in every case and
         `GET /api/locks` agrees. A phantom row that outlives its file makes a document render
         read-only forever with a banner naming a holder that released, and today only a full
         `db rebuild` clears it
```

**Finding 10 — watcher `git show` per anchored file — reassigned to SERVER-020's agent**

```
TEST-123: A batch of anchored files does not block the event loop unboundedly
  Given: `git-head.ts:23-36`'s `readHeadVersion` uses **`execFileSync`** with
         `timeout: GIT_TIMEOUT_MS` (5000 ms), called synchronously from
         `reconcile-out-of-band.ts:89` ← `watcher.ts:148-156` ← `flush()`'s synchronous
         `for (const [absPath, kind] of ordered)` loop at `watcher.ts:256-258`. N anchored files in
         one batch means N sequential blocking subprocess calls, each able to hold the process for
         up to 5 s during which NO other request is served
  When:  N anchored documents (N ≥ 20) are touched out of band inside one batch window on a real
         server — e.g. by a `git checkout` that rewrites them — while a second client polls
         `GET /api/health` throughout
  Then:  The health poll's worst-case latency during the flush is recorded, along with the number
         of git invocations and the flush duration, before and after. The per-batch bound is
         stated. "It felt fast" is not a result; state the numbers

TEST-124: Out-of-band reconciliation still uses git HEAD as the pre-edit body
  Given: SPEC.md §6 — the watcher "runs the same reconciliation using the last committed version
         (git HEAD) as the pre-edit body before projecting"
  Then:  Anchors still reconcile correctly for every file in the batch. A bound that costs
         correctness is a fail, and the existing "reconciliation is a repair, not a precondition"
         error path still holds
```

**Finding 11 — FTS control characters (`docs/fts.ts`)**

```
TEST-125: A body containing STX/ETX cannot forge a highlight
  Given: `SNIPPET_OPEN = "\u0002"` / `SNIPPET_CLOSE = "\u0003"` (`docs/fts.ts:8-14`), whose comment
         asserts these are "control characters a markdown corpus does not contain" — an assumption
         nothing enforces: control-character rejection exists only in `attachments/chars.ts` for
         filenames, and `validateBeforeWrite`'s `CHECK_CODES` do not cover body text
  When:  A document or turn whose body contains a literal `\u0002 … \u0003` pair is written and
         then matched by `GET /api/docs?q=<term>`
  Then:  `toSegments` (`fts.ts:74-98`) does not misparse it into a `match: true` segment the query
         never produced. The finding is cosmetic and a WAIVED verdict is acceptable — with the
         forged-highlight behaviour actually observed and recorded, not by omission
```

---

### CLI-008: CLI hardening batch — PR #9 MINOR findings

Ports `8951`–`8959`, primary `8955` (item 1 also needs `8956`). **15 criteria, 5 items.** Same rule
as SERVER-022: fixed-with-regression-test or explicitly waived with a written rationale. Item 4 is
already known to be closed (verify and record) and item 5 is the one with a real design decision in
it.

```
TEST-126: Every one of the five has a verdict
  Then:  Each item in `issues/cli/008-cli-hardening-batch.md` carries FIXED (test named) or WAIVED
         (rationale written). Silence is a fail

TEST-127: No new exit codes, and no registry surprise
  Given: `docs/cli.md`'s fixed set (0/1/2/3/4/5/6) and `registry/validate.ts` rejecting any command
         flag that shadows a global AT MODULE LOAD
  Then:  CLI-008 introduces no exit code and no flag that shadows a global. `corpus --help` at all
         three levels still renders
```

**Item 1 — `probeHealth` ignores `health.workspace`**

```
TEST-128: A foreign server on the port is not mistaken for this workspace's
  Given: `GET /api/health` returns `{status, version, uptimeSeconds, workspace}` where `workspace`
         is "Absolute path of the workspace this server owns", and `probeHealth` compares nothing
  When:  Workspace A's server runs on 8955, and workspace B (a different directory) is configured
         to the same port and `corpus server status` is run in B
  Then:  B reports STOPPED (or an explicit "a different workspace's server holds this port"), not
         RUNNING. The exact output and exit code are quoted

TEST-129: `start` does not write a pidfile for a dead child
  Given: `start` writes the pidfile last on purpose, gated on `waitForHealth` → `probeHealth`
  When:  Workspace A's server holds 8955 and `corpus server start` runs in workspace B on the same
         port, so B's child dies EADDRINUSE while the probe reaches A
  Then:  B's `corpus server start` FAILS with a clear message, exit code per the documented set,
         and `.corpus/server.pid` in B is absent — never a file naming a pid that never became a
         server. This is the failure mode the module's own comment says it exists to prevent

TEST-130: The happy path is unchanged
  When:  `corpus server start` / `status` / `stop` run normally in a workspace with its own port
  Then:  Identical behavior to today: idempotent start reports "already running" and exits 0,
         `status`'s exit code still gates on state, stale pidfiles are still detected and cleaned
```

**Item 2 — `lock break --from agent` silently rewritten**

```
TEST-131: `--from agent` is refused before any request is sent
  Given: `commands/lock/break.ts` hardcodes `header: {"x-corpus-author":"user"}` and never reads
         `context.actor`
  When:  `corpus lock break <docId> --from agent` runs against a real server on 8955
  Then:  Exit 2, a usage error naming the constraint, NOTHING sent to the server (no request in
         the server log, no audit entry, no commit) — mirroring `doc delete`'s shipped guard,
         whose refusal is `"deletion is user-only — the agent archives, never deletes"`

TEST-132: `CORPUS_FROM=agent` is refused identically
  Given: `resolveActor` reads `--from` and `CORPUS_FROM`
  When:  `CORPUS_FROM=agent corpus lock break <docId>` runs
  Then:  Same refusal, same exit 2. A guard that only checks the flag is incomplete

TEST-133: Breaking as user still works and is still audited
  When:  `corpus lock break <docId>` runs with no actor override, and with `--from user`
  Then:  The lock is broken, the break is recorded in the audit trail (commit message), a 404
         "no lock held" is still a no-op exiting 0, and the deferred edit re-enters the queue

TEST-134: The stale module prose is refreshed and the docs regenerate
  Given: `break.ts`'s header still says "the actor is overridden per call", which stops being true
  Then:  The prose describes the refusal, `docs/cli.md` is regenerated, and
         `scripts/check-generated-artifacts.ts` is green
```

**Item 3 — tag edit read-modify-write**

```
TEST-135: The race is documented because there is nothing to mitigate with
  Given: `resolveTags()` does a GET then a PUT of the whole tag list, and the server offers NO
         conditional write — `updateDoc`'s request headers are `ActorHeaderSchema` only, with no
         If-Match/ETag/version anywhere in `packages/contract` or `apps/server`; the only
         concurrency control is the 423 document lock
  When:  The finding is resolved
  Then:  The accepted race is written into `edit.ts`'s module header — naming that two concurrent
         `--add-tag` calls can each read the same list and each write a stale merge — and the
         verdict is recorded as WAIVED-with-rationale. Inventing a conditional write here would be
         a contract change and is out of scope

TEST-136: `--add-tag` / `--remove-tag` still behave
  When:  Tags are added, removed, added-and-removed in one call, and removed when absent
  Then:  The resulting tag list on disk is correct in every case and the document is committed once
```

**Item 4 — `readAll` duplication**

```
TEST-137: Verified closed, with evidence
  Given: `commands/job/log.ts` imports `readAll` and `stdinCarriesABody` from `../../input.js` and
         defines neither; `input.ts:132` holds the single definition; CLI-007's commit message
         states "readAll deduped onto input.ts"
  Then:  The item closes as VERIFIED-CLOSED with that evidence quoted, and `corpus job log
         <eventId>` reading from a piped stdin and from an argument both still work against a real
         server. The socket-hang regression CLI-007 shipped (a real `net.Socket` harness) still
         passes
```

**Item 5 — enforcing the stdin discipline**

```
TEST-138: The enforcement covers every command module, not three topics
  Given: `apps/cli/src/commands/hygiene.test.ts` exists and scans `TOPICS = ["doc","thread","db"]`
         only — so `job/`, `lock/`, `queue/`, `server/`, `init/` and `health.ts` are unscanned, and
         `job/log.ts`'s `process.stdin` reference is invisible to it today
  When:  The stdin rule is added
  Then:  The scan covers every command module under `apps/cli/src/commands/`, and the "finds the
         modules it is supposed to be guarding" assertion is updated to the full list so a new
         command cannot escape the scan by being new

TEST-139: The rule permits nothing it should not, and forbids nothing it must
  Given: `process.stdin` appears in exactly four places today — `input.ts:115` (the `isTTY`
         probe), `input.ts:159` (`readAll(dependencies.stdin ?? process.stdin)`),
         `commands/job/log.ts:43` (the same default-parameter idiom) and
         `commands/doc/delete.ts:67` (`isTTY`) and `:86` (`input: NodeJS.ReadableStream =
         process.stdin`) — two of which are legitimate
  When:  The rule is written
  Then:  It is an ABSOLUTE ban outside `input.ts` (and `testing/stdin.ts`), achieved by moving the
         two legitimate call sites onto accessors exported from `input.ts` — not a ban with
         carve-outs. A rule with per-file exceptions decays; the log states which of the two
         designs shipped and why (Open Conflict 10)

TEST-140: The rule catches a real violation and the socket-hang class stays closed
  Given: `stripProse()` already removes comments and string literals, so prose about stdin is not
         a violation
  When:  A `process.stdin` read is deliberately introduced into a command module and the suite runs
  Then:  It FAILS with a message naming the file — demonstrated, not asserted. And the behavior the
         rule protects still holds: `corpus job log` and every stdin-reading verb run under a
         non-TTY socket harness without hanging, and `corpus doc delete` without `--yes` on a
         non-TTY stdin still exits 2 without consuming piped input as a confirmation
```

---

### INFRA-004: merge Playwright e2e coverage into the combined 90 % gate

Ports `8960`–`8969`, primary `8962`. **14 criteria.** Sequenced last, because it changes the gate
every other issue is measured by. Its premise needs correcting first: **the Playwright suite starts
no server and no CLI today**, so AC 2 has no spawn point (Open Conflict 12). The criteria below are
written against what can be true at the end of this sprint, with the rest named and deferred rather
than pretended.

```
TEST-141: The baseline is recorded before anything moves
  Given: `coverage/coverage-summary.json` from the unit-only run — lines 98.71 % (15653/15856),
         statements 98.71 %, functions 98.48 % (1043/1059), branches 94.73 % (4682/4942)
  When:  Work starts
  Then:  A fresh unit-only run is captured and compared to that baseline, per workspace. Any
         difference is explained before the merge is built, so a later drop is attributable to the
         merge rather than to the sprint's other seven issues

TEST-142: Chromium V8 coverage is collected from the real e2e run
  Given: Playwright's `webServer` runs the Vite DEV server (`npm run dev -- --port ${PORT}
         --strictPort`), so the UI is served as unbundled ESM with dev source maps
  When:  `CORPUS_UI_PORT=5273 npm run e2e` runs with collection enabled
  Then:  Raw V8 coverage is produced for the UI and source-mapped back to `apps/ui/src/**`. The
         log names the mechanism (a CDP `startJSCoverage`/`stopJSCoverage` fixture, or the
         monocart reporter) and shows at least one `apps/ui/src` file with coverage attributed
         from the browser

TEST-143: Source maps actually resolve — proven by a file, not by config
  Given: The issue's own edge case: "Source maps must resolve built artifacts back to `src/` … or
         e2e coverage is silently dropped by the `src/**` include filter"
  When:  The merged report is read
  Then:  At least one specific `apps/ui/src` file's browser-attributed line coverage is quoted.
         A merge that silently contributes zero rows is the failure mode this criterion exists to
         catch, and it looks identical to success in every summary

TEST-144: The merge happens at the istanbul level and loses nothing
  Given: Vitest's v8 provider emits ISTANBUL-format `coverage/coverage-final.json` (converted
         before reporters run) while CDP and `NODE_V8_COVERAGE` emit RAW V8
  When:  The merge runs
  Then:  Both inputs are normalized and combined into one report; nothing is downgraded to lcov
         before merging; and a file covered by BOTH unit and e2e shows the union, not either
         input alone

TEST-145: Files no test ever loads still count as 0 %
  Given: The issue's second edge case — include-based, not seen-based, accounting
  When:  The merged report is read
  Then:  The `include` globs (`apps/*/src/**`, `packages/*/src/**`, `plugins/*/src/**`) and
         `exclude` globs (`**/*.test.{ts,tsx}`, `apps/*/src/bin/**`, `**/*.generated.ts`) are the
         same as the unit run's, and a file loaded by neither runner appears at 0 % rather than
         being absent

TEST-146: The thresholds move — they are not duplicated
  Given: The 90 % thresholds live in exactly one place today (`vitest.config.ts` →
         `test.coverage.thresholds`), enforced by `npm run test:coverage`
  When:  The gate relocates
  Then:  The vitest-only run keeps emitting raw json and NO LONGER enforces the thresholds; the
         merged check enforces all four at 90; and `grep` for the number `90` across the repo's
         config finds exactly one enforcement site. Two gates that can disagree is the outcome to
         avoid

TEST-147: `npm run coverage` reproduces the CI verdict locally
  Given: The issue's AC — "local `npm run coverage` reproduces it"
  When:  It is run on a clean tree
  Then:  It performs unit → e2e → merge → gate and prints the same verdict CI produces, with a
         text summary showing PER-WORKSPACE numbers

TEST-148: CI enforces the merged gate in the right order
  Given: CI's single `validate` job runs `npm run test:coverage` (the gate) and THEN e2e, so e2e
         contributes nothing today
  When:  `.github/workflows/ci.yml` is updated
  Then:  The order is unit → e2e → merge → gate; the gate step's name says it is the MERGED gate;
         and the e2e step's `compgen -G` guard is either kept deliberately or removed with a note
         (13 specs exist, so it always matches)

TEST-149: The gate demonstrably FAILS below 90
  Given: A gate never observed failing has not been verified
  When:  Coverage is forced below the bar on a scratch branch (an excluded file re-included, or a
         thresholds bump, whichever is cleaner)
  Then:  Both the local `npm run coverage` and a real CI run FAIL, with output naming the metric
         and the number. Both failures are quoted in the log

TEST-150: The negative control proves e2e coverage actually counts
  Given: The issue's Testing Strategy — "Deliberately cover one module only via e2e (no unit
         test): the merged gate must count it; removing the e2e spec must drop combined coverage"
         — and the awkward fact that every one of the 13 `apps/ui/src` files is ALREADY at 100 %
         from unit tests
  When:  The control is run
  Then:  A named unit test is TEMPORARILY disabled, the merged number is shown to stay above the
         bar because e2e covers that code, the e2e spec is then also disabled and the number is
         shown to DROP, and both changes are reverted. The two numbers and the reverted diff are
         in the log. Permanently shipping an unit-untested module to satisfy this is a fail

TEST-151: Server and CLI coverage plumbing is seamed, and its gap is named
  Given: `NODE_V8_COVERAGE` appears nowhere in the repo outside INFRA-004's own issue file, and
         the e2e suite spawns NO `corpus` server and NO CLI (Open Conflict 12)
  When:  AC 2 is addressed
  Then:  The seam exists and is exercised the moment such a spawn does — a spawned-process helper
         that sets `NODE_V8_COVERAGE`, demonstrated on at least one real spawn (a scratch spec, or
         an integration test) whose output merges — OR the item is `DEFERRED → <named issue>` with
         the reason recorded. Claiming AC 2 with no spawn point is a fail

TEST-152: The e2e suite is not made flakier by being instrumented
  When:  The instrumented suite runs three times
  Then:  13 passed, three times, with 8765 unbound and `CORPUS_UI_PORT=5273`. Collection must not
         change what the suite asserts; in particular the `expect(uncaught).toEqual([])`
         assertions still hold

TEST-153: The stale documentation is corrected
  Given: `CLAUDE.md`'s Build & Dev Commands says `npm run e2e` is "skipped automatically when no
         specs exist" — describing a state that ended when `smoke.spec.ts` landed
  Then:  That line, and `docs/TS_GUIDELINES.md` → Coverage ("unit + e2e once Playwright specs
         exist"), describe what actually ships after this issue, including the new command name
         and where the gate lives

TEST-154: The 90 % bar actually holds with all of this sprint's code in it
  Given: UI-002 adds a substantial `packages/kit` (one covered line today) and four other issues
         add code
  When:  The merged gate runs on the phase branch with everything landed
  Then:  All four metrics are at or above 90, and per-workspace numbers are recorded. Branches at
         94.73 % is the tightest metric today and the one to watch
```

---

## Cross-Issue Tests

Port `8975`, one `corpus init` workspace, zero stubs, real browser, real server, real CLI.
**12 criteria.** These exist because five of the eight issues in this batch are individually
verifiable and jointly capable of producing a board that looks right and is wrong.

```
TEST-155: The full loop, end to end, once
  Given: A real workspace on 8975, a real server, `npm run dev -w apps/ui` on 5273, and the board
         open in a real browser with UI-002's provider mounted and authenticated
  When:  A document is created with the real CLI, edited on disk out of band, commented on over
         HTTP, replied to as the agent, archived, and finally deleted
  Then:  Every step repaints the board with NO reload; the frames observed on a parallel
         `curl -N /events` are quoted; and each frame's keys are the contract's nine shapes only

TEST-156: The watcher fix is visible in the UI, not just on the wire
  Given: SERVER-020 landed
  When:  A document is archived by editing its frontmatter ON DISK
  Then:  A folder-scoped view in the UI reflects the changed count without a reload. Pre-fix this
         is the exact silent-staleness bug: the tree changed and no key named it

TEST-157: The mark-seen key fix is visible in the UI
  Given: SERVER-022 finding 8 landed
  When:  A STANDALONE thread is marked seen
  Then:  Both the thread view and any list showing its unread state converge without a reload —
         the `["docs", id]` key that was missing is what the list was waiting for

TEST-158: A reconnect recovers a change made while the UI was disconnected
  Given: TEST-33's shape, run in the composed environment
  When:  The server is stopped, a change is made after restart, and the UI reconnects
  Then:  Exactly one refetch burst, correct final state, connection state having passed through
         `reconnecting`

TEST-159: No document content ever crosses the SSE stream
  Given: SPEC.md §2.2 rule 3 — the server never pushes data
  When:  The whole captured `/events` stream from TEST-155 is grepped
  Then:  Zero matches for the document title, any turn body, any anchor quote, any job log line and
         any attachment filename. Every frame is `event: invalidate` with `keys` only

TEST-160: The generated artifacts are green at the tip
  When:  `node --import tsx scripts/check-generated-artifacts.ts` runs on the phase branch tip
  Then:  Green TWICE IN A ROW for `openapi.json`, `schema.generated.ts` and `docs/cli.md`

TEST-161: The whole repo gate is green at the tip
  When:  `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`
         and the merged coverage gate run on the phase branch tip
  Then:  All pass. The test count is stated and compared to today's 201 files / 3415 tests

TEST-162: e2e is green at the tip, with the reserved ports respected
  When:  `CORPUS_UI_PORT=5273 npm run e2e` runs with nothing bound on 8765
  Then:  13 (or more) passed. The `"server unreachable"` assertion still holds, which is only true
         if 8765 is free — confirm with `lsof` and say so

TEST-163: The kit's exported surface is the one UI-003 was promised
  Given: UI-003, UI-004 and UI-011 all declare UI-002 as their dependency
  Then:  UI-002's E2E log carries the verbatim export list from TEST-2, and the query-key table
         from TEST-11, so the next three issues consume a written contract rather than reading
         `dist/index.d.ts`

TEST-164: Every Open Conflict was adjudicated BEFORE implementation, and written back
  Then:  Each conflict below has a recorded decision, and the decision is written into the issue
         file it affects — not only into this contract and not only into a chat message

TEST-165: Every issue's E2E log names its model
  Given: CLAUDE.md's Model Policy — the implementing agent states which model it ran on, as the
         audit trail for recalibrating recommendations
  Then:  All eight logs carry "implemented on: opus | fable". SERVER-014 is the one issue whose
         recommendation is fable; a deviation either way is stated

TEST-166: Nothing was left running and the repo is clean
  When:  The sprint closes
  Then:  No process bound in `8900`–`8999`, nothing on `8765`, nothing on `5273`, no orphaned Vite
         or Playwright children, and `git status` in each worktree shows only intended files
```

---

## Out of Scope

- **The board itself.** UI-003 (columns), UI-004 (rows), UI-005 (reader), UI-006 (editor), UI-007
  (anchored threads), UI-008 (thread view), UI-009 (search), UI-010 (composer), UI-011 (console)
  are all later. UI-002 ships **no chrome**. A dev/debug route rendering hook output is allowed and
  expected for the E2E pass; it must use kit tokens, and whether it is committed or scaffolding is
  stated in the log.
- **Token provisioning as a product feature.** Open Conflict 3 decides the minimum UI-002 needs.
  The installed tool's same-origin token delivery (SPEC.md §2.1) is a SERVER concern and, if it
  needs code, a filed issue — not something UI-002 improvises.
- **`SERVER-016` — the form answer write path.** CONTRACT-007 declares the surface; the producer
  that writes the answer turn and enqueues `form.respond` is SERVER-016 and is **not** in this
  batch. TEST-56/57/59 are therefore verified against whatever handler exists at verification time
  and are `DEFERRED → SERVER-016` otherwise, with the contract-level evidence supplied instead.
- **Populating `Job`'s origin title.** CONTRACT-007's own AC says "the server-side population rides
  with SERVER-016 or a small follow-up". This sprint declares the field and names the follow-up
  (TEST-64); it does not implement the title lookup in `jobs/project.ts`.
- **UI rendering of forms.** UI-008. No form controls are built here.
- **Changing the query-key vocabulary.** Nine shapes, closed. `["health"]` and `["x", …]` are
  kit-owned (Open Conflict 2); neither is added to `packages/contract`.
- **`eslint-plugin-react-hooks`, or any other lint-policy change.** Lint policy is a user-level
  decision (infra-dev's own escalation rule). Open Conflict 11 raises it; it is not implemented
  inside UI-002.
- **A conditional write / ETag on `PUT /api/docs/{id}`.** CLI-008 item 3 resolves to documentation
  precisely because no such primitive exists (TEST-135). Inventing one is a CONTRACT issue nobody
  has filed.
- **Anchor engine behavior changes beyond the adjudicated policy.** SERVER-014 may change the
  policy or bless it; it does not re-open SERVER-002/012/013's five closed adjudications, and
  SERVER-022 finding 4 is a guard placement, not a semantics change.
- **A traversal-defence rewrite in `attachments/serve.ts`.** Finding 1 is a consistency fix; the
  containment and auth properties SERVER-010 shipped and its evaluation verified are not re-derived.
- **Attachment thumbnails, resizing, EXIF stripping, virus scanning, garbage collection.** Still out,
  as in sprint 007.
- **`corpus doc check`, `corpus skill rollback`, `corpus doc unarchive`, `corpus thread create|list`,
  `corpus doc list|show`.** CONTRACT-008 / SERVER-019 / CLI-006 are Phase 4; the rest were
  deliberately not in CLI-003's ACs. Do not add verbs speculatively.
- **The orchestrate and comment skills.** AGENT-002/003.
- **Packaging.** INFRA-008.
- **Rewriting the e2e suite to drive a real server.** INFRA-004 needs one to exist for AC 2
  (Open Conflict 12); writing it is a UI issue's job, not an infra issue's, and TEST-151 permits
  the deferral explicitly.

---

## Integration Points

**CONTRACT-007/009 produce → `apps/server` must consume, in this sprint.** Three of the four wire
changes break compilation in a workspace the contract agent may not edit (SPEC.md §9.3). The
mechanical follow-through, with its known site:

```
ReapStaleResult.failed   → apps/server/src/queue/routes.ts:35
                           `const { reaped } = await queue.reapStale();` → return `failed` too.
                           QueueService already computes it; this is a destructure and a field.
resolve/reopen warnings  → apps/server/src/threads/routes.ts
                           `reportWarnings(...)` already runs; `c.json(thread, 200)` becomes
                           `c.json({thread, warnings}, 200)`.
Job origin title         → apps/server/src/jobs/project.ts — `resolveOriginId()` returns an id.
                           Populating a title is SERVER-016's or a follow-up's (Out of Scope).
413 on over-cap uploads  → apps/server/src/attachments/limits.ts — flip the adjudicated interim
                           400 to 413 and retire the comment that promised it.
```

**CONTRACT-007 produces → `apps/cli` must consume.** `apps/cli/src/commands/thread/status.ts:33`
does `context.out.emit(summary)`, and the verb's help says "One JSON value: the thread summary".
When resolve/reopen return `{thread, warnings}`, `corpus thread resolve --json` changes shape and
`docs/cli.md` must be regenerated with a corrected description. **This is a user-visible CLI output
change and needs a line in the log, not a silent edit.**

**CONTRACT-007 produces → SERVER-022 finding 3 consumes.** The pinned fence grammar is what
`docs/needs.ts`'s detector must recognize. Today it is `LIKE '%```form%'`, which the finding is
fixing anyway. **The two must agree**: if CONTRACT-007 pins the info-string as exactly ```` ```form ````
terminated by a newline, the detector's predicate follows from that and TEST-107's ```` ```formula ````
case is fixed by construction. Whoever lands second reads the other's decision rather than guessing.

**`packages/contract` produces → UI-002 consumes, and this is the sprint's single most important
handoff.** The nine key builders in `packages/contract/src/query-keys.ts` are the vocabulary; the
kit imports and re-exports them and adds exactly two kit-owned shapes. Written as the contract:

```
Core (contract-owned, closed, do not extend):
  ["docs"]                     DOCS_KEY
  ["docs", "<docId|threadId>"] docKey(id)
  ["tree"]                     TREE_KEY
  ["threads", "<threadId>"]    threadKey(id)
  ["queue"]                    QUEUE_KEY
  ["jobs"]                     JOBS_KEY
  ["jobs", "<eventId>"]        jobKey(eventId)
  ["locks"]                    LOCKS_KEY
  ["locks", "<docId>"]         lockKey(docId)

Kit-owned (NOT in the contract, never emitted by the server):
  ["health"]                   the console strip's server probe — invalidated by the SSE
                               bridge's own connect/disconnect transitions, not by a frame
  ["x", "<plugin>", ...parts]  pluginKey() — the SPEC §10 namespace; passed through to
                               invalidateQueries verbatim, never allowlisted away

Collection keys: useDocs(query) caches under ["docs", <canonical filter object>].
Structural comparison keeps that distinct from docKey's ["docs", "<id>"].
```

**SERVER-020 produces → UI-002 consumes.** UI-002's TEST-30 (a direct file write repaints the UI)
runs through the exact watcher path SERVER-020 is fixing. Before SERVER-020 lands, an on-disk
archive will not refresh a folder view and it will look like a kit bug. **UI-002's E2E log states
which of the two orders it verified in**, and TEST-156 is the composed re-check.

**SERVER-018 produced → SERVER-020 extends.** `folderTreeSignature()` is already exported from
`docs/tree.ts` and already used by `runMutation`. SERVER-020 drops the same call into the watcher's
`flush()`. It does not write a second signature function, does not add a key name, and does not
touch the mutation path.

**SERVER-014 and SERVER-022 finding 4 share `anchors/reconcile.ts`; SERVER-020 and SERVER-022
finding 10 share `watcher/watcher.ts`.** See Open Conflict 9 for the reassignment that makes the
three server issues file-disjoint and therefore genuinely parallel.

**INFRA-004 consumes everything.** It runs last, and its negative control (TEST-150) needs the
sprint's other code in the tree to be meaningful. Its gate is what the phase PR is judged by.

**Nobody but the contract agent touches `packages/contract`.** UI-002 needs two key shapes the
contract does not have and must put them in the kit (Open Conflict 2). SERVER-020 needs no new key.
CLI-008 needs no shape change. A shape change from any non-contract issue is a filed CONTRACT issue,
never an improvisation (§9.3).

---

## Merge order (recommendation)

1. **Adjudicate Open Conflicts 1, 2, 3, 4, 4a, 5, 6, 7 and 9 first.** Conflicts 1–3 block UI-002's
   first line of code. Conflicts 4/4a block CONTRACT-007's first schema. Conflicts 5–7 decide
   whether the phase branch typechecks. Conflict 9 decides how the three server agents are
   launched. None of these is discoverable cheaply mid-implementation.
2. **SERVER-014, SERVER-020 and SERVER-022 in parallel, in worktrees**, with findings 4 and 10
   reassigned per Conflict 9. They then touch disjoint files and the parallelism is real.
   SERVER-014 may finish in an hour with no code change; that is a success, not a shortfall.
3. **CLI-008 in parallel throughout.** `apps/cli` is disjoint from everything else in this batch
   except the CONTRACT-007 follow-through on `thread/status.ts`, which lands last inside that same
   worktree.
4. **CONTRACT-009 then CONTRACT-007, one agent, sequential**, each with artifacts regenerated and
   the drift check green between them. **Immediately followed by the server and CLI
   follow-through** (Conflicts 5–7) — the phase branch must not sit red.
5. **UI-002 in parallel from the start**, but **verify its E2E half after SERVER-020 lands** so
   TEST-30's on-disk path is honest. It touches `packages/kit` and `apps/ui` and collides with
   nothing else in the batch.
6. **INFRA-004 last**, alone, holding the e2e suite and ports 8765/5273. Its baseline (TEST-141) is
   only meaningful once the sprint's code is in the tree.
7. **Cross-issue tests (TEST-155…166) after everything**, on 8975.

The batch splits cleanly into five workspaces — `packages/kit`+`apps/ui`, `packages/contract`,
`apps/server` (×3 disjoint files), `apps/cli`, and root tooling. The only genuinely serialized edges
are the contract → consumers follow-through and INFRA-004's exclusive hold on the e2e suite.

---

## Open Conflicts — orchestrator decision required before implementation

### 1. UI-002's issue file prescribes query keys the server never emits (**P0, blocks the phase**)

`issues/ui/002-kit-data-layer.md` → Technical Design publishes, in its own words *"exactly this and
do not deviate"*: `["doc", id]` for a single document and `["thread", id]` for a thread. The shipped
contract emits `docKey(id) = ["docs", id]` and `threadKey(id) = ["threads", id]`, and
`apps/server/src/events/keys.ts` re-exports those very builders precisely so that *"the published set
is the emitted set"* is true by construction.

A kit built to the issue file would cache every reader under a key **no `invalidate` frame ever
names**. Unit tests pass (they assert the kit against itself). The board looks correct. Single
documents and threads never refresh, forever — and the bug surfaces three UI issues later, in
someone else's code.

**Recommendation: the contract wins, unambiguously.** Build every key by CALLING the contract's
exported builders, never by writing a literal — then a future rename is a compile error rather than
a silent divergence. Correct the issue file's Technical Design in place (TEST-7) so the next agent
reading it is not misled. This also disposes of `["jobs", params]`: the list key is
`["jobs", <canonical params>]`, structurally distinct from `jobKey(eventId) = ["jobs", eventId]`,
both invalidated by `JOBS_KEY`.

### 2. UI-002 needs two key shapes the contract's closed vocabulary forbids

The vocabulary is *"nine shapes, no more and no fewer"*, pinned by `query-keys.test.ts` and rendered
into `openapi.json`'s `GET /events` description. UI-002's ACs require a **health** key (the console
strip must converge on connect/disconnect) and a **plugin namespace** (`pluginKey`, SPEC §10). Neither
exists, and adding either to `packages/contract` fails a test and changes a generated artifact for a
key the server will never emit.

**Recommendation: both are kit-owned, and the distinction is documented rather than blurred.**
`packages/kit` re-exports the nine contract shapes verbatim and adds exactly two of its own:
`["health"]` (a client-side probe key, invalidated only by the bridge's own transitions — the server
has no idea it exists) and `["x", plugin, ...]` (which the server CAN emit for plugin routes, and
which the bridge must therefore pass through unfiltered — TEST-18). `packages/kit/README.md` states
which shapes are contract-owned and which are kit-owned, and `git diff` over `packages/contract` is
empty at UI-002's commit (TEST-12).

### 3. The UI has no bearer token, and nothing provisions one (**P0, blocks UI-002's E2E**)

`apps/ui/src/app/apiClient.ts` holds `const UNPROVISIONED_TOKEN = ""` with a comment that names
UI-002 as the issue at which *"the server can inject a real token"*. But `mountStaticUi` serves
`index.html` byte-for-byte with no injection point, there is no `/api/config` route, no
`window.__CORPUS__` global, and no `import.meta.env` / `VITE_*` usage anywhere in `apps/ui`. In
development the UI is served by **Vite**, not by the server, so same-origin delivery does not help.
Today the UI works only because `GET /api/health` is the one route the contract declares
unauthenticated.

Every hook UI-002 adds will 401. `/events` will 401 (it needs `?token=`), and the bridge will enter
its backoff loop against a permanent 401 — which is also what the e2e suite will see.

**Recommendation: split it, and keep the kit's AC honest.**
1. **The kit takes the token as configuration** — that AC is already right and must not bend. The
   kit reads no file, no env, no global.
2. **`apps/ui` resolves it, in one named module**, from a server-injected global when present and
   from `import.meta.env.VITE_CORPUS_TOKEN` in development. The developer exports it from the
   workspace's `.corpus/config.json`; UI-002's E2E log records the exact command used.
3. **File the production half as a SERVER rider** — injecting the token into the served
   `index.html` (or exposing it on a same-origin, loopback-only endpoint) is `mountStaticUi`'s job
   and belongs to a SERVER issue with a number, not to UI-002.
4. **Decide the no-token behavior now**: with an empty token the bridge must degrade *quietly* —
   surface "unauthenticated" through `useConnectionState()`, back off, and produce **no uncaught
   error**, because `apps/ui/e2e/smoke.spec.ts` asserts `expect(uncaught).toEqual([])` in three
   tests that have nothing to do with SSE.

### 4. `413` has no home in the closed error union

`ERROR_CODES` is a seven-member discriminated union on `code`, and `413` appears nowhere in the
contract. CONTRACT-009 must declare it on two (or three) routes and give it a body.

**Recommendation: reuse `ValidationErrorSchema` / `bad_request`.** An over-cap upload *is* a
request-shape problem, the shape (`{code, message, issues[]}`) already carries the field-level
detail an operator needs, and reusing it changes no consumer — the CLI's error renderer, eight
schemas and every `ApiError` narrowing site keep working. Adding an eighth union member for one
status is a wide blast radius for a narrow gain. If the orchestrator prefers a distinct code, TEST-48
requires every consumer be named in the log before it lands.

### 4a. The form fence grammar is three words of spec (**blocks CONTRACT-007**)

SPEC.md §6's entire specification of forms is *"a fenced ```` ```form ```` block (YAML: a prompt +
options)"* plus *"submitting appends a structured answer turn (chosen option + optional note)"*.
There are no field names, no form identity, no cardinality, no free-text rules — and **three
consumers** are about to depend on the answer: `docs/needs.ts`'s detector, SERVER-016's write path,
and UI-008's controls.

**Recommendation: pin the minimum that satisfies §6 and no more, and amend §6 with it.** A prompt, a
list of options, single-select, an optional free-text note; identity by the answered turn's
timestamp unless a second form can appear in one turn, in which case an explicit id. Resist adding
required/optional, validation, multi-select or field types — they are not in §6 and every one of
them is a UI-008 decision made a phase early. Per SHARED-002's adopted process rule, this is
user-observable behavior and lands with a spec-writer-drafted §6 amendment held for sign-off at the
phase PR.

### 5. CONTRACT-007's riders stop `apps/server` compiling (**blocks the phase branch**)

`ReapStaleResultSchema` gaining a required `failed` makes
`apps/server/src/queue/routes.ts:35` — `const { reaped } = await queue.reapStale(); return
c.json({ reaped }, 200);` — a type error. The resolve/reopen change does the same to
`apps/server/src/threads/routes.ts`. `packages/contract` may not fix either (§9.3), and every other
agent in the sprint shares the branch's typecheck.

**Recommendation: the server follow-through is named, owned and sequenced in the same sprint, not
deferred.** Give it to the **SERVER-022 agent** — it is already in `apps/server`, the edits are two
destructures and a JSON shape in files SERVER-022 does not otherwise touch, and it avoids spawning a
fourth server agent. Record it in `issues/PLAN.md` as an explicit named item (a 12th SERVER-022 item,
or a filed SERVER-023 — the orchestrator's call, but it must have a number). **Sequence it to land
within an hour of CONTRACT-007's commit**; a red branch is tolerable for minutes, not overnight.
The fallback — making both fields optional — is worse: it satisfies the compiler by making the
contract lie about what the server always returns, and the CONTRACT-006 CARRIERS invariant requires
`warnings` be *required* anyway.

### 6. CONTRACT-007's rider changes a documented CLI output shape

`corpus thread resolve --json` currently emits the bare thread summary (`out.emit(summary)`), and
`docs/cli.md` — a drift-checked generated artifact — documents it as *"One JSON value: the thread
summary"*. `{thread, warnings}` changes that.

**Recommendation: the CLI-008 agent takes it**, as the last commit in its worktree, after
CONTRACT-007 lands. It is one destructure, one help-text edit and a `docs/cli.md` regeneration.
**Whether the CLI prints the wrapper or unwraps to the thread and surfaces warnings on stderr is a
real product decision** — sprint-007 established that `out.emit()` may be called exactly once and
that human-mode output is separate. Recommendation: **emit the full `{thread, warnings}` under
`--json`** (the agent is the consumer and should see the warnings the server bothered to compute)
and print warnings as indented hints in human mode, matching the existing failure-hint convention.

### 7. The 413 flip is a server change with no owner

CONTRACT-009's AC says *"server flip noted for a small SERVER follow-up"*, and
`apps/server/src/attachments/limits.ts` carries a comment promising it. A note in a comment is not
an owner.

**Recommendation: same disposition as Conflict 5** — fold it into the SERVER agent's follow-through
with a number, and retire the comment in the same change (TEST-50). If the orchestrator prefers to
defer it out of the sprint, TEST-49 becomes `DEFERRED → <issue>` and CONTRACT-009 still lands: a
declared-but-not-yet-returned 413 is honest forward compatibility, an undeclared returned 413 is not.

### 8. SERVER-014 is already resolved by the amended §6 (**a recommendation to close, not to build**)

SHARED-002 rewrote §6's reconciliation clause from a five-step procedure into four behavioral
guarantees, and they settle this shape:

- *"Threads **orphan when their text is genuinely gone**."* In the reproduction, `B` is present at
  two locations. Its text is not gone. Orphaning would contradict this sentence directly.
- *"An anchor whose text the edit left alone keeps its `exact`, with **`prefix`/`suffix` refreshed**
  from the new surroundings."* The evaluator's complaint that `suffix` was rewritten describes
  **required** behavior for a remap.
- *"An **orphaned** anchor always preserves its last selector byte-for-byte."* Byte-preservation is
  promised for orphans. TEST-64's criterion demanded orphan semantics *and* byte-preservation on an
  outcome that is observably a remap — it conflated the two branches.
- *"A thread is re-attached only to text the edit **demonstrably carried forward**, never to a
  lookalike."* Neither candidate is a lookalike; both **are** the text. The diff mapper is the
  demonstration, which is exactly the evaluator's own reading: *"the mapper produced a trusted
  slice, so the uniqueness rules never ran; the choice is positional (diff-derived), not
  arbitrary."*

The code agrees. `reconcile.ts:112-146`: `verifiedSurvivor` — the **only** ambiguity check in the
engine — is reached solely on a `"deleted"` classification or a `suspect` mapped slice. An unchanged
mapped slice takes `newRange: mapped` at line 145 and never consults uniqueness at all. That is not
an oversight; it is the SERVER-002 in-place-edit adjudication holding.

**One correction that changes how the issue should be worked.** The shipped suite does *not* already
cover the escalation. The repo's `it(…TEST-64)` fixture (`reconcile.test.ts:662`) has `HIRE` present
**twice in `oldBody`** and relocates the anchor's own occurrence, so it classifies `"deleted"`,
enters `verifiedSurvivor`, and orphans. The evaluator's reproduction has `B` present **once** in
`oldBody`, duplicated only by the edit — the line-145 fast path. **A green suite is not evidence
this corner is covered**, and TEST-80 exists to make the new test cover the path that is actually
uncovered.

**Recommendation: take option (a), bless current behavior, and spend the issue's budget on the
written rationale and the named test rather than on code.** Require TEST-77's reproduction first
(the finding may have moved since SERVER-013), require the one-sentence causal rule (TEST-79) and
require the Domain Knowledge entry (TEST-85) so this is not re-litigated a fourth time. If the
implementer concludes otherwise, option (b) needs an A/B sweep, must not disturb TEST-63/65 or the
68c corner, and — being a change to user-observable behavior — lands with a §6 amendment per
SHARED-002's process rule. **A "no code change" close is a full PASS here**; do not let an evaluator
read it as an incomplete issue.

### 9. SERVER-020 and SERVER-022 share `watcher/watcher.ts`; SERVER-014 and SERVER-022 share `anchors/reconcile.ts`

Confirmed by inspection, and the intersection is exact. SERVER-020's minimal fix is
`watcher/watcher.ts` — replacing the `structural` boolean in `documentKeys`/`flush()` with a
before/after `folderTreeSignature` compare — plus tests; it needs no edit to `docs/tree.ts` (the
helper is already exported) and none to `projection/`. SERVER-022's finding 10 edits
**`watcher/watcher.ts`** (the `reconcileOutOfBandEdit` call inside `collectDocument`) and
`git-head.ts`. **`src/watcher/watcher.ts` is the single file both need**, in nearby but distinct
code paths. Separately, `anchors/reconcile.ts` is SERVER-014's primary file *and* SERVER-022's
finding 4 — a second same-file collision. No other file in SERVER-022's list overlaps SERVER-020.

**Recommendation: reassign the two findings rather than serialize three agents.** Give finding 4 to
the **SERVER-014 agent** — it is fable-tier, it is already reasoning about the `partial`/`deleted`
classification machinery that the fix must gate on, and it is the one agent qualified to judge that
the gate does not disturb a closed adjudication. Give finding 10 to the **SERVER-020 agent** — it is
already inside `flush()` and already measuring the batch. SERVER-022 keeps nine findings on files
neither of the others touches, and all three run in parallel worktrees with no rebase.

The alternative — SERVER-022 last, sequentially — costs a full serialization of the sprint's largest
server workload to avoid two small reassignments. If the orchestrator prefers to keep SERVER-022 at
its filed scope, **sequence it after both**, and mark TEST-110/111 and TEST-123/124 in the E2E logs
of whichever issue actually landed them.

### 10. The CLI stdin rule has two legitimate violations today

`process.stdin` appears at `input.ts:115` and `:159` (sanctioned), `commands/job/log.ts:43`
(`readAll(dependencies.stdin ?? process.stdin)`) and `commands/doc/delete.ts:67` and `:86`
(`process.stdin.isTTY`, and a default-parameter reader for the confirm prompt). A naive
"no `process.stdin` outside `input.ts`" rule fails on two call sites that are doing the right thing.

**Recommendation: make the rule absolute by moving the call sites, not by carving exceptions.**
Export two accessors from `input.ts` — one returning the stdin stream and one answering "is stdin a
TTY" — and have `job/log.ts` and `doc/delete.ts` use them. The rule then reads "no command module
references `process.stdin`", which is trivially checkable, does not decay as new commands arrive,
and keeps the socket-hang mitigation CLI-007 shipped in exactly one place. Prefer the **hygiene
test** over an ESLint rule: the test file already exists
(`apps/cli/src/commands/hygiene.test.ts`), already strips comments and string literals, and adding
a lint rule would be a lint-policy change, which is a user-level decision. **Widen its `TOPICS` scan
to every command directory in the same change** (TEST-138) — today it does not look at `job/` at
all, which is why the existing reference went unnoticed.

### 11. UI-002 introduces React hooks with no rules-of-hooks lint

`eslint.config.js` has no `eslint-plugin-react-hooks` and no `no-restricted-*` rule of any kind. The
repo is about to gain a hooks package whose whole value is correct subscription lifecycles —
precisely the bug class `rules-of-hooks` and `exhaustive-deps` catch and `tsc` does not.

**Recommendation: raise it, do not fold it into UI-002.** Lint policy is a user-level decision
(infra-dev's own escalation rule says so), and the repo's stated philosophy is that only rules with
real bug risk block. `rules-of-hooks` qualifies; `exhaustive-deps` is famously noisy and would fit
the "warning" tier. **Recommend adding both to `eslint.config.js` scoped to `packages/kit/**` and
`apps/ui/**` — `rules-of-hooks` as error, `exhaustive-deps` as warn — as a small INFRA rider with
user sign-off.** If it is declined, record the decision so the next reviewer does not re-file it.

### 12. INFRA-004's AC 2 has no spawn point

*"Real `corpus` CLI invocations count too: CLI processes spawned in e2e/integration tests run with
`NODE_V8_COVERAGE`."* The Playwright suite spawns the **Vite dev server and nothing else**, and its
own config comment says it *"deliberately does not start a workspace server"*. There is no e2e path
that runs `apps/server` or the `corpus` binary. `NODE_V8_COVERAGE` appears nowhere in the repo.

Compounding it: every one of the 13 `apps/ui/src` files is already at **100 %** from unit tests, so
"a module covered only via e2e" — the issue's own negative control — does not exist to be found.

**Recommendation: scope INFRA-004 to what is true, and name the rest.** Ship (i) Chromium V8
collection source-mapped to `apps/ui/src`, (ii) the istanbul-level merge and the relocated single
gate, (iii) the `NODE_V8_COVERAGE` seam for spawned processes, demonstrated on **one** real spawn
even if that spawn is a scratch integration test rather than a Playwright spec. For the negative
control, use the **reversible experiment** in TEST-150 — disable a unit test, show the merged number
holds because e2e covers the code, disable the e2e spec too, show it drop, revert both — rather than
permanently shipping an unit-untested module to satisfy a criterion. If the orchestrator wants AC 2
fully satisfied, it needs a server-backed e2e spec, which is a UI issue's deliverable and should be
filed as one.

### 13. `pre-push` runs e2e on the wrong port on this machine

`.githooks/pre-push` runs `npm run e2e` with no port override, and `playwright.config.ts` defaults
to `5173`, which an unrelated `ssh` process holds. `strictPort` makes Vite refuse rather than drift,
so **every `git push` from this machine fails at the e2e step** unless `CORPUS_UI_PORT=5273` is
exported in the pushing shell. It also requires `8765` to be free, which this sprint has seven
agents capable of violating.

**Recommendation: INFRA-004 fixes the hook while it is in there** — have `pre-push` default
`CORPUS_UI_PORT` to `5273` when unset (or read it from a documented env), and have it fail with a
clear message when `8765` is bound rather than surfacing a mystifying `"server unreachable"`
assertion failure. Both are two lines and both save the orchestrator a false-alarm debugging session
during the phase PR. If declined, this contract's Verification Environment is the only warning
anyone gets.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above has a verdict** in the evaluator's report — PASS, or
  `STRUCK → Open Conflict N` / `DEFERRED → <issue>` with the reason and substitute evidence
  recorded. Silent omission is a fail.
- **Every Open Conflict was adjudicated before implementation started**, and each adjudication is
  written back into the issue file it affects (TEST-164) — not only into this contract.
- **Each issue's E2E Verification Log is filled with concrete evidence** — actual commands, actual
  output, actual file/git/sqlite/SSE/browser state — and states which model the implementing agent
  ran on (TEST-165).
- **UI-002's log carries the two artifacts the next three UI issues depend on**: the verbatim kit
  export surface and the query-key table (TEST-163).
- **CONTRACT-007's and CONTRACT-009's consumer follow-through has landed**, and the phase branch
  typechecks (Open Conflicts 5–7).
- `npm run build` succeeds in dependency order; `/lint` passes (ESLint, Prettier, `tsc --noEmit`
  across all workspaces); `/test` passes with no regressions.
- **The merged coverage gate is green at 90 % on all four metrics** (TEST-154), and the gate has
  been demonstrated failing below the bar (TEST-149).
- `CORPUS_UI_PORT=5273 npm run e2e` passes with **nothing bound on 8765**.
- `node --import tsx scripts/check-generated-artifacts.ts` is green **twice in a row** — all three
  artifacts (`openapi.json`, `schema.generated.ts`, `docs/cli.md`).
- **`/audit` has been run on UI-002** (P0, cross-domain — this is the plugin contract surface) and
  on **CONTRACT-007/009** (cross-domain, they change a shipped wire).
- **Any user-observable behavior change carries its SPEC.md amendment**, drafted by spec-writer and
  held for user sign-off at the phase PR — SHARED-002's adopted process rule. In this batch that is
  the form fence grammar (Conflict 4a) and, only if option (b) is taken, SERVER-014's policy
  (Conflict 8).
- **pr-reviewer verdict APPROVE** on the phase PR, with CRITICAL and MAJOR findings fixed or
  explicitly waived by the user.
- **No stray processes**: nothing bound in `8900`–`8999`, `8765` free, `5273` free, no orphaned Vite
  or Playwright children, and `git status` clean in every worktree and in the Corpus repository
  (TEST-166).
