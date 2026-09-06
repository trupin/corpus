# [INFRA-037] A seed write can commit after the boundary, and the run is blamed for it

## Domain

infra

## Status

done — 2026-09-06, committed on phase-58 (boundary closed via read-back)

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Related: `INFRA-033` (which built the one-shape excusal this extends),
  `INFRA-036` (the same family: the harness blaming the product for its own
  timing)

## Spec References

- None. Harness-internal.

## Summary

Found in the v0.32.0 verifying pass, 2026-09-02. Story 4 graded **fail** while
all three of its runs were **cut short**, so nothing about the product was
measured. The failure came from a universal invariant — *every commit is the
server's, acting for the agent* — and the commit it flagged is the harness's
own seeding.

Read against the boundary (`04-two-lanes-no-crossing.run-1`):

| commit | tree | parent | author | subject |
| --- | --- | --- | --- | --- |
| boundary | `e0bbe2b9` | `093d4c2f` | — | — |
| `f9c04c6c` | `e0bbe2b9` | `093d4c2f` | user | editing session: 2 documents |
| `60ee4f2f` | `3ccc2237` | `f9c04c6c` | user | **editing session: 1 document** |
| `89e75f84` | `c4781dcc` | `60ee4f2f` | agent | comment: turn by agent |

`f9c04c6c` carries the boundary's tree **and** its parent, so it is the amend
`INFRA-033` documented and the scorer correctly excuses it. **`60ee4f2f` is a
second one**, with a new tree — a seed write whose commit window closed after
`snapshotSeed` took its mark.

`snapshotSeed` waits for a clean tree before snapshotting, but the server closes
a commit window **lazily**, so "no uncommitted bytes" is not "everything the seed
wrote is committed". The boundary lands early and the seed's own last write
appears on the run's side of it.

## Why this matters more than one red row

- **It fails a scenario that measured nothing.** All three runs were cut short
  (`INFRA-036`), so story 4's grade is entirely an artifact — and a universal
  breach fails a scenario regardless of how many runs scored.
- **It is the second harness defect in this family.** `INFRA-036` was the
  harness blaming the product for stopping it; this is the harness blaming the
  product for its own seeding. Both produce reds that read exactly like product
  defects, and `AGENT-064` shows what that costs: a real finding sitting inside
  the noise.
- **The excusal cannot just be widened.** Excusing every `user` commit would
  delete the invariant, which exists because a hand-edited workspace is not a
  rehearsal. The fix has to make the boundary true, not the check loose.

## Acceptance Criteria

- [ ] The boundary is taken after **every seed write has been committed**, not
      merely after the tree is clean — so no seed commit can land on the run's
      side of it
- [ ] The tree-and-parent excusal for the lazy relabel stays exactly as narrow as
      it is. If the boundary is right, it should fire less, not more
- [ ] A cut-short run contributes **no universal findings**, for the same reason
      it contributes no score: its workspace is mid-flight and its commit windows
      may be open. Decide this deliberately — it is a real widening of
      `INFRA-036` and it must not swallow a genuine hand-edit on a completed run
- [ ] Story 4 is re-run and its grade reflects the product, whatever that turns
      out to be

## Technical Design

### Files to Create/Modify

- `rehearsals/fixture.ts` — `snapshotSeed` and `waitForCleanTree`
- `rehearsals/score.ts` — the universal-findings path, for the cut-short clause

### Notes

- **The honest way to make the boundary true** is probably to make the seed's
  last write settle deterministically rather than to wait longer — a wait is a
  guess about a lazy window, and `INFRA-033` already measured that waiting does
  not fix the amend. Look for a way to close the window rather than to outlast
  it.
- Do not reach for a longer `SEED_COMMIT_WAIT_MS`. That is the timeout-moving
  reflex `INFRA-020` was written against.

## Testing Strategy

Unit tests over the scorer for the cut-short clause. The boundary change proves
itself in a pass: story 4's universal finding should stop appearing, and the
existing tree-and-parent tests must still pass unchanged.

