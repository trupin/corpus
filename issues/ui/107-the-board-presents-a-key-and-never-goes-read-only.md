# [UI-107] The board presents a key, and never goes read-only

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-049, SERVER-098

## Spec References

- SPEC.md **§7** — both writers participate
- SPEC.md **§11** — "The board is **never read-only**", and "Autosave, no save
  button"

## Summary

The board is the other writer. SHARED-041 decision 2: it presents a key too, and
adopts-then-retries on refusal — reusing the external-change handling
`DocEditor` already has.

And the read-only banner goes. A document the agent is writing stays editable.

## Acceptance Criteria

- [ ] The editor's autosave presents the key from its last read or write, and
      keeps the key each save returns
- [ ] A `409` is handled by **adopt-then-retry**, not by an error: the editor
      already knows how to take an external change (`DocEditor.tsx`'s "an
      external change while the user is typing"). A conflict is that path, with a
      retry after it
- [ ] **Nothing the person typed is lost to a conflict.** This is the criterion
      that matters. A refusal arriving mid-sentence must not discard the
      sentence; state plainly in the log what happens to in-flight text and prove
      it in a spec
- [ ] `LockBanner.tsx` and the force-unlock action are **deleted**; no document
      renders read-only, and nothing polls or subscribes to lock state
- [ ] The person sees the agent's writes land live, as they always have (§9.4) —
      confirm nothing about that depended on the lock projection
- [ ] Frontmatter controls (tags, status, due) are delta writes and keep working
      with no key at all
- [ ] The e2e stub carries the key and the `409` shape. `stubCorpus.ts` is typed
      against the contract since UI-102, so an unmodelled field is a typecheck
      error — keep it that way

## Technical Design

### Files to Create/Modify

- `apps/ui/src/editor/DocEditor.tsx`, `apps/ui/src/reader/useReaderDoc.ts`
- **Delete** `apps/ui/src/reader/LockBanner.tsx` and its usages
- `apps/ui/e2e/stubCorpus.ts`, and whatever specs assert lock behaviour

### Notes

- Conflicts should be rare in practice — the person's own autosave is the most
  frequent writer and it always holds a fresh key. The realistic trigger is the
  agent writing the open document, which is exactly the case the lock banner used
  to make loud and the spec now makes quiet.

## Testing Strategy

Component and Playwright. The conflict path needs a real spec: stub a `409`,
assert the editor adopts, retries, and keeps the person's text.

## E2E Verification Plan

`CORPUS_UI_PORT` set to a free port — **never 5173** (an ssh tunnel holds it) and
never 8765.

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
