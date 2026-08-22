# [SERVER-027] Populate `DocRow.unreadThreads` in the collection query

## Domain

server

## Status

done

## Priority

P1

## Model

opus — one aggregate subquery in the collection query, UNREAD_SQL already exists.

## Dependencies

- Depends on: CONTRACT-012, SERVER-011
- Blocks: —

## Spec References

- `issues/contract/012-unread-threads-rider.md`

## Summary

Server half of the CONTRACT-012 coupled commit: an aggregate over the doc's threads using the existing `unreadSql(mark)` fragment (one source of truth — SERVER-021 precedent), no N+1, bounded query cost.

## Acceptance Criteria

- [x] `unreadThreads` populated in `GET /api/docs`; 0 for threads/childless docs; consistent with per-thread `unread`.
- [x] Query-plan sanity (no per-row subquery explosion on large corpora — verify with a seeded 500-doc workspace timing).
- [x] Colocated tests + E2E; full gate green as the coupled unit.

## E2E Verification Log

**Implemented on: opus.** Worktree `.claude/worktrees/contract-012` (branch `wt-contract-012`), on
top of CONTRACT-012's uncommitted contract half — the two halves are one commit by construction
(a required `DocRow` field is a `tsc` error in `apps/server` until it is populated).

### What changed

| File | Change |
| --- | --- |
| `apps/server/src/docs/query.ts` | `UNREAD_THREADS_SQL` (correlated subquery, splices `UNREAD_SQL`); `unread_threads` in `ROW_COLUMNS`/`RawRow`/`toDocRow`; `includeArchived` in the archived rule; `parentTitle`'s comment re-quoted against the corrected contract wording |
| `apps/server/src/jobs/project.ts` | `e.type` in `SELECT_JOBS`, `type` on `JobJoinRow`, `type` on the `Job`, `UNKNOWN_EVENT_TYPE` fallback |
| `apps/server/src/docs/query.test.ts` | key list + 4 `includeArchived` tests + a 7-test `unreadThreads` describe |
| `apps/server/src/docs/routes.test.ts` | the one/`COUNT` discriminator (see "one thing the break list missed") |
| `apps/server/src/jobs/project.test.ts`, `jobs/routes.test.ts` | exact-shape fixtures + 2 new `Job.type` tests |

**`SCHEMA_VERSION` is unchanged at 3** and `apps/server/src/projection/schema.ts` is not in the
diff: this is a **query-time** aggregate. A projected `unread_threads` column would be derived state
with two writers (a turn append and a seen mark), i.e. exactly the drift `db doctor` exists to catch
— the aggregate is recomputed per request instead, for ~20 µs (measured below).

### Environment

Real `corpus init` workspaces, real servers, real `curl`/CLI — no test clients.

- **`/tmp/corpus-s010-s027-FoVeEz`** on **8972** (pid 82457): 1 parent document + 4 threads at mixed
  read state, 1 childless document, the seeded template/views/skills.
- **`/tmp/corpus-s010-s027-big-GIdBh4`** on **8973** (pid 90380): **500 documents, 1000 threads,
  500 seen marks** (half full, half partial) — 1506 projected documents.
- `8765` never bound (`lsof -nP -iTCP:8765 -sTCP:LISTEN` empty at start and at exit).

### `unreadThreads` — the value (TEST-76)

Four threads on `doc_cjqexvqm`: two never opened, one marked seen at its last turn, one marked seen
at a `lastSeenTs` **before** its last turn. The partial mark's own response already says
`"unread": true`, and the aggregate agrees:

```
POST /api/threads/th_gcclikcl/seen  {}                                → {"threadId":"th_gcclikcl","lastSeenTs":"2026-07-28T06:02:36Z","unread":false}
POST /api/threads/th_t52bxlyc/seen  {"lastSeenTs":"2026-07-28T06:02:36Z"}  → {"threadId":"th_t52bxlyc","lastSeenTs":"2026-07-28T06:02:36Z","unread":true}

A (no marks):   unreadThreads=4   ?parent=…&type=thread&unread=true items=4
B (T3 seen):    unreadThreads=3   items=3
C (T4 partial): unreadThreads=3   items=3      ← two unread + one fully seen + one partial = 3
```

### 0 on thread rows and childless documents (TEST-77)

Every row of `GET /api/docs?limit=200` on 8972:

