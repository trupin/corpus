# [SERVER-096] Dragging a column wider moves its document to the top of every list

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: SERVER-095 (found alongside it, in the same commit, and deliberately
  filed apart), UI's `useColumnWidth`

## Spec References

- SPEC.md **§5** — `updated` is part of a document's frontmatter
- SPEC.md **§9.2** — `GET /api/docs` is "newest-updated first by default"
- SPEC.md **§10** — the board, and the column a view document backs

## Summary

Found while diagnosing SERVER-095 in the user's live workspace, and filed apart
from it on purpose: SERVER-095 is about **who gets woken**, this is about **what
the list says**. Fixing one does not fix the other, and folding them together
would have recorded a second defect as a side effect of the first.

The same commit demonstrates both:

```
commit 4e8fc3f  Author: user  doc edit: Open threads (doc_seedopenthreads) by user

-updated: 2026-08-08T22:24:13Z
+updated: 2026-08-08T22:41:49Z
-width: 444
+width: 725
```

Someone dragged a board column wider. That bumped the view document's `updated`,
and §9.2 orders the default result set **newest-updated first** — so resizing a
column moves its document to the top of every list that shows it, ahead of
documents someone actually wrote in.

## The question this issue has to answer first

**Is `updated` "when the bytes changed" or "when the content changed"?** The
answer decides the fix, and it is not obvious:

- If it is *bytes*, the current behaviour is correct and the defect is that
  view state lives in the document at all — which makes this a UI/contract issue
  about where a column's width belongs, not a server one.
- If it is *content*, `updated` should move only when the body or the fields a
  reader would call the document's substance change, and a pure view-state write
  should leave it alone.

SERVER-095 has already drawn a line for a neighbouring question — the **body** is
what decides whether a person was writing. Reusing that line here is the obvious
move and is probably right, but it is not automatic: a title change is not a body
change, and a title change plainly should touch `updated`.

Do not implement until this is settled. If it needs the user, escalate rather
than guessing — this is a visible ordering rule for every list in the product.

## Acceptance Criteria

- [ ] The `updated` question above is answered explicitly, in this file, with
      the reasoning — not settled implicitly by whatever the diff does
- [ ] Reproduce first: resize a column, then confirm its view document has
      jumped to the head of `GET /api/docs` ordered by `updated`
- [ ] A pure view-state write no longer reorders the board
- [ ] Whatever rule is chosen is applied **consistently**, not just to `width`:
      any other field of the same class gets the same treatment, and the class is
      named rather than enumerated by accident
- [ ] A real edit still updates `updated`. Assert both directions
- [ ] Check the projection: `updated` is a column there too, and the ordering is
      SQL. A fix that only corrects the file leaves the list wrong

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/update.ts` and wherever `updated` is stamped
- Possibly `apps/ui/src/board/useColumnWidth.tsx`, if the answer is that view
  state should not be a document write at all

### Notes

- SERVER-095's `bodyChanged` computation is right next to where this decision
  has to be made, and the two rules should be visibly related in the code even
  if they turn out to differ — a later reader will ask why one write is "not a
  content edit" and yet still bumps `updated`.

## Testing Strategy

Unit, against the real write pipeline: one test per field class, asserting
whether `updated` moves; plus a projection-level test that ordering matches.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. Start a server on a free port (**never 8765 or 5173**).
2. Note the order of `GET /api/docs`.
3. `PUT /api/docs/<view-id>` with `{"extra":{"width":725}}`.
4. Expected: order unchanged.
5. Actual: the view document is now first.

## E2E Verification Log

_Filled by the implementing agent; state the model. This is a bug: the pre-fix
reproduction is mandatory._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
