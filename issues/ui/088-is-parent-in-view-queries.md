# [UI-088] A view cannot be told to show top-level documents only

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-042, SERVER-073
- Blocks: —
- Related: UI-087 (the rendering half of the same complaint)

## Spec References

- SPEC.md §11 — columns and saved views are filtered lists
- SPEC.md §9.2 — the filter set a view query composes from

## Summary

The surface the user actually asked for: *"so I can show parents only in
views."* CONTRACT-042 and SERVER-073 make `isParent` answerable; this makes it
reachable from a column or saved view without hand-editing the query.

## Acceptance Criteria

- [ ] A column or saved view can be set to show top-level documents only, and
      the setting survives a reload the way the rest of a view's query does
- [ ] It reads as **what it does** wherever it is shown. The parameter is named
      `isParent` but selects roots (CONTRACT-042), so a label reading "is a
      parent" would be actively wrong. The UI is where a person meets this, and
      the label is the only explanation they get
- [ ] A view that does not set it is unchanged — no column silently starts
      hiding rows after this ships
- [ ] It composes visibly with the filters already on the view, rather than
      replacing them
- [ ] Reachable from the keyboard like every other affordance (§11 adds no
      exclusive-pointer capability)

## Technical Design

### Files to Create/Modify

- `apps/ui/src/board/viewDoc.ts` and the column query editor; check
  `apps/ui/src/board/newList.ts` for where a new column's query is composed.

### Notes

- Check how the existing boolean filters (`pinned`, `unread`, `stale`) are
  presented and follow that, rather than introducing a second idiom for the same
  kind of control.
- A saved view is a document, so its query is content on disk — confirm a query
  written by an older build still loads once this parameter exists.

## Testing Strategy

A view with the filter set returns only top-level rows; a view without it is
byte-identical in behaviour to before. Plus the label assertion — a test that
pins the wording is worth having precisely because the parameter's name
contradicts its meaning.

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
