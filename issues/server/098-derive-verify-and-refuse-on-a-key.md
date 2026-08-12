# [SERVER-098] Derive the key, verify it, and refuse with the document

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-049
- Blocks: SERVER-099

## Spec References

- SPEC.md **§7** "A key, not a lock" — every paragraph
- SPEC.md **§9.2** — the Keys bullet
- SPEC.md **§4** — the edit session, which is where the advisory signal comes from

## Summary

The server half of SHARED-041: compute a document's key, check it on the writes
that need one, refuse a stale one with the current document and a fresh key, and
report whether a person has a session open.

This issue **adds**. SERVER-099 removes the lock subsystem. They are separate so
each is reviewable on its own, and they land in the same PR.

## Acceptance Criteria

- [ ] Every read that returns a document returns its key, derived per
      CONTRACT-049. No stored state, no registry, nothing to expire
- [ ] A body-replacing or whole-frontmatter `PUT` **requires** a key. Missing is
      refused exactly as stale is — an optional check reproduces the lock
- [ ] A delta-naming write takes no key and is unaffected: tags, folder, status,
      `reviewed`, archive, unarchive, move. So is `POST /api/docs/{id}/patch`
- [ ] A stale key answers `409` with the document as it now stands and a fresh
      key. **Nothing is written** — assert the file on disk is untouched and no
      commit was made
- [ ] The advisory signal reports whether a **person** has an edit session open
      (`edit/sessions.ts` already knows — expose it, do not build new tracking).
      It never refuses anything
- [ ] An **out-of-band edit invalidates a key**, with no watcher involvement. This
      falls out of deriving from content; prove it rather than assume it
- [ ] A **move does not invalidate a key** (§9.2: the id never changes)
- [ ] The key a write returns is the key of what was **stored**, after anchor
      reconciliation (§6) — not of what the caller sent. Otherwise a writer's own
      next write is refused by its own reconciliation
- [ ] Concurrency: two writes presenting the same key, one wins, one gets `409`.
      Serialised against the same mutex the write path already holds

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/key.ts` (new) — derivation, one place
- `apps/server/src/docs/update.ts`, `read.ts`, `routes.ts`
- `apps/server/src/edit/sessions.ts` — expose "is a session open on this doc"

### Key Implementation Details

Derive from the **stored bytes** — the serialized document — rather than from the
parsed model, so anything that changes the file changes the key, including
changes nothing has modelled yet.

The check belongs where `updateDocumentLocked` already reads the document under
the document mutex. Reading, comparing and writing must be inside one critical
section or the check is decorative.

### Edge Cases

- **A document that does not exist**: `404`, not `409`. The key question never
  arises.
- **A write whose key is valid but whose content is identical**: lands as a
  no-op save (§9.2) and returns the same key. Not a conflict.
- **The reconciliation case above** is the subtle one and deserves its own test:
  write body B with key K, the server reconciles anchors and stores B′, and the
  returned key must be key(B′).

## Testing Strategy

Unit and integration against the real write pipeline. The conflict path is the
one to over-test: assert the refusal's payload, that nothing was written, that
no commit was made, and that the fresh key works on retry.

## E2E Verification Plan

Real server on a free port (**never 8765 or 5173**), scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`. Never write to
`/Users/theophanerupin/cos` — the user's real workspace.

Read a document, edit the file in an external editor, then write with the old
key: refused, with the current content back. Retry with the fresh key: lands.

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
