# [SERVER-061] Populate the in-progress set on claim-all and idle

## Domain

server

## Status

done

## Priority

P0 (critical path — the server does not typecheck until this lands)

## Model

opus

## Dependencies

- Depends on: SHARED-015 (signed), CONTRACT-033
- Blocks: CLI-029, AGENT-013

## Spec References

- SPEC.md §7 — the event queue; specifically the signed rider bullet "**The agent
  can see what the server still thinks it is doing.**"
- `packages/contract/src/schemas/queue.ts` — `InProgressEventSchema`,
  `InProgressSetSchema`, `MAX_IN_PROGRESS_REPORTED`

## Summary

CONTRACT-033 added a **required** `inProgress` field to `ClaimBatchSchema` and
`IdleResultSchema`. The server produces neither, so `tsc -p apps/server` fails at
`queue/routes.ts` and the two claim-all/idle response-shape tests fail. This
issue populates the field from the queue's own `in-progress/` directory: the
events the server is still holding, most recently claimed first, capped at
`MAX_IN_PROGRESS_REPORTED` with `total` and `truncated` reported, each row
carrying its type, the instant it was claimed, and the origin document resolved
by the **same** rule `GET /api/jobs` uses.

The server reports and settles nothing. No auto-complete, no auto-fail, no
auto-requeue: reconciliation is the agent's judgement (SPEC.md §7), and
`reap-stale` remains the only recovery path and stays a requeue.

## Acceptance Criteria

- [x] `POST /api/queue/claim-all` responds with `inProgress`, parsing against
      `ClaimBatchSchema`
- [x] `GET /api/queue/idle` responds with `inProgress` on its `200`, parsing
      against `IdleResultSchema`; the `204` is unchanged (no body, no list)
- [x] The reported events are exactly what is in `.corpus/queue/in-progress/`
      **before** the claim's own moves — disjoint from the batch just claimed
- [x] Ordering is most-recently-claimed-first
- [x] At most `MAX_IN_PROGRESS_REPORTED` rows, with `total` = the true count and
      `truncated` = true exactly when the cap cut the list
- [x] `originId`/`originTitle` derive from `jobs/project.ts`'s `resolveOrigin`
      rule — the same function, not a second implementation
