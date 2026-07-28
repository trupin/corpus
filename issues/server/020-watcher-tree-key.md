# [SERVER-020] Watcher path breaks the tree-key invariant (structural heuristic vs. signature)

## Domain

server

## Status

done

## Priority

P2

## Model

opus — the mechanism already exists (`folderTreeSignature()` from SERVER-018); this drops it into the watcher's `flush()`.

## Dependencies

- Depends on: SERVER-018
- Blocks: —

## Spec References

- SPEC.md §9 — SSE invalidation keys
- `issues/server/018-tree-key-gaps.md` — the governing invariant and its escalation note

## Summary

Escalated by SERVER-018's implementer: mutation frames now satisfy the invariant ("a frame carries `["tree"]` exactly when `GET /api/tree`'s response changed") by construction, but the out-of-band **watcher** path (`watcher/watcher.ts`) still picks the key from a `structural` heuristic and breaks the invariant in both directions — reproduced: an on-disk edit setting `status: archived` removed a folder from `GET /api/tree` while the frame carried only doc keys; conversely a skill file appearing under `.claude/skills/` emits `["tree"]` though skills are counted nowhere.

## Acceptance Criteria

- [x] The watcher's `flush()` decides `["tree"]` by comparing `folderTreeSignature()` across the re-projection, same as `runMutation`.
- [x] Both reproduced directions become regression tests (disk-edit archive → key present; skill-file appearance → key absent).
- [x] No new key names; mutation-path behavior untouched.
- [x] Optional (sprint-007 evaluator note): `POST /api/db/rebuild` is the one remaining route emitting `["tree"]` on a byte-identical tree — deliberately coarse per SERVER-017. Decide whether to fold it into the measured scheme or bless the coarseness with a written rationale. → **DECIDED: bless the coarseness.** Rationale below.
- [x] **Reassigned in (sprint-008 Open Conflict 9)**: SERVER-022 finding 10 — the watcher's batch flush runs a synchronous `execFileSync("git show")` per anchored file (`watcher.ts` + `git-head.ts`); a branch switch touching many anchored docs (or a wedged git at the 5s timeout) blocks the event loop for the whole batch. Bound the per-batch blocking. Lands here because both changes live inside `flush()`.

## Technical Design

Expected footprint: `watcher/watcher.ts` flush + tests. The signature helper is exported from `docs/tree.ts`.

### As built

**The tree key (`watcher/watcher.ts`).** `documentKeys()` loses its `structural`
parameter entirely — it now returns only `["docs"]`, `["docs", id]` and, for a
thread, `["threads", id]`. A per-batch `FlushContext` carries the accumulated
keys and a `captureTree()` memo; `collectDocument()` calls the memo as its first
statement, so the signature is taken exactly once per batch and only when the
batch touches a document path (a batch of queue events, locks or job logs pays
nothing). After the loop, `flush()` compares `folderTreeSignature(db)` against
the snapshot and appends `TREE_KEY` iff it differs. This is the same measurement
`runMutation` performs at `docs/write.ts:630`/`:640`, against the same function
`GET /api/tree` calls — so the watcher cannot disagree with `docs/tree.ts` about
what moves a folder badge, which is the whole of SERVER-018's invariant.

**The flush bound (finding 10).** `flush()` is synchronous by necessity —
projecting rows and reconciling anchors are both synchronous, and interleaving a
second flush would break the unlink-before-add ordering. The problem was that it
was also *unbounded*: one `execFileSync("git show")` per anchored file, run
sequentially, with nothing else served in between.

The bound is a **per-flush time budget with deferral of the remainder**
(`WATCH_FLUSH_BUDGET_MS = 100`, overridable via `StartWatcherOptions.flushBudgetMs`):

- before each entry after the first, `flush()` checks `Date.now()` against the
  budget; when it is spent, that entry and **every entry after it** go back into
  `pending` and the flush ends;
- the first entry always runs — a bound that can decline to make progress is a
  livelock, not a bound;
