# Sprint 025 — A document shows what it costs

**Issues**: CONTRACT-097 · SERVER-166 · CLI-085 · UI-190
**Domains**: contract · server · cli · ui
**Release**: v0.35.0 — _"A document shows what it costs"_ (Phase 59)
**Date**: 2026-09-06
**Test numbering**: continues the ladder from sprint-024's `TEST-1167`; this sprint runs
`TEST-1168`–`TEST-1222` — 55 tests across four lanes.

**The authority is SPEC.md §9.4**, signed 2026-09-06 and already applied. Quoted whole, because
every ruling below is read off it:

> **The workspace measures what its own surface costs.** Every `corpus` invocation reports, after
> its work is done, the size of what the caller wrote and what the command printed — counted
> deterministically as bytes, shown as the workspace's token estimate — attributed to the documents
> and threads the invocation named. The server keeps these measurements as runtime state beside the
> queue: they are telemetry about using the corpus, not part of it — never a document, never
> committed, absent after a rebuild and none the worse for it. Each document's view can show its own
> cost over time (§10), beside its size, so "is working with this document getting more expensive as
> it grows?" is answered by looking rather than by feeling. A report that fails to arrive costs the
> command nothing and is never retried: the measurements are advisory, and no verb's outcome may
> depend on the telemetry channel. _(Rider signed 2026-09-06.)_

The design constants are SHARED-079's and are not reopened here: bytes ÷ 4 as the house estimate,
fire-and-forget reporting, telemetry as runtime state beside the queue, the panel with the document
rather than in the console, and the goal metric — **cost over time per document**, so that flat cost
against a growing document is Phase 57's bounded reads visibly working.

---

## What this wave is

One chain, four links, strictly sequential: the wire, the ledger, the measurement, the panel. Each
link is unverifiable until the one before it exists — a CLI report has nowhere to go without the
server, and the panel has nothing to draw without the CLI. There is no parallelism to find here, and
pretending otherwise buys a batch of agents blocked on each other.

The pre-flight verified every premise against the tree, read-only. **The chain holds**, and three
things the issue files assume are not true of the built system. None of them is fatal; two of them
change the implementation, and one of them would have destroyed the feature quietly:

- **The house estimate does not exist in product code.** It exists once, in repo tooling, and
  nothing under `apps/` or `packages/` can import it (P2). CONTRACT-097 is establishing it, not
  reusing it.
- **The dispatcher's fire-and-forget hazard is inverted.** CLI-085 reasons that a detached POST
  races process exit and may be lost. The CLI does not call `process.exit` on its normal path, so an
  un-awaited request holds the process open until it settles: the hazard is added latency on every
  invocation, not loss (P5). The mitigation is the opposite of the one filed.
- **The obvious implementation of "absent after a rebuild" wipes the series on every server
  restart** (P9). The rider says rebuild. The mechanism that would deliver it also runs at boot.

---

## Premise checks — verified read-only against the tree, 2026-09-06

No git, no builds, no installs, no test runs (a rehearsal pass holds the machine).

### P1 — the rider is §9.4, and §10 has no line to cite

§9.4 is the whole of the signed text, and it cross-references §10 for the panel. **§10 itself carries
no sentence about cost, and none about a document's size in the reader** — a grep of §10 for both
words returns only the layout-stability rule and unrelated prose. So UI-190's "Spec References: §10"
points at text that does not exist. The panel's authority is §9.4's own sentence plus SHARED-079's
recorded placement reading, which is sufficient. **No §10 text is drafted or added this sprint**
(Ruling R10): an unsigned rider does not enter SPEC.md, and nothing here is blocked on one.

### P2 — the house estimate is repo tooling, and product code cannot reach it

`BYTES_PER_TOKEN = 4` and `tokensOf` live in `scripts/skill-budget.ts:44` and `:53`, added by
INFRA-038. `scripts/` is the development harness: a grep across `apps/` and `packages/` for any
import of it returns nothing, and it is not a workspace anything depends on.

So **CONTRACT-097 introduces this number to the product for the first time.** Two consequences the
issue does not name. The rounding mode is a decision, not an inheritance — the repo's existing
meaning of the number is `Math.round` — and it must be written down, because `wc -c ÷ 4` reproducing
the panel's figure is the entire value of the estimate. And the declaration belongs in
`packages/contract` rather than the server, because three consumers need it: the server derives,
the UI labels, and the CLI's help note names the unit.

### P3 — every byte the CLI prints passes one seam, with exactly one exception

`bin/corpus.ts:14-15` is the only place the real streams are named. It wraps them in `guardPipes`
(`pipe.ts:104`), which returns two `Writer`s, and hands those to `run()`. `run.ts` receives writers
and never touches a stream — deliberately, and the pipe guard's own docblock says so. Everything a
verb prints goes through `Output` (`output.ts`), which is constructed over those two writers at
`run.ts:41` and again at `run.ts:69`.

A grep of `apps/cli/src` for `process.stdout`, `process.stderr`, `console.log`, `console.error` and
`console.warn`, excluding tests, returns **five hits in `pipe.ts` and `bin/corpus.ts` — the seam
itself — and one real bypass**: `promptOnTerminal` (`commands/doc/delete.ts:87`) defaults its output
to `process.stderr` and writes the confirmation prompt through `readline`.

That bypass is user-only and interactive: `corpus doc delete` refuses `--from agent` before any
request is sent, so the prompt is never on the agent's loop, and `readline` owns the stream it is
given. See Ruling R3.

