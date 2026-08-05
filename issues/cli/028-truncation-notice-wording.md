# [CLI-028] The truncation notice says "hunk boundary" when the cut may be a line boundary

## Domain
cli

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: SERVER-058
- Blocks: —

## Spec References
- SPEC.md §9.2 `GET /api/docs/:id/diff`

## Summary
Found by SERVER-058 while fixing the truncation rule it was named for.

`apps/cli/src/commands/doc/diff.ts:171` prints:

> the diff above is cut at a hunk boundary …

asserted at `diff.test.ts:263`. That was accurate when every cut was a hunk
boundary. SERVER-058 changed the rule: whole hunks are still dropped from the
end, but when the hunk that would then be dropped is **larger than the whole
bound**, the cut happens inside it at the last line boundary — because no cut
anywhere could show that hunk whole, so a prefix of it beats none of it.

That case is not exotic; it is the reported one (a document rewrite is a single
oversized hunk). So the notice now sometimes describes the cut incorrectly.

Cosmetic, and worth fixing precisely because the notice exists to stop the agent
reading a partial diff as whole — a sentence that misdescribes the cut
undermines the one job it has.

## Acceptance Criteria
- [ ] The notice describes the cut that actually happened, both cases
- [ ] It stays one line and keeps saying plainly not to read the diff as the
      whole change — that sentence is the point, not the boundary type
- [ ] The pinned assertion moves with it
- [ ] Check whether the distinction is even worth surfacing: "cut after N of M
      characters" may serve the reader better than naming the boundary at all.
      Decide deliberately rather than patching the adjective

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/doc/diff.ts`, `diff.test.ts`

## Testing Strategy
Both truncation shapes through the real formatter.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