- [x] `heldSince` is an instant, never a pre-computed duration
- [x] Nothing held is `{events: [], total: 0, truncated: false}`
- [x] Nothing is settled, moved or quarantined by the read
- [x] `tsc -p apps/server` clean; lint and prettier clean; server tests green

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/held.ts` — **new**: reads `in-progress/`, orders, caps,
  and maps to the contract's `InProgressSet`
- `apps/server/src/queue/held.test.ts` — **new**: unit tests for the reader and
  the wire mapping
- `apps/server/src/queue/service.ts` — `claimAll` and `idle` return the batch
  **and** the held set, captured in the same serialized turn
- `apps/server/src/queue/routes.ts` — hands the held set to the wire mapper with
  an origin resolver bound to the projection
- `apps/server/src/queue/index.ts` — re-exports the new module
- `apps/server/src/app.ts` — passes `deps.projection` to `mountQueueRoutes`
- `apps/server/src/jobs/project.ts` — `resolveOrigin` splits into a JSON-parsing
  wrapper over `resolveOriginFromPayload`, so an already-parsed payload reaches
  the identical rule without a stringify round-trip
- tests updated for the two changed service signatures

### Key Implementation Details

**Before, not after.** `claim-all` reads `in-progress/` *before* it moves
anything out of `pending/`. Reporting the state after the move would list the
batch the caller was handed in the same breath as "you are apparently already
doing this", which is precisely the confusion the contract forbids
(`InProgressSetSchema`: "Disjoint from the events just claimed"). The snapshot
is taken inside `claimAll`'s own serialized turn, so the ordering is structural
rather than a property of the order two calls happen to be made in.

**`heldSince`** is the event's `updated` — the instant `stamp()` wrote when the
claim moved it into `in-progress/` — falling back to `created` for a file
dropped in by hand without one. Instants are canonical to the second, so equal
timestamps are broken by id descending: deterministic, and arbitrary only within
a single batch, whose members were claimed at the same instant anyway.

**Malformed files are skipped, not quarantined.** This is a read path; the same
rule `availablePending` already follows. They are also excluded from `total`, so
the contract's stated invariant (`total === events.length` whenever `truncated`
is false) stays true.

### Edge Cases

- No projection wired in (unit-test server shape): every origin is `null`, which
  is what `null` already means — "no document the corpus still holds".
- A payload naming a deleted document: `resolveOrigin` falls through to the next
  origin key, and to `null` when none survives.
- Halted queue: `claim-all` returns no events but still reports what is held —
  a halt does not stop the agent from reconciling.
- An unparseable event file in `in-progress/` is skipped and debug-logged.

## Testing Strategy

Unit tests in `queue/held.test.ts` (reader + mapper: disk agreement, ordering,
cap/overflow, origin resolution including a deleted document, empty queue) and
route-level tests in `queue/routes.test.ts` (both response shapes parse; the
claimed batch is absent from `inProgress`; a second claim reports the first).
Service tests cover the before-the-move snapshot and the halted case.

## E2E Verification Plan

Start a real server on a real `corpus init` workspace, enqueue events through
the real write path, claim over HTTP, and compare the reported set against
`.corpus/queue/in-progress/` on disk.

### Verification Steps

1. `corpus init` a scratch workspace; start the real server on a free port.
2. Create a document and threads so `comment.created` events are enqueued with
   real payloads.
3. `POST /api/queue/claim-all` — expect `inProgress.events` empty, `total` 0.
4. Claim again after a second batch — expect the first batch reported, with
   origin titles, ordered newest first.
5. Delete the origin document; claim again — expect `originId`/`originTitle`
   null for that row and the event still listed.
6. Strand more than `MAX_IN_PROGRESS_REPORTED` events; claim — expect 20 rows,
   the true `total`, `truncated: true`.
7. Confirm no file moved: `in-progress/` count unchanged across every read.

## E2E Verification Log

Implemented on: **opus**.

### Post-Implementation Verification

Real `corpus init` workspace at `/tmp/corpus-s061-e2e`, the real server process
(`tsx apps/server/src/main.ts --workspace /tmp/corpus-s061-e2e`, pid 98946) on
**port 8766** — the port `corpus init` chose; the user's live server on 8765 was
never touched. Documents and threads created through the real CLI
(`tsx apps/cli/src/bin/corpus.ts`), every queue call over real `curl`.

**1. Empty queue — the field is present and zeroed, never absent**

```
$ curl -s -XPOST localhost:8766/api/queue/claim-all -H "Authorization: Bearer $TOKEN"
{"events": [], "inProgress": {"events": [], "total": 0, "truncated": false}}
```

**2. The before-the-move decision, on the most common call there is**

One document and two `@agent` threads through the CLI, so two real
`comment.created` events are enqueued by the real write path:

```
$ curl -s localhost:8766/api/queue/status ...
{"halted":false,"pending":2,"inProgress":0,...}

$ curl -s -XPOST .../claim-all ...
claimed: ['evt_6bx2mfm3m6e2', 'evt_dcpbadrtmbhp']
inProgress: {"events": [], "total": 0, "truncated": false}

$ ls .corpus/queue/in-progress
evt_6bx2mfm3m6e2.json
evt_dcpbadrtmbhp.json
```

Both events **are** in `in-progress/` when the response is written, and both are
absent from `inProgress` — the snapshot was taken before the claim's own moves.
Reported after, this first call would have handed the agent two events and told
it, in the same breath, that it was apparently already working on them.

**3. The next claim reports them, with type, instant and origin**

```
$ curl -s -XPOST .../claim-all ...
{"events": [],
 "inProgress": {"events": [
   {"id":"evt_dcpbadrtmbhp","type":"comment.created","heldSince":"2026-08-06T16:38:58Z",
    "originId":"th_abj5pcom","originTitle":"Second question"},
   {"id":"evt_6bx2mfm3m6e2","type":"comment.created","heldSince":"2026-08-06T16:38:58Z",
    "originId":"th_evcoxcud","originTitle":"Rate check"}],
  "total": 2, "truncated": false}}