### P4 — the counter's position decides what the number means

`guard()` (`pipe.ts:111-140`) stops writing after a broken pipe: `if (broken) return`. So a counter
placed **inside or below** the guard measures bytes actually delivered, and a counter above it
measures bytes attempted. The two differ exactly when a reader closed the pipe. `wc -c` on a
redirect measures delivered bytes, so the reproducibility rule in P2 chooses the position (R2).

### P5 — the exit path delays a pending report, it does not truncate it

`bin/corpus.ts:23` sets `process.exitCode = await run(…)`. It never calls `process.exit()` on the
normal path. Node then exits when the event loop drains — **so an un-awaited `fetch` keeps the
process alive until the request settles.** CLI-085's premise ("a detached POST races process exit")
is therefore inverted: nothing is lost, and a slow or hanging server adds its full latency to every
invocation. That is the failure mode to design against.

There is exactly one place the process is killed outright: the pipe guard's `quit`, which calls
`process.exit(0)` (`bin/corpus.ts:19`) on a broken pipe. A report in flight at that moment is lost,
which is correct and costs nothing.

The shared client makes this worse if used: `client.ts:125-158` maps `ECONNREFUSED` and friends to
`ServerUnreachableError` — "server not running for this workspace — run `corpus server start`" —
which is exit code 4 (`client.test.ts:212`). It does not retry. See R6.

### P6 — no command path reaches a handler, and `batch` loses the topic

`run.ts:101` passes `resolution.command` into `invoke`, and `CommandContext`
(`registry/types.ts`) carries `args`, `flags`, `out`, `cwd`, `env`, `version` and `registry` — no
topic, no resolved path. `commandSynopsis` (`help.ts:86-87`) shows the composition (`${topic}
${command.name}`) but is a help renderer.

So `"thread show"` must be **composed where the resolution still exists** — in `run.ts`, beside the
dispatch — and threaded to the reporter. Inside `batch`, the same composition has to survive into
each prepared entry, or entries report a label instead of a path.

### P7 — nothing in the registry marks a value as a document id

`ArgSpec` is `{ name, required, description, variadic? }` (`registry/types.ts:56-61`). There is no
type field, and ids arrive **both** as positionals and as flags: `thread create --parent`
(`commands/thread/create.ts:196`), `doc list --parent` (`commands/filters.ts:158`, which carries
`valueName: "doc-id"` — a rendering hint, not a type). A count of flags spelling a `doc-id`,
`thread-id` or `id` value name returns five.

CLI-085 requires subjects "from parsed args, not regex over argv", and that is right, but it cannot
be satisfied by reading the registry as it stands. See R7.

Two verb classes name **no** id at all and must report none: `corpus search` and `corpus doc list`
take a query or filters and return ids only in their output. Attributing a listing's cost to the
documents it *returned* would be a different metric from the one §9.4 defines.

### P8 — a batch entry's payload never reaches stdout

`createNestedOutput` (`output.ts:151-190`) gives each entry an `Output` whose `emit` **captures**
the value (`output.ts:165-167`) instead of writing it; `write` is routed through `line`, and the
composite report is what the process finally prints.

So per-entry `readBytes` must be counted inside the nested output, and **the sum over entries will
not equal the process's stdout bytes**. The difference is the batch's own report framing, measured
at ~77 B an entry in Phase 57, and it belongs to no subject. This must be stated rather than
discovered by whoever first adds the two numbers up.

### P9 — "absent after a rebuild" is one line away from "absent after every restart"

This is the finding that matters most.

`PROJECTION_TABLES` (`projection/schema.ts:228-244`) is the declared table set, and
`projection/db.test.ts:330-350` asserts the live database's tables equal it **in both directions** —
so a new table that is not declared fails a test immediately.

`REPOPULATED_TABLES` (`projection/schema.ts:262-275`) is a different list: "tables cleared by a full
repopulation". `chunk_embeddings` is deliberately absent from it, with the reasoning written out
above the declaration. **That list is not rebuild-only** — the boot repopulation clears it too. A
telemetry table added to `REPOPULATED_TABLES` would therefore be emptied by every ordinary
`corpus server stop && corpus server start`, which is not what §9.4 says and is not a behaviour any
test in the batch would have caught.

The correct shape: **declare the table in `PROJECTION_TABLES`, keep it out of `REPOPULATED_TABLES`.**
A rebuild constructs a fresh database file and carries nothing over except the embeddings, so the
series is empty afterwards with no code written for it — exactly §9.4's "absent after a rebuild",
and nothing more.

A second consequence, honest and unavoidable: `SCHEMA_VERSION` is 24 (`schema.ts:221`) and a version
bump supersedes the database file. SERVER-166's own bump therefore starts the series at zero, and
every future bump resets it again. The rider tolerates this. The panel should not pretend otherwise
— see O4.

### P10 — the doctor cannot see a new table, and must not learn to

`inspectProjection` (`projection/doctor.ts`) runs exactly two drift checks: `checkDocuments`, whose
`orphan_row` pass iterates the **documents** rows explicitly (`doctor.ts:230-237`), and
`checkEvents`, which compares the `events` count against `evt_*.json` files on disk
(`doctor.ts:249-262`). Nothing enumerates `sqlite_master`, and nothing is generic over tables.

So a fileless telemetry table is invisible to the doctor by construction. `DRIFT_KINDS`
(`schemas/db.ts:95-102`) is closed at six kinds and **stays closed** — telemetry adds none. The
queue's count check is the precedent for a table with no per-file bookkeeping, and telemetry is one
step further: it is checked by nothing, because there is nothing to check it against.

