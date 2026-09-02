# [INFRA-037] A seed write can commit after the boundary, and the run is blamed for it

## Domain

infra

## Status

todo

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

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
