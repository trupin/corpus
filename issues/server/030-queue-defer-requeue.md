# [SERVER-030] Queue defer/requeue transition for lock-deferred work

## Domain

server

## Status

in_progress

## Priority

P2

## Model

opus — a new queue transition following the existing event-store patterns.

## Dependencies

- Depends on: CONTRACT-021, SERVER-008, SERVER-009, AGENT-002
- Blocks: —

## Spec References

- SPEC.md §7 — "The orchestrator defers edits to user-locked documents — the work stays queued and
  applies when the lock clears"; force-break: "the agent's deferred edit re-enters the queue rather
  than being lost"
- issues/sprints/sprint-012.md — Open Conflict 2 + Adjudication 6 (the interim protocol this issue
  replaces)

## Summary

Filed from sprint-012 Open Conflict 2 (2026-07-28). §7 promises that agent work deferred on a
user-held lock "stays queued", but the queue surface has no defer/requeue transition — a claimed
event can only reach `processed` or `failed`. The interim protocol (Adjudication 6) has the
orchestrate skill reply to the waiting thread, then `corpus queue fail` with a `deferred:`-prefixed
reason, with `corpus job retry` as the re-entry — honest, but a deferral renders as a **failed** job
in the console, and nothing automatically re-enters the work when the lock clears or is force-broken.

This issue adds the honest transition: a deferred state (or equivalent re-enqueue mechanism) such
that (a) a lock-deferred event is distinguishable from a failure in the queue store, the API, and
the console; (b) the event re-enters `pending` when the blocking lock is released, broken, or
reaped; (c) the orchestrate skill's deferral section can be simplified to use it. Contract (route/
schema) and CLI (verb) riders are expected — split them out as coupled issues when this is
scheduled. §7's wording and the skill text (AGENT-002) are updated to match whichever shape lands;
the §7 amendment goes through spec-writer + user sign-off.

## Acceptance Criteria

- [x] A claimed event blocked on a user-held lock can be moved to a non-terminal deferred state (or
      re-enqueued) through the CLI, without counting as failed.
      _Server half done: `POST /api/queue/{id}/defer` is live. **CLI reachability landed via
      CLI-015, evaluator FAIL-2** — this box was ticked here while `corpus queue defer` did not
      exist, which is exactly what sprint-015's evaluator caught (`issues/evals/SERVER-030-eval.md`,
      FAIL-2): "through the CLI" is half of the criterion and the server half cannot satisfy it
      alone. `corpus queue defer <id> --blocked-on <docId> [--reason <text>]` now reaches the route
      (`apps/cli/src/commands/queue/defer.ts`); Follow-up 1 below is closed by it. Re-ticked
      deliberately with this annotation rather than silently._
- [x] Release, force-break, or reap of the blocking lock re-enters the deferred event into
      `pending`, and the SSE invalidation keys cover the transition.
- [x] Console/jobs surface distinguishes deferred from failed.
      _`GET /api/queue/status` counts `deferred` separately, `GET /api/jobs` reports
      `status: "deferred"` with `blockedOn`/`blockedOnTitle`; the console's rendering landed with
      CONTRACT-021's UI consumption rider._
- [x] The orchestrate skill's deferral section is updated to the new protocol (AGENT rider), and
      §7's "stays queued" wording is reconciled (spec-writer, user sign-off).
      _Both **routed, not applied**, per sprint-015 TEST-359/TEST-361: AGENT-007 filed
      (`issues/agent-runtime/007-orchestrate-defer-verb.md`, added to PLAN); the three spent §7
      sentences are recorded verbatim below with their replacement wording, for SHARED-004._

## Technical Design

### The deferral is recorded on the event, not on the lock

`StoredEvent` gains `blockedOn` (a `DocumentId`) and `deferReason`. That is what makes the three
required properties implementable at once:

- **several events per lock** — a lock file is one per document, and TEST-352 requires each of N
  events deferred on the same document to come back exactly once;
- **restart survival** — the event file is what `.corpus/queue/deferred/` already persists;
- **`Job.blockedOn` non-null exactly when `status` is `deferred`** — `stamp()` strips both fields
  on every transition, and only `defer` re-supplies them.