```
  thread    th_gcclikcl    unreadThreads=0 unread=false "Fully read"
  thread    th_t52bxlyc    unreadThreads=0 unread=true  "Partially read"
  thread    th_mzvh4n46    unreadThreads=0 unread=true  "Unread B"
  thread    th_pupwzvcb    unreadThreads=0 unread=true  "Unread A"
  note      doc_cjqexvqm   unreadThreads=3 unread=null  "Mortgage options"
  note      doc_vfgwysux   unreadThreads=0 unread=null  "No threads here"
  view      doc_seedattention / doc_seedinbox / doc_seedopenthreads  unreadThreads=0
  template  doc_seedtemplatenote  unreadThreads=0
  skill     doc_skillcomment / doc_skillorchestrate  unreadThreads=0
thread rows with non-zero unreadThreads: 0
rows where unreadThreads is not a number: 0
```

Not null, not absent, never a string — `0` means "nothing unread". A unit test also covers a thread
that is itself the parent of an unread thread: it still reports `0`.

### Consistency as a property (TEST-78)

`?parent=<id>&type=thread&unread=true` issued once per row of the corpus and compared against the
aggregate: **12 documents checked, 0 mismatches** (`agg=3 perRow=3` on the parent, `0/0` on the other
eleven). The same property is asserted as a unit test over a workspace seeded with all four read
states, with a guard that at least one document is non-zero so it cannot pass vacuously. On the
500-document corpus the same property holds by construction and was spot-checked over 200 rows:
even-numbered documents (one thread fully seen, one never) report `1`, odd ones (one **partially**
seen, one never) report `2` — `[...new Set(...)]` over each half is exactly `[1]` and `[2]`.

### It moves live, in both directions, and the SSE frame carries keys only (TEST-79)

```
C (T4 partial):        unreadThreads=3  items=3
corpus thread reply th_gcclikcl -m "A new agent reply." --from agent
D (new turn on T3):    unreadThreads=4  items=4        ← incremented
POST /api/threads/th_gcclikcl/seen {}  → {"…","unread":false}
E (T3 re-seen):        unreadThreads=3  items=3        ← decremented
```

`curl -N /events` across those two mutations, verbatim:

```
:connected

event: invalidate
data: {"keys":[["docs"],["docs","th_gcclikcl"],["threads","th_gcclikcl"],["docs","doc_cjqexvqm"]]}

event: invalidate
data: {"keys":[["docs"],["docs","th_gcclikcl"],["threads","th_gcclikcl"],["docs","doc_cjqexvqm"]]}
```

Two frames, `invalidate` only, `keys` only — no count on the wire (§2.2 rule 3). The parent's
`["docs","doc_cjqexvqm"]` key is already announced by the existing turn/seen paths, so the aggregate
needed no new key.

### No N+1, no per-row explosion (TEST-80)

Statements executed for one `GET /api/docs?limit=50` over the 1506-row corpus, counted by wrapping
the `ProjectionDb` handle:

```
rows returned: 50, total: 1506
statements prepared for one GET /api/docs: 2
  1. SELECT d.id AS id, d.type AS type, d.title AS title, d.path AS path, d…
  2. SELECT COUNT(*) AS total FROM documents d LEFT JOIN threads t ON t.id …
```

Unchanged: the page and its total. `EXPLAIN QUERY PLAN` for the page statement, quoted:

```
SCAN d USING INDEX documents_updated
SEARCH t USING COVERING INDEX sqlite_autoindex_threads_1 (id=?) LEFT-JOIN
CORRELATED SCALAR SUBQUERY 1
SEARCH t USING INDEX threads_parent_id (parent_id=?)
SEARCH s USING INDEX sqlite_autoindex_seen_1 (thread_id=?) LEFT-JOIN
USE TEMP B-TREE FOR LAST TERM OF ORDER BY
```

`SEARCH … USING INDEX threads_parent_id (parent_id=?)` — an index **seek** per page row, never a
scan of `threads`. `seen` is reached through its primary key. The `TEMP B-TREE` line is the
pre-existing `ORDER BY` tiebreak, not the subquery.

### The cost, measured (TEST-81)

Same seeded 500-document workspace, same server, `GET /api/docs?limit=50`, 20 warm-up + 200 timed
requests. "BEFORE" was produced by temporarily replacing `UNREAD_THREADS_SQL` with `` `0` `` and
restarting the server; the file was then restored from a byte copy and the AFTER run repeated twice.

| Run | p50 | p95 | p99 |
| --- | --- | --- | --- |
| AFTER (1) | 1.22 ms | 1.61 ms | 2.03 ms |
| **BEFORE (subquery neutralized)** | **1.07 ms** | **1.25 ms** | 1.38 ms |
| AFTER (2, after restore) | 1.10 ms | 1.28 ms | 2.12 ms |
| AFTER (3) | 1.08 ms | 1.24 ms | 1.37 ms |