### P11 — the document's byte size is already in the projection

`file_hashes(path TEXT PRIMARY KEY, hash TEXT, size INTEGER NOT NULL, mtime_ms INTEGER)` —
`projection/schema.ts:580-585` — and it is written on every projection
(`project-document.ts:661`, deleted at `:301`). `documents` carries `path`, so the size joins
directly.

**Neither CONTRACT-097 nor SERVER-166 needs to compute or store a size**, and the series route needs
no filesystem read. What that column holds is the file's current byte length, frontmatter included —
a single present-tense number, never a history. The reference line is therefore a horizontal line at
today's size, not a second series, and the panel must say what it is showing.

### P12 — the reader shows no size, and the repository has no chart

`Doc` carries no size field, and the reader prints none. And there is **no charting dependency
anywhere**: `apps/ui/package.json`, `packages/kit/package.json` and the root manifest match nothing
for `chart`, `d3`, `recharts`, `victory`, `visx` or `plotly`, and no file under `packages/kit/src`
contains an `<svg>` element at all.

**UI-190 introduces this repository's first chart.** It is filed as a panel and priced as one. See
E1 and E2.

### P13 — the panel goes below the body, and one insertion serves both views

`DocView.tsx:325-353` records, in prose, a measured **77.86px** downward shift (306.69 → 384.55)
caused by a panel that rendered *above* the body and arrived after the editor had painted — on the
surface where text is selected in order to comment on it, so a body that moves between mousedown and
mouseup silently yields a selection over words nobody chose.

`Backlinks` and `RelatedPanel` render at `DocView.tsx:628-629`, below the body, and that call site is
downstream of the document/thread branch — so **one insertion there serves ordinary documents and
`type: thread` documents, in the column reader and in focus mode**. `related.spec.ts` proves the
pattern with `.reader .related` and `.focus .related`.

`RelatedPanel` renders `null` when empty, a rule its docblock attributes to `Backlinks`: a heading
over nothing is a claim that something was searched and found wanting. UI-190 requires the opposite
— an honest "no measurements yet" — which is a deliberate deviation and must be argued in the
component's own docblock rather than left to look like an oversight.

### P14 — threads are documents, so one route serves both views

SPEC.md:219 — a document with `type: thread` carries the thread fields additionally. The contract's
`docKey` docblock says it outright: "Threads are documents, so a thread id is legal here."
`GET /api/docs/{id}/cost` therefore covers UI-190's "reachable from the document and thread views"
with no second route and no second key.

---

## Rulings — binding, not open

**R1 — one definition of the token.** `packages/contract` exports the constant and the conversion.
The CLI reports **bytes only** and converts nothing. The server derives tokens in exactly one place,
by calling the contract's function. The UI labels the unit in the same words the CLI help uses. The
rounding mode is recorded in the export's docblock (P2).

**R2 — the counter wraps the two writers in `bin/corpus.ts`**, at the pipe guard's seam, below
`Output`. That covers every verb at once including ones added later — the reason the guard lives
there — and it counts **delivered** bytes, so `corpus … > f && wc -c f` reproduces `readBytes`
exactly (P4).

**R3 — `doc delete`'s prompt is a recorded exclusion, not a re-plumbing job.** Route it through an
injected writer if that is a free change; otherwise record it in the issue as the one write past the
funnel, with its argument: user-only, interactive, never on the agent's loop. Do not rewrite
`readline`'s stream ownership to chase a confirmation prompt's bytes.

**R4 — the report is awaited under a hard cap, not detached.** P5 shows a detached request holds the
process open anyway, so detaching buys nothing and costs determinism. Use `AbortSignal.timeout` at
the budget CLI-085 sets, wrap the whole thing so that no error can escape, and **never retry, never
buffer to disk, never print**.

**R5 — no new dependency.** `startup-cost.test.ts` pins the CLI's startup-path third-party imports
to exactly three (`@corpus/contract`, `@corpus/contract/client`, `zod`). Telemetry uses global
`fetch` and nothing else. A fourth entry is a decision, not an import.

**R6 — the telemetry POST does not go through `createClient`.** It builds its own request from the
workspace's base URL and token so that `ServerUnreachableError` and exit code 4 (P5) are structurally
unable to reach it.

**R7 — subjects are the ids the invocation named in its own parsed input**, positional or flag,
never ids read out of a response. The extractor is **registry-driven**: add a declared marker to the
argument and flag specs, checked by `validateRegistry`, so "which ids does this verb name" is a
property of the command surface rather than a heuristic. A regex over parsed *values* is the
fallback the implementer may argue for in writing. A regex over argv is not available (P7).

**R8 — telemetry announces nothing.** No SSE frame, no new query key. The contract's key vocabulary
is closed and its rendered description is part of `openapi.json` (`routes/events.ts:49`), so a new
shape is a contract change for a stream that should carry nothing. The panel's query hangs under the
docs prefix — `["docs", id, "cost"]`, following `relatedKey` at `packages/kit/src/query/keys.ts:165`
— so it refreshes on frames that already exist. **The panel is not live to the ledger**, by design: a
frame per CLI invocation would put the telemetry channel on the hot path it exists to measure.

**R9 — the table is in `PROJECTION_TABLES` and out of `REPOPULATED_TABLES`** (P9), with a named test
asserting the absence and stating its reason, as the repository already does for `chunk_embeddings`.

