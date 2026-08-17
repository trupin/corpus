# [CONTRACT-054] Designating an archived agent succeeds silently, and the response cannot say so

## Domain

contract (then server)

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-043 (which could not implement its own acceptance criterion
  because of this), SERVER-109 (which made the decision deliberately)

## Spec References

- SPEC.md **§7** — designation is user-only state on a standalone thread

## Summary

`CLI-043` carried an acceptance criterion requiring `corpus thread designate` to
**warn inline when the response carries `status: "archived"`**. It is
unimplementable as written: the designation response carries no archived signal
at all.

This was a deliberate server decision, stated in
`apps/server/src/threads/resident.ts:150-153`, and CLI-043 verified the
behaviour against a real server: designating an archived agent-def succeeds
cleanly, `status` is `open` (the *thread's* status, not the agent's), `resident`
carries no status, and `warnings` is empty.

So the CLI could only warn by issuing a second `GET /api/docs/{docId}` and
re-deriving what the server chose not to publish — which is both a round trip
per designation and a client re-implementing a server judgment. CLI-043
escalated rather than doing that, correctly.

## The question this issue has to answer first

**Is designating an archived agent something a person should be warned about?**
Do not assume the acceptance criterion was right merely because it was written
down. There is a real case for silence: an archived agent-def is still a
document, designation is user-only state, and a person who archived a definition
and then designated it may well mean it. There is also a real case for warning:
archiving is how a person says "this is no longer current", and designating one
by name — most likely from a stale note or an old thread — is the kind of thing
worth one line of feedback.

If the answer is *no warning*, this issue closes by **removing the criterion
from CLI-043** and recording why, which is a legitimate outcome and cheaper than
building the mechanism.

## If the answer is yes

- [ ] The designation response carries whatever the client needs — most likely
      the resident's own document status — so no second request is required
- [ ] `SERVER-109`'s comment at `threads/resident.ts:150-153` is updated rather
      than left contradicting the new behaviour
- [ ] `openapi.json` regenerated; the field described in terms of what it is
      for, not merely its type
- [ ] A follow-up CLI issue restores the criterion CLI-043 could not meet

## Testing Strategy

Contract-side: the schema and its generation. Server-side: designating an
archived definition returns the signal, and designating a current one does not.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-054]` prefix