- deferral is a *suffix* of the batch, never a hole in it, so unlink-before-add
  survives the split (unlinks are the head of `ordered`, and the next flush
  re-sorts what it gets);
- putting an entry back never overwrites a newer event recorded for the same
  path while the batch ran (`if (!pending.has(absPath))`);
- the continuation is scheduled with `schedule(0)` and `batchDeadline` is pinned
  at *now*, so work that is already overdue cannot be re-debounced by events
  arriving in the meantime.

**Stated bound: one flush blocks for at most `WATCH_FLUSH_BUDGET_MS` plus the
cost of the single entry already in flight when the budget expired** (worst case
`GIT_TIMEOUT_MS`, in the wedged-git case) — **independently of the batch size.**
Pre-fix the term was `N ×` per-entry cost, with no size-independent term at all.

Deliberately *not* done: batching the reads into one `git cat-file --batch`
invocation. It would cut the constant (100 spawns → 1) but bounds nothing —
one `cat-file --batch` over 10 000 paths blocks just as long as 10 000 `git
show`s — and it replaces a per-call `maxBuffer` of `MAX_HEAD_BLOB_BYTES` with an
output buffer that grows with the batch, which is a new unbounded quantity in
exchange for removing none. The finding asks for a bound; the budget is the
bound. Reducing the constant is a legitimate follow-up and an independent one.

**Nothing is dropped.** Every deferred path is reconciled, projected and
announced by a later flush; what changes is *when*, not *whether*. SPEC.md §6's
out-of-band catch-all is not allowed to become best-effort, so this is asserted
directly (`flush-budget.test.ts`, and `db doctor` reporting zero drift over 209
files after a 100-file deferred batch in the E2E below).

### The `POST /api/db/rebuild` decision: bless the coarseness

`REBUILD_QUERY_KEYS` stays unconditional, `["tree"]` included. The rationale, now
recorded next to the constant in `projection/routes.ts` and pinned by
`projection/routes.test.ts` → _"names the tree even when the rebuild leaves it
byte-identical, by design"_:

SERVER-018 and SERVER-020 make every **mutation** frame lawful — it carries
`["tree"]` exactly when `GET /api/tree`'s response changed, measured across the
write. A rebuild is not a mutation frame. It reports no change the server made;
it is a *resynchronization instruction* — the operator's reset button for a
cache, or a client, nobody trusts any more.

Folding it in is technically trivial (snapshot either side of `reopenAround`,
which does not disturb SERVER-017's contract: the handle object is unchanged,
both reads sit outside the callback, everything stays synchronous). It was
rejected on the merits. Measuring would mean comparing the tree derived from the
rows being discarded against the tree derived from the rows replacing them, and
staying silent when they match — and that comparison is blind to the case the
route exists for. A rebuild is typically run because the **board** looks wrong,
which includes a client that missed a frame while the projection was right all
along; there the two signatures match *by construction*, and suppression would
decline to resynchronize the one thing the user asked to have fixed. The failure
modes are not symmetric: over-invalidating a rare, manual, whole-cache operation
costs one refetch of a small structure, while under-invalidating it costs the
point of the command.

A corollary worth stating so it is not read as an inconsistency: the frame's
other four keys are unconditional for a different reason — `["tree"]` is the only
key in the vocabulary with a cheap, total, deterministic signature. There is no
comparable snapshot of `["docs"]`. The asymmetry would follow from what is
measurable, not from principle, which is a second reason not to introduce it.

**The invariant, stated precisely after this issue:** _every frame that reports a
mutation — from the write path or from the watcher — carries `["tree"]` exactly
when `GET /api/tree`'s response changed. `POST /api/db/rebuild` does not report a
mutation; it names the coarse vocabulary unconditionally, by design._

## E2E Verification Plan

### Verification Steps

1. Reproduce both directions pre-fix on a real server with out-of-band file edits; log frames + tree bodies.
2. Post-fix: both directions satisfy the invariant.

## E2E Verification Log

implemented on: opus