```

`heldSince` is an instant. Nothing was claimed by the call that reported them.

**4. Origin follows `resolveOrigin`'s rule, live — rename, fall-through, null**

```
$ curl -s -XPUT .../api/docs/th_evcoxcud -d '{"title":"Rate check (revised)"}'   -> 200
$ claim-all -> [('evt_dcpbadrtmbhp','th_abj5pcom','Second question'),
                ('evt_6bx2mfm3m6e2','th_evcoxcud','Rate check (revised)')]

$ curl -s -XDELETE .../api/docs/th_abj5pcom                                      -> 200
$ claim-all -> [('evt_dcpbadrtmbhp','doc_ackk5rzz','The rate assumption'),   # fell through
                ('evt_6bx2mfm3m6e2','th_evcoxcud','Rate check (revised)')]

$ curl -s -XDELETE .../api/docs/doc_ackk5rzz                                     -> 200
$ claim-all -> [('evt_dcpbadrtmbhp', None, None),
                ('evt_6bx2mfm3m6e2','th_evcoxcud','Rate check (revised)')]
                total 2
```

The middle step is the rule's own fall-through observed end to end: with its
`threadId` deleted the event resolved to its `parentId`, exactly as
`ORIGIN_KEYS` says and as `GET /api/jobs` answers. The title is read at response
time (the rename shows through). With both documents gone the row is **still
listed** — only its origin is null.

**5. Cap and overflow, on 25 held events**

23 further events dropped into `pending/` and claimed, so 25 are held:

```
$ claim-all -> claimed 23, held-before 2
$ claim-all -> reported 20  total 25  truncated True
             newest first: all 20 rows carry heldSince 2026-08-06T16:39:31Z
             (the two 16:38:58 rows are the ones that aged out)
$ ls .corpus/queue/in-progress | wc -l
      25
$ curl -s .../api/queue/status -> {"inProgress":25,...}
```

Most-recently-claimed-first with the cap biting: the older residue leaves the
window, the fresh discrepancies stay visible, and `total` still tells the truth.

**6. `idle` carries it on the 200; the 204 stays body-less**

```
$ curl -s -i ".../api/queue/idle?timeout=1" | head -1
HTTP/1.1 204 No Content
$ curl -s ".../api/queue/idle?timeout=1" | wc -c
       0
