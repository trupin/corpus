# [UI-105] `soft-wrap.spec.ts` places the caret at the end of a visual line, and flakes

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
- Related: UI-080 (ten e2e sites sending a key straight after `click()`)

## Spec References

- Not a spec behaviour — a test defect.

## Summary

Diagnosed during UI-103 and deliberately left alone there, since it is unrelated
to that fix and fixing it would have mixed concerns.

`apps/ui/e2e/soft-wrap.spec.ts:193` fails in **2 of 3** full Playwright runs and
**0 of 24** in isolation. It positions the caret with `press("End")`, which goes
to the end of the **visual** line rather than the logical one — so under load,
when wrapping settles differently, the typed character lands mid-word
(`offic!e opens later.`).

It cannot be UI-103's serializer change: `separateListItemBlocks` returns
`undefined` for any parent that is not a `listItem`, and the document this spec
uses contains no list.

## Acceptance Criteria

- [ ] The caret is placed by a means that does not depend on where the text
      happens to wrap
- [ ] The spec passes under `--repeat-each 4` in a full run, not only in
      isolation — isolation is what hid this
- [ ] Check the sibling specs for the same idiom. `press("End")` in a wrapped
      editor is wrong wherever it appears, and UI-080 already records that this
      suite has a family of timing-shaped caret bugs

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/soft-wrap.spec.ts`.

### Notes

- A flake that only appears under load is the kind that gets re-run rather than
  read. Fix the cause; do not add a retry.

## Testing Strategy

The spec itself, under `--repeat-each 4` in a full run.

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