The two clean AFTER runs bracket BEFORE, so the HTTP-level delta is **inside run-to-run variance**
(the AFTER runs differ from each other by more than AFTER differs from BEFORE). The real cost is
therefore measured at the statement, same database, 200 warm-up + 2000 timed executions each:

```
  without unread_threads: p50=0.0246ms p95=0.0260ms
  with    unread_threads: p50=0.0443ms p95=0.0458ms
```

**+19.7 µs p50 / +19.8 µs p95 for a 50-row page — about 0.4 µs per row**, which is one index seek,
and ~1.8 % of a 1.1 ms request. Bounded in the page size, not in the corpus size: doubling the
corpus does not change the number of seeks a 50-row page makes.

### `db rebuild && db doctor` stays clean (TEST-82)

```
/tmp/corpus-s010-s027-FoVeEz    rebuilt in   6ms — 12 documents, 4 threads, 7 turns, 1 event, 2 seen
                                projection is clean — 12 documents from 12 files (1ms)
/tmp/corpus-s010-s027-big-…     rebuilt in 312ms — 1506 documents, 1000 threads, 2000 turns, 500 seen
                                projection is clean — 1506 documents from 1506 files (29ms)
```

And the values survive the rebuild (they are recomputed, not stored): `unreadThreads=3` on the small
workspace's parent, `2/1/2/1` on the big workspace's four newest documents, and the job row still
reads `type=comment.created`.

### `Job.type` (rider 1)

A real `comment.created` enqueued by a real `@agent` mention:

```
corpus thread reply th_pupwzvcb -m "@agent can you check this?"
  → replied to th_pupwzvcb — turn 2026-07-28T06:04:56Z (queued evt_xa232bwtcugp)

.corpus/queue/pending/evt_xa232bwtcugp.json  →  type = "comment.created"

GET /api/jobs → {"jobs":[{"eventId":"evt_xa232bwtcugp","type":"comment.created","status":"pending",
   "started":"2026-07-28T06:04:56Z","updated":"2026-07-28T06:04:56Z","lastLine":null,
   "originId":"th_pupwzvcb","originTitle":"Unread A"}]}
```

Byte-identical to the event file's own `type`, giving the console its `<type> · <originTitle>` row.
It survives a status transition (`corpus queue claim-all` →
`evt_xa232bwtcugp type=comment.created status=in-progress`) and the projection rebuild above,
because it is joined from `events`, never stored on `jobs`. A plugin type passes through untouched
(`todos.rollup`) and an empty `events.type` — unreachable through the queue, since
`QueueEventSchema.type` is `min(1)` — degrades to `UNKNOWN_EVENT_TYPE` rather than emitting a shape
`JobSchema.type`'s own `min(1)` rejects. Both are unit-tested.

### `includeArchived` (rider 2) — all four combinations, against files on disk

`corpus doc archive doc_vfgwysux` →
`data/docs/finance/no-threads-here.md` carries `status: archived`, `git log -1` reads
`doc archive: No threads here (doc_vfgwysux) by user | author=user`.

| Request | total | archived row present? |
| --- | --- | --- |
| *(default: no `status`, no `includeArchived`)* | 11 | no |
| `includeArchived=true` | **12** | **yes, alongside the open ones** |
| `includeArchived=false` | 11 | no |
| `status=archived` | 1 | yes — **and nothing else** |
| `status=archived&includeArchived=true` | 1 | yes — no-op, identical to `status=archived` |
| `status=open&includeArchived=true` | 11 | no — no-op, identical to `status=open` |
| `status=open` | 11 | no |

A union, not a narrowing: `includeArchived=true` returns every id the default returns **plus**
`doc_vfgwysux:archived`. Alongside an explicit `status` it is the documented no-op — `status`
replaces the default filter outright, so there is no default left to widen. The COUNT moves with the
page (11 → 12), because both statements share the WHERE clause.

### One thing the break list missed

`apps/server/src/docs/routes.test.ts:148` (`"runs one SELECT and one COUNT per request"`) is not a
type error and not an exact-shape fixture, so it was not on the measured list — it discriminated the
two statements by `sql.includes("COUNT(*)")`, and the new subquery puts a `COUNT(*)` in the **page**
statement too, so both matched. The statement count itself was still 2; only the discriminator was
wrong. It now asserts one statement contains `SELECT COUNT(*) AS total` **and** one contains
`AS unread_threads`, which is strictly stronger than what it checked before.

### Checks

