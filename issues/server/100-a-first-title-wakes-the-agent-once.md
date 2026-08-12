# [SERVER-100] A document with no `title:` wakes the agent on the save that adds one

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
- Related: SERVER-095 (introduced the condition this refines)

## Spec References

- SPEC.md **§4** "Edit acknowledgment" — a session is opened by a change to what
  the document **says**: its body, or the title it goes by

## Summary

Found by PR #42's third review pass, and filed rather than fixed because it is
arguably correct behaviour rather than a defect.

`projection/project-document.ts:171` derives a row's title from
`data["title"] ?? data["name"] ?? titleFromPath(...)`, so a document's
frontmatter can carry **no** `title` key at all while the reader still displays
one. When the reader autosaves, it sends the title it is displaying;
`sameValue(undefined, "…")` is false, so `title` lands in `fields` and opens an
edit session — waking the agent for a change nobody made.

Self-limiting: the save genuinely adds `title:` to the file, and every subsequent
save compares equal. So it fires **once** per such document, ever.

## The question to answer before changing anything

Is this wrong? §4 says a session opens on "the title it goes by". A document
whose title was derived from its filename and is now written into its frontmatter
has, arguably, had the title it goes by pinned down — which is a real editorial
event, and the one acknowledgment is honest.

The counter-argument: nothing a reader can see changed, and the person did not
type anything. §4's line is about what the document says, and it said the same
thing before and after.

**Decide this explicitly, in this file, before touching the comparison.** If the
answer is "it is correct", close the issue with the reasoning rather than
weakening a condition that is doing its job.

## Acceptance Criteria

- [ ] The question above is answered in writing, with the reasoning
- [ ] If it is a defect: a save that writes a title equal to the one the
      projection already derived opens no session
- [ ] The genuine rename case still opens one — the fix must not reach it
- [ ] SERVER-095's 15 acknowledgment cases still pass unchanged

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/update.ts` — the comparison, if it changes at all

## Testing Strategy

A document created out of band with `name:` or no title, then a reader autosave.

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
