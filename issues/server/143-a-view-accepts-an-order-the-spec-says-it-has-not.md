# [SERVER-143] A view accepts an `order` the spec says it does not have

## Domain
server

## Status
done

## Priority
P1 (important)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 10 — rider 2, boards as documents (signed 2026-08-22): a
  view's `order` was removed, and a board's `order` is the bar's
- SPEC.md Section 5 — core frontmatter

## Summary

**Found by CLI-058's implementer while testing CLI-063**, against machinery
neither issue owned.

```
corpus doc edit doc_seedattention --order 5
```

on a `type: view` document **succeeds**. Rider 2 removed `order` from views in
Phase 41, and `POST /api/boards/order` enforces that — `PUT /api/docs/{id}` does
not.

So the product has one write path that refuses the field and another that
accepts it, and the one that accepts it is the general one every client uses.
Phase 41's migration told users to unset `order` on their views
(`corpus doc edit <id> --unset order`, CLI-061), and nothing stops it being put
back.

## Why it is P1

Nothing crashes. But an accepted write is a promise: the value is on disk, it is
in the projection, and a later reader is entitled to believe it means something.
Rider 2 says it means nothing on a view. A field that is writable and meaningless
is how the next release's migration gets written.

## Acceptance Criteria

- [x] `PUT /api/docs/{id}` refuses `order` on a document whose type is `view`,
      and says why — naming the field and the rule, not a generic rejection.
- [x] A `board` still accepts `order`. The refusal is by type, not by field.
- [x] The refusal reaches the CLI as a real failure with a non-zero exit, so
      `corpus doc edit <view> --order 5` cannot silently appear to work.
- [x] An existing view that already carries `order` is **not** broken by this: it
      still reads, still lists, and the field is still removable with `--unset`.
      A refusal on write must not become a refusal on read.
- [x] The contract declares whatever status this refusal uses. CONTRACT-059 just
      closed the same class of gap on this exact route — do not reopen it.

### Added on the orchestrator's decision, 2026-08-23

The original criteria named `PUT /api/docs/{id}` alone. `POST /api/docs` accepted
`order` on a view too, so a view could be *born* carrying one. Shipping one
guarded write path and one unguarded one is the exact shape of the defect this
issue exists to fix — rider 2 was enforced by `POST /api/boards/order` and not by
`PUT`, and that is how the field survived Phase 41's migration. So:

- [x] `POST /api/docs` refuses `order` on a new document whose type is not
      `board`, with the same status, the same field path and the same rule.
- [x] **One assertion, not two.** Create and update call the same function; a
      single edit to it moves both, and a test proves that.
- [x] The recovery sentence is the one that applies to each path: an existing
      document drops the key, a caller creating one omits the field.

## Technical Design

### Files to Create/Modify
- `apps/server/src/docs/update.ts` — the type-aware field guard
- its tests
- `packages/contract` — only if the refusal needs a status the route does not
  declare, which would be a separate issue with a dependency

### Key Implementation Details

The guard belongs beside the existing per-field rules in `update.ts`, not in a
new validation layer. That file already refuses `origin: null` for a non-user
actor and already knows the document's type.

**Read the reserved-key machinery first.** Phase 41 removed `pinned` and view
`order` from `RESERVED_FRONTMATTER_KEYS` and the schemas. Whatever remains there
is the natural home, and a second mechanism beside it is how two rules that agree
today stop agreeing.

### Edge Cases
- A document whose type changes from `board` to `view` while carrying `order`.
- `--unset order` on a view: must keep working, and is the migration's own
  instruction.
- A `PUT` that touches `order` with the same value it already holds. The server
  compares untouched keys structurally (SERVER-001), so decide deliberately
  whether a no-op write refuses or passes, and write the decision down.

## Testing Strategy

Unit tests over a real projection: a view refusing, a board accepting, a view
that already carries the field still reading and still unsettable.

**Falsify**: remove the guard and watch the view's write succeed again.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Start a real server on a scratch workspace with a seeded view
2. `corpus doc edit <view-id> --order 5`
3. Expected: a refusal naming the field and the rule
4. Actual: exit 0, and `order: 5` on disk

### Verification Steps
1. Repeat after the change and confirm the refusal and the exit code
2. `corpus doc edit <board-id> --order 5` still succeeds
3. A view already carrying `order` still reads, and `--unset order` still clears it

## E2E Verification Log

Run on **opus** (claude-opus-5[1m]), 2026-08-23, branch `phase-43-what-you-see-is-true`.

### Reproduction (bugs only)

Real workspace at `/tmp/c082-ws`, real server on port 8891, the packaged
`corpus` binary, before any code changed:

```
$ corpus doc edit doc_seedattention --order 5 --from user
edited doc_seedattention
key cf03970431c9129305090a96340c78fb5ccb0c9917ea19e35147e424a1a4b079
EXIT=0

$ head -14 data/docs/views/attention.md
---
id: doc_seedattention
type: view
…
query:
  needs: me
order: 5
---
```

Exit 0, and `order: 5` on a `type: view` document — as filed.

### Post-Implementation Verification

#### What changed

- `apps/server/src/docs/update.ts` — `assertOrderIsABoardPosition(...)`, called
  from `updateDocumentLocked` immediately after `assertNotUnarchivingByPut` and
  before anything is reconciled or written. It reads the **computed change set**,
  not the request, and the projection row's type, not the raw `type:` key. (The
  assertion itself moved to `order-rule.ts` when the create half landed — see
  the section below.)
- `apps/server/src/docs/update.test.ts` — nine cases, in two describes.
- `apps/server/src/edit/acknowledgment.test.ts` — two pre-existing tests put a
  board position on a `type: view` fixture, which the rule now refuses. Both
  moved to a `type: board` document, which is what they were describing all
  along ("a board position", "reordering the board"). No assertion changed.
- **No contract change.** `PUT /api/docs/{id}` already declares
  `400: VALIDATION_RESPONSE`, verified against the generated document rather
  than assumed: `openapi.json` → `paths./api/docs/{id}.put.responses` is
  `['200','400','401','403','404','409','422']`, and the `400` is
  `ValidationError`, whose `issues[]` is exactly the shape emitted. CONTRACT-059's
  class of gap is not reopened.

#### The three deliberate decisions

1. **`400`, not `409`.** The remedy is "drop the field and send the save again",
   which is what a `400` tells a caller to do. The route's `409` is §7's stale
   key and nothing else. It also matches `POST /api/boards/order`, which refuses
   the same thing with the same status.
2. **A no-op write passes.** The guard reads `changedFields`' output, which has
   already dropped an `order` equal to the file's. So a save that re-sends the
   `order` a legacy view already carries is the no-op it has always been. This
   is the acceptance criterion's own requirement in another form: the reader
   autosaves the frontmatter it was shown, and refusing that would make every
   document the migration exists to fix uneditable.
3. **Anything that is not a board**, not views alone. The published description
   of the field says "**It is a board's position and nothing else**", and
   `planBoard` already draws its line at `type !== "board"`. A note is refused
   too, and a test pins it.

#### Real commands, real server

Server restarted on the packaged build, workspace `/tmp/c082-ws`:

```
$ corpus doc show doc_seedattention --json | …
order = 5 | type = view                      ← the legacy key still READS

$ corpus doc list --type view
doc_seedattention    view  open  Attention     data/docs/views/attention.md
doc_seedinbox        view  open  Inbox         data/docs/views/inbox.md
doc_seedopenthreads  view  open  Open threads  data/docs/views/open-threads.md
showing 1–3 of 3 documents                   ← and still LISTS

$ corpus doc edit doc_seedattention --order 9 --from user
corpus: 400 bad_request: request failed validation
  [
    {
      "path": "body.order",
      "message": "doc_seedattention is a `view` document, not a board: `order` is
       a board's position among boards and nothing else (SPEC.md §10). Boards are
       reordered with `POST /api/boards/order`; a view is a saved query with no
       position of its own, and the same view may sit on two boards. A document
       that still carries the key from before the rule can drop it with
       `unset: [\"order\"]`."
    }
  ]
EXIT=5                                       ← non-zero, and the file still says order: 5

$ corpus doc edit doc_seedattention --unset order --from user
edited doc_seedattention
EXIT=0
$ grep -c '^order:' data/docs/views/attention.md
0                                            ← the migration's instruction still works