This **retires** `StoredLock.deferredEventId` (sprint-005 Open Conflict 8), which recorded one
event id on the lock file, could not be set by any API, and only `forceBreak` consulted. Two
places recording "the deferred edit" would leave no answer to which is authoritative.

### Files changed

- `queue/store.ts` — `blockedOn`/`deferReason` on `StoredEventSchema`; `withoutDeferral()`.
- `queue/service.ts` — `defer(id, {blockedOn, deferReason})` (409 unless `in-progress`, in the
  writer chain); `requeueDeferredFor(docId)`; `RequeueOptions.onlyFrom` widened to a status list.
- `queue/routes.ts` — `contractRoutes.deferEvent`.
- `locks/service.ts` — `release`, `forceBreak` and `reap` each call `requeueDeferredFor`;
  `BreakResult.requeuedEventId` → `requeuedEventIds`.
- `locks/store.ts` — `deferredEventId` removed; legacy files still parse (the key is dropped).
- `jobs/service.ts` — `retry` accepts `["failed", "deferred"]`.
- `jobs/project.ts` — `blockedOn` from `events.blocked_on`, `blockedOnTitle` joined at read time.
- `projection/schema.ts` — `events.blocked_on`, `SCHEMA_VERSION` 5 → 6.
- `projection/project-runtime.ts`, `projection/queue-mirror.ts` — carry it through both writers.

## E2E Verification Log

**implemented on: opus** (2026-07-30, server-dev). Sprint-015, ports `9190`–`9194` (used `9191`),
scratch under `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-server030-Ft2Oam`, workspace
created with the subshell-`cd` form and an explicit `--port`. `8765` was never bound and never
killed (`lsof -nP -iTCP:8765 -sTCP:LISTEN` → nothing listening, before and after).

### TEST-344 — the contract/CLI rider boundary, audited before code

`git diff packages/contract` from this agent is empty; CONTRACT-021 had already landed the whole
wire surface, and every shape used here is imported:

- `QUEUE_EVENT_STATUSES` gained `"deferred"` (`schemas/queue.ts:44-51`) — the server iterates it in
  `queue/store.ts:196` (`ensureLayoutSync`), `queue/project.ts:55` and `projection/project-runtime.ts:47`,
  so the directory, the boot scan and the projection all follow the enum with no local list.
- `DeferEventRequestSchema` (`schemas/queue.ts:210-226`) and `deferEvent`
  (`routes/queue.ts:192-230`) — the handler attaches to the route definition; nothing is declared
  locally.
- `Job.blockedOn` / `Job.blockedOnTitle` (`schemas/job.ts:45-60`) and `QueueStatus.deferred`.
- `retryJob`'s widened description (`routes/jobs.ts`) — the 409 message now reads
  `only a failed or deferred job can be retried`.

**Escalated as riders, not implemented here:** (a) the **CLI verb** — the CLI is a thin HTTP client
and `corpus queue defer` does not exist; without it the agent cannot reach this route and the
orchestrate skill cannot be rewritten (AGENT-007 is filed and blocked on it). (b) `apps/cli`'s
scaffold — **already fixed by cli-dev in this batch**: `init/scaffold.ts` now derives the status
directories from `QUEUE_EVENT_STATUSES`, and a fresh `corpus init` produced
`.corpus/queue/deferred/.gitkeep`, tracked (TEST-363 verified below). No status was smuggled through
as free text anywhere.

### Pre-fix state — the four known reds

`vitest run apps/server/src/json-body.test.ts` before any change:

```
AssertionError: expected [ 'POST /api/queue/{id}/defer', 404 ] to deeply equal [ …, 400 ]
 FAIL  an empty body … | a truncated object … | prose … | a bare comma …
 Tests  4 failed | 3 passed (7)
```

The route was in `ALL_CONTRACT_ROUTES` with no handler, so the sweep's requests fell through to a
404. After the handler: **7 passed (7)**.

### A. The transition exists and is not a failure

TEST-345 — real workspace on `9191`, real `comment.created` from a real thread, real user-held lock:

```
$ curl -X POST /api/locks/doc_orf34y5v      -H 'x-corpus-author: user'
{"docId":"doc_orf34y5v","holder":"user","acquired":"2026-07-30T14:29:19Z","ttl":300}

$ curl -X PUT /api/docs/doc_orf34y5v        -H 'x-corpus-author: agent' -d '{"body":"rewritten by the agent"}'
{"code":"locked","message":"doc_orf34y5v is being edited by user; the lock was acquired at …"}  <- HTTP 423

$ curl -X POST /api/queue/evt_lrspdbrsxmge/defer -H 'x-corpus-author: agent' \
       -d '{"blockedOn":"doc_orf34y5v","reason":"the user is editing this document"}'
{"id":"evt_lrspdbrsxmge","type":"comment.created", …}                                            <- HTTP 200

$ ls .corpus/queue/deferred .corpus/queue/in-progress
deferred: evt_lrspdbrsxmge.json     in-progress: (empty)

$ curl /api/queue/status
{"halted":false,"pending":0,"inProgress":0,"deferred":1,"processed":0,"failed":0,"abandoned":0}
```

The 423 is the real guard refusing the real write, and `failed` stayed `0`.

TEST-346 — the blocking document is on the event, on disk:

```json
{ "id": "evt_lrspdbrsxmge", "type": "comment.created", "status": "deferred",
  "updated": "2026-07-30T14:29:19Z",
  "blockedOn": "doc_orf34y5v", "deferReason": "the user is editing this document" }
```

Supplied at defer time, per CONTRACT-021: `comment.created` happens to carry `parentId`, but
`form.respond` names no document and plugin payloads are their own shapes.

TEST-347 — not claimable while it waits:

```
$ curl -X POST /api/queue/claim-all      → {"events":[]}
$ curl '/api/queue/idle?timeout=2'       → HTTP 204
```

TEST-348 — not a silent drop. Server stopped by pid, `9191` confirmed free, server restarted:

```
$ curl /api/queue/status   {"deferred":1, …}
$ curl /api/jobs           {"eventId":"evt_lrspdbrsxmge","status":"deferred", …,
                            "blockedOn":"doc_orf34y5v","blockedOnTitle":"Mortgage options"}
$ curl /api/db/doctor      {"ok":true,"drift":[],"stats":{"files":10,"documents":10, …}}
```

Still deferred, still visible, still on disk, and `db doctor` clean with a deferred event present.
It is also retryable by hand — see TEST-358.

### B. Automatic re-entry

TEST-349 (**release**) — SSE stream open, then the user releases:

```
$ curl -N /events &
$ curl -X DELETE /api/locks/doc_orf34y5v -H 'x-corpus-author: user'
{"docId":"doc_orf34y5v","released":true,"holder":"user"}
```

Frames received (TEST-354):

```
event: invalidate
data: {"keys":[["locks"],["locks","doc_orf34y5v"],["docs","doc_orf34y5v"]]}
event: invalidate
data: {"keys":[["queue"],["jobs"],["docs"]]}
```

Both halves: the lock keys the release itself touches, and the queue/jobs/docs keys the re-entry
does — exactly what the contract's `/events` description promises ("…and any lock release, break or
reap that re-enters a deferred event"). No CLI call, no `job retry`. On disk the pending file has
**no** `blockedOn`/`deferReason`; `GET /api/jobs` reports `"status":"pending","blockedOn":null,
"blockedOnTitle":null`; `claim-all` handed it back and `complete` finished it.

TEST-350 (**force-break**) + TEST-352 (**several events, exactly once**) — two events deferred on
one document, and a `corpus queue idle` parked with a 60-second window before the break:

```
$ curl /api/queue/status  {"deferred":2, …}
$ (idle t=0, 60s window)
$ curl -X POST /api/locks/doc_orf34y5v/break -H 'x-corpus-author: user'   (at t≈3s)
{"docId":"doc_orf34y5v","released":true,"holder":"user"}

idle returned: HTTP 200 after real 3.04s   →  [ 'evt_ekag4foqeqmn', 'evt_vo3ewgrmbdyh' ]
$ curl /api/queue/status  {"pending":2,"deferred":0, …}
```

The parked long-poll unparked on the break rather than sitting out its window, and both events came
back — one file each, no duplicates.

TEST-351 (**reap**) — the crashed-editor case, a lease that simply ran out:

```
$ curl -X POST /api/locks/doc_orf34y5v -d '{"ttl":1}'   → acquired, ttl 1
$ defer …                                               → {"deferred":1}
(sleep 3)
$ curl -X POST /api/locks/reap    → {"reaped":["doc_orf34y5v"]}
$ curl /api/queue/status          → {"pending":1,"deferred":0, …}
```

Wrong-document check: acquiring and releasing a lock on an **unrelated** document left the deferral
untouched (`{"deferred":1}` before and after), and releasing the right one returned it
(`{"pending":1,"deferred":0}`). A release with nothing deferred behind it is a silent no-op — no
extra frame (unit-pinned in `locks/service.test.ts`, "announces nothing extra…").

TEST-353 (**restart**) — covered by TEST-348 above: the deferral was created before a full stop/start
and the release that re-entered it came **after**. The deferral lives in the file-backed queue, not
in process memory.

### C. SSE and the console (TEST-355, TEST-356) — added by ui-dev

**implemented on: opus** (2026-07-30, ui-dev, closing eval FAIL-1). This section was missing from the
original log; the evaluator was right that its absence is itself a contract violation, and right about
what it was hiding — `GET /api/jobs` served `blockedOn`/`blockedOnTitle` correctly and the drawer
rendered neither. Fixed in `apps/ui` only (`consoleModel.ts`, `JobList.tsx`, `JobDetail.tsx`,
`console.css`); no server, contract or CLI file touched.

**Drill.** Real app, real files, no fixtures: `corpus init --port 9187` in `/tmp/corpus-ui-drill-…`
(nothing written under the repo), `corpus server start` (pid 67234), then over HTTP — created two
documents (`doc_t7tfgunq` "Mortgage options", `doc_oz4tut26` "Unrelated"), a thread on the first with
`requestsAgent: true` (`evt_noils5igsfmw`), `claim-all`, a `user` lock on **`Unrelated`**, then
`POST /api/queue/evt_noils5igsfmw/defer {"blockedOn":"doc_oz4tut26"}`. A second event
(`evt_64sbr77ndrhy`) was genuinely `fail`ed so a failure and a deferral sit in the drawer together.
Wire state before reading the DOM:

```
GET /api/jobs   -> [{"eventId":"evt_noils5igsfmw","status":"deferred","originTitle":"Re: Mortgage options",
                     "blockedOn":"doc_oz4tut26","blockedOnTitle":"Unrelated"},
                    {"eventId":"evt_64sbr77ndrhy","status":"failed","blockedOn":null,"blockedOnTitle":null}]
GET /api/queue/status -> {"halted":false,"pending":0,"inProgress":0,"deferred":1,"processed":0,"failed":1,"abandoned":0}
```

The blocking document is deliberately **not** the thread's parent — the evaluator's probe, and the
case where a row that merely echoes its origin looks plausible and still says nothing.

**TEST-355 — the two do not read the same.** Read from the live DOM in headless Chromium at
`http://127.0.0.1:9187/`, drawer opened by clicking the strip:

```
row 1  dot="job-dot deferred"  title="comment.created · Re: Mortgage options"  blocked="🔒 Unrelated"  meta="deferred"
row 2  dot="job-dot failed"    title="comment.created · Re: Mortgage options"  blocked=null            meta="failed"
computed colours  deferred dot & hint rgb(169,131,75) [--sepia]   vs   failed dot rgb(196,85,46) [--signal]
strip            "0 running · 1 deferred · 0 done · 1 failed"
```

Distinct dot class, distinct colour, distinct status word, distinct count in the strip, and only the
waiting row carries a blocker. The deferred treatment is `--sepia` — pending's "hasn't run yet" hue —
never `--signal`, so it reads as waiting rather than broken.

**TEST-356, first half — the row says what it is waiting for.** The evaluator's exact probe now
answers the other way:

```
document.querySelector('.console').innerText.includes('Unrelated')  ->  true      (was false)
.job-list  .job-blocked  text="🔒 Unrelated"   title="blocked on Unrelated · doc_oz4tut26"
.job-detail-head .job-blocked  text="blocked on Unrelated · doc_oz4tut26"
detail meta                    "deferred · started 08:32 · evt_noils5igsfmw"
detail buttons                 ["↗ open", "Retry", "Abandon"]
Retry title                    "Re-queue this deferred job now — the manual override; it re-enters on its own when the lock clears"
```

