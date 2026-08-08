# [SERVER-071] `thread create` stores the context it was sent, so agent anchors are born context-free

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: SERVER-059 (the prevention half; the repair half is UI-086)
- Sibling of: UI-068 (the other way an anchor is born orphaned)

## Spec References

- SPEC.md §6 Anchoring — the selector is a text-quote selector over the file's
  own bytes; "a visible orphan beats a silent misattachment"

## Summary

Phase A of the route chosen for SERVER-059 (user decision, 2026-08-07):
**stop creating orphans before building anything to repair them.**

`corpus thread create` stores `prefix` and `suffix` **verbatim as sent**. The
agent has no reliable way to produce them — it is quoting from what it read, not
from a byte range it holds — so in practice agent-created anchors arrive either
wrong or empty.

SERVER-055's post-mortem measured the consequence and it is sharper than "some
anchors are weak": because the stored context is empty, `contextCorroborates`
hits its `return true` on the first line, so **every anchor the agent opens
bypassed the safety check entirely**. The one gate meant to stop a fuzzy match
misattaching was inert for exactly the population it most needed to guard.

This is one of the two ways an anchor is **born** orphaned. UI-068 is the other
(the selector quotes the serializer's re-print rather than the file's bytes).
Together they are why SERVER-059's population exists at all, and why it grows.

## Acceptance Criteria

- [ ] The server computes `prefix`/`suffix` from the document's own bytes around
      the resolved `exact`, rather than trusting what the caller sent
- [ ] An anchor created through `corpus thread create` is byte-faithful to the
      file, and resolves on the next read without any fuzzy rung
- [ ] A caller that sends context anyway is not silently half-trusted — the
      server's computation wins, and the behaviour is stated in the route's
      description so the next reader does not re-derive it
- [ ] `contextCorroborates` is no longer reachable with empty context from this
      path. Its `return true` fallback stays for genuinely context-free
      anchors, but this route stops manufacturing them
- [ ] Existing threads are **not** rewritten by this issue — that is repair, and
      repair is UI-086 where the person decides. Boot and read paths stay reads
- [ ] A test asserts the created anchor against the file's bytes, not against
      what the request contained

## Technical Design

### Files to Create/Modify

- The `thread create` write path in `apps/server/src/threads/`, and whichever
  module already computes context for the UI's capture path — reuse it rather
  than writing a second one, or the two spellings will drift and this issue
  will need doing again.

### Notes

- **Do not widen this into resolution.** The temptation is to also "fix up"
  anchors that fail to resolve on read. That is precisely the move SERVER-055
  made and PR #22 reverted; the read path has no evidence and cannot decide.
  This issue only concerns the moment of creation, where the document is in
  hand and the bytes are knowable.
- Check what happens when the `exact` the caller sent matches the file more than
  once. Computing context from the *first* match would attach the thread to a
  place the caller may not have meant. Ambiguity here should refuse, not guess —
  an error at creation is cheap and visible, unlike an orphan discovered months
  later.

## Testing Strategy

Create threads through the real route against files whose canonical spelling
differs from their bytes (a padded table, a list with hard-wrapped items), and
assert the stored selector byte-for-byte against the file. Plus the ambiguous
`exact` case, asserted as refused rather than resolved.

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