$ corpus doc create --type board --title Work --folder boards --from user --json
EXIT=0   → doc_zsnnpwge
$ corpus doc edit doc_zsnnpwge --order 4 --from user
edited doc_zsnnpwge
EXIT=0   → board order = 4                   ← a board is unaffected
```

#### Falsifications performed

1. **The guard's call removed.** Three tests fail: the view refusal, the note
   refusal and the "moves the stored order to another number" case — each
   `expected 200 to be 400`. The six tests that assert the *absence* of a
   refusal stay green, which is what they are for.
2. **The removal exemption removed** (`fields["order"] === undefined` deleted).
   The two clearing tests fail, `expected 400 to be 200` — an over-broad guard
   strands exactly the documents the rider was written to clean up.
3. **The guard fed the request instead of the change set.** "Stays editable"
   and "clears with `order: null`" both fail, `expected 400 to be 200` — which
   is what pins decision 2 above.

One test could not be falsified this way: **"still reads and still lists"**.
Reading is untouched by this change, so it passes with the fix absent. It is a
regression pin on the acceptance criterion, not evidence of the fix, and is
reported as such rather than counted.

#### Checks

```
vitest run apps/server        201 files, 4556 tests passed
vitest run packages/contract apps/cli   174 files, 4932 tests passed
npm run lint                  exit 0
npm run typecheck             exit 0
npm run format:check          exit 0
npm run generate -w packages/contract → openapi.json unchanged
```

#### Edge cases from the Technical Design

- **A document whose type changes from `board` to `view` while carrying
  `order`.** A `PUT` cannot change `type` (it is not in
  `UPDATABLE_FRONTMATTER_KEYS`, and `extra` refuses every reserved key), so this
  only happens out of band. Such a document then behaves exactly like the legacy
  view the second describe covers: it reads, it lists, it is clearable, and only
  a write that *moves* the number is refused.
- **`--unset order` on a view.** Covered by a test and by the E2E above.
- **A `PUT` that touches `order` with the same value.** Decided as "passes",
  with the reason written into the guard's docblock and pinned by a test.

### The create half (added on the orchestrator's decision, 2026-08-23)

#### Reproduction

Against the packaged build carrying the `PUT` guard and nothing else:

```
$ corpus doc create --type view --title Scoped --folder views --order 7 --query type=note
EXIT=0  → created type= view order= 7
```

One write path refused the field and another wrote it — the shape of the defect,
one door over.

#### What changed

- `apps/server/src/docs/order-rule.ts` (new) — the assertion, moved out of
  `update.ts` so there is **one** of it. It owns the status, the field path
  (`body.order`), the type test and the sentence. Two recovery clauses sit
  beside it as named constants, because the way out genuinely differs by path.
- `apps/server/src/docs/create.ts` — calls it at the top of `createDocument`,
  before `resolveFolder` and before the create lane is taken, so a doomed
  request never contends for the lock. It is asked of `input.order`, the
  request's own field.
- `apps/server/src/docs/update.ts` — the guard's body is gone; it calls the
  shared one with `fields["order"]`, the computed change. Byte-identical message
  and behaviour: the nine existing cases pass untouched.
- `apps/server/src/docs/create.test.ts` — four cases.
- Three pre-existing tests put an `order` on a `type: view` fixture through the
  create route. Two in `board-write.test.ts` moved to `type: board` — the keys
  they assert are written the same way whatever the type, which is what those
  cases are about. One in `kanban.test.ts` is the Phase 41 migration itself
  (`unset: ["pinned", "order"]` on a view), so its fixture is now **seeded on
  disk**: that document is a pre-rider-2 view, and writing the file is the only
  way to have one. No assertion changed in any of the three.

#### The asymmetry, stated rather than left to be rediscovered

The **no-op exemption is the update path's alone**, and the docblock says so.
`changedFields` has no analogue at creation: there is no stored value to match,
and every field a create request carries is one the caller deliberately asked to
be written. So update passes the **computed change** and create passes the
**request's own field** — the same rule, asked of the thing each path writes.

#### Real CLI, real server, after

```
$ corpus doc create --type view --title Scoped --folder views --order 7 --query type=note
corpus: 400 bad_request: request failed validation
  [
    {
      "path": "body.order",
      "message": "the document you are creating is a `view` document, not a board:
       `order` is a board's position among boards and nothing else (SPEC.md §10).
       Boards are reordered with `POST /api/boards/order`; a view is a saved query
       with no position of its own, and the same view may sit on two boards. Omit
       the field, or create the document with `type: board`."
    }
  ]
EXIT=5

$ corpus doc list --type view
… showing 1–3 of 3 documents            ← the three seeds, nothing created

$ corpus doc create --type board --title Work --folder boards --order 7
created doc_f7ehzmdf — data/docs/boards/work.md
EXIT=0   → order: 7 on disk

$ corpus doc edit doc_seedattention --order 9      → EXIT=5, the `unset` recovery
$ corpus doc edit doc_seedattention --unset order  → EXIT=0
$ corpus doc edit doc_f7ehzmdf --order 4           → EXIT=0, order: 4 on disk
```

#### Falsifications performed

4. **The create guard's call removed.** Both create refusal tests fail,
   `expected 201 to be 400` — the view is created again, with `order: 7` on it.
5. **The shared rule's type test changed** from `type === "board"` to
   `type !== "view"`, one line, one file. The **note** case fails on *both*
   paths at once — `expected 201 to be 400` on create and `expected 200 to be
   400` on update. That is the proof the sharing is real rather than two copies
   that happen to agree today.

#### Checks

```
vitest run apps/server        201 files, 4560 tests passed
npm run build                 exit 0
npm run typecheck             exit 0
npm run lint                  exit 0
npm run format:check          exit 1 — `apps/ui/e2e/zz-cascade-audit.spec.ts`,
                              an untracked ui-dev file, not touched here
```

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