The row shows the lock glyph the mockup already uses for a held document plus the title (the row has
380 px; spending ten characters on "blocked on" is what pushed the name into an ellipsis), and the
detail pane spells out the sentence with the id, which appears nowhere else. Retry/Abandon are
offered on a deferred job because §7 keeps `corpus job retry` as the manual override and CONTRACT-021
widened the route to accept `deferred`; the tooltip says it is an override, not the normal path, so
the console does not imply the automatic re-entry needs a human.

**TEST-356, second half — it clears itself, live.** With the drawer open and the deferred row on
screen, the lock was released out of band (`DELETE /api/locks/doc_oz4tut26` → 200) from outside the
browser:

```
rows after release  [{"dot":"job-dot pending","blocked":null,"meta":"pending"},
                     {"dot":"job-dot failed","blocked":null,"meta":"failed"}]
strip after         "0 running · 1 queued · 0 done · 1 failed"
probe after         .console.innerText.includes('Unrelated') -> false
performance.getEntriesByType("navigation").length -> 1 before and after   (no reload)
page errors -> []
```

So the server's invalidation frames on the release do reach the console: dot, status word, blocker
hint and the strip's counts all follow, in one page load. Screenshots at `/tmp/drill-console.png`
(deferred) and `/tmp/drill-released.png` (after).

**Unit cover for the same two criteria** (`vitest run apps/ui/src` → **88 files, 1312 tests, pass**;
`tsc --noEmit` on `apps/ui` → exit 0; eslint + prettier clean): `consoleModel.test.ts` pins the
blocker model — the title/id pair, the id standing in when the document is gone, and the
contract-says-impossible null case rendering "blocked on an unnamed document" rather than
"blocked on "; `Console.test.tsx` pins deferred-vs-failed rendering, the not-the-origin probe
against `.console` text, the manual-override tooltip, and the live SSE transition driven through
`invalidate` on the queue and jobs keys — asserting the row is the **same DOM node** afterwards, which
is what separates a live update from a re-render of everything.

