# [UI-057] No test guards the widened-fence round-trip

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- —

## Summary
Spun out of AGENT-012's investigation (2026-08-03). A four-backtick fence whose
body contains a three-backtick fence survives a parse→serialize→reparse cycle as
exactly one code block — verified by probe against the repo's own printer:

```
PARSE   -> code blocks: 1
REPARSE -> code blocks: 1
WIDENED FENCE KEPT: true
```

That property is what keeps the editor from **corrupting a document on autosave**
— splitting one snippet into several on disk — and nothing currently guards it.
`serialize.test.ts` and `roundtrip.test.ts` have no nested-fence fixture
(grepped: no "widen", no backtick-run case), and `serialize.ts`'s stated
normalisation reads "fences are ``` and keep their language string", which a
future reader could reasonably implement as a cap.

The behavior is correct today because `remark-stringify` does the widening and
`serialize.ts` deliberately delegates printing to it. The risk is a later change
that hand-rolls part of that path, or a printer option that turns widening off,
breaking documents with no test failing.

## Acceptance Criteria
- [ ] A round-trip test with a fence whose payload contains a shorter fence:
      one code block in, one out, delimiter still wide enough
- [ ] The general case, not just three-into-four — a payload containing ````
      must round-trip inside a five-backtick fence
- [ ] Placed with the other round-trip fixtures so it runs with them
- [ ] `serialize.ts`'s normalisation comment says the fence widens as needed,
      so the docblock stops implying a fixed three

## Technical Design
### Files to Create/Modify
- `apps/ui/src/editor/markdown/roundtrip.test.ts` (or `serialize.test.ts`)
- `apps/ui/src/editor/markdown/serialize.ts` (comment only)

## Testing Strategy
Fixture-driven, alongside the existing round-trip cases.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