(one event enqueued)
$ curl -s ".../api/queue/idle?timeout=10"
available ['evt_idleprobe01']; held total 25, reported 20, truncated True
$ curl -s .../api/queue/status -> {"pending":1,"inProgress":25,...}
```

`idle` still claims nothing — the event it reported is still pending.

**7. Halted, it still reports what is held**

```
$ POST /api/queue/halt   -> 200
$ claim-all              -> claimed 0, held total 25
```

A halt stops work being handed out, not the agent's ability to reconcile.

**8. The server settles nothing — SPEC.md §7's load-bearing constraint**

Five further claims, then the terminal directories:

```
processed: 0   failed: 0   abandoned: 0   deferred: 0   in-progress: 26
```

(26 because one claim legitimately took the idle probe event.) Nothing was
completed, failed, requeued or quarantined by any read. Settling still works
when the *agent* asks:

```
$ POST /api/queue/evt_bulk00000000/complete -> 200
$ claim-all -> held total now 25
```

Workspace `git log` shows only the document/thread commits — no queue-driven
commit — and the server log contains **0** error lines.

**Conclusion: PASS.** Every acceptance criterion observed against the real
server over real HTTP. Server stopped (pid 98946), port 8766 verified free.

---

### Review-fix round — PR #25, two MINOR findings (2026-08-06, model: opus)

Both findings addressed. Real server (`corpus server start`, run from source via
tsx, port 8766, workspace `/tmp/corpus-s061-e2e-m6f2`), real CLI, real
`chmod 000` files — no stubs anywhere in this round's E2E.

#### Finding 1 — `queue/held.ts`: a diagnostic read could deny the agent its work

`store.readEvent` rethrows every non-`ENOENT` error, so one unreadable file in
`in-progress/` made `readHeldInProgress` throw — inside `claimAll`, **before it
moves anything**. Malformed *content* was skipped and logged; an unreadable
*file* took the whole batch down with it.

**Decision: degrade at the granularity the failure actually has — two tiers, not
one.**

- **One unreadable file → skip it**, exactly as a malformed one is skipped, and
  exclude it from `total` as well as from the list. This is the maximal-
  information option and the one consistent with the neighbouring path: the
  other nineteen held events are still reported, and still reported honestly.
  Degrading the whole report here would throw away nineteen accurate rows to
  punish one bad file.
- **An unlistable directory → degrade the whole report** to `NOTHING_HELD`.
  There is no per-file granularity to be narrow with — there is no list to skip
  an entry from — so the choice is between telling the agent nothing (which the
  CLI renders as silence) and telling it a number that is wrong. Nothing wins.

Both are logged at `error`, deliberately unlike the malformed path's `debug`: a
malformed file is expected residue that `reap-stale` exists to clear, while an
unreadable one is a workspace fault only an operator can fix — and `error` is
the one level a server running at `silent` still writes. `total` excludes every
skip in both tiers, so the contract's `total === events.length` while
`truncated` is false still holds exactly.

The CLI's own reasoning (`commands/queue/in-progress.ts:98-103` — "a server that
omits the report costs a diagnostic instead of costing the work") now holds on
both ends of the wire: **the in-progress set is the report, the claim is the
work.**

**Pre-fix reproduction** (per-file catch temporarily removed from `held.ts`,
server restarted on the reverted code, `chmod 000` on one held file):

```
$ chmod 000 .corpus/queue/in-progress/evt_ijm56o7bd3bs.json
$ corpus queue status
queue running — pending 2, in-progress 5, …
$ corpus queue claim-all
corpus: 500 internal_error: internal error
$ corpus queue status
queue running — pending 2, in-progress 5, …      # the batch is stranded
```

Two claimable events, and the agent got neither — because of a diagnostic.

**Post-fix, same workspace, same unreadable file, same two pending events:**

```
$ corpus queue claim-all --json
claimed: evt_3gcwf54tel57,evt_h45u7o33nerh
inProgress.total: 4  events: 4  truncated: false
$ corpus queue status
queue running — pending 0, in-progress 7, …
```

Server log (`.corpus/server.log`), the skip and the 200 side by side:

```
{"level":"error","msg":"skipping unreadable in-progress event",
 "id":"evt_ijm56o7bd3bs",
 "reason":"EACCES: permission denied, open '…/in-progress/evt_ijm56o7bd3bs.json'"}
{"level":"info","msg":"request","method":"POST","path":"/api/queue/claim-all","status":200,"durationMs":10}
```

Five files held, one unreadable, `total: 4 === events.length` — the invariant
survives the skip, and the skip is not silent.

**The directory tier, on the same server** (`chmod 000` on `in-progress/`, queue
halted so the claim attempts no moves):

```
$ corpus queue claim-all --json
{"events":[],"inProgress":{"events":[],"total":0,"truncated":false}}
{"level":"error","msg":"cannot list in-progress events; reporting nothing held",
 "reason":"EACCES: permission denied, scandir '…/.corpus/queue/in-progress'"}