**Not fixed here** (unchanged from the log's known gaps): FAIL-2, the missing `corpus queue defer`
verb, is `apps/cli`'s and remains open.

### D. Retiring the interim protocol

TEST-357 — the deferral path is now the transition. **Status of the old form, stated once:**
`corpus queue fail --reason "deferred:…"` is **left working but no longer the deferral path** — this
issue does not touch `apps/cli`, and `queue fail` is state-agnostic by design (it always was). It
must stop being *instructed*, which is AGENT-007's first acceptance criterion, and the CLI rider
decides whether the string form is refused outright. Nothing in the server teaches it.

TEST-358 — `job retry` still works, on both:

```
(deferred, lock still held)
$ curl -X POST /api/jobs/evt_3l3dgbmab4tu/retry
{"status":"pending","blockedOn":null,"blockedOnTitle":null,"lastLine":"retry requested", …}

(genuinely failed)
$ curl -X POST /api/queue/…/fail -d '{"reason":"boom"}' ; curl -X POST /api/jobs/…/retry
{"status":"pending", …}

(running)
$ curl -X POST /api/jobs/…/retry
{"code":"conflict","message":"queue event … is in-progress; only a failed or deferred job can be retried"}  <- 409
```

Its role: the **manual override**. Automatic re-entry supplements it — a lock cleared out of band, a
deferral that named the wrong document, an expired-but-unreaped lease (see Known gap) still need a
human verb.

TEST-359 — `git diff assets/workspace/` from this agent is **empty**. `AGENT-007` filed at
`issues/agent-runtime/007-orchestrate-defer-verb.md` and added to `issues/PLAN.md`, naming the
"Locks and deferral" section (`orchestrate/SKILL.md:143-175`), the exact two commands it replaces,
and the pinned `expect(commentBody).not.toMatch(/corpus queue (?:complete|fail)/)` constraint on how
the new verb may be named.

TEST-360 — `vitest run scripts/workspace-template.test.ts` → **91 passed**, `CLI_COMMANDS_PENDING_CLI_006`
still `[]` (nothing in `assets/workspace/**` changed by this issue).

### E. SPEC §7 — three spent sentences, recorded not edited (TEST-361)

`git diff SPEC.md` from this agent is **empty**. For SHARED-004's sign-off set:

1. **The status list** — "`pending → in-progress → processed | failed`", plus `abandoned` — must gain
   `deferred` as an explicitly **non-terminal, non-claimable** state: claimed work waiting on a
   user-held edit lock, counted separately from `failed`.
2. **The lock bullet's interim protocol** — "replies to the waiting thread…, fails the event with a
   `deferred:`-prefixed reason, and the work re-enters the queue via `corpus job retry` … A dedicated
   defer/requeue queue state that re-enters automatically on lock release is planned (SERVER-030);
   until then the deferral is visible as an actionable failed job, never silently dropped." — is spent
   **in full**. Replacement: the orchestrator replies to the waiting thread and **defers** the event
   onto the blocking document; the deferral is visible as a waiting job, never a failure and never
   silently dropped, and it returns to `pending` by itself when that lock is released, broken or
   reaped.
3. **The force-unlock bullet's** "the agent's deferred edit stays retryable (`corpus job retry`)
   rather than being lost" → "the agent's deferred edit **re-enters the queue automatically**;
   `corpus job retry` remains the manual override".

### F. Regression (TEST-362)

`VITEST_MAX_THREADS=4 vitest run apps/server/src/queue apps/server/src/locks` → **10 files, 204
tests, all pass**. Whole workspace: `vitest run apps/server` → **122 files, 2448 tests, all pass**
(one run, at the end). `tsc --noEmit`, `eslint --max-warnings 0` and `prettier --check` over
`apps/server/src` all exit 0; no rule disabled.

**Tests changed deliberately, none deleted to reach green:**

| Test | Change | Why |
| --- | --- | --- |
| `jobs/service.test.ts` "refuses a job that is not failed…" | renamed + message widened to `only a failed or deferred job can be retried` (2 assertions) | §7's manual override now admits `deferred`; a **new** sibling asserts the deferred retry works, so both branches stay covered |
| `locks/service.test.ts` "carries a deferred event across a renewal but not across a takeover" | rewritten as "leaves work deferred on the document alone…" | asserted `deferredEventId` on the lock file. The replacement pins the property that survives and matters: acquire/renew/takeover — user or agent — never re-enters deferred work; only clearing does |
| `locks/service.test.ts` "re-enqueues the deferred edit rather than losing it" | same name, driven through `queue.defer` and `requeuedEventIds` | the behaviour is unchanged; only how the deferral is recorded moved |
| `locks/service.test.ts` "still breaks when the deferred event has since gone" | → "still breaks when nothing was deferred behind the lock" | the old fixture (a lock naming a vanished event id) is unreachable now; the surviving branch is "a break with no deferrals is `requeuedEventIds: []`" |
| `locks/store.test.ts` "keeps the deferred event on disk and out of the wire shape" | → "reads a lock file left behind by an older build, dropping the retired field" | **inverted deliberately**: a real workspace running the old build still has such files, and this pins that they keep working |
| `locks/store.test.ts` / `routes.test.ts` "…never leaks the deferred event" | reframed to the general rule, legacy key written by hand | keeps the "runtime-only lock fields never reach the wire" branch covered without a field that no longer exists |
| `projection/db.test.ts` §9.1 column pin | `events` gains `blocked_on` | the one place the DDL is pinned |
| `locks/service.test.ts` fixture | the queue now shares the lock service's invalidation sink | mirrors `app.ts`, where both hold the one bus — without it the queue's frames were invisible to the test |

**New coverage:** `queue/service.test.ts` +2 describes (11 cases: defer's happy path, no-reason,
not-a-failure, the four 409s incl. the second defer, 404, claim-all/idle exclusion, bookkeeping
stripped on exit, restart survival; `requeueDeferredFor`'s matching/idempotence/no-op/attempts/
quarantine); `queue/routes.test.ts` +6 HTTP cases incl. four 400s; `queue/store.test.ts` +2;
`locks/service.test.ts` +5; `jobs/project.test.ts` +4; `jobs/service.test.ts` +1;
`projection/project-runtime.test.ts` +3.

TEST-363 — a fresh `corpus init` (this workspace) created `.corpus/queue/deferred/` **with a tracked
`.gitkeep`**: `git ls-files` shows all six status directories. cli-dev's scaffold now derives them
from `QUEUE_EVENT_STATUSES`, so nothing was needed here and `init/index.test.ts` needed no
reconciliation from this side (TEST-365).

### The kit question (SHARED-003) — DECIDED, kit untouched

`ACTIVE_JOB_STATUSES` stays `["pending", "in-progress"]`; `packages/kit` is not touched by this
issue. Its only consumer is `useAgentActivity`, whose only output is `WorkingDot` — "a pulsing dot
and nothing else… it claims only that something is running" (`badges.tsx:106-112`; the CSS is
`animation: pulse 1.4s ease-in-out infinite`). A deferred job is not running: it is parked on a
lease a human holds, potentially for days, and a dot that pulses for days asserts motion that is not
happening — the same lie the console's separate `deferred` dot exists to avoid. The counter-argument
(the work is genuinely outstanding, and `pending` is not literally "running" either) is real but
weaker on duration: a pending job is seconds from the loop, a deferral is not. And the deferral is
not hidden — three surfaces carry it without claiming motion: the console row (own dot, own count,
`blockedOn`/`blockedOnTitle`), the agent's reply in the waiting thread (§7 replies *before*
deferring), and the lock chip on the blocked document, which the user put there themselves. A
distinct *parked* row signal, if ever wanted, is a kit affordance to design and file — not a silent
widening of the running dot. Recorded in `issues/shared/003-pr11-review-followups.md`.

