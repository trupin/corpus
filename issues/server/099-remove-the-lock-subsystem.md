# [SERVER-099] Remove the lock subsystem

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-098 (keys work before locks go)

## Spec References

- SPEC.md **§7** — "Nothing to acquire, nothing to release, nothing to break"
- SPEC.md **§4** — "Two acts commit alone" (was three; the force unlock is gone)
- SPEC.md **§9.4** — the `locks` projection table, struck

## Summary

The deletion half of SHARED-041. Locks are **removed**, not deprecated beside the
new mechanism — the user's decision 7, and the reason is that two coexisting
mechanisms is how the forgettable one survives.

## Acceptance Criteria

- [x] `apps/server/src/locks/` is gone in full, and every import of it
- [x] The lock guard is out of every write path. No route returns `423`
- [x] The `locks` projection table is dropped, with a schema migration — the
      projection has a `SCHEMA_VERSION` and this is a real change to it
- [x] `.corpus/locks/` is no longer watched (§9.4) and no longer created
- [x] The **force-break commit and its audit entry are gone**, including the
      `closeWindow("commits-alone")` SERVER-092 added for it. §4 now says two
      acts commit alone, not three — check that paragraph reads correctly
- [x] An **existing workspace with `.corpus/locks/` on disk** starts cleanly and
      is not confused by it. Decide whether the directory is removed or ignored,
      and say which. A leftover lock file must not resurrect any behaviour
- [x] The queue's `deferred` state survives with its new trigger (§7): re-entry
      is driven by an edit session ending, not by a lock clearing
- [x] Nothing that referenced a lock is left half-referring to one — sweep the
      way SHARED-041's own sweep did, by grepping rather than by memory. That
      sweep found four references the plan had missed

## Technical Design

### Files to Create/Modify

- **Delete** `apps/server/src/locks/` (11 files)
- `apps/server/src/app.ts` — construction and route mounting
- `apps/server/src/projection/` — the table and a schema-version bump
- `apps/server/src/watcher/` — the watched path
- `apps/server/src/queue/` — the deferral re-entry trigger
- `apps/server/src/docs/*` — the guard calls

### Edge Cases

- **The projection migration.** A user upgrading has a `locks` table with rows.
  Dropping it is the change; make sure the migration path is exercised against a
  populated database, not only a fresh one.
- **`git-fixture.ts`** lives under `locks/` but is a test double for the git
  writer, used elsewhere. Move it rather than delete it.

## Testing Strategy

Deletion is proved by absence: the routes 404, the table is gone after migration,
and the full suite passes with no lock test remaining. Add a migration test
against a database that **has** the table.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**). Start against a workspace
that already has `.corpus/locks/` and a populated projection; confirm a clean
start, a working migration, and that two writers still behave per SERVER-098.

## E2E Verification Log

**Model: opus.** Real server from source (`tsx apps/server/src/main.ts`), real
workspace at `~/.claude/jobs/4dd0ddef/tmp/ws99` created by `corpus init`, port
**8791** (never 8765 or 5173). Everything below is read off HTTP, `git log`, the
SQLite file, the queue directories or the SSE stream.

### 1. The lock surface is gone from a running server

All five removed endpoints, on a server with a projection:

```
GET    /api/locks                    -> 404 {"code":"not_found","message":"no route matches GET /api/locks"}
POST   /api/locks/reap               -> 404
POST   /api/locks/doc_a1b2c3         -> 404
DELETE /api/locks/doc_a1b2c3         -> 404
POST   /api/locks/doc_a1b2c3/break   -> 404
```

The live `GET /api/openapi.json`: `paths mentioning lock: []`; every response
code declared anywhere is `['200','201','202','204','400','401','403','404','409','413']`
— **`423` is not among them**. The only bare `lock` left in the document is
inside §7's own prose ("Neither is a lock in the other direction").

### 2. The projection migration, against a **populated** database

The workspace was brought to the exact upgrade state: a v14 database was
downgraded in place to the predecessor — `locks` re-created and filled with
**12 rows** (one per projected document, holders alternating `user`/`agent`),
`meta.schema_version` set back to `13` — and 13 lease files written under
`.corpus/locks/` (12 well-formed, plus a deliberately malformed `notalock.json`).

Restart:

```
{"msg":"projection schema changed; rebuilding from files","from":13,"to":14,
 "path":".../.corpus/cache.db"}
```

After the restart, read with a separate read-only connection:

```
stamp: 14
'locks' present: False
SELECT * FROM locks -> no such table: locks
documents: 12          (all rebuilt from files)
embeddings carried over: 106
```

`GET /api/db/doctor` → `ok=true, drift=[], warnings=[]`. `POST /api/db/rebuild`
afterwards returns counts with **no `locks` field** (`documents/threads/turns/
anchors/links/events/jobs/seen`), matching the contract's
`PROJECTION_COUNT_FIELDS`.

### 3. A leftover `.corpus/locks/` — **ignored, not removed**

The 13 lease files were still on disk after the migration, byte-for-byte, and
caused no drift. With the server running and an SSE stream attached, a lease file
was **created, modified and deleted**; a real document create followed so
"nothing happened" could be told from "the stream is dead":

```
lock-related SSE frames: 0
last frames: data: {"keys":[["docs"],["docs","doc_lnlvv4hv"],["tree"]]}
             data: {"keys":[["index"]]}
```

The directory is left where it is by decision (see the report): it is not a watch
root, `classifyWatchPath` returns `null` for anything under it, and nothing
projects it — so it is structurally inert rather than cleaned up. `corpus init`
no longer creates one.

### 4. Two writers, a key, no 423

```
both read key      e24d492e46c37708…
user PUT + key  -> 200, fresh key fff2ea8ee12eb4f9…
agent PUT + same (now stale) key -> 409 code=stale_key
   carries the document = True
   fresh key = fff2ea8ee12eb4f9…
   body it now stands at = "The user's version.\n"
on disk: "The user's version." — the agent's write never landed
```

And the advisory signal is not a gate: with `userEditing = True`, an agent `PUT`
presenting a current key answered **200**.

### 5. §4 — two acts commit alone, and the third one is gone

A create of two documents (one window), then a deletion:

```
f320ed1 user | doc delete: Doomed (doc_svhtjoxu) by user
b156ab8 user | editing session: 2 documents by user
files in the deletion commit:  data/docs/inbox/doomed.md
files in the window commit:    data/docs/inbox/doomed.md
                               data/docs/inbox/neighbour.md
```

The window closes and lands first; the deletion commits alone with only its own
file. Across the whole repository: **0** commit subjects mentioning a lock or a
force-break, **0** `Corpus-Lock-Holder` trailers, and every commit still names a
party (`6 user`, `1 agent`).

### 6. §7's deferral, re-triggered by the session ending

```
user PUT on doc_4sky6mja        -> 200,  userEditing = True
comment on it                    -> enqueues evt_s2raped7lzmw
claim-all                        -> claimed evt_s2raped7lzmw
defer blockedOn=doc_4sky6mja     -> deferred/: evt_s2raped7lzmw.json
POST /api/docs/{id}/edit-session/flush -> 204
                                    deferred/: EMPTY
                                    pending/:  evt_s2raped7lzmw.json (+ the doc.edited)
server log: {"msg":"deferred events re-entered the queue",
             "docId":"doc_4sky6mja","ids":"evt_s2raped7lzmw"}
```

The work came back on its own, with no CLI call and no operator — driven by the
session ending, not by a lock clearing.

### 7. Clean stop

`SIGTERM` → the open edit session was acknowledged, `shutdown complete`, port
8791 free, no stray processes.

### 8. PR #43 review, MAJOR 2 — the 13 → 14 boot no longer discards embeddings

**Model: opus.** The verification above was run against a `corpus init`
workspace, which has no semantic index to lose — and section 2's line
"embeddings carried over: 106" was **the wrong reading of a true number**: at
boot nothing was carried, the whole table was deleted with `cache.db`, and the
bundled local model (`local/all-MiniLM-L6-v2@384`) recomputed 106 embeddings
within seconds of the restart. Presence after the boot is not evidence of
survival. `updated_ms` is, so every measurement below is a digest over
`(chunk_id, identity, dim, vec, state, failures, updated_ms)`.