```

**A deliberate limit, recorded honestly:** with the queue *running* and the
directory still `chmod 000`, the same claim is a `500` — not from the report,
which degraded cleanly, but from `move("pending","in-progress")`, whose
destination is unusable. The report tier cannot rescue a claim whose own writes
cannot land, and should not pretend to: that is a write failure and a `500` is
the right answer to it.

#### Finding 2 — `queue/service.ts:284`: the comment contradicted the code

`// Halted: return empty *without touching the filesystem*.` sat directly under
a line that reads every file in `in-progress/`. Behaviour unchanged (the
docblock at 278–279 is right: a halt stops work being handed out, not the
agent's ability to reconcile); the comment now says what the code does:

```
// Halted: claim nothing, and *move* nothing — the read above is the report
// the halt does not suppress (see the docblock), never a claim.
```

#### Tests

New, in `queue/held.test.ts`:

- *"skips a file it cannot read at all — not merely one it cannot parse"* — a
  real unreadable entry (a **directory** named `evt_unreadable0.json`: `readdir`
  lists it, every read fails `EISDIR`). Chosen over `chmod` on purpose — a
  `chmod` is bypassed by root and would let the test pass in CI without proving
  anything. Asserts the good event is still reported, `total: 1` /
  `truncated: false` (the skip is out of `total`), one `error` log carrying the
  id and the reason, zero `debug` logs, and that nothing moved or was
  quarantined.
- *"degrades the whole report when in-progress/ cannot be listed at all"* — the
  status directory replaced by a file, so `readdir` is `ENOTDIR` for every user.
  Asserts `NOTHING_HELD` (not a throw) and the `error` log.
- `recordingLogger` now records `errors` separately from `debugs`, because the
  *level* is part of the assertion.

New, in `queue/routes.test.ts` (over real HTTP, in the in-progress-set suite):

- *"hands over the batch even when a held file cannot be read at all"* — one
  unreadable held file, two claimable events: the batch comes back with both,
  and the report degrades by exactly one row (`events: 1`, `total: 1`,
  `truncated: false`).

Every pre-existing assertion kept and passing, including the
malformed-skipped-not-quarantined case and the `total === events.length`
invariant at exactly the cap.

```
VITEST_MAX_THREADS=4 npx vitest run apps/server   → 3340 passed, 0 failed
VITEST_MAX_THREADS=4 npx vitest run apps/server/src/queue → 157 passed, 0 failed
npx eslint <4 touched files>                      → No issues found
npx prettier --check <4 touched files>            → all clean
tsc --noEmit (apps/server)                        → clean
```

Server stopped (pid 50082), port 8766 verified free, workspace removed.

#### Surfaced, not fixed — same failure class, worse blast radius, outside these findings

Reproduced by accident while restarting the server with the `chmod 000` file
still in place: **an unreadable queue file stops the server from booting at
all.** `QueueService`'s constructor calls `rebuildMirror` →
`rebuildQueueMirrorSync` → `scanQueueSync` → `readEventSync`, which rethrows
`EACCES` exactly as the async twin did:

```
{"level":"error","msg":"failed to start",
 "error":"Error: EACCES: permission denied, open '…/in-progress/evt_ijm56o7bd3bs.json'",
 "stack":"… at QueueStore.readEventSync (queue/store.ts:285)
          at scanQueueSync (queue/project.ts:57)
          at rebuildQueueMirrorSync (queue/project.ts:72)
          at QueueService.rebuildMirror (queue/service.ts:196)
          at new QueueService (queue/service.ts:169)
          at createServer (app.ts:327) …"}
$ corpus server start
corpus: the server exited during startup
```

One bad file costs the whole workspace its server, and `corpus server start` is
the only way back — with no way to reach the server to find out why. Note that a
*different* boot-time reader already skips the same file gracefully
(`{"level":"info","msg":"skipping unreadable queue event", …}` appears in the
same log, before the crash), so the mirror rebuild is the one path that does
not. This is the same class as finding 1 but strictly worse, and it is a change
to boot behaviour that nobody asked for in this round — **escalated to the
orchestrator for its own issue rather than folded in here.**

## Completion Checklist (domain agent)

- [x] Tests written and passing (`VITEST_MAX_THREADS=4 npx vitest run apps/server`)
- [x] `npx eslint` + `npx prettier --check` clean on every touched file;
      `tsc --noEmit -p apps/server` clean
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-061]` prefix