**R10 — no SPEC.md change this sprint.** §9.4 is signed and applied; §10 gets no new text (P1).

**R11 — ingestion reads nothing.** One INSERT batch, no SELECT, no commit, no git, no event. This is
a property to assert in a test, not an intention to state in a comment.

---

## Machine rules — binding on every agent in this batch

- A rehearsal pass may be running. **Run scoped tests only** — `VITEST_MAX_THREADS=4
  ./node_modules/.bin/vitest run <path>`. The orchestrator's harvest gate is the single repo-wide
  run.
- **One heavy command at a time.** Never overlap a build, a test run, an e2e run or an install.
- **`bench:startup` is measured once, deliberately.** It needs `npm run package:build` and a warm
  server, and it spawns 25 processes per command by default. It is CLI-085's single most expensive
  step: schedule it alone, record the number, and do not re-run it to make it look better.
- Playwright is single-holder. Never start it while another e2e run or dev server is up.
- Kill every process you start, and verify your ports are free before reporting.

---

## Acceptance Tests

### Group A — the wire (contract-dev) · CONTRACT-097

**TEST-1168: the token estimate is declared once, in the contract**
Given: the repository
When: the bytes-to-token estimate is located
Then: exactly one exported constant and one exported conversion live in `packages/contract`; no
second definition and no bare division by four exists anywhere under `apps/`; `scripts/skill-budget.ts`
is unchanged and is still not imported by product code

**TEST-1169: the rounding mode is stated and pinned**
Given: the conversion function
When: it is called with 1, 2, 3, 6 and 4001 bytes
Then: every answer matches the rule named in its own docblock, and the docblock says why the rule
matters — that `wc -c` divided by four must reproduce what the panel shows

**TEST-1170: ingestion accepts one invocation and a batch**
Given: the mounted contract
When: `POST /api/telemetry/invocations` is called with a single-invocation body, then with
`{invocations: [ … ]}`
Then: both validate and answer 204; a body that is neither form is rejected as a 400 naming the
field, and the batch form is documented as existing for a future buffering CLI rather than for
today's

**TEST-1171: the success answer carries no body**
Given: the ingestion route definition
When: its responses are read
Then: 204 is declared as a bare description with no content, exactly as
`POST /api/docs/{id}/edit-session/flush` declares it, and no 2xx response on this route carries a
schema

**TEST-1172: the description says the channel is advisory**
Given: the ingestion route's description
When: it is read
Then: it states, in those terms and citing SPEC.md §9.4, that loss is acceptable, that the report is
never retried, that idempotency is not promised, and that no verb's outcome may depend on this route

**TEST-1173: an invocation may name nothing**
Given: the ingestion schema
When: `subjects` is read
Then: an empty array is legal, and the field's description says that a verb which names no document
— a search, a listing — reports zero subjects rather than attributing its cost to the ids it
returned

**TEST-1174: the series is a document subresource on the shared id shape**
Given: the contract
When: `GET /api/docs/{id}/cost` is read
Then: its path parameter is built from `DocumentIdSchema` and declared locally as its `/api/docs/{id}/…`
siblings declare theirs; a `th_*` id is legal (P14); a malformed id is a 400 before any handler runs

**TEST-1175: a bucket is fully described and the granularity is stated**
Given: the series response schema
When: it is read
Then: each bucket carries `from`, `to`, `wroteTokens`, `readTokens`, `invocations` and `byCommand`;
timestamps use the contract's existing ISO datetime shape; and the response **names the granularity
it chose** rather than leaving a caller to infer it from two boundaries

**TEST-1176: the series carries the document's size, and says what it is**
Given: the series response schema
When: the size field is read
Then: it is the document's current byte length including frontmatter, described as the panel's
reference line, and described as a **present-tense** number rather than a history — because
`file_hashes.size` holds one value and the panel must not imply a second series (P11)

**TEST-1177: truncation uses the vocabulary that already exists**
Given: the series response
When: its bounding is read
Then: it spells `total` and `truncated`, per `JobList`, and introduces no third spelling; the newest
buckets are the ones kept, and the description says so

**TEST-1178: the artifacts regenerate byte-identically and the inventory agrees**
Given: the two new routes
When: the contract's generator runs twice and the package's tests run
Then: the generated OpenAPI document and typed client are byte-identical across both runs and
committed in sync; the endpoint inventory names both routes; every operation declares 401, the two
that validate input declare 400, and both carry a summary

**TEST-1179: the SSE key vocabulary is untouched**
Given: the contract before and after
When: the query-key names and the events route's rendered description are compared
Then: both are unchanged — telemetry announces nothing over the stream (R8)

**TEST-1180: every tag used is registered, in the runtime-state language**
Given: the new routes' tags
When: the document's tag list is read
Then: no route uses an unregistered tag, and a telemetry tag — if one is introduced — describes
itself as derived runtime state with no files and no commits, in the words the `index` tag already
uses

### Group B — the ledger (server-dev) · SERVER-166

**TEST-1181: the table is declared, and the projection's own census passes**
Given: a fresh workspace
When: the projection opens and creates its database
Then: the telemetry table exists, the declared table list names it, and the existing assertion that
the live database holds exactly the declared tables — checked in both directions — still passes

**TEST-1182: a server restart does not wipe the series**
Given: a workspace holding telemetry rows
When: the server stops and starts, so the boot repopulation runs
Then: every row is still there. The table is absent from the repopulated set (R9, P9), and a named
test asserts that absence **with its reason in prose**, as the repository already does for
`chunk_embeddings`

