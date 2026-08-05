# [SERVER-058] Diff truncation keeps the frontmatter and drops the change

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-028, SERVER-052
- Blocks: —

## Spec References
- SPEC.md §9.2 `GET /api/docs/:id/diff` — "truncated at a hunk boundary with a
  `truncated` flag and the full size, never refused"

## Summary
Found by CLI-026's E2E, measured against a real server: a diff of a 93 486-character
change returned **401 characters of an allowed 16 000**.

This is the second bite of the same bug. SERVER-052 already fixed truncation
cutting at the *first* hunk header (which returned 166 of 16 000). The remaining
case is subtler and hits the **normal** edit shape:

`truncateDiff` picks the last hunk boundary ≤ cap. A typical document edit
produces a tiny `updated:` frontmatter hunk followed by one oversized body hunk,
so the only admissible boundary sits at ~401 characters. The route therefore
keeps the frontmatter timestamp, drops the entire substantive change, and leaves
~15 600 characters of budget unspent.

The consequence is worse than a short answer: the agent receives a diff that
says a document's `updated:` field changed and nothing else — a confident,
well-formed, useless answer to "what changed here". It then reasons about a
change it never saw.

SERVER-052's line-boundary fallback exists but only fires when there is **no**
admissible hunk boundary at all, which is not this case.

**The rule CLI-026 proposes, and it satisfies the contract's own stated
exception:** take the **larger** of the hunk-boundary cut and the last line
boundary ≤ cap. A line boundary inside a hunk still yields a readable unified
diff, and the contract already permits the line-boundary exception.

## Acceptance Criteria
- [ ] A diff whose only hunk boundary is early uses the budget — measured, with
      the before/after character counts recorded
- [ ] The result is still a valid unified diff that a reader can parse
- [ ] `truncated` and `totalChars` remain honest
- [ ] The frontmatter-only outcome is impossible when there is body change within
      budget — assert exactly that shape, since it is the reported one
- [ ] SERVER-052's first-hunk-header fix is not regressed (it has tests)
- [ ] A test at the shape level: tiny leading hunk, oversized following hunk

## Technical Design
### Files to Create/Modify
- `apps/server/src/edit/diff.ts` (`truncateDiff`) + tests

## Testing Strategy
Fixture-driven at the hunk shapes that matter (tiny-then-huge, one huge, many
small), asserting bytes returned against the cap.

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