- `apps/server`: **111 test files, 2188 tests, all passing** (`vitest run apps/server`,
  `VITEST_MAX_THREADS=4`) — +13 tests over the pre-change count.
- `npm run typecheck` per workspace: `apps/server` OK, `packages/contract` OK, `packages/kit` OK,
  `apps/cli` OK, `apps/ui` OK.
- ESLint + Prettier clean on every touched file. No rule disabled.
- Repo-wide suite, e2e and coverage deliberately **not** run here (machine-load discipline) — the
  orchestrator's harvest gate is the single repo-wide run.

### Cleanup

Both servers stopped by recorded pid (`corpus server stop`), the SSE `curl -N` killed by pid,
`8972`/`8973`/`8765`/`5273` verified unbound, both scratch workspaces removed, and the scratch
measurement directory deleted from the worktree (`git status` shows only source files).

## Completion Checklist (orchestrator)

- [x] `/evaluate` passes
- [ ] Committed with CONTRACT-012

## Riders (orchestrator, 2026-07-28 — sprint-010 adjudications)

Consume both CONTRACT-012 riders in the same coupled commit:

1. **Populate `Job.type`** in job rows from the projection's `events.type`.
2. **Implement `includeArchived=true`**: lift the default `d.status <> 'archived'` exclusion
   (union). Absent/false unchanged; explicit `status=archived` still returns only archived.

---

## Fix Addendum (2026-07-28) — PR #10 review, finding 4 [MAJOR]: archived children counted

**Model:** opus (server-dev).

### The defect

`UNREAD_THREADS_SQL` carried no lifecycle predicate, so the aggregate counted **archived** child
threads. The contract states this field equals the item count of
`?parent=<id>&type=thread&unread=true` (`packages/contract/src/schemas/query.ts:352`), and that
query carries §10's default archived exclusion — so the two disagreed the moment a thread was
archived. Symptom: archive a thread holding an unread reply and the parent keeps a pill that
nothing visible on the board explains or clears. The property test at `query.test.ts` was vacuous
on this: the fixture had no archived thread.

### Pre-fix reproduction (real server, port 9040; one live unread thread + one archived unread thread)

```
  unreadThreads       = 2
  filtered query items = 1        # ?parent=doc_byqaujiv&type=thread&unread=true
```

### The fix

The subquery joins the thread's own `documents` row and applies the exclusion:

```
SELECT COUNT(*) FROM threads t
       LEFT JOIN seen s ON s.thread_id = t.id
       JOIN documents td ON td.id = t.id
 WHERE t.parent_id = d.id AND ${notArchivedSql("td")} AND ${UNREAD_SQL}
```

`notArchivedSql(alias)` is new and is the *same* fragment the collection query's default lifecycle
rule now splices (`compileFilters` was changed to call it) — the SERVER-027 splice discipline, one
comparison rather than two copies. The exclusion is **fixed**, not driven by the request's
`status`/`includeArchived`: the equality the contract states is with the default query, and the
pill answers "what is still asking for me", which archiving settles — widening what a *listing*
shows does not revive dismissed attention. Rationale is in the constant's doc comment.

`UNREAD_THREADS_SQL` is now exported so the index-plan test EXPLAINs the shipped fragment (it still
seeks `threads_parent_id` and never scans `t`) instead of a hand-copied twin that could drift.

### Tests (`apps/server/src/docs/query.test.ts`)

- Fixture gains three archived-unread cases: `th_archived` (a fifth child of `doc_hub`),
  `th_onlyarchived` (sole child of a new `doc_archivedonly`), and `th_archiving` (live at seeding).
- New `does not count archived threads, which the default set excludes (§10)`: asserts the archived
  threads *are* unread (`?status=archived&type=thread&unread=true` returns them), that `doc_hub`
  still reports 3 of its 5 children, and that `doc_archivedonly` reports 0 on both sides.
- New `drops the pill when the unread thread behind it is archived`: 1 → archive → 0, aggregate and
  filtered query in lockstep.
- The property test is no longer vacuous — it now asserts the corpus contains at least one archived
  unread thread, and it **fails** on the pre-fix SQL (verified by reverting: 5 of these fail).

### E2E (real server, real workspace)

```
before archive:                 unreadThreads = 2   filtered query items = 2
archive th_2r2grorc  (status now: archived)
after archiving one:            unreadThreads = 1   filtered query items = 1
archive th_4aloemkh
after archiving both:           unreadThreads = 0   filtered query items = 0
unarchive th_2r2grorc
after unarchive:                unreadThreads = 1   filtered query items = 1
corpus db doctor → projection is clean — 9 documents from 9 files (1ms)
```