Two arms from **one byte-identical starting workspace** (`ws2a`, `ws2b`; scratch
under `~/.claude/jobs/4dd0ddef/tmp`, ports 8794/8795 — never 8765 or 5173): a
real `corpus init` workspace with 12 documents, 114 chunks and **114 real
embeddings the server itself computed**, then aged into a genuine v13 database —
`meta.schema_version` set to `13` and a populated `locks` table re-created, which
is what an upgrading workspace actually holds.

```
before either boot (both arms identical):
  rows 114 · identity local/all-MiniLM-L6-v2@384 · dim 384 · all state=ready
  updated_ms 1786545165225 .. 1786545169707
  DIGEST bfb61e5189b3d98c328ba96ea94b899023783d1c70ef7b97f8addd43dbc3dc4e
```

**Arm A — the shipped behaviour** (the boot-time replacement restored to
delete-then-create, via a temporary probe in `supersedeProjectionFile`):

```
$ corpus server start           # 13 -> 14
  {"msg":"projection schema changed; rebuilding from files","from":13,"to":14}
  rows 114 · all ready
  updated_ms 1786545235591 .. 1786545240099      <- every row rewritten
  DIGEST f75b4d9bbb5496c902cda9a4cf926d6c6935d1ce5baa1960ed1355a14786b285
```

Every embedding was destroyed and recomputed — 114 chunks, ~4.5 s of local
inference on this laptop. Linear in corpus size: the 40k-chunk corpus
`schema.ts` names is ~26 minutes of CPU, and against a paid embedding provider it
is 40k inferences billed, for a schema change whose entire content is dropping a
table nothing reads.

**Arm B — the fix**, same starting bytes, probe removed:

```
$ corpus server start           # 13 -> 14
  {"msg":"projection schema changed; rebuilding from files","from":13,"to":14}
  {"msg":"carried semantic embeddings across the schema change","carried":114}
  rows 114 · all ready
  updated_ms 1786545165225 .. 1786545169707      <- untouched
  DIGEST bfb61e5189b3d98c328ba96ea94b899023783d1c70ef7b97f8addd43dbc3dc4e
```

Digest identical to the pre-boot snapshot: the rows were **carried, not
recomputed**. Everything else the replacement is supposed to do still happened:

```
stamp                14
documents            12          (re-derived from files)
chunks               114
embeddings           114, of which 114 join a live chunk row
locks table          gone
.corpus/             no `cache.db.superseding-*` leftovers
corpus db doctor     projection is clean — 12 documents from 12 files (5ms)
corpus search "quarterly revenue invoices"  -> ranked hits, index usable
corpus db rebuild    -> DIGEST bfb61e51…  (unchanged: the explicit path still carries)
```

Unit-level regression probe, to prove the new tests are not vacuous: with
`supersedeProjectionFile` reverted to delete-then-create, exactly two of the new
tests fail — "carries semantic embeddings across a schema change" and "sweeps a
staging database left by an interrupted schema change" — and all 25 other tests
in `db.test.ts` pass, so the arm changes only what it claims to.

**Design note.** The alternative was to leave the dead `locks` table in place and
skip the bump. Rejected: it dodges *this* bump only, leaves a table in the schema
that §7 says has nothing to hold, and pays the same cost at the next bump. The
carry-over is the fix for every future schema change, and it puts the boot path
on the same footing as `corpus db rebuild` — which has carried embeddings since
sprint-021. The asymmetry was the bug: `db rebuild` is a thing an operator chose
to run, while a stamp bump is something an upgrade does unasked, and the unasked
one was the destructive one.

### Checks

- `npx tsc --noEmit -p apps/server/tsconfig.json` — **0 errors** (re-run after
  the MAJOR 2 fix: still 0)
- `npx vitest run apps/server` — **3739 passed / 178 files**, green
  (re-run after the MAJOR 2 fix: **3744 passed / 178 files**, the 5 new
  projection tests included, no flakes)
  (one flake on `acts.test.ts > an ordinary save…` under a loaded 4-worker run;
  passed alone and on the immediate re-run of the full suite)
- `eslint apps/server/src --max-warnings=0` — clean (the pre-existing warnings in
  `bulk.test.ts`, `write-guard.test.ts`, `mutate.test.ts` and `rollback.test.ts`
  went with the subsystem)
- `prettier --check apps/server/src/**/*.ts` — clean

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (deletes a subsystem and migrates a user's database)
- [ ] Committed with `[ISSUE-ID]` prefix