Real `corpus` workspace at `/tmp/corpus-s020-e2FOfs` (`corpus init`, port moved to
**8910**), real server process started with `corpus server start`, `curl -N /events`
attached throughout, `GET /api/tree` read either side of every change. Entry point
`node --import tsx apps/cli/src/bin/corpus.ts`.

### Reproduction (bugs only)

Both directions reproduced **before any code was written**, against the shipped
`structural` heuristic.

**Direction (i) — an on-disk archive empties a folder and the frame says nothing.**
One document (`doc_jwbimevv`) alone in `data/docs/solo/`; `status: open` →
`status: archived` written directly to the file by an outside process.

```
tree BEFORE: {"folders":[{"path":"solo","name":"solo","count":1,"totalCount":1,"children":[]},
                         {"path":"templates",...},{"path":"views",...}]}
tree AFTER : {"folders":[{"path":"templates","name":"templates","count":1,"totalCount":1,"children":[]},
                         {"path":"views","name":"views","count":3,"totalCount":3,"children":[]}]}
```

`solo` is gone from the route's answer. The frames on `/events`:

```
event: invalidate
data: {"keys":[["docs"],["docs","doc_jwbimevv"]]}
```

**No `["tree"]`.** The board keeps rendering a folder the server no longer lists.
Cause by inspection: an edit to an existing file is `structural === false`
(`watcher.ts:175`), while `folderTree()` excludes `status = 'archived'`.

**Direction (ii) — a skill file appears and the frame invents a tree change.**
`.claude/skills/probe/SKILL.md` created out of band.

```
tree BEFORE: {"folders":[{"path":"templates",...},{"path":"views",...}]}
tree AFTER : {"folders":[{"path":"templates",...},{"path":"views",...}]}      ← byte-identical
```

```
event: invalidate
data: {"keys":[["docs"],["docs","doc_probeskill"],["tree"]]}
```

**`["tree"]` present on an unchanged tree.** `.claude/skills` is a full
`DOCUMENT_ROOT` and a new path is `structural === true`, while `folderTree()`
selects only `data/docs/%`.

**Finding 10 — the unbounded flush, measured before the fix.** N anchored
documents (each with a real `anchors:` entry, created through `POST /api/docs` +
`POST /api/threads`, so `readHeadVersion` runs for each) touched out of band in
one batch, while a second client polled `GET /api/health` back-to-back
throughout. `git show` invocations counted with a counting `git` shim on the
server's `PATH`.

| run                                | `git show` invocations | worst `GET /api/health` latency |
| ---------------------------------- | ---------------------: | ------------------------------: |
| pre-fix, N = 25                    |                     25 |                        **179 ms** |
| pre-fix, N = 100                   |                    100 |                        **575 ms** |
| pre-fix, N = 100 (counting shim on) |                    100 |                       **1630 ms** |

~5.7 ms per anchored file, linear in N — i.e. no bound at all. The shim row is
the like-for-like baseline for the post-fix number below (it makes each git call
about twice as expensive; both sides ran with it).

### Post-Implementation Verification

Server restarted on the fixed build, same workspace, same instrumentation.

**Direction (i) — fixed.** `status: open` → `status: archived` on the lone
document in `data/docs/solo/`:

```
tree BEFORE: {"folders":[{"path":"bulk",...,"count":200},{"path":"research",...},
                         {"path":"solo","name":"solo","count":1,"totalCount":1,"children":[]},
                         {"path":"templates",...},{"path":"views",...}]}
tree AFTER : {"folders":[{"path":"bulk",...,"count":200},{"path":"research",...},
                         {"path":"templates",...},{"path":"views",...}]}
tree CHANGED: yes
data: {"keys":[["docs"],["docs","doc_jwbimevv"],["tree"]]}
ANNOUNCED: yes
```

**Direction (ii) — fixed.** `.claude/skills/probe/SKILL.md` created out of band:

```
tree BEFORE == tree AFTER   (byte-identical, `bulk`/`solo`/`templates`/`views` unchanged)
tree CHANGED: no
data: {"keys":[["docs"],["docs","doc_skill6b48b45c"]]}
ANNOUNCED: no
```