**TEST-1183: `db rebuild` leaves the series empty**
Given: a workspace holding telemetry rows
When: `corpus db rebuild` runs
Then: the series is empty, every document is projected again, and nothing carried the rows across —
this is §9.4's "absent after a rebuild", delivered by the rebuild constructing a fresh database
rather than by a delete written for the purpose

**TEST-1184: `db doctor` is clean with the table full and with it empty**
Given: the workspace from TEST-1182 and the workspace from TEST-1183
When: `corpus db doctor` runs against each
Then: both report ok; no drift entry and no warning mentions telemetry; and the closed drift-kind
set still holds exactly its six kinds (P10)

**TEST-1185: one row per subject**
Given: a running server
When: an invocation naming two subjects is reported
Then: two rows exist, one per subject, each carrying the same timestamp, command path, wrote-bytes
and read-bytes — so a document's series counts the whole invocation, not a share of it

**TEST-1186: an invocation that named nothing is still kept**
Given: a running server
When: an invocation with an empty subjects array is reported
Then: one row exists with a null subject, so workspace-wide cost stays answerable later without
re-reporting anything (SERVER-166's stated reason, preserved)

**TEST-1187: ingestion reads nothing, commits nothing, announces nothing**
Given: a running server on a clean git tree
When: a hundred invocations are reported
Then: the git tree is still clean, nothing under `data/` changed, no SSE frame was emitted, and the
write path issued no SELECT — asserted against the code path rather than inferred (R11). The
measured cost per report is recorded in the issue log

**TEST-1188: the series is correct against a hand-computed fixture**
Given: telemetry rows seeded across three buckets for one document, with byte totals chosen by hand
When: the series is read
Then: each bucket's token figures equal the contract's conversion applied to that bucket's summed
bytes; `byCommand` sums to the bucket total; and `invocations` counts invocations, not rows — a
two-subject invocation counts once in each document's series

**TEST-1189: tokens are derived in exactly one place**
Given: the server
When: the bytes-to-token conversion is located
Then: it is the contract's exported function, called from one site, and no second division by four
exists anywhere in `apps/server` (R1)

**TEST-1190: the size line is read from the projection, not from disk**
Given: a document of known byte length
When: the series is read
Then: the reported size equals that length exactly, frontmatter included; it is read from the
existing per-file size column joined on path (P11); and the request performs no filesystem read of
the document

**TEST-1191: truncation is stated when it bites, and false when it does not**
Given: a document with more buckets than the cap allows
When: the series is read with the default bound and again with an explicit one
Then: the newest buckets are the ones returned, `truncated` is true with `total` greater than the
number returned, and both are correct on a document whose whole series fits

**TEST-1192: retention runs, and the decision is written down**
Given: rows older than the recorded retention window
When: retention runs
Then: those rows are gone and newer rows are untouched. The issue records the window, what triggers
the prune, where it runs, and why the first time-based delete in this server is safe where it was
put — a prune on the ingestion path would put a scan on the channel §9.4 says must cost nothing

**TEST-1193: a rebuild stays deterministic**
Given: the repository's existing rebuild-determinism check
When: it runs
Then: it still passes — nothing writes a telemetry row during a rebuild, so no wall-clock value
enters a comparison that must not carry one

**TEST-1194: both routes are mounted, and auth comes from the mount**
Given: the contract's full route set
When: the server's mounting assertion runs
Then: both new routes are mounted and answer; authentication is inherited from the `/api/*`
middleware, and the new module wires none of its own — the rule the index-maintenance routes state
explicitly

**TEST-1195: the schema version moved once**
Given: the repository before and after SERVER-166
When: the schema version is compared
Then: it advanced by one, in SERVER-166's commit alone, and the issue notes the consequence P9
records: a version bump supersedes the database, so the series restarts on this release and on every
future bump

### Group C — the measurement (cli-dev) · CLI-085

**TEST-1196: one seam counts every byte the CLI prints**
Given: the CLI
When: the counting seam is located
Then: it wraps the two writers where the pipe guard wraps them, below `Output`, so every verb is
covered at once including verbs added later (R2). A test pins that no file outside that seam names
`process.stdout` or `process.stderr`, with `doc delete`'s interactive prompt as the single named and
argued exception (R3, P3)

**TEST-1197: read-bytes match `wc -c`, exactly**
Given: a seeded thread and a running server
When: `corpus thread show <id> --json > out.json` runs
Then: the reported read-bytes equal `wc -c < out.json` with no off-by-one — the trailing newline is
counted the way the file counts it. This is the test that makes the number worth having

**TEST-1198: wrote-bytes count argv and the stdin body, in bytes**
Given: a running server
When: a verb that consumes stdin is run with a known body
Then: wrote-bytes equal the byte length of the joined argv plus the byte length of the stdin body as
read, both as UTF-8; a body containing multi-byte characters is counted in bytes, not characters

**TEST-1199: the command is the resolved path**
Given: the report from TEST-1197
When: its command field is read
Then: it is `thread show` — topic and verb, composed where the resolution still exists (P6) — never
the raw argv and never a truncated label

**TEST-1200: subjects are the ids the invocation named**
Given: a running server
When: `corpus thread show <threadId>` runs, then a verb taking two document positionals, then a verb
taking a document id in a flag
Then: each reports exactly the ids its own parsed input named — positional and flag alike — and a
test proves the extractor is driven by the registry's declarations rather than by scanning argv (R7)

**TEST-1201: a verb that names nothing reports nothing**
Given: a running server
When: `corpus search <query>` and `corpus doc list` run
Then: each produces one report with an empty subjects array. No id is lifted out of the response —
attributing a listing's cost to the documents it returned is a different metric from §9.4's

**TEST-1202: a dead server changes nothing at all**
Given: no server running for the workspace
When: a read verb, a write verb, a failing verb, `--help` and `--version` are each exercised
Then: every one's stdout, stderr and exit code are byte-identical to the same run before CLI-085, and
no output anywhere mentions telemetry, a report, or a failure to send one. **This is the test that
proves §9.4's "no verb's outcome may depend on the telemetry channel"**, and it is asserted as an
absence, not as a tolerated warning

**TEST-1203: the report is never retried and never stored**
Given: a server answering the telemetry route with a 500, and a server that never answers at all
When: a verb runs against each
Then: exactly one attempt is made in each case, the exit code is unchanged, and nothing is written
anywhere on disk to be sent later

**TEST-1204: the reporting path cannot inherit the client's failure surface**
Given: the reporting code
When: it is read
Then: it does not go through `createClient`, so `ServerUnreachableError` and its exit code 4 are
structurally unable to reach it (R6, P5); its own handler swallows every error without printing

**TEST-1205: reporting is bounded in time**
Given: a server that accepts the connection and never answers
When: any verb runs
Then: the command still exits, within the cap CLI-085 records, and the added latency is measured and
written into the issue log against that cap — the hazard P5 identifies, tested directly

**TEST-1206: a broken pipe costs nothing**
Given: `corpus doc show <id> | head -1`
When: the reader closes the pipe
Then: the command exits 0 and silently. Whether a report was sent is deliberately not asserted: the
pipe guard calls `process.exit(0)` immediately, and the issue records that loss as intended (P5)

**TEST-1207: the channel never reports itself**
Given: a running server
When: any verb runs
Then: exactly one invocation is recorded for that verb, and no report names the telemetry POST as a
command

**TEST-1208: the exclusions are declared, not buried in the dispatcher**
Given: the registry
When: the excluded commands are located
Then: `corpus init`, `corpus upgrade` and the server lifecycle verbs are excluded by a **declared
property** that `validateRegistry` checks and the CLI docs generator renders — not by a name list
inside the reporter. `--help` and `--version` return before any report is composed. Note that
`requiresWorkspace: false` does not express this set: only `init` and `upgrade` carry it, while the
server lifecycle verbs do not (P7's neighbouring finding), so a new field is required

**TEST-1209: `batch` attributes per entry, and the arithmetic is explained**
Given: a batch of three entries naming three different documents
When: `corpus batch` runs
Then: three reports arrive, each with its own resolved command path and its own subject. The issue
records that the entries' read-bytes sum to **less** than the process's stdout bytes, because a batch
entry's payload is captured rather than written and the composite report's framing belongs to no
subject (P8)

**TEST-1210: no new dependency reaches the startup path**
Given: the CLI's startup-cost pin
When: it runs
Then: it passes unchanged — the pinned third-party set is still exactly three packages (R5)

**TEST-1211: the startup cost is measured once, and recorded**
Given: the packaged bundle and a warm server
When: the startup benchmark runs, alone, per the machine rules
Then: the delta against the recorded baseline is within CLI-085's budget, and the minimum, the run
count and the machine state are written into the E2E Verification Log — the minimum, not the mean,
as the benchmark's own docblock requires

**TEST-1212: the help note fits its budget, and the docs regenerate clean**
Given: the registry
When: `validateRegistry` runs and the CLI reference is regenerated
Then: validation passes — the note naming the measurement and its unit keeps every page under the
help byte budgets — the note uses the same words for the unit that the panel uses (R1), and
`docs/cli.md` regenerates with no leftover diff

### Group D — the panel (ui-dev) · UI-190

**TEST-1213: the panel lives with the document, and nowhere near the console**
Given: a seeded document with measurements
When: the reader is open and the console is expanded on each of its tabs
Then: the panel is present inside the reader, and its selector has count **zero** anywhere inside
the console — SHARED-079's recorded placement, asserted as a negative

**TEST-1214: one insertion serves documents and threads, in both readers**
Given: a seeded ordinary document and a seeded `type: thread` document, each with measurements
When: each is opened in the column reader and again in focus mode
Then: the panel renders in all four cases, from the single call site beside `Backlinks` and
`RelatedPanel` (`DocView.tsx:628-629`) — no second component, no thread-specific branch (P13, P14)

**TEST-1215: nothing above the body moves when the series arrives**
Given: a document whose cost series resolves after the editor has painted
When: the series arrives
Then: the body's top offset is identical before and after, measured. The panel renders **below** the
body, for the reason `DocView.tsx:325-353` records: a panel above it once moved the body 77.86px,
and this is the surface where text is selected in order to comment on it

**TEST-1216: the series is drawn against the document's size**
Given: a document with several buckets of measurements and a known byte size
When: the panel renders
Then: read-tokens and wrote-tokens are both drawn over time, the document's size is drawn as the
reference line, and the line is labelled as the document's **current** size rather than presented as
a second series (P11). Units are named in the same words the CLI help uses (R1)

**TEST-1217: the by-command breakdown names the verb that paid**
Given: measurements from two different verbs on one document
When: the breakdown is shown
Then: each verb's resolved command path and its token total are listed, and they sum to the total the
panel shows for the same span

**TEST-1218: an untouched document says so honestly**
Given: a document with no measurements
When: the reader is open
Then: the panel says "no measurements yet" — never a zero series, never a flat line drawn at zero —
and the loading state is distinguishable from the empty one. This deviates from `RelatedPanel`'s
render-nothing rule on purpose, and the component's docblock argues why: "related" found nothing,
whereas here nothing has been measured, and those are different claims

**TEST-1219: a truncated series says it is truncated**
Given: a series the server bounded
When: the panel renders
Then: it states that older buckets are not shown, using the server's own `total` and `truncated`,
rather than presenting a window as the whole history

**TEST-1220: the panel reaches the server through the kit**
Given: the UI
When: its data path is read
Then: `apps/ui` imports no `@corpus/contract/client`; the query lives in a kit hook; its key hangs
under the docs prefix as `relatedKey` does (R8); no new SSE key exists; and the import-boundary lint
still passes

**TEST-1221: flat cost against a growing document is legible at a glance**
Given: a seeded series in which the document's size grows while read-tokens stay flat
When: the panel renders
Then: the two shapes are distinguishable in a screenshot attached to the issue log. This is the one
thing the panel exists to show — Phase 57's bounded reads working — and a panel where that shape is
not readable has failed even with every other test green

**TEST-1222: the real numbers are verified by hand, because Playwright cannot**
Given: a real workspace, a running server, and a document exercised through several CLI verbs
When: the panel is opened in a browser
Then: the figures match what the server's table holds and what `wc -c` reports, with the evidence in
UI-190's E2E Verification Log. **Playwright verifies the rendering half only**: the e2e suite starts
Vite with no API target, so every panel assertion above runs against a stub, and the stub proves
nothing about the numbers

---

## Out of scope

- **Any SPEC.md change.** §9.4 is signed and applied. §10 gets no cost sentence this sprint (P1, R10).
- **A workspace-wide cost view.** Null-subject rows are kept so the question stays answerable
  (TEST-1186). Nothing reads them this sprint, and no route exposes them.
- **Rolling a thread's cost up to its parent document.** §9.4 attributes to what the invocation
  **named**. A thread is a document with its own series, and a parent roll-up is a second metric.
- **Per-flag or per-payload detail.** CONTRACT-097 says minimal and means it: no payload echo, no
  argv capture, no per-flag breakdown. The command path is the finest grain.
- **A real tokenizer.** The whole value of bytes ÷ 4 is that `wc -c` reproduces it.
- **Buffering reports to disk to survive a dead server.** §9.4 says a failed report is never retried.
  A spool file would make the telemetry channel durable, which is the property it is defined not to
  have — and it would put a write on the loop's hot path.
- **An SSE key or a live-updating panel** (R8). The panel refreshes on frames that already exist.
- **A charting dependency**, unless E1 is decided the other way by the user.
- **Measuring the UI's own cost.** §9.4 measures `corpus` invocations. The browser is not one.
- **Preserving the series across a schema bump.** P9's consequence is accepted, not engineered
  around.
- **Re-running `bench:startup` to improve a number.** One measurement, recorded as taken.

---

## Integration points — the seams that must hold

**S1 — one token definition, three readers.** The constant and its conversion are declared once in
`packages/contract` (R1, P2). The server calls it (TEST-1189), the UI labels with it (TEST-1216),
and the CLI's help note names the same unit in the same words (TEST-1212). The CLI itself converts
nothing — it reports bytes, and the server derives. A second definition anywhere is a failing test,
not a style preference.

**S2 — the CLI's report and the ingestion body are one shape.** CLI-085 constructs exactly what
CONTRACT-097 declares: `{command, wroteBytes, readBytes, subjects, at}`. The CLI's typed client is
generated from the same document the server validates against, so a drift here is a type error
rather than a silent 400 that fire-and-forget would swallow. **This is the one place where
fire-and-forget hides a real bug**, so the E2E in TEST-1197 verifies the row landed in the server's
table — not merely that the CLI sent something.

**S3 — the size lives on the series response, because nothing else carries it.** `Doc` has no size
field and the reader shows none (P12). So `GET /api/docs/{id}/cost` is the only surface that can
give the panel its reference line, and it reads the projection's existing per-file size column
(P11). If the panel ever needs size without cost, that is a new decision — not a second computation.

**S4 — the panel's query key sits under the docs prefix and nothing emits for telemetry.** `["docs",
id, "cost"]`, following `relatedKey` (`packages/kit/src/query/keys.ts:165`). Document writes already
emit `["docs", …]`, which TanStack matches as a prefix, so the panel refreshes on existing frames.
The closed SSE vocabulary is untouched (TEST-1179, TEST-1220), and the consequence is stated rather
than hidden: **a report does not update an open panel.** The panel is a periodic read of an
append-only ledger, and that is the correct relationship between a measurement and the thing it
measures.

**S5 — verification crosses domain boundaries in one direction only.** CLI-085 cannot be verified
without SERVER-166 running (TEST-1197 reads the server's table). UI-190's rendering is verifiable
against a stub, and its **numbers are not** (TEST-1222) — the e2e suite reaches no server. So
UI-190's Playwright work and its E2E log are two different verifications, and the issue must not
report the first as if it were the second.

**S6 — the schema version is SERVER-166's alone.** One bump, in one commit (TEST-1195). No other
issue in this batch touches the projection schema.

---

## Open questions the implementers answer, not guess

**O1 — do bytes the CLI read on the caller's behalf count as "wrote"?** §9.4 says "the size of what
the caller wrote". `corpus doc create -m "<body>"` and `corpus doc create --file body.md` are the
same act with the same payload, and CLI-085 as filed counts only argv and stdin — so the second
would measure as nearly free. **Recommendation: count the resolved value, whatever door it came
through**, because a measurement that changes with the input syntax cannot answer "what does this
document cost". Whichever way it is decided, the choice is recorded in the issue and named in the
help note.

**O2 — does a filter flag name a subject?** `corpus doc list --parent <docId>` names that document in
its input, and returns other documents. Under R7 it reports that parent as its subject.
**Recommendation: keep the one rule with no special case**, and record the consequence in the issue —
a special case is exactly where a reproducible number stops being reproducible. If the panel later
shows a document paying for listings it merely filtered, that is a filed observation, not a bug to
patch in place.

**O3 — retention: raw rows only, or raw plus aggregates?** SERVER-166 proposes 90 days of raw rows
plus bucketed aggregates kept indefinitely. **Recommendation: raw rows only in v1, pruned at the
recorded window, bucketed on read.** A second table is a second source of truth for one number, and
at one row per invocation-subject the read cost does not justify it yet. If the series is later slow,
that is a measured issue with a measurement attached.

**O4 — should the panel say since when it has been measuring?** P9's consequence is that the series
restarts on every schema bump and on every `db rebuild`, and the panel cannot tell "never measured"
from "wiped on Tuesday" — both look like a short history. **Recommendation: stamp the ledger's start
in `meta` and let the series report it, so the panel can say "measuring since …" instead of implying
it is showing everything.** It is cheap, it is honest, and it is the difference between an empty
panel that informs and one that misleads. Decide it in SERVER-166, before CONTRACT-097's response
shape is frozen — this is the one open question with a wire consequence.

---

## Escalations — for the orchestrator, before spawning

**E1 — UI-190 needs this repository's first chart, and that is a dependency decision.** There is no
charting library in any manifest and no `<svg>` in the kit at all (P12). Two directions: add a
charting dependency, or hand-roll SVG. **Recommendation: hand-roll.** The panel draws two series and
one horizontal line; the repository's dependency discipline is strict enough that the CLI pins its
startup imports to three packages by test; and `KanbanGraph` is a standing precedent for drawing by
hand in this codebase. But a first charting dependency is an architecture decision, not a domain
agent's call — **confirm before spawning ui-dev**, either way.

**E2 — UI-190 is filed as one panel and is at least three pieces of work.** It introduces a chart
(E1), the first display of a document's size anywhere in the reader (P12), and an on-demand
breakdown. **Recommendation: land the series, the size line and the empty state as UI-190, and split
the by-command breakdown into its own issue** if the first three run long. TEST-1217 moves with it.
The panel's reason to exist is TEST-1221, and nothing that delays TEST-1221 should ride in the same
issue.

**E3 — CLI-085's exclusion set is not expressible in the registry today.** Only `init` and `upgrade`
declare `requiresWorkspace: false`; the server lifecycle verbs do not, so there is no existing
property that names "this verb must not report" (TEST-1208). A new declared field is required, which
`validateRegistry` checks and the docs generator renders. Small, but it is a registry shape change —
worth knowing before cli-dev discovers it mid-issue.

**E4 — confirm the reading of "absent after a rebuild".** P9 shows that the mechanism which would
deliver it also runs at every boot, so the naive implementation deletes the user's cost history every
time the server restarts. The contract reads §9.4 as **rebuild only** (R9). If the user meant
something stronger or weaker, this is the moment to say so — after CONTRACT-097 lands it is a
migration.

---

## Spawn order — strictly sequential, one agent at a time

| Wave | Agent | Issue | Gate before the next wave |
| --- | --- | --- | --- |
| 1 | contract-dev | CONTRACT-097 | O4 answered; artifacts regenerate byte-identically; server typecheck window noted |
| 2 | server-dev | SERVER-166 | Routes answer against a real server; TEST-1182 and TEST-1183 both green |
| 3 | cli-dev | CLI-085 | A real report lands in the server's table (TEST-1197); TEST-1202 green |
| 4 | ui-dev | UI-190 | E1 decided by the user before spawning |

There is no parallelism to find in this batch, and the sequence is a dependency rather than a
preference: each lane's acceptance tests read the previous lane's output. Running two at once
produces one agent writing against an interface that does not exist yet.

The one thing that can be done early: **E1 goes to the user while wave 1 runs**, so ui-dev is not
blocked on a decision when its turn comes.

---

## Done Criteria

This sprint is complete when:

- Every acceptance test above PASSES in the evaluator's verdict, or is struck by an orchestrator
  ruling recorded in this file
- Every issue's E2E Verification Log is filled with concrete evidence and states the model it ran on
- Every decision this contract requires in writing is written: the rounding mode (P2), the counter's
  position and what a broken pipe does to the count (R2, TEST-1206), `doc delete`'s recorded
  exclusion (R3), the report's timing mechanics and measured cost (R4, TEST-1211), the subject
  extractor's shape (R7), the retention window and where it runs (TEST-1192), O1's and O2's answers,
  and O4's decision with its wire consequence
- **TEST-1197 and TEST-1202 are both green**, because they are the two halves of §9.4: the number is
  real, and nothing depends on it
- `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` all pass at the orchestrator's
  harvest gate — the single repo-wide run
- `docs/cli.md` and the contract's generated artifacts regenerate with no leftover diff
- `CI / validate` is green on the phase PR's head, and the pr-reviewer's verdict is APPROVE