## E2E Verification Log

_Filled by the implementing agent; state the model._

**Pre-fix observation, 2026-09-02 (orchestrator, Opus 5):** the commit table
above, read from
`rehearsals/out/2026-09-02T18-*/04-two-lanes-no-crossing.run-1.json`. The same
`user`-authored second commit appears in the earlier pass on story 1 run 3 and
story 2 runs 1 and 10, so it is recurrent rather than a one-off.

**Implementation, 2026-09-06 (infra-dev, Fable 5):**

_Correction to the diagnosis, from the run records themselves._ The lazy-close
defect is real, but `60ee4f2f` is not a seed write. Its content includes a
`## Claude · 2026-09-02T17:56:30Z` turn — 25 s into the run — hand-written into
`data/threads/th_3fszl5np.md`, which the watcher committed out-of-band as
`user` (SPEC.md §4: an out-of-band edit belongs to the person). Same shape in
the earlier pass: `0353bc51` (story 1 run 3) holds a `## resident · 16:30:15Z`
turn. These are launched listeners editing thread files directly instead of
using the product's turn verb — AGENT-064's real bug, sitting exactly where
this issue predicted noise would hide it. What **was** the harness's own timing
is the `f9c04c6c` class: the seed window's relabel amend landing post-boundary,
which the tree-and-parent excusal absorbed.

_The mechanism chosen._ SPEC.md §4's read-back rule: any read that names a
commit closes the open window — relabel included — inside one critical section
(`AutoCommitter.withClosedWindow("read-back")`, reached via
`GET /api/docs/{id}/diff`). `snapshotSeed` now runs `corpus doc list --json` →
`corpus doc diff <first id>` after the clean-tree wait and before reading HEAD.
`SEED_COMMIT_WAIT_MS` is unchanged (TEST-1149); nothing waits longer — an amend
never dirties `git status`, so there was nothing to wait on.

_Live proof against the real product (corpus 0.33.0 build, scratch workspace
on port 55332, composer `POST /api/threads` as the seed write):_

- Before the close: tree clean, `HEAD = 008a4ae`, tree `02dc5082`, subject
  `comment: new standalone thread (th_mn66zgvl) by user` — the exact boundary
  the old `snapshotSeed` would have taken, with the window still open.
- `corpus doc diff th_mn66zgvl` → HEAD amended **during the call** to
  `1bb87a3`, same tree `02dc5082`, subject
  `editing session: 1 document by user` — the very commit that used to land
  mid-run and need the excusal, now landed before the boundary.
- A second `corpus doc diff` moved nothing (`1bb87a3` stable): the close is
  idempotent, so the boundary read after it is final.

_Cut-short clause._ `universalFindings` returns `[]` for a run with
`meta.cutShort` (rehearsals/score.ts), decided deliberately: the run's
workspace is mid-flight, and it contributes no findings for the same reason it
contributes no score. A completed run with the same `user` commit still fails —
both halves held by unit tests. The tree-and-parent excusal is untouched.

_Tests run:_ `vitest run rehearsals` — 7 files, 68 tests, all green (3 new in
`fixture.test.ts` for `firstDocumentId`, 2 new in `score.test.ts` for the
cut-short clause at both the findings and the grade level). ESLint, Prettier
and `tsc --noEmit -p rehearsals/tsconfig.json` clean on the touched files.

_What the release pass must confirm (TEST-1148/1150/1152)._ Across the full
pass: (a) no `user` commit with the boundary's tree-and-parent appears mid-run
any more — the excusal should fire rarely or never; (b) no `user` commit with a
tree the boundary does not hold appears on a **completed** run, unless it is a
genuine hand-edit — after AGENT-064, a listener writing a turn by hand must
fail a completed run, and that red is real; (c) story 4 regrades on runs that
complete, and its grade — whatever it is — is about the product.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes (ESLint + Prettier + tsc, scoped to the touched files)
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified (the last two await the release pass:
      story 4's re-run is the orchestrator's, per the sprint's S7 serialization)

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