The skill is still projected and still announced — it just no longer claims the
tree moved.

**Symmetry, and the cases either side of the fix.** Same harness, same run:

| out-of-band change                          | `GET /api/tree` changed | frame carried `["tree"]` |
| ------------------------------------------- | ----------------------- | ------------------------ |
| `status: archived` on the last doc in a folder | yes                     | yes                      |
| `status: archived` undone (unarchive)       | yes (`solo` returns)    | yes                      |
| `SKILL.md` appears under `.claude/skills/`  | no                      | no                       |
| body-only append to a document              | no                      | no (`["docs"]`, `["docs", id]` still present) |
| new `.md` in a brand-new `research/` folder | yes                     | yes                      |
| `POST /api/db/rebuild`, nothing changed     | no                      | **yes — blessed, by design** |

The invariant holds in every row, in both directions, and the last row is the
decided exception rather than a leak.

**Finding 10 — the bound, measured.** Same 100 anchored documents, same probe:

| run                                  | `git show` invocations | worst `GET /api/health` latency |
| ------------------------------------ | ---------------------: | ------------------------------: |
| pre-fix, N = 100 (counting shim on)  |                    100 |                       **1630 ms** |
| post-fix, N = 100 (counting shim on) |                    100 |                        **117 ms** |
| pre-fix, N = 100 (no shim)           |                    100 |                        **575 ms** |
| post-fix, N = 100 (no shim)          |                    100 |                **110 ms / 125 ms** (two runs) |

**14× like-for-like, and — the point — the remaining number is the budget, not a
function of N.** The invocation count is deliberately unchanged: the fix bounds
*when* the reads happen, not how many there are (see "As built" for why batching
them was rejected).

**Correctness of the bound.** After the deferred 100-file batch,
`corpus db doctor --json` on the real workspace:

```
{"ok":true,"drift":[],"stats":{"files":209,"documents":209,"hashed":0,"parsed":0,"durationMs":13}}
```

Zero drift over 209 files — every deferred path was reconciled and projected, so
nothing the bound stopped short of was lost.

### Tests

- `apps/server/src/watcher/tree-key.test.ts` (new, 8 cases) — the invariant
  asserted the way `docs/tree-key.test.ts` asserts it: real files, real chokidar,
  the real Hono app, and `GET /api/tree`'s **HTTP body** read either side, with
  `expect(announced).toBe(changed)` checked for every case before anything
  specific to it. Covers both reproduced directions, unarchive symmetry, a
  body-only edit keeping its other keys, a folder appearing and vanishing,
  parented vs standalone thread accounting, an unparseable file and a file
  outside every root, and a batch mixing one structural edit with three body
  edits naming the tree exactly once.
  **Verified to fail against the pre-fix `flush()`**: with `documentKeys`'s
  `structural` parameter and the signature compare temporarily reverted, 5 of the
  8 fail — both reproduced directions among them (`expected false to be true`,
  `expected true to be false`) — and all 8 pass against the fix.
- `apps/server/src/watcher/flush-budget.test.ts` (new, 4 cases) — the bound, via
  the **`readHead` seam** rather than a wedged git: a deterministic busy-waiting
  reader stands in for `execFileSync`. Asserts the flush stops at its budget
  (elapsed and read count both bounded), that it always makes progress, that the
  remainder converges with every document read and projected, that frames stay
  correct and key-complete across the split with no phantom `["tree"]`, that a
  batch under the budget still drains in one flush, and that an unlink recorded
  for a deferred path wins over the deferred `change`.
- `apps/server/src/projection/routes.test.ts` — one case added pinning the
  rebuild decision on a provably byte-identical tree.
- `apps/server/src/watcher/watcher.test.ts` — one expectation corrected: a
  document landing at the **root** of `data/docs/` belongs to no folder node, so
  the tree is byte-identical and the frame no longer carries `["tree"]`. The old
  expectation was the `structural` heuristic's over-announcement.

`npm test`: **3428 passed / 203 files**. `npm run lint`, `npm run format:check`,
`npm run typecheck`: clean.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-020]` prefix
