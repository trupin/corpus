# [SERVER-132] An ill-shaped `resident:` block vanishes a designation, and nothing reports it

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: SERVER-129
- Blocks: —
- Related: SHARED-052 (the `corpus check` rider, unsigned), SERVER-124

## Spec References

- SPEC.md **§7** — designation, lanes, the lapse fallback
- SPEC.md **§11** — what a check reports

## Summary

Found by the PR #52 review, 2026-08-19. `apps/server/src/core/resident.ts` parses a thread's stored `resident:` block as a whole. An ill-shaped `weight` — `weight: 3` from a hand edit, or two lines where one belongs — fails the parse and takes the **whole block** with it, so the thread reads as **undesignated**.

Failing the whole block is the right parse rule, and the reviewer agreed: you cannot honour half a designation, and it matches how a half-written `name`/`docId` pair already reads. The gap is that **nothing reports it**. The designation disappears from the roster, the resident's next park is refused, work reroutes to the orchestrator, and no surface says why.

The docblock's own defence cuts both ways: dropping just the weight would substitute *"none chosen"* for a choice somebody made, and failing the block substitutes *nobody* for that choice. Both are silent, and the second is louder.

## Acceptance Criteria

- [ ] An ill-shaped `resident:` block on a standalone thread is **reported** rather than only absorbed — `corpus check` is the natural surface (SPEC.md §11)
- [ ] The report names the file and what about the block did not parse
- [ ] The parse rule itself is unchanged: a block that does not parse still yields no designation
- [ ] Falsified: write an ill-shaped block, confirm the check reports it, remove the reporting, confirm it goes quiet

## Technical Design

### Files to Create/Modify

- `apps/server/src/core/resident.ts` — the parse, which currently discards the reason
- wherever `corpus check` gathers its findings

### Key Implementation Details

Read SHARED-052's drafted rider before deciding what a check may report — it is unsigned, and this issue must not assume its outcome. If §11 as it stands cannot carry this finding, say so in the issue rather than inventing a surface.

## Testing Strategy

Unit test over a fixture workspace with an ill-shaped block.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate a resident, hand-edit `weight:` to a number, run the check
3. Confirm it is reported, and that the roster still reads the thread as undesignated
4. Stop the server, confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-132]` prefix