### Follow-ups and known gaps

1. ~~**The CLI verb is not filed.**~~ **Closed by CLI-015** (2026-07-30): `corpus queue defer <id>
   --blocked-on <docId> [--reason <text>]` is wired, `docs/cli.md` regenerated, and the full
   defer → auto-re-enter cycle verified through CLI verbs only. AGENT-007 is unblocked.
2. **An expired-but-unreaped lease does not re-enter on its own.** There is no TTL sweeper in the
   server — `POST /api/locks/reap` is explicit — so a deferral behind an expired lock waits until
   someone reaps. §7 names release, break and reap, and all three fire; this is the case `job retry`
   exists for. Making `GET /api/locks` re-enter on the expiries it already detects would close it,
   at the cost of queue writes on a read path — deliberately not done.
3. **`Job` carries no deferral `reason`.** CONTRACT-021 scoped it out, so the sentence lives on the
   event file and in the thread reply. If the console should show it, the CLI verb logging it (the
   row's `lastLine`) is the cheapest honest route; a `Job.blockedReason` would be a contract rider.
4. **No live-lock check at defer time.** The contract declares exactly two refusals (409 not
   in-progress, 404 unknown) and this adds no third: a user who releases between the agent's 423 and
   its defer call would otherwise lose the race, and the resulting deferral is visible, counted and
   manually retryable rather than rejected.
5. `.corpus/queue/deferred/` on a **pre-CONTRACT-021 workspace** grows at boot (`ensureLayoutSync`)
   but gains no tracked `.gitkeep` until `init`/`workspace upgrade` writes one — already recorded in
   SHARED-003 as a CLI-side upgrade-path item.

### Housekeeping

`git status --porcelain` (repo) carries this batch's other in-flight work (CLI-013, CONTRACT-020/021,
SERVER-036, the UI rider) as well as mine. **This issue's edits are exactly**: `apps/server/src/queue/**`,
`apps/server/src/locks/**`, `apps/server/src/jobs/**`, `apps/server/src/projection/{schema,
project-runtime,queue-mirror}.ts` + `{project-runtime,db}.test.ts`, `issues/server/030-…`,
`issues/agent-runtime/007-…` (new), `issues/PLAN.md` (one row), `issues/shared/003-…` (the kit
ruling). Nothing under `packages/contract`, `SPEC.md`, `assets/workspace/`, `apps/cli` or
`packages/kit` was touched by me. No `.corpus/` and no scaffolded `data/` anywhere in the repo;
`/Users/theophanerupin/code/corpus/.corpus` absent. Ports `9190`–`9194` free, server stopped by recorded pid, no orphaned vitest workers, `8765`
exactly as it was. No `git commit`/`push`/`checkout`/`reset`/`stash`/`mv`/`rm` was run.

### TEST-364

implemented on: **opus**.

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
